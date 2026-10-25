import { and, asc, eq, like, sql } from "drizzle-orm";
import {
  reserve as reserveBalance,
  settle as settleBalance,
} from "../core/budget";
import {
  runRequestSchema,
  runResultSchema,
  type RunRequest,
  type RunResult,
} from "../core/contracts";
import { defaultPipelineRoles, type PipelineRoles } from "../core/pipeline";
import type { Database } from "./client";
import { recordEvent, type Transaction } from "./events";
import {
  agentRuns,
  contributions,
  correctionRequests,
  ledgerEntries,
  projects,
  pullRequests,
  results,
  runFundings,
  sponsorProfiles,
  sponsorProjectSelections,
  workUnits,
} from "./schema";

const availableCents = sql<number>`(${contributions.creditCents} - ${contributions.reservedCents} - ${contributions.debitedCents})::int`;

/**
 * Settled contributions whose sponsor filters accept this project, oldest money
 * first, locked for the rest of the transaction. "Every project" includes
 * hidden ones (decided 2026-10-07): Listed projects already show no code.
 */
function eligibleContributions(tx: Transaction, projectId: string) {
  const selected = sql`exists (select 1 from ${sponsorProjectSelections} where ${sponsorProjectSelections.userId} = ${contributions.userId} and ${sponsorProjectSelections.projectId} = ${projects.id})`;
  return tx
    .select({
      id: contributions.id,
      creditCents: contributions.creditCents,
      reservedCents: contributions.reservedCents,
      debitedCents: contributions.debitedCents,
      available: availableCents,
    })
    .from(contributions)
    .innerJoin(projects, eq(projects.id, projectId))
    .leftJoin(sponsorProfiles, eq(sponsorProfiles.userId, contributions.userId))
    .where(
      and(
        eq(contributions.paymentStatus, "settled"),
        sql`${availableCents} > 0`,
        sql`(
          (coalesce(${sponsorProfiles.mode}, 'all_except') = 'all_except'
            and not ${selected}
            and not (${projects.categories} && coalesce(${sponsorProfiles.excludedCategories}, '{}')))
          or (${sponsorProfiles.mode} = 'only' and ${selected})
        )`,
        sql`(coalesce(cardinality(${sponsorProfiles.requiredStacks}), 0) = 0 or ${projects.stacks} && ${sponsorProfiles.requiredStacks})`,
      ),
    )
    .orderBy(asc(contributions.createdAt), asc(contributions.id))
    .for("update", { of: contributions });
}

/** Server-only mutations. Reservations and settlements are atomic and retry-safe. */
export class PostgresLedger {
  constructor(
    private readonly db: Database,
    private readonly roles: PipelineRoles = defaultPipelineRoles,
  ) {}

  /** Starts a run and reserves its initial budget. Returns the cents reserved. */
  async reserve(input: RunRequest): Promise<number> {
    const run = runRequestSchema.parse(input);
    return this.db.transaction(async (tx) => {
      const [work] = await tx
        .select()
        .from(workUnits)
        .where(eq(workUnits.id, run.workUnitId))
        .for("update");
      if (!work?.authorized) throw new Error("Work unit is not authorized");
      const [existing] = await tx
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.id, run.runId));
      if (existing) {
        if (
          existing.workUnitId !== run.workUnitId ||
          existing.kind !== run.kind ||
          existing.instruction !== (run.instruction ?? null)
        )
          throw new Error("Run idempotency conflict");
        return existing.reservedCents;
      }
      const [project] = await tx
        .select()
        .from(projects)
        .where(eq(projects.id, work.projectId));
      if (!project || project.suspendedAt)
        throw new Error("Project is suspended");
      if (run.kind === "implementation" && work.status !== "queued")
        throw new Error("Work unit is not queued");
      if (run.kind === "correction") {
        if (work.status !== "delivered")
          throw new Error("Corrections need a delivered pull request");
        const [busy] = await tx
          .select({ id: agentRuns.id })
          .from(agentRuns)
          .where(
            and(
              eq(agentRuns.workUnitId, work.id),
              eq(agentRuns.status, "running"),
            ),
          );
        if (busy)
          throw new Error("Another run is in progress on this work unit");
        const [request] = await tx
          .select()
          .from(correctionRequests)
          .where(eq(correctionRequests.id, run.correctionRequestId!))
          .for("update");
        if (
          !request ||
          request.workUnitId !== work.id ||
          request.status !== "queued" ||
          request.instruction !== run.instruction
        )
          throw new Error("Correction request is not queued");
      }
      await tx.insert(agentRuns).values({
        id: run.runId,
        workUnitId: run.workUnitId,
        kind: run.kind,
        instruction: run.instruction ?? null,
        implementer: this.roles.implementer,
        reviewer: this.roles.reviewer,
      });
      const reserved = await reserveFrom(
        tx,
        run.runId,
        project.id,
        run.budgetCents,
        0,
      );
      if (reserved === 0) throw new Error("No eligible funds");
      if (run.kind === "implementation")
        await tx
          .update(workUnits)
          .set({ status: "running" })
          .where(eq(workUnits.id, work.id));
      else
        await tx
          .update(correctionRequests)
          .set({ status: "dispatched", agentRunId: run.runId })
          .where(eq(correctionRequests.id, run.correctionRequestId!));
      await recordEvent(tx, {
        type: "run.started",
        accountId: project.accountId,
        projectId: project.id,
        workUnitId: work.id,
        agentRunId: run.runId,
        payload: { kind: run.kind, reservedCents: reserved },
      });
      return reserved;
    });
  }

  /**
   * Reserves more budget for a running run (there is no cap). `step` numbers each
   * top-up so a retried call never reserves twice. Returns the cents reserved
   * by this step, which can be 0 when no eligible money is left.
   */
  async reserveMore(
    runId: string,
    amountCents: number,
    step: number,
  ): Promise<number> {
    if (!Number.isSafeInteger(step) || step < 1)
      throw new Error("Top-up steps start at 1");
    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.id, runId))
        .for("update");
      if (!run || run.status !== "running")
        throw new Error("Run is not active");
      const prior = await tx
        .select({ amount: ledgerEntries.amountCents })
        .from(ledgerEntries)
        .where(
          like(ledgerEntries.idempotencyKey, `${runId}:reserve:${step}:%`),
        );
      if (prior.length > 0)
        return prior.reduce((sum, entry) => sum + entry.amount, 0);
      const [work] = await tx
        .select({ projectId: workUnits.projectId })
        .from(workUnits)
        .where(eq(workUnits.id, run.workUnitId));
      const reserved = await reserveFrom(
        tx,
        runId,
        work!.projectId,
        amountCents,
        step,
      );
      await recordEvent(tx, {
        type: "run.reserved_more",
        projectId: work!.projectId,
        workUnitId: run.workUnitId,
        agentRunId: runId,
        payload: { step, requestedCents: amountCents, reservedCents: reserved },
      });
      return reserved;
    });
  }

  async settle(runId: string, input: RunResult): Promise<void> {
    const result = runResultSchema.parse(input);
    await this.db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.id, runId))
        .for("update");
      if (!run) throw new Error("Run not found");
      if (run.status !== "running") {
        const [existing] = await tx
          .select()
          .from(results)
          .where(eq(results.agentRunId, runId));
        if (!existing || !sameResult(run, existing, result))
          throw new Error("Settlement idempotency conflict");
        return;
      }
      const fundings = await tx
        .select({ funding: runFundings, contribution: contributions })
        .from(runFundings)
        .innerJoin(
          contributions,
          eq(contributions.id, runFundings.contributionId),
        )
        .where(eq(runFundings.agentRunId, runId))
        .orderBy(asc(contributions.createdAt), asc(contributions.id))
        .for("update", { of: contributions });
      let remaining = result.actualCostCents;
      for (const { funding, contribution } of fundings) {
        const debit = Math.min(remaining, funding.reservedCents);
        remaining -= debit;
        const balance = settleBalance(
          contribution,
          funding.reservedCents,
          debit,
        );
        await tx
          .update(contributions)
          .set({
            reservedCents: balance.reservedCents,
            debitedCents: balance.debitedCents,
          })
          .where(eq(contributions.id, contribution.id));
        await tx
          .update(runFundings)
          .set({ debitedCents: debit })
          .where(
            and(
              eq(runFundings.agentRunId, runId),
              eq(runFundings.contributionId, contribution.id),
            ),
          );
        await tx.insert(ledgerEntries).values([
          {
            contributionId: contribution.id,
            agentRunId: runId,
            kind: "debit",
            amountCents: debit,
            idempotencyKey: `${runId}:debit:${contribution.id}`,
          },
          {
            contributionId: contribution.id,
            agentRunId: runId,
            kind: "release",
            amountCents: funding.reservedCents - debit,
            idempotencyKey: `${runId}:release:${contribution.id}`,
          },
        ]);
      }
      await tx
        .update(agentRuns)
        .set({
          status: result.outcome === "pull_request" ? "completed" : "abstained",
          debitedCents: result.actualCostCents - remaining,
          uncoveredCents: remaining,
          finishedAt: new Date(),
        })
        .where(eq(agentRuns.id, runId));
      await tx.insert(results).values({
        agentRunId: runId,
        outcome: result.outcome,
        summary: result.summary,
        pullRequestUrl:
          result.outcome === "pull_request" ? result.pullRequestUrl : null,
        abstentionReason: result.outcome === "abstained" ? result.reason : null,
        evidence: result.evidence,
        review: result.review ?? null,
        artifacts: result.artifacts,
      });
      if (result.outcome === "pull_request") {
        const [pullRequest] = await tx
          .select()
          .from(pullRequests)
          .where(eq(pullRequests.workUnitId, run.workUnitId));
        if (pullRequest && pullRequest.url !== result.pullRequestUrl)
          throw new Error("A work unit has exactly one pull request");
        if (!pullRequest)
          await tx.insert(pullRequests).values({
            workUnitId: run.workUnitId,
            url: result.pullRequestUrl,
            number: result.pullRequestNumber,
            branch: result.branch,
          });
      }
      if (run.kind === "implementation")
        await tx
          .update(workUnits)
          .set({
            status:
              result.outcome === "pull_request" ? "delivered" : "abstained",
          })
          .where(eq(workUnits.id, run.workUnitId));
      await recordEvent(tx, {
        type: "run.finished",
        workUnitId: run.workUnitId,
        agentRunId: runId,
        payload: {
          kind: run.kind,
          outcome: result.outcome,
          reason: result.outcome === "abstained" ? result.reason : null,
          actualCostCents: result.actualCostCents,
          uncoveredCents: remaining,
        },
      });
    });
  }

  /** Live progress shown on the run page. */
  async setPhase(runId: string, phase: string): Promise<void> {
    await this.db
      .update(agentRuns)
      .set({ phase })
      .where(and(eq(agentRuns.id, runId), eq(agentRuns.status, "running")));
  }

  /** Called from the GitHub webhook when the owner merges or closes the PR. */
  async closePullRequest(
    url: string,
    state: "merged" | "closed",
    rejectionReason?: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [pullRequest] = await tx
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.url, url))
        .for("update");
      if (!pullRequest) throw new Error("Pull request not found");
      if (pullRequest.state !== "open") {
        if (pullRequest.state !== state)
          throw new Error("Pull request is already closed");
        return;
      }
      await tx
        .update(pullRequests)
        .set({
          state,
          rejectionReason:
            state === "closed" ? (rejectionReason ?? null) : null,
          closedAt: new Date(),
        })
        .where(eq(pullRequests.id, pullRequest.id));
      await tx
        .update(workUnits)
        .set({ status: "closed" })
        .where(eq(workUnits.id, pullRequest.workUnitId));
      await recordEvent(tx, {
        type:
          state === "merged" ? "pull_request.merged" : "pull_request.closed",
        workUnitId: pullRequest.workUnitId,
        payload: { url, rejectionReason: rejectionReason ?? null },
      });
    });
  }
}

/** Takes eligible money, oldest first, until `amountCents` is covered or none is left. */
async function reserveFrom(
  tx: Transaction,
  runId: string,
  projectId: string,
  amountCents: number,
  step: number,
): Promise<number> {
  let remaining = amountCents;
  for (const candidate of await eligibleContributions(tx, projectId)) {
    if (remaining === 0) break;
    const amount = Math.min(remaining, candidate.available);
    const balance = reserveBalance(candidate, amount);
    await tx
      .update(contributions)
      .set({ reservedCents: balance.reservedCents })
      .where(eq(contributions.id, candidate.id));
    await tx
      .insert(runFundings)
      .values({
        agentRunId: runId,
        contributionId: candidate.id,
        reservedCents: amount,
      })
      .onConflictDoUpdate({
        target: [runFundings.agentRunId, runFundings.contributionId],
        set: { reservedCents: sql`${runFundings.reservedCents} + ${amount}` },
      });
    await tx.insert(ledgerEntries).values({
      contributionId: candidate.id,
      agentRunId: runId,
      kind: "reserve",
      amountCents: amount,
      idempotencyKey: `${runId}:reserve:${step}:${candidate.id}`,
    });
    remaining -= amount;
  }
  const reserved = amountCents - remaining;
  if (reserved > 0)
    await tx
      .update(agentRuns)
      .set({ reservedCents: sql`${agentRuns.reservedCents} + ${reserved}` })
      .where(eq(agentRuns.id, runId));
  return reserved;
}

function sameResult(
  run: typeof agentRuns.$inferSelect,
  existing: typeof results.$inferSelect,
  result: RunResult,
): boolean {
  return (
    run.debitedCents + run.uncoveredCents === result.actualCostCents &&
    existing.outcome === result.outcome &&
    existing.summary === result.summary &&
    JSON.stringify(existing.evidence) === JSON.stringify(result.evidence) &&
    existing.pullRequestUrl ===
      (result.outcome === "pull_request" ? result.pullRequestUrl : null) &&
    existing.abstentionReason ===
      (result.outcome === "abstained" ? result.reason : null)
  );
}
