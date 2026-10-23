import type { Database } from "../../db/client";
import {
  boardsToSync,
  queuedOnBoard,
  updateConnectionTokens,
} from "../../db/trackers";
import { upsertTicket } from "../../db/workunits";
import { decryptToken, encryptToken } from "./crypto";
import { jiraAdapter } from "./jira";
import { linearAdapter } from "./linear";
import { trelloAdapter } from "./trello";
import type {
  Fetch,
  TrackerAdapter,
  TrackerCredentials,
  TrackerName,
} from "./types";

export type { TrackerName } from "./types";

export const trackerNames: TrackerName[] = ["linear", "jira", "trello"];

export function trackerAdapter(
  name: TrackerName,
  fetcher?: Fetch,
): TrackerAdapter {
  if (name === "linear") return linearAdapter(fetcher);
  if (name === "jira") return jiraAdapter(fetcher);
  return trelloAdapter(fetcher);
}

export interface TrackerSecrets {
  encryptionKey?: string;
  linear?: TrackerCredentials;
  jira?: TrackerCredentials;
  trello?: TrackerCredentials;
}

/** Builds credentials from Worker env vars; missing values disable a tracker. */
export function trackerSecretsFromEnv(env: {
  TOKEN_ENCRYPTION_KEY?: string;
  LINEAR_CLIENT_ID?: string;
  LINEAR_CLIENT_SECRET?: string;
  JIRA_CLIENT_ID?: string;
  JIRA_CLIENT_SECRET?: string;
  TRELLO_API_KEY?: string;
  TRELLO_API_SECRET?: string;
}): TrackerSecrets {
  const pair = (id?: string, secret?: string) =>
    id && secret ? { clientId: id, clientSecret: secret } : undefined;
  return {
    encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    linear: pair(env.LINEAR_CLIENT_ID, env.LINEAR_CLIENT_SECRET),
    jira: pair(env.JIRA_CLIENT_ID, env.JIRA_CLIENT_SECRET),
    trello: env.TRELLO_API_KEY
      ? {
          clientId: env.TRELLO_API_KEY,
          clientSecret: env.TRELLO_API_SECRET ?? "",
        }
      : undefined,
  };
}

type Connection = Awaited<
  ReturnType<typeof boardsToSync>
>[number]["connection"];

/** A usable access token, refreshed and re-encrypted when it is about to expire. */
export async function accessTokenFor(
  db: Database,
  connection: Connection,
  secrets: TrackerSecrets,
  fetcher?: Fetch,
): Promise<string> {
  const key = secrets.encryptionKey;
  if (!key) throw new Error("TOKEN_ENCRYPTION_KEY is not configured");
  const adapter = trackerAdapter(connection.tracker as TrackerName, fetcher);
  const credentials = secrets[connection.tracker as TrackerName];
  if (!credentials) throw new Error(`${connection.tracker} is not configured`);
  const expiring =
    connection.tokenExpiresAt &&
    connection.tokenExpiresAt.getTime() < Date.now() + 5 * 60_000;
  if (!expiring || !adapter.refresh || !connection.encryptedRefreshToken)
    return decryptToken(key, connection.encryptedAccessToken);
  const refreshed = await adapter.refresh({
    credentials,
    refreshToken: await decryptToken(key, connection.encryptedRefreshToken),
  });
  await updateConnectionTokens(db, connection.id, {
    encryptedAccessToken: await encryptToken(key, refreshed.accessToken),
    encryptedRefreshToken: refreshed.refreshToken
      ? await encryptToken(key, refreshed.refreshToken)
      : connection.encryptedRefreshToken,
    tokenExpiresAt: refreshed.expiresAt ?? null,
  });
  return refreshed.accessToken;
}

/**
 * Polls every mapped board: labeled open tickets are queued, and queued
 * tickets that lost the label or were closed leave the queue. One failing
 * board never stops the others. Returns per-board results for logs.
 */
export async function syncTrackers(
  db: Database,
  secrets: TrackerSecrets,
  fetcher?: Fetch,
): Promise<string[]> {
  const log: string[] = [];
  for (const { board, connection, project } of await boardsToSync(db)) {
    if (project.suspendedAt) continue;
    const name = connection.tracker as TrackerName;
    const credentials = secrets[name];
    if (!credentials) continue;
    try {
      const adapter = trackerAdapter(name, fetcher);
      const accessToken = await accessTokenFor(
        db,
        connection,
        secrets,
        fetcher,
      );
      const scope = { externalId: connection.externalId, accessToken };
      const tickets = await adapter.labeledTickets(
        scope,
        credentials,
        board.externalBoardId,
        project.authorizationLabel,
      );
      const seen = new Set<string>();
      for (const ticket of tickets) {
        seen.add(ticket.externalId);
        await upsertTicket(db, {
          projectId: project.id,
          source: name,
          boardId: board.id,
          externalId: ticket.externalId,
          title: ticket.title,
          body: ticket.body,
          url: ticket.url,
          labeled: true,
          closed: ticket.closed,
        });
      }
      for (const queued of await queuedOnBoard(db, board.id)) {
        if (seen.has(queued.externalId)) continue;
        const ticket = await adapter.getTicket(
          scope,
          credentials,
          queued.externalId,
        );
        const label = project.authorizationLabel.toLowerCase();
        await upsertTicket(db, {
          projectId: project.id,
          source: name,
          boardId: board.id,
          externalId: queued.externalId,
          title: ticket?.title ?? "(deleted ticket)",
          body: ticket?.body ?? "",
          url: ticket?.url ?? "",
          labeled: Boolean(
            ticket?.labels.some((value) => value.toLowerCase() === label),
          ),
          closed: !ticket || ticket.closed,
        });
      }
      log.push(`${name}:${board.name}: ${tickets.length} labeled`);
    } catch (error) {
      log.push(`${name}:${board.name}: ${(error as Error).message}`);
    }
  }
  return log;
}
