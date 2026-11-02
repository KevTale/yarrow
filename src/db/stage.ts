import { and, desc, eq } from "drizzle-orm";
import type { AppRecipe } from "../core/contracts";
import type { Database } from "./client";
import {
  agentRuns,
  projectRunConfigs,
  projects,
  pullRequests,
  results,
  workUnits,
} from "./schema";

/** What a pull request's stage needs: where its branch is, how its app runs. */
export interface StageContext {
  repository: string;
  githubInstallationId: string | null;
  githubRepositoryId: string | null;
  branch: string;
  base: string;
  recipe: AppRecipe | null;
  /** The newest presentation's timeline, by its key in the evidence store. */
  presentation: string | null;
}

export async function stageContext(
  db: Database,
  workUnitId: string,
): Promise<StageContext | null> {
  const [[row], delivered] = await Promise.all([
    db
      .select({
        repository: projects.repository,
        githubInstallationId: projects.githubInstallationId,
        githubRepositoryId: projects.githubRepositoryId,
        branch: pullRequests.branch,
        base: projects.defaultBranch,
        recipe: projectRunConfigs.recipe,
      })
      .from(workUnits)
      .innerJoin(projects, eq(projects.id, workUnits.projectId))
      .innerJoin(pullRequests, eq(pullRequests.workUnitId, workUnits.id))
      .leftJoin(projectRunConfigs, eq(projectRunConfigs.projectId, projects.id))
      .where(eq(workUnits.id, workUnitId)),
    db
      .select({ artifacts: results.artifacts })
      .from(results)
      .innerJoin(agentRuns, eq(agentRuns.id, results.agentRunId))
      .where(
        and(
          eq(agentRuns.workUnitId, workUnitId),
          eq(results.outcome, "pull_request"),
        ),
      )
      .orderBy(desc(agentRuns.createdAt)),
  ]);
  if (!row) return null;
  // A correction with nothing new to show recorded none: the last one still holds.
  const film = delivered
    .flatMap(({ artifacts }) => artifacts)
    .find((artifact) => artifact.kind === "presentation");
  return { ...row, presentation: film?.key ?? null };
}
