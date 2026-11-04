import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  projectFormSchema,
  projectSecretSchema,
  runConfigSchema,
} from "@/core/forms";
import { ensureAccount, requireProjectMember } from "@/db/accounts";
import type { Database } from "@/db/client";
import {
  createProject,
  deleteSecretReference,
  importProject,
  recordSecretReference,
  saveRunConfig,
  setProjectVisibility,
  updateProject,
} from "@/db/projects";
import { projectsForUser } from "@/db/github-tasks";
import { ownerDashboard, projectForOwner } from "@/db/queries";
import { setAnthropicResources } from "@/db/runs";
import {
  addBoard,
  connectionsForAccount,
  getConnection,
  removeBoard,
} from "@/db/trackers";
import { getViewer, requireViewer } from "@/server/auth.server";
import { syncInstallation } from "@/server/github/installation";
import { removeProject, trackerContext } from "@/server/jira.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { appEnv, NotConfiguredError } from "@/server/env.server";
import { STATE_COOKIE, storeTrackerTokens } from "@/server/integrations.server";
import {
  accessTokenFor,
  trackerAdapter,
  trackerSecretsFromEnv,
  type TrackerName,
} from "@/server/trackers/index";
import { ManagedAgentsClient } from "@/runner/anthropic";

export const getOwnerDashboardFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const viewer = await getViewer().catch(() => null);
    if (!viewer) return { status: "signed_out" as const };
    if (!databaseConfigured()) return { status: "not_configured" as const };
    return withDb(async (db) => ({
      status: "ok" as const,
      ...(await ownerDashboard(db, viewer.userId)),
    }));
  },
);

export const createProjectFn = createServerFn({ method: "POST" })
  .validator(projectFormSchema)
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    const projectId = await withDb(async (db) => {
      const accountId = await ensureAccount(db, viewer);
      return createProject(db, accountId, viewer.userId, data);
    });
    return { projectId };
  });

const projectId = z.object({ projectId: z.uuid() });

/** What a project's connections show, in its settings and in the setup. */
async function projectSetup(db: Database, id: string, accountId: string) {
  const env = appEnv();
  const secrets = trackerSecretsFromEnv(env);
  return {
    status: "ok" as const,
    ...(await projectForOwner(db, id))!,
    connections: await connectionsForAccount(db, accountId),
    githubInstallUrl: githubInstallUrl(),
    trackersAvailable: {
      linear: Boolean(secrets.linear && secrets.encryptionKey),
      jira: Boolean(secrets.jira && secrets.encryptionKey),
      trello: Boolean(secrets.trello && secrets.encryptionKey),
    },
    secretsAvailable: Boolean(env.ANTHROPIC_API_KEY),
  };
}

const githubInstallUrl = () =>
  `https://github.com/apps/${appEnv().GITHUB_APP_SLUG}/installations/new`;

/**
 * The setup lists what GitHub lists for the viewer's installations, whatever
 * webhook went missing. GitHub out of reach: the list stays as it was.
 */
async function syncInstallations(
  db: Database,
  connected: { installationId: string | null }[],
) {
  const env = appEnv();
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return;
  const credentials = {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
  };
  const installations = new Set(
    connected
      .map((project) => project.installationId)
      .filter((id): id is string => id !== null && /^\d+$/.test(id)),
  );
  await Promise.all(
    [...installations].map((id) =>
      syncInstallation(db, credentials, id).catch((error) =>
        console.error("sync installation", id, error),
      ),
    ),
  );
}

export const getProjectFn = createServerFn({ method: "GET" })
  .validator(projectId)
  .handler(async ({ data }) => {
    const viewer = await getViewer().catch(() => null);
    if (!viewer) return { status: "signed_out" as const };
    if (!databaseConfigured()) return { status: "not_configured" as const };
    return withDb(async (db) => {
      const project = await requireProjectMember(
        db,
        viewer.userId,
        data.projectId,
      );
      return projectSetup(db, project.id, project.accountId);
    });
  });

/**
 * The setup after connecting GitHub: the repositories that came, and the
 * connections of the one being set up (the newest, unless one is chosen).
 */
export const getStartFn = createServerFn({ method: "GET" })
  .validator(z.object({ projectId: z.uuid().optional() }))
  .handler(async ({ data }) => {
    const viewer = await getViewer().catch(() => null);
    if (!viewer) return { status: "signed_out" as const };
    if (!databaseConfigured()) return { status: "not_configured" as const };
    return withDb(async (db) => {
      await syncInstallations(db, await projectsForUser(db, viewer.userId));
      const repositories = (await projectsForUser(db, viewer.userId)).filter(
        (project) => project.linked,
      );
      const chosen =
        repositories.find((project) => project.id === data.projectId) ??
        repositories.find((project) => !project.imported) ??
        repositories[0];
      return {
        status: "ok" as const,
        repositories: repositories
          .map(({ id, repository, imported }) => ({ id, repository, imported }))
          .sort((a, b) => a.repository.localeCompare(b.repository)),
        githubInstallUrl: githubInstallUrl(),
        setup: chosen
          ? await projectSetup(db, chosen.id, chosen.accountId)
          : null,
      };
    });
  });

/** The repository chosen in the setup: the only ones that show. */
export const importProjectFn = createServerFn({ method: "POST" })
  .validator(projectId)
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    await withDb(async (db) => {
      await requireProjectMember(db, viewer.userId, data.projectId);
      await importProject(db, data.projectId, viewer.userId);
    });
  });

/** Remove project, from its settings: "busy" while one of its tickets works. */
export const removeProjectFn = createServerFn({ method: "POST" })
  .validator(projectId)
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    const status = await withDb((db) =>
      removeProject(db, trackerContext(), viewer.userId, data.projectId),
    );
    return { status };
  });

export const updateProjectFn = createServerFn({ method: "POST" })
  .validator(projectFormSchema.extend(projectId.shape))
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    const { projectId: id, ...form } = data;
    await withDb(async (db) => {
      await requireProjectMember(db, viewer.userId, id);
      await updateProject(db, id, viewer.userId, form);
    });
    return { saved: true };
  });

/** The visibility on the settings page: saved as soon as it is chosen. */
export const setProjectVisibilityFn = createServerFn({ method: "POST" })
  .validator(
    projectId.extend({ visibility: z.enum(["public", "listed", "hidden"]) }),
  )
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    await withDb(async (db) => {
      await requireProjectMember(db, viewer.userId, data.projectId);
      await setProjectVisibility(
        db,
        data.projectId,
        viewer.userId,
        data.visibility,
      );
    });
    return { saved: true };
  });

export const saveRunConfigFn = createServerFn({ method: "POST" })
  .validator(runConfigSchema.extend(projectId.shape))
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    const { projectId: id, ...config } = data;
    await withDb(async (db) => {
      await requireProjectMember(db, viewer.userId, id);
      await saveRunConfig(db, id, config);
    });
    return { saved: true };
  });

function vaultClient(): ManagedAgentsClient {
  const key = appEnv().ANTHROPIC_API_KEY;
  if (!key) throw new NotConfiguredError("Test secrets (ANTHROPIC_API_KEY)");
  return new ManagedAgentsClient(key);
}

/** The value goes straight to the Managed Agents vault; we keep a reference only. */
export const addSecretFn = createServerFn({ method: "POST" })
  .validator(projectSecretSchema.extend(projectId.shape))
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    const client = vaultClient();
    await withDb(async (db) => {
      const project = await requireProjectMember(
        db,
        viewer.userId,
        data.projectId,
      );
      const details = await projectForOwner(db, project.id);
      let vaultId = details?.runConfig?.anthropicVaultId ?? null;
      if (!vaultId) {
        vaultId = (await client.createVault(`yarrow project ${project.id}`)).id;
        await setAnthropicResources(db, project.id, { vaultId });
      }
      const previous = await deleteSecretReference(db, project.id, data.name);
      if (previous)
        await client.deleteSecret(vaultId, previous).catch(() => undefined);
      const credential = await client.createSecret(vaultId, {
        name: data.name,
        value: data.value,
        allowedHost: data.allowedHost,
      });
      await recordSecretReference(db, project.id, {
        name: data.name,
        providerCredentialId: credential.id,
        allowedHost: data.allowedHost,
      });
    });
    return { saved: true };
  });

export const deleteSecretFn = createServerFn({ method: "POST" })
  .validator(projectId.extend({ name: z.string().min(1) }))
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    await withDb(async (db) => {
      const project = await requireProjectMember(
        db,
        viewer.userId,
        data.projectId,
      );
      const details = await projectForOwner(db, project.id);
      const credentialId = await deleteSecretReference(
        db,
        project.id,
        data.name,
      );
      const vaultId = details?.runConfig?.anthropicVaultId;
      if (credentialId && vaultId)
        await vaultClient()
          .deleteSecret(vaultId, credentialId)
          .catch(() => undefined);
    });
    return { deleted: true };
  });

export const listTrackerBoardsFn = createServerFn({ method: "GET" })
  .validator(projectId.extend({ connectionId: z.uuid() }))
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    const env = appEnv();
    return withDb(async (db) => {
      const project = await requireProjectMember(
        db,
        viewer.userId,
        data.projectId,
      );
      const connection = await getConnection(db, data.connectionId);
      if (!connection || connection.accountId !== project.accountId)
        throw new Error("Connection not found");
      const secrets = trackerSecretsFromEnv(env);
      const name = connection.tracker as TrackerName;
      const credentials = secrets[name];
      if (!credentials) throw new NotConfiguredError(`${name} integration`);
      const accessToken = await accessTokenFor(db, connection, secrets);
      return trackerAdapter(name).listBoards(
        { externalId: connection.externalId, accessToken },
        credentials,
      );
    });
  });

export const addBoardFn = createServerFn({ method: "POST" })
  .validator(
    projectId.extend({
      connectionId: z.uuid(),
      externalBoardId: z.string().min(1).max(200),
      name: z.string().min(1).max(200),
    }),
  )
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    await withDb(async (db) => {
      await requireProjectMember(db, viewer.userId, data.projectId);
      await addBoard(db, data);
    });
    return { saved: true };
  });

export const removeBoardFn = createServerFn({ method: "POST" })
  .validator(projectId.extend({ boardId: z.uuid() }))
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    await withDb(async (db) => {
      await requireProjectMember(db, viewer.userId, data.projectId);
      await removeBoard(db, data.projectId, data.boardId);
    });
    return { removed: true };
  });

/** Trello returns the token in the URL fragment: the callback page posts it here. */
export const saveTrelloTokenFn = createServerFn({ method: "POST" })
  .validator(
    z.object({ token: z.string().min(20).max(500), state: z.string() }),
  )
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    const [tracker, state, project, next] = (
      getCookie(STATE_COOKIE) ?? ""
    ).split(":");
    setCookie(STATE_COOKIE, "", { maxAge: 0, path: "/" });
    if (tracker !== "trello" || state !== data.state || !project)
      throw new Error("The authorization expired. Try again.");
    await withDb((db) =>
      storeTrackerTokens(db, {
        userId: viewer.userId,
        projectId: project,
        tracker: "trello",
        tokens: { accessToken: data.token },
      }),
    );
    return { projectId: project, next };
  });
