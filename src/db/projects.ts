import { and, eq, inArray, sql } from "drizzle-orm";
import type { ProjectForm, RunConfig } from "../core/forms";
import type { Database } from "./client";
import { recordEvent } from "./events";
import { setAnthropicResources } from "./runs";
import {
  githubTasks,
  projectRunConfigs,
  projectSecrets,
  projects,
} from "./schema";

export class DuplicateProjectError extends Error {
  constructor(repository: string) {
    super(`${repository} is already listed on Yarrow.`);
  }
}

function projectValues(form: ProjectForm) {
  return {
    name: form.name,
    description: form.description,
    productUrl: form.productUrl || null,
    repository: form.repository,
    visibility: form.visibility,
    categories: form.categories,
    stacks: [...new Set(form.stacks)],
    authorizationLabel: form.authorizationLabel,
  };
}

export async function createProject(
  db: Database,
  accountId: string,
  userId: string,
  form: ProjectForm,
): Promise<string> {
  const [existing] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(sql`lower(${projects.repository}) = lower(${form.repository})`);
  if (existing) throw new DuplicateProjectError(form.repository);
  return db.transaction(async (tx) => {
    const [project] = await tx
      .insert(projects)
      .values({ accountId, ...projectValues(form) })
      .returning({ id: projects.id });
    await recordEvent(tx, {
      type: "project.created",
      accountId,
      projectId: project!.id,
      userId,
      payload: { visibility: form.visibility, categories: form.categories },
    });
    return project!.id;
  });
}

export async function updateProject(
  db: Database,
  projectId: string,
  userId: string,
  form: ProjectForm,
): Promise<void> {
  const [clash] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        sql`lower(${projects.repository}) = lower(${form.repository})`,
        sql`${projects.id} <> ${projectId}`,
      ),
    );
  if (clash) throw new DuplicateProjectError(form.repository);
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ repository: projects.repository })
      .from(projects)
      .where(eq(projects.id, projectId));
    const repositoryChanged =
      current?.repository.toLowerCase() !== form.repository.toLowerCase();
    await tx
      .update(projects)
      .set({
        ...projectValues(form),
        // A new repository needs a new GitHub App installation link.
        ...(repositoryChanged
          ? { githubInstallationId: null, githubRepositoryId: null }
          : {}),
      })
      .where(eq(projects.id, projectId));
    await recordEvent(tx, {
      type: "project.updated",
      projectId,
      userId,
      payload: { visibility: form.visibility, repositoryChanged },
    });
  });
}

/**
 * Links GitHub App installations to listed projects, matched by repository
 * name. Returns the IDs of the projects that were linked.
 */
export async function linkGithubRepositories(
  db: Database,
  installationId: string,
  repositories: { fullName: string; id: string; defaultBranch?: string }[],
  /** Only projects of these accounts may be linked: the installer's. */
  accountIds?: string[],
): Promise<string[]> {
  if (accountIds && accountIds.length === 0) return [];
  const linked: string[] = [];
  for (const repository of repositories) {
    const rows = await db
      .update(projects)
      .set({
        githubInstallationId: installationId,
        githubRepositoryId: repository.id,
        ...(repository.defaultBranch
          ? { defaultBranch: repository.defaultBranch }
          : {}),
      })
      .where(
        and(
          sql`(lower(${projects.repository}) = lower(${repository.fullName}) or ${projects.githubRepositoryId} = ${repository.id})`,
          accountIds ? inArray(projects.accountId, accountIds) : undefined,
        ),
      )
      .returning({ id: projects.id, repository: projects.repository });
    for (const row of rows) {
      linked.push(row.id);
      // Keep the canonical name after a rename on GitHub.
      if (row.repository !== repository.fullName)
        await db
          .update(projects)
          .set({ repository: repository.fullName })
          .where(eq(projects.id, row.id));
      await recordEvent(db, {
        type: "project.github_linked",
        projectId: row.id,
        payload: { installationId },
      });
    }
  }
  return linked;
}

/**
 * One project per newly installed repository, owned by the installer's
 * account (decided 2026-10-06: nothing typed that the repo already says).
 * Repositories already listed anywhere are skipped. The brain then reads
 * the repo details and creates the label (setup_project task).
 */
export async function createProjectsFromInstallation(
  db: Database,
  accountId: string,
  installationId: string,
  repositories: { id: string; fullName: string; private: boolean }[],
): Promise<string[]> {
  const created: string[] = [];
  for (const repository of repositories) {
    const id = await db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          sql`(lower(${projects.repository}) = lower(${repository.fullName}) or ${projects.githubRepositoryId} = ${repository.id})`,
        );
      if (existing) return null;
      const [project] = await tx
        .insert(projects)
        .values({
          accountId,
          name: repository.fullName.split("/")[1] ?? repository.fullName,
          repository: repository.fullName,
          githubRepositoryId: repository.id,
          githubInstallationId: installationId,
          // Private code stays private: only the name and description show.
          visibility: repository.private ? "listed" : "public",
        })
        .onConflictDoNothing()
        .returning({ id: projects.id });
      if (!project) return null;
      await tx
        .insert(githubTasks)
        .values({ projectId: project.id, kind: "setup_project" });
      await recordEvent(tx, {
        type: "project.created",
        accountId,
        projectId: project.id,
        payload: { from: "github_install", private: repository.private },
      });
      return project.id;
    });
    if (id) created.push(id);
  }
  return created;
}

export async function unlinkGithubRepositories(
  db: Database,
  installationId: string,
  repositoryIds?: string[],
): Promise<void> {
  const scope = repositoryIds
    ? and(
        eq(projects.githubInstallationId, installationId),
        inArray(projects.githubRepositoryId, repositoryIds),
      )
    : eq(projects.githubInstallationId, installationId);
  await db.update(projects).set({ githubInstallationId: null }).where(scope);
}

export async function saveRunConfig(
  db: Database,
  projectId: string,
  config: RunConfig,
): Promise<void> {
  const values = {
    setupCommand: config.setupCommand || null,
    seedCommand: config.seedCommand || null,
    startCommand: config.startCommand || null,
    appPort: config.appPort,
    env: config.env,
    updatedAt: new Date(),
  };
  await db
    .insert(projectRunConfigs)
    .values({ projectId, ...values })
    .onConflictDoUpdate({ target: projectRunConfigs.projectId, set: values });
}

/** Only the vault reference is stored; the secret value never touches our DB. */
export async function recordSecretReference(
  db: Database,
  projectId: string,
  secret: { name: string; providerCredentialId: string; allowedHost: string },
): Promise<void> {
  await db
    .insert(projectSecrets)
    .values({ projectId, ...secret })
    .onConflictDoUpdate({
      target: [projectSecrets.projectId, projectSecrets.name],
      set: {
        providerCredentialId: secret.providerCredentialId,
        allowedHost: secret.allowedHost,
      },
    });
  // The sandbox environment's allowed hosts derive from the secrets.
  await setAnthropicResources(db, projectId, { environmentId: null });
}

export async function deleteSecretReference(
  db: Database,
  projectId: string,
  name: string,
): Promise<string | null> {
  const [deleted] = await db
    .delete(projectSecrets)
    .where(
      and(
        eq(projectSecrets.projectId, projectId),
        eq(projectSecrets.name, name),
      ),
    )
    .returning({ credentialId: projectSecrets.providerCredentialId });
  if (deleted)
    await setAnthropicResources(db, projectId, { environmentId: null });
  return deleted?.credentialId ?? null;
}

export async function suspendProject(
  db: Database,
  projectId: string,
  reason: string,
): Promise<void> {
  await db
    .update(projects)
    .set({ suspendedAt: new Date() })
    .where(eq(projects.id, projectId));
  await recordEvent(db, {
    type: "project.suspended",
    projectId,
    payload: { reason },
  });
}
