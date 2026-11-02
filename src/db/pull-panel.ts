import { and, asc, eq } from "drizzle-orm";
import type { Criterion, ResultDetails } from "../core/contracts";
import { modelDisplayName } from "../core/pipeline";
import { previewSignIn } from "../core/preview";
import type { Proof } from "../core/proofs";
import {
  blockingComments,
  type ReviewComment,
  type StoredArtifact,
  type StoredReview,
} from "../core/review";
import { phaseStatus, type PaidBy } from "../core/tickets";
import type { Database } from "./client";
import {
  agentRuns,
  correctionRequests,
  projectRunConfigs,
  pullRequests,
  results,
  runModels,
  spottedTickets,
  workUnits,
} from "./schema";
import { sponsorsByUnit } from "./tickets";

/** One model's part across every run of the ticket, corrections included. */
export interface PanelModel {
  role: "implementer" | "reviewer";
  name: string;
  seconds: number | null;
  secondsExact: boolean;
  costCents: number;
  costExact: boolean;
}

export interface PanelCorrection {
  id: string;
  instruction: string;
  requestedBy: string;
  askedAt: string;
  status: "queued" | "working" | "done" | "stopped";
  summary: string | null;
}

/** A reviewer's comment, where it points in the code when it does. */
export interface PanelComment {
  path: string | null;
  line: number | null;
  body: string;
}

const panelComment = (comment: ReviewComment): PanelComment => ({
  path: comment.path ?? null,
  line: comment.line ?? null,
  body: comment.body,
});

/** The pull request as it stands, after the corrections delivered so far. */
export interface PullRequestNow {
  /** What the ticket asks; none on pull requests delivered before it. */
  ask: string | null;
  summary: string;
  /** What the ticket asks, ticked; none before acceptance criteria. */
  criteria: Criterion[];
  verification: string[];
  notVerified: string[];
  risks: string[];
  spotted: string[];
  /** Delivered before these were apart: the description's Risks stand in. */
  legacy: boolean;
}

interface DeliveredRun {
  kind: "implementation" | "correction";
  outcome: "pull_request" | "abstained" | null;
  summary: string | null;
  evidence: string[] | null;
  details: ResultDetails | null;
}

/**
 * The implementation sets what the pull request does; each correction that
 * rewrote the whole summary replaces it. One without leaves it as it was.
 * What the ticket asks is the implementation's: a correction keeps it.
 */
export function pullRequestNow(runs: DeliveredRun[]): PullRequestNow | null {
  let now: PullRequestNow | null = null;
  let ask: string | null = null;
  for (const run of runs) {
    if (run.outcome !== "pull_request" || !run.summary) continue;
    const summary =
      run.kind === "implementation"
        ? run.summary
        : run.details?.pullRequestSummary;
    if (!summary || (run.kind === "correction" && !now)) continue;
    if (run.kind === "implementation") ask = run.details?.ask ?? null;
    now = {
      ask,
      summary,
      criteria: run.details?.criteria ?? [],
      verification: run.evidence ?? [],
      notVerified: run.details?.notVerified ?? [],
      risks: run.details?.risks ?? [],
      spotted: run.details?.spotted ?? [],
      legacy: !run.details,
    };
  }
  return now;
}

/** What a correction is told the pull request does before it starts. */
export async function pullRequestSummaryNow(
  db: Database,
  workUnitId: string,
): Promise<string | null> {
  const runs = await db
    .select({
      kind: agentRuns.kind,
      outcome: results.outcome,
      summary: results.summary,
      evidence: results.evidence,
      details: results.details,
    })
    .from(agentRuns)
    .innerJoin(results, eq(results.agentRunId, agentRuns.id))
    .where(eq(agentRuns.workUnitId, workUnitId))
    .orderBy(asc(agentRuns.createdAt));
  return pullRequestNow(runs)?.summary ?? null;
}

/** The ticket's pull request number, null before one is opened. */
export async function pullNumber(
  db: Database,
  projectId: string,
  key: string,
): Promise<number | null> {
  const [row] = await db
    .select({ number: pullRequests.number })
    .from(pullRequests)
    .innerJoin(workUnits, eq(workUnits.id, pullRequests.workUnitId))
    .where(
      and(eq(workUnits.projectId, projectId), eq(workUnits.externalId, key)),
    );
  return row?.number ?? null;
}

/**
 * What the builder reads when a ticket's row opens: what the implementer
 * did and checked, the review, the corrections asked since, the models and
 * what they cost, who paid. GitHub's side (draft, diff size, risks) is read
 * live by the server function.
 */
export interface PanelData {
  workUnitId: string;
  /** The run that opened the pull request: its public page is shared. */
  runId: string | null;
  pullRequest: {
    number: number;
    url: string;
    state: "open" | "merged" | "closed";
    branch: string;
  } | null;
  implementation: ({ by: string } & PullRequestNow) | null;
  review: {
    by: string;
    /** The pull request as it stands, told by the reviewer; none before. */
    changed: string | null;
    summary: string;
    /** What the fix round left broken: usually none. */
    blocking: PanelComment[];
    suggestions: PanelComment[];
  } | null;
  corrections: PanelCorrection[];
  /** A run at work now: what it does, as the table words it. */
  working: "writing" | "reviewing" | "delivering" | null;
  models: PanelModel[];
  totalCents: number;
  /** Every run's own duration added up, in seconds; null while one works. */
  totalSeconds: number | null;
  paidBy: PaidBy[];
  /** The latest delivered run's screenshots and videos, served by /evidence. */
  screens: StoredArtifact[];
  /**
   * The open pull request's app at its own address (src/core/preview.ts),
   * once Yarrow knows how to run it; with the recipe's test sign-in.
   */
  preview: {
    signIn: { login: string; password: string } | null;
    /** The page a proof names; the recipe's own before proofs. */
    path: string | null;
  } | null;
  /**
   * What proves the pull request (src/core/proofs.ts), from the latest run
   * that recorded some; null when it was delivered before proofs.
   */
  proofs: Proof[] | null;
}

/**
 * The proofs that stand: the latest run's that recorded some (a correction
 * that changed nothing to show keeps the earlier ones); none recorded since
 * proofs exist, an empty list; delivered before them, null.
 */
export function standingProofs(
  runs: { outcome: string | null; details: unknown }[],
): Proof[] | null {
  let proofs: Proof[] | null = null;
  for (const run of runs) {
    if (run.outcome !== "pull_request") continue;
    const recorded = (run.details as ResultDetails | null)?.proofs;
    if (!recorded) continue;
    if (recorded.length > 0 || proofs === null) proofs = recorded;
  }
  return proofs;
}

export async function pullPanel(
  db: Database,
  projectId: string,
  key: string,
): Promise<PanelData | null> {
  const [unit] = await db
    .select()
    .from(workUnits)
    .where(
      and(eq(workUnits.projectId, projectId), eq(workUnits.externalId, key)),
    );
  if (!unit) return null;
  // Independent reads, sent together on the one connection.
  const [runs, [pull], requests, recorded, paidBy, made, [config]] =
    await Promise.all([
      db
        .select({
          id: agentRuns.id,
          kind: agentRuns.kind,
          status: agentRuns.status,
          phase: agentRuns.phase,
          implementer: agentRuns.implementer,
          reviewer: agentRuns.reviewer,
          createdAt: agentRuns.createdAt,
          finishedAt: agentRuns.finishedAt,
          outcome: results.outcome,
          summary: results.summary,
          evidence: results.evidence,
          review: results.review,
          details: results.details,
          artifacts: results.artifacts,
        })
        .from(agentRuns)
        .leftJoin(results, eq(results.agentRunId, agentRuns.id))
        .where(eq(agentRuns.workUnitId, unit.id))
        .orderBy(asc(agentRuns.createdAt)),
      db
        .select()
        .from(pullRequests)
        .where(eq(pullRequests.workUnitId, unit.id)),
      db
        .select()
        .from(correctionRequests)
        .where(eq(correctionRequests.workUnitId, unit.id))
        .orderBy(asc(correctionRequests.queuedAt)),
      db
        .select({
          role: runModels.role,
          model: runModels.model,
          seconds: runModels.seconds,
          secondsExact: runModels.secondsExact,
          costCents: runModels.costCents,
          costExact: runModels.costExact,
        })
        .from(runModels)
        .innerJoin(agentRuns, eq(agentRuns.id, runModels.agentRunId))
        .where(eq(agentRuns.workUnitId, unit.id)),
      sponsorsByUnit(db, [unit.id]),
      db
        .select({ note: spottedTickets.note })
        .from(spottedTickets)
        .where(eq(spottedTickets.workUnitId, unit.id)),
      db
        .select({ recipe: projectRunConfigs.recipe })
        .from(projectRunConfigs)
        .where(eq(projectRunConfigs.projectId, projectId)),
    ]);

  const delivered = runs.find(
    (run) => run.kind === "implementation" && run.outcome === "pull_request",
  );
  const reviewed = [...runs]
    .reverse()
    .find((run) => run.outcome === "pull_request" && run.review);
  const review = reviewed?.review as StoredReview | null | undefined;

  const models = (["implementer", "reviewer"] as const).flatMap((role) => {
    const rows = recorded.filter((row) => row.role === role);
    if (rows.length === 0) return [];
    const timed = rows.filter((row) => row.seconds !== null);
    return [
      {
        role,
        name: modelDisplayName(rows[0]!.model),
        seconds: timed.length
          ? timed.reduce((sum, row) => sum + row.seconds!, 0)
          : null,
        secondsExact: rows.every((row) => row.secondsExact),
        costCents: rows.reduce((sum, row) => sum + row.costCents, 0),
        costExact: rows.every((row) => row.costExact),
      },
    ];
  });

  const running = runs.find((run) => run.status === "running");
  const now = pullRequestNow(runs);
  const proofs = standingProofs(runs);
  // The app is offered where a proof names its page, or on a pull request
  // delivered before proofs.
  const page = proofs?.find((proof) => proof.kind === "app");
  return {
    workUnitId: unit.id,
    runId: delivered?.id ?? null,
    pullRequest: pull
      ? {
          number: pull.number,
          url: pull.url,
          state: pull.state,
          branch: pull.branch,
        }
      : null,
    implementation:
      delivered && now
        ? {
            by: modelDisplayName(delivered.implementer.split(":")[0]!),
            ...now,
            // A suggestion made a ticket leaves the list.
            spotted: now.spotted.filter(
              (line) => !made.some((row) => row.note === line),
            ),
          }
        : null,
    review: review
      ? {
          by: modelDisplayName(review.reviewer),
          changed: review.changed ?? null,
          summary: review.summary,
          blocking: blockingComments(review).map(panelComment),
          suggestions: review.comments
            .filter((comment) => comment.severity === "suggestion")
            .slice(0, 3)
            .map(panelComment),
        }
      : null,
    corrections: requests
      .filter((request) => request.status !== "cancelled")
      .map((request) => {
        const run = runs.find(
          (candidate) => candidate.id === request.agentRunId,
        );
        return {
          id: request.id,
          instruction: request.instruction,
          requestedBy: request.requestedBy,
          askedAt: new Date(request.queuedAt).toISOString(),
          status: !run
            ? "queued"
            : run.status === "running"
              ? "working"
              : run.outcome === "pull_request"
                ? "done"
                : "stopped",
          summary: run?.summary ?? null,
        };
      }),
    working: running ? phaseStatus(running.phase) : null,
    models,
    totalCents: models.reduce((sum, model) => sum + model.costCents, 0),
    totalSeconds: running
      ? null
      : runs.reduce(
          (sum, run) =>
            run.finishedAt
              ? sum +
                Math.round(
                  (new Date(run.finishedAt).getTime() -
                    new Date(run.createdAt).getTime()) /
                    1000,
                )
              : sum,
          0,
        ) || null,
    paidBy: paidBy.get(unit.id) ?? [],
    screens:
      ([...runs]
        .reverse()
        .find((run) => run.outcome === "pull_request" && run.artifacts?.length)
        ?.artifacts as StoredArtifact[] | undefined) ?? [],
    preview:
      pull?.state === "open" && config?.recipe && (proofs === null || page)
        ? {
            signIn: previewSignIn(config.recipe.signIn),
            path: page?.path ?? null,
          }
        : null,
    proofs,
  };
}

/** A suggestion of the pull request's sidebar, made a ticket: it leaves the list. */
export async function madeSpottedTicket(
  db: Database,
  input: { projectId: string; key: string; note: string; ticketKey: string },
): Promise<void> {
  const [unit] = await db
    .select({ id: workUnits.id })
    .from(workUnits)
    .where(
      and(
        eq(workUnits.projectId, input.projectId),
        eq(workUnits.externalId, input.key),
      ),
    );
  if (!unit) return;
  await db
    .insert(spottedTickets)
    .values({
      workUnitId: unit.id,
      note: input.note,
      ticketKey: input.ticketKey,
    })
    .onConflictDoNothing();
}
