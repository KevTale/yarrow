import { accountIdsForUser, requireProjectMember } from "@/db/accounts";
import type { Database } from "@/db/client";
import { saveTrackerConnection } from "@/db/trackers";
import { encryptToken } from "./trackers/crypto";
import {
  trackerAdapter,
  trackerSecretsFromEnv,
  type TrackerName,
} from "./trackers/index";
import type { TrackerTokens } from "./trackers/types";
import { ensureJiraWebhook } from "./trackers/jira-webhooks";
import { trackerContext } from "./jira.server";
import { appEnv, NotConfiguredError } from "./env.server";

export const STATE_COOKIE = "ac_tracker_state";

export function trackerConfig(name: TrackerName) {
  const env = appEnv();
  const secrets = trackerSecretsFromEnv(env);
  const credentials = secrets[name];
  if (!credentials || !secrets.encryptionKey)
    throw new NotConfiguredError(
      `${name[0]!.toUpperCase()}${name.slice(1)} integration`,
    );
  return { credentials, encryptionKey: secrets.encryptionKey };
}

export function callbackUrl(name: TrackerName): string {
  const base = appEnv().APP_URL;
  return name === "trello"
    ? `${base}/integrations/trello-callback`
    : `${base}/integrations/${name}/callback`;
}

/** Encrypts and stores every workspace the token reaches, for the project's account. */
export async function storeTrackerTokens(
  db: Database,
  input: {
    userId: string;
    projectId: string;
    tracker: TrackerName;
    tokens: TrackerTokens;
  },
): Promise<number> {
  const project = await requireProjectMember(db, input.userId, input.projectId);
  if (!(await accountIdsForUser(db, input.userId)).includes(project.accountId))
    throw new Error("Not a member of this account");
  const { credentials, encryptionKey } = trackerConfig(input.tracker);
  const workspaces = await trackerAdapter(input.tracker).describe(
    input.tokens,
    credentials,
  );
  for (const workspace of workspaces) {
    const connectionId = await saveTrackerConnection(db, {
      accountId: project.accountId,
      tracker: input.tracker,
      externalId: workspace.externalId,
      name: workspace.name,
      encryptedAccessToken: await encryptToken(
        encryptionKey,
        workspace.accessToken,
      ),
      encryptedRefreshToken: workspace.refreshToken
        ? await encryptToken(encryptionKey, workspace.refreshToken)
        : null,
      tokenExpiresAt: workspace.expiresAt ?? null,
    });
    // A new consent may carry the webhook scope an older one lacked.
    if (input.tracker === "jira")
      await ensureJiraWebhook(db, trackerContext(), connectionId);
  }
  return workspaces.length;
}
