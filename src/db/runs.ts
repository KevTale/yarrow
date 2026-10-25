import { eq } from "drizzle-orm";
import type { RunModelUsage } from "../core/pipeline";
import type { Database } from "./client";
import {
  agentRuns,
  projectRunConfigs,
  projectSecrets,
  projects,
  pullRequests,
  runModels,
  trackerBoards,
  trackerConnections,
  workUnits,
} from "./schema";

/** Everything the brain needs to execute one run. */
export async function runContext(db: Database, runId: string) {
  const [row] = await db
    .select({
      run: agentRuns,
      workUnit: workUnits,
      project: projects,
    })
    .from(agentRuns)
    .innerJoin(workUnits, eq(workUnits.id, agentRuns.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(eq(agentRuns.id, runId));
  if (!row) throw new Error(`Run ${runId} not found`);
  const [pullRequest] = await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.workUnitId, row.workUnit.id));
  const [runConfig] = await db
    .select()
    .from(projectRunConfigs)
    .where(eq(projectRunConfigs.projectId, row.project.id));
  const secrets = await db
    .select({
      name: projectSecrets.name,
      allowedHost: projectSecrets.allowedHost,
    })
    .from(projectSecrets)
    .where(eq(projectSecrets.projectId, row.project.id));
  const [tracker] = row.workUnit.boardId
    ? await db
        .select({ board: trackerBoards, connection: trackerConnections })
        .from(trackerBoards)
        .innerJoin(
          trackerConnections,
          eq(trackerConnections.id, trackerBoards.connectionId),
        )
        .where(eq(trackerBoards.id, row.workUnit.boardId))
    : [];
  return {
    ...row,
    pullRequest: pullRequest ?? null,
    runConfig: runConfig ?? null,
    secrets,
    tracker: tracker ?? null,
  };
}
export type RunContext = Awaited<ReturnType<typeof runContext>>;

/** Records the Managed Agents environment or vault created for a project. */
export async function setAnthropicResources(
  db: Database,
  projectId: string,
  resources: { environmentId?: string | null; vaultId?: string | null },
): Promise<void> {
  const values = {
    ...(resources.environmentId !== undefined
      ? { anthropicEnvironmentId: resources.environmentId }
      : {}),
    ...(resources.vaultId !== undefined
      ? { anthropicVaultId: resources.vaultId }
      : {}),
  };
  await db
    .insert(projectRunConfigs)
    .values({ projectId, ...values })
    .onConflictDoUpdate({ target: projectRunConfigs.projectId, set: values });
}

/** Stores what each model did on a run. Idempotent: Workflow steps may retry. */
export async function recordRunModels(
  db: Database,
  runId: string,
  models: RunModelUsage[],
): Promise<void> {
  for (const model of models) {
    const { role, ...values } = model;
    await db
      .insert(runModels)
      .values({ agentRunId: runId, role, ...values })
      .onConflictDoUpdate({
        target: [runModels.agentRunId, runModels.role],
        set: values,
      });
  }
}
