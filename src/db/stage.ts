import { eq } from "drizzle-orm";
import type { AppRecipe } from "../core/contracts";
import type { Database } from "./client";
import { projectRunConfigs, projects, pullRequests, workUnits } from "./schema";

/** What a pull request's stage needs: where its branch is, how its app runs. */
export interface StageContext {
  repository: string;
  githubInstallationId: string | null;
  githubRepositoryId: string | null;
  branch: string;
  recipe: AppRecipe | null;
}

export async function stageContext(
  db: Database,
  workUnitId: string,
): Promise<StageContext | null> {
  const [row] = await db
    .select({
      repository: projects.repository,
      githubInstallationId: projects.githubInstallationId,
      githubRepositoryId: projects.githubRepositoryId,
      branch: pullRequests.branch,
      recipe: projectRunConfigs.recipe,
    })
    .from(workUnits)
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .innerJoin(pullRequests, eq(pullRequests.workUnitId, workUnits.id))
    .leftJoin(projectRunConfigs, eq(projectRunConfigs.projectId, projects.id))
    .where(eq(workUnits.id, workUnitId));
  return row ?? null;
}
