import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import {
  projectFormSchema,
  projectSecretSchema,
  runConfigSchema,
} from "@/core/forms";
import { ensureAccount, requireProjectMember } from "@/db/accounts";
import {
  createProject,
  deleteSecretReference,
  recordSecretReference,
  saveRunConfig,
  setProjectVisibility,
  updateProject,
} from "@/db/projects";
import { ownerDashboard, projectForOwner } from "@/db/queries";
import { setAnthropicResources } from "@/db/runs";
import {
  addBoard,
  connectionsForAccount,
  getConnection,
  removeBoard,
} from "@/db/trackers";
import { getViewer, requireViewer } from "@/server/auth.server";
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

export const getProjectFn = createServerFn({ method: "GET" })
  .validator(projectId)
  .handler(async ({ data }) => {
    const viewer = await getViewer().catch(() => null);
    if (!viewer) return { status: "signed_out" as const };
    if (!databaseConfigured()) return { status: "not_configured" as const };
    const env = appEnv();
    return withDb(async (db) => {
      const project = await requireProjectMember(
        db,
        viewer.userId,
        data.projectId,
      );
      const secrets = trackerSecretsFromEnv(env);
      return {
        status: "ok" as const,
        ...(await projectForOwner(db, project.id))!,
        connections: await connectionsForAccount(db, project.accountId),
        githubInstallUrl: `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`,
        trackersAvailable: {
          linear: Boolean(secrets.linear && secrets.encryptionKey),
          jira: Boolean(secrets.jira && secrets.encryptionKey),
          trello: Boolean(secrets.trello && secrets.encryptionKey),
        },
        secretsAvailable: Boolean(env.ANTHROPIC_API_KEY),
      };
    });
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
    const [tracker, state, project] = (getCookie(STATE_COOKIE) ?? "").split(
      ":",
    );
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
    return { projectId: project };
  });
