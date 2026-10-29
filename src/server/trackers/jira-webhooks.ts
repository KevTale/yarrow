import { jiraProject } from "../../core/ticket-link";
import type { Database } from "../../db/client";
import {
  boardsOfConnection,
  connectionsByWebhook,
  getConnection,
  jiraConnections,
  saveWebhook,
  ticketKnown,
} from "../../db/trackers";
import { signalIssues } from "../../db/tickets";
import { upsertTicket } from "../../db/workunits";
import { safeEqual } from "../github/app";
import { trackerApi, type Connection, type TrackerContext } from "./context";
import { json, type Fetch } from "./types";

/**
 * Jira's webhooks: a label set in Jira itself queues the ticket in seconds,
 * as GitHub's do, instead of at the next 5-minute sync (which stays, as the
 * safety net). One webhook per connection covers all its linked projects.
 * Jira drops a webhook 30 days after it was registered or refreshed; the
 * brain refreshes them every hour it finds one with less than 20 days left.
 */

const EVENTS = [
  "jira:issue_created",
  "jira:issue_updated",
  "jira:issue_deleted",
];
// The changes that matter to the queue: the label, the status, the text.
const FIELDS = ["labels", "status", "summary", "description"];
const DAY = 24 * 60 * 60_000;
const REFRESH_BEFORE = 20 * DAY;

/** Jira's webhook API, as the person who connected Jira. */
function webhookApi(cloudId: string, token: string, fetcher: Fetch = fetch) {
  const url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/webhook`;
  const init = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    async register(callback: string, jqlFilter: string): Promise<string> {
      const result = await json<{
        webhookRegistrationResult: {
          createdWebhookId?: number;
          errors?: string[];
        }[];
      }>(
        await fetcher(
          url,
          init("POST", {
            url: callback,
            webhooks: [{ events: EVENTS, fieldIdsFilter: FIELDS, jqlFilter }],
          }),
        ),
        "Jira webhook",
      );
      const [first] = result.webhookRegistrationResult;
      if (first?.createdWebhookId === undefined)
        throw new Error(
          `Jira webhook refused: ${first?.errors?.join("; ") ?? "no reason"}`,
        );
      return String(first.createdWebhookId);
    },
    /** The ids Jira still holds for this app (and token). */
    async ids(): Promise<Set<string>> {
      const ids = new Set<string>();
      for (let startAt = 0; ;) {
        const page = await json<{
          values: { id: number }[];
          isLast?: boolean;
        }>(
          await fetcher(
            `${url}?startAt=${startAt}&maxResults=100`,
            init("GET"),
          ),
          "Jira webhooks",
        );
        for (const webhook of page.values) ids.add(String(webhook.id));
        if (page.isLast !== false || page.values.length === 0) return ids;
        startAt += page.values.length;
      }
    },
    async refresh(id: string): Promise<Date> {
      const { expirationDate } = await json<{ expirationDate: number }>(
        await fetcher(
          `${url}/refresh`,
          init("PUT", { webhookIds: [Number(id)] }),
        ),
        "Jira webhook refresh",
      );
      return new Date(expirationDate);
    },
    async remove(id: string): Promise<void> {
      const response = await fetcher(
        url,
        init("DELETE", { webhookIds: [Number(id)] }),
      );
      // Already gone is fine; 202 Accepted on success.
      if (!response.ok && response.status !== 404)
        await json(response, "Jira webhook removal");
    },
  };
}

// JQL string values: quotes and backslashes could end the string early.
const quote = (value: string) => value.replace(/["\\]/g, "");

/** The JQL a connection's webhook listens to: its linked projects. */
export function webhookFilter(projectKeys: string[]): string | null {
  const keys = [...new Set(projectKeys)].sort();
  return keys.length
    ? `project in (${keys.map((key) => `"${quote(key)}"`).join(", ")})`
    : null;
}

async function ensureFor(
  db: Database,
  ctx: TrackerContext,
  connection: Connection,
  now: number,
): Promise<string> {
  const filter = webhookFilter(
    (await boardsOfConnection(db, connection.id)).map(
      ({ board }) => board.externalBoardId,
    ),
  );
  const fresh =
    connection.webhookExpiresAt &&
    connection.webhookExpiresAt.getTime() > now + REFRESH_BEFORE;
  if (connection.webhookFilter === filter && (fresh || !filter))
    return "up to date";
  // Jira only calls public HTTPS addresses: none on this machine.
  if (!ctx.appUrl?.startsWith("https://")) return "no public address";
  const tracker = await trackerApi(db, ctx, connection);
  const api = webhookApi(
    connection.externalId,
    tracker.scope.accessToken,
    ctx.fetcher,
  );
  const id = connection.webhookId;
  if (id && connection.webhookFilter === filter && (await api.ids()).has(id)) {
    const expiresAt = await api.refresh(id);
    await saveWebhook(db, connection.id, {
      webhookExpiresAt: expiresAt,
      webhookError: null,
    });
    return "refreshed";
  }
  if (id) await api.remove(id);
  if (!filter) {
    await saveWebhook(db, connection.id, {
      webhookId: null,
      webhookFilter: null,
      webhookExpiresAt: null,
      webhookError: null,
    });
    return "removed";
  }
  const created = await api.register(`${ctx.appUrl}/api/webhooks/jira`, filter);
  await saveWebhook(db, connection.id, {
    webhookId: created,
    webhookFilter: filter,
    webhookExpiresAt: new Date(now + 30 * DAY),
    webhookError: null,
  });
  return "registered";
}

/**
 * Registers, moves or refreshes a connection's webhook so it follows its
 * linked projects. Never throws: a failure (a connection made before Yarrow
 * asked for `manage:jira-webhook`, say) is kept on the connection and the
 * sync goes on covering it.
 */
export async function ensureJiraWebhook(
  db: Database,
  ctx: TrackerContext,
  connectionId: string,
  now = Date.now(),
): Promise<string> {
  const connection = await getConnection(db, connectionId);
  if (!connection || connection.tracker !== "jira")
    return "not a Jira connection";
  try {
    return await ensureFor(db, ctx, connection, now);
  } catch (error) {
    const message = (error as Error).message;
    await saveWebhook(db, connection.id, { webhookError: message });
    return message;
  }
}

/** The brain's hourly pass over every Jira connection. */
export async function ensureJiraWebhooks(
  db: Database,
  ctx: TrackerContext,
  now = Date.now(),
): Promise<string[]> {
  const log: string[] = [];
  for (const connection of await jiraConnections(db))
    log.push(
      `${connection.name}: ${await ensureJiraWebhook(db, ctx, connection.id, now)}`,
    );
  return log;
}

const fromBase64Url = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (char) =>
    char.charCodeAt(0),
  );

/**
 * Jira signs each delivery to an OAuth app with a JWT in the Authorization
 * header, HS256 with the app's client secret.
 */
export async function verifyJiraWebhook(
  clientSecret: string,
  authorization: string | null,
  now = Date.now(),
): Promise<boolean> {
  const token = authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const [header, payload, signature] = token.split(".");
  if (!header || !payload || !signature) return false;
  try {
    const { alg } = JSON.parse(
      new TextDecoder().decode(fromBase64Url(header)),
    ) as { alg?: string };
    if (alg !== "HS256") return false;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(clientSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${header}.${payload}`),
      ),
    );
    const given = fromBase64Url(signature);
    const hex = (bytes: Uint8Array) =>
      [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!safeEqual(hex(expected), hex(given))) return false;
    const { exp } = JSON.parse(
      new TextDecoder().decode(fromBase64Url(payload)),
    ) as { exp?: number };
    // A minute of clock drift between Atlassian and Cloudflare.
    return exp === undefined || exp * 1000 > now - 60_000;
  } catch {
    return false;
  }
}

export interface JiraDelivery {
  webhookEvent?: string;
  issue?: { key?: string };
  matchedWebhookIds?: number[];
}

/**
 * One delivery: the ticket is read again from Jira (the payload only says
 * which one changed) and Yarrow's copy follows, as the sync would do it.
 * Returns whether a ticket entered the queue, so the brain is kicked.
 */
export async function handleJiraDelivery(
  db: Database,
  ctx: TrackerContext,
  delivery: JiraDelivery,
): Promise<{ queued: boolean; log: string[] }> {
  const key = delivery.issue?.key;
  const log: string[] = [];
  let queued = false;
  if (!key) return { queued, log: ["no issue"] };
  const connections = await connectionsByWebhook(
    db,
    (delivery.matchedWebhookIds ?? []).map(String),
  );
  for (const connection of connections) {
    const boards = (await boardsOfConnection(db, connection.id)).filter(
      ({ board, project }) =>
        board.externalBoardId === jiraProject(key) && !project.suspendedAt,
    );
    if (boards.length === 0) continue;
    // Created, renamed or closed: the dashboards' open tickets read again.
    for (const { project } of boards) await signalIssues(db, project.id);
    const tracker = await trackerApi(db, ctx, connection);
    const ticket = await tracker.adapter.getTicket(
      tracker.scope,
      tracker.credentials,
      key,
    );
    for (const { board, project } of boards) {
      const label = project.authorizationLabel.toLowerCase();
      const labeled = Boolean(
        ticket?.labels.some((value) => value.toLowerCase() === label),
      );
      // An unlabeled ticket Yarrow never held stays out of its tables.
      if (!labeled && !(await ticketKnown(db, project.id, "jira", key)))
        continue;
      const result = await upsertTicket(db, {
        projectId: project.id,
        source: "jira",
        boardId: board.id,
        externalId: key,
        title: ticket?.title ?? "(deleted ticket)",
        body: ticket?.body ?? "",
        url: ticket?.url ?? "",
        labeled,
        closed: !ticket || ticket.closed,
      });
      queued ||= result.queued;
      log.push(`${key} ${labeled ? "labeled" : "unlabeled"}`);
    }
  }
  return { queued, log };
}
