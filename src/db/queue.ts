import { and, eq, isNotNull, isNull, lt, max } from "drizzle-orm";
import type { DispatchCandidate, DispatchState } from "../core/queue";
import type { Database } from "./client";
import {
  agentRuns,
  correctionRequests,
  projects,
  pullRequests,
  workUnits,
} from "./schema";

const CANDIDATE_LIMIT = 500;

/** Everything the dispatcher needs to plan one cycle. */
export async function loadDispatch(
  db: Database,
  limits: { perAccountLimit: number; globalLimit: number },
): Promise<{ candidates: DispatchCandidate[]; state: DispatchState }> {
  const dispatchable = and(
    isNull(projects.suspendedAt),
    isNotNull(projects.githubInstallationId),
  );
  const implementations = await db
    .select({
      workUnitId: workUnits.id,
      accountId: projects.accountId,
      queuedAt: workUnits.queuedAt,
    })
    .from(workUnits)
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(
      and(
        eq(workUnits.status, "queued"),
        eq(workUnits.authorized, true),
        dispatchable,
      ),
    )
    .orderBy(workUnits.queuedAt)
    .limit(CANDIDATE_LIMIT);
  const corrections = await db
    .select({
      id: correctionRequests.id,
      workUnitId: correctionRequests.workUnitId,
      accountId: projects.accountId,
      queuedAt: correctionRequests.queuedAt,
    })
    .from(correctionRequests)
    .innerJoin(workUnits, eq(workUnits.id, correctionRequests.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .innerJoin(pullRequests, eq(pullRequests.workUnitId, workUnits.id))
    .where(
      and(
        eq(correctionRequests.status, "queued"),
        eq(workUnits.status, "delivered"),
        eq(pullRequests.state, "open"),
        dispatchable,
      ),
    )
    .orderBy(correctionRequests.queuedAt)
    .limit(CANDIDATE_LIMIT);
  const running = await db
    .select({
      accountId: projects.accountId,
      workUnitId: agentRuns.workUnitId,
    })
    .from(agentRuns)
    .innerJoin(workUnits, eq(workUnits.id, agentRuns.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(eq(agentRuns.status, "running"));
  const served = await db
    .select({ accountId: projects.accountId, at: max(agentRuns.createdAt) })
    .from(agentRuns)
    .innerJoin(workUnits, eq(workUnits.id, agentRuns.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .groupBy(projects.accountId);

  const runningByAccount = new Map<string, number>();
  for (const run of running)
    runningByAccount.set(
      run.accountId,
      (runningByAccount.get(run.accountId) ?? 0) + 1,
    );
  return {
    candidates: [
      ...implementations.map((row): DispatchCandidate => ({
        kind: "implementation",
        id: row.workUnitId,
        workUnitId: row.workUnitId,
        accountId: row.accountId,
        queuedAt: row.queuedAt,
      })),
      ...corrections.map((row): DispatchCandidate => ({
        kind: "correction",
        id: row.id,
        workUnitId: row.workUnitId,
        accountId: row.accountId,
        queuedAt: row.queuedAt,
      })),
    ],
    state: {
      runningByAccount,
      lastServedAt: new Map(
        served
          .filter((row) => row.at)
          .map((row) => [row.accountId, new Date(row.at!)]),
      ),
      busyWorkUnits: new Set(running.map((run) => run.workUnitId)),
      ...limits,
    },
  };
}

export async function correctionInstruction(
  db: Database,
  correctionRequestId: string,
): Promise<string> {
  const [row] = await db
    .select({ instruction: correctionRequests.instruction })
    .from(correctionRequests)
    .where(eq(correctionRequests.id, correctionRequestId));
  if (!row) throw new Error("Correction request not found");
  return row.instruction;
}

/** Runs still marked running after `olderThan`: the dispatcher re-creates their workflow. */
export async function staleRunningRuns(db: Database, olderThan: Date) {
  return db
    .select({
      runId: agentRuns.id,
      workUnitId: agentRuns.workUnitId,
      kind: agentRuns.kind,
      instruction: agentRuns.instruction,
      reservedCents: agentRuns.reservedCents,
      correctionRequestId: correctionRequests.id,
    })
    .from(agentRuns)
    .leftJoin(
      correctionRequests,
      eq(correctionRequests.agentRunId, agentRuns.id),
    )
    .where(
      and(eq(agentRuns.status, "running"), lt(agentRuns.createdAt, olderThan)),
    );
}
