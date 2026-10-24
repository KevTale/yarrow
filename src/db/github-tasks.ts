import { and, asc, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Database } from "./client";
import { accountMembers, githubTasks, projects } from "./schema";

export type GithubTaskKind = (typeof githubTasks.$inferSelect)["kind"];

/** Tries before a task is left alone (its last error stays visible). */
export const MAX_GITHUB_TASK_ATTEMPTS = 5;

/** Asks the brain for a GitHub write. Asking again re-opens a finished task. */
export async function requestGithubTask(
  db: Database,
  task: { projectId: string; kind: GithubTaskKind; issueNumber?: number },
): Promise<void> {
  const reopen = { doneAt: null, attempts: 0, lastError: null };
  await db
    .insert(githubTasks)
    .values({ ...task, issueNumber: task.issueNumber ?? 0 })
    .onConflictDoUpdate({
      target: [
        githubTasks.projectId,
        githubTasks.kind,
        githubTasks.issueNumber,
      ],
      set: reopen,
    });
}

export type PendingGithubTask = {
  id: string;
  kind: GithubTaskKind;
  issueNumber: number;
  projectId: string;
  repository: string;
  githubRepositoryId: string;
  installationId: string;
  label: string;
};

/** Oldest first, so a project's setup runs before its tickets get labeled. */
export async function pendingGithubTasks(
  db: Database,
  limit = 10,
): Promise<PendingGithubTask[]> {
  const rows = await db
    .select({
      id: githubTasks.id,
      kind: githubTasks.kind,
      issueNumber: githubTasks.issueNumber,
      projectId: projects.id,
      repository: projects.repository,
      githubRepositoryId: projects.githubRepositoryId,
      installationId: projects.githubInstallationId,
      label: projects.authorizationLabel,
    })
    .from(githubTasks)
    .innerJoin(projects, eq(projects.id, githubTasks.projectId))
    .where(
      and(
        isNull(githubTasks.doneAt),
        lt(githubTasks.attempts, MAX_GITHUB_TASK_ATTEMPTS),
        sql`${projects.githubInstallationId} is not null`,
        sql`${projects.githubRepositoryId} is not null`,
        isNull(projects.suspendedAt),
      ),
    )
    .orderBy(asc(githubTasks.createdAt))
    .limit(limit);
  return rows as PendingGithubTask[];
}

export async function finishGithubTask(
  db: Database,
  id: string,
  error?: string,
): Promise<void> {
  await db
    .update(githubTasks)
    .set(
      error
        ? {
            attempts: sql`${githubTasks.attempts} + 1`,
            lastError: error.slice(0, 500),
          }
        : { doneAt: new Date(), lastError: null },
    )
    .where(eq(githubTasks.id, id));
}

/** What the repository says about itself, read by the brain at setup. */
export type RepositoryDetails = {
  description: string | null;
  homepage: string | null;
  defaultBranch: string;
  languages: string[];
};

/** Fills what the owner has not set yet; never overwrites their edits. */
export async function applyRepositoryDetails(
  db: Database,
  projectId: string,
  details: RepositoryDetails,
): Promise<void> {
  const stacks = details.languages
    .map((language) => language.toLowerCase().replace(/\s+/g, "-"))
    .filter((tag) => /^[a-z0-9][a-z0-9.+#-]{0,31}$/.test(tag))
    .slice(0, 5);
  const homepage = /^https?:\/\//.test(details.homepage ?? "")
    ? details.homepage
    : null;
  const [project] = await db
    .select({
      description: projects.description,
      productUrl: projects.productUrl,
      stacks: projects.stacks,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return;
  await db
    .update(projects)
    .set({
      defaultBranch: details.defaultBranch,
      description:
        project.description || (details.description ?? "").slice(0, 500),
      productUrl: project.productUrl ?? homepage,
      stacks: project.stacks.length > 0 ? project.stacks : stacks,
    })
    .where(eq(projects.id, projectId));
}

export type ConnectedProject = {
  id: string;
  name: string;
  repository: string;
  visibility: "public" | "listed" | "hidden";
  linked: boolean;
};

/** The viewer's projects, newest first, with their GitHub link state. */
export async function projectsForUser(
  db: Database,
  userId: string,
): Promise<ConnectedProject[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      repository: projects.repository,
      visibility: projects.visibility,
      installationId: projects.githubInstallationId,
    })
    .from(projects)
    .innerJoin(accountMembers, eq(accountMembers.accountId, projects.accountId))
    .where(eq(accountMembers.userId, userId))
    .orderBy(desc(projects.createdAt));
  return rows.map(({ installationId, ...row }) => ({
    ...row,
    linked: installationId !== null,
  }));
}

/**
 * A pasted ticket on one of the viewer's connected repositories: the brain
 * labels it on GitHub, which queues it. Returns the project, or null when the
 * repository is not (yet) connected by this user.
 */
export async function requestTicket(
  db: Database,
  userId: string,
  repository: string,
  issueNumber: number,
): Promise<string | null> {
  const project = (await projectsForUser(db, userId)).find(
    (row) =>
      row.linked && row.repository.toLowerCase() === repository.toLowerCase(),
  );
  if (!project) return null;
  await requestGithubTask(db, {
    projectId: project.id,
    kind: "label_issue",
    issueNumber,
  });
  return project.id;
}
