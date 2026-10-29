import { and, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "./client";
import { recordEvent } from "./events";
import {
  accountMembers,
  projects,
  trackerBoards,
  trackerConnections,
  workUnits,
} from "./schema";

type Tracker = "linear" | "jira" | "trello";

/** Upserts an OAuth connection. Tokens arrive already encrypted. */
export async function saveTrackerConnection(
  db: Database,
  input: {
    accountId: string;
    tracker: Tracker;
    externalId: string;
    name: string;
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    tokenExpiresAt: Date | null;
  },
): Promise<string> {
  const values = {
    name: input.name,
    encryptedAccessToken: input.encryptedAccessToken,
    encryptedRefreshToken: input.encryptedRefreshToken,
    tokenExpiresAt: input.tokenExpiresAt,
  };
  const [row] = await db
    .insert(trackerConnections)
    .values({
      accountId: input.accountId,
      tracker: input.tracker,
      externalId: input.externalId,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        trackerConnections.accountId,
        trackerConnections.tracker,
        trackerConnections.externalId,
      ],
      set: values,
    })
    .returning({ id: trackerConnections.id });
  await recordEvent(db, {
    type: "tracker.connected",
    accountId: input.accountId,
    payload: { tracker: input.tracker },
  });
  return row!.id;
}

export async function connectionsForAccount(db: Database, accountId: string) {
  return db
    .select({
      id: trackerConnections.id,
      tracker: trackerConnections.tracker,
      name: trackerConnections.name,
      // Jira refused the webhook: the consent predates manage:jira-webhook.
      webhookRefused: sql<boolean>`coalesce(${trackerConnections.webhookError} ~ '\((401|403)\)', false)`,
    })
    .from(trackerConnections)
    .where(eq(trackerConnections.accountId, accountId));
}

export async function getConnection(db: Database, connectionId: string) {
  const [row] = await db
    .select()
    .from(trackerConnections)
    .where(eq(trackerConnections.id, connectionId));
  return row ?? null;
}

export async function updateConnectionTokens(
  db: Database,
  connectionId: string,
  tokens: {
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    tokenExpiresAt: Date | null;
  },
): Promise<void> {
  await db
    .update(trackerConnections)
    .set(tokens)
    .where(eq(trackerConnections.id, connectionId));
}

/** Maps a board to a project. The connection must belong to the project's account. */
export async function addBoard(
  db: Database,
  input: {
    connectionId: string;
    projectId: string;
    externalBoardId: string;
    name: string;
  },
): Promise<void> {
  const [match] = await db
    .select({ id: projects.id })
    .from(projects)
    .innerJoin(
      trackerConnections,
      eq(trackerConnections.accountId, projects.accountId),
    )
    .where(
      and(
        eq(projects.id, input.projectId),
        eq(trackerConnections.id, input.connectionId),
      ),
    );
  if (!match) throw new Error("This connection belongs to another account");
  await db
    .insert(trackerBoards)
    .values(input)
    .onConflictDoUpdate({
      target: [trackerBoards.connectionId, trackerBoards.externalBoardId],
      set: { projectId: input.projectId, name: input.name },
    });
}

export async function removeBoard(
  db: Database,
  projectId: string,
  boardId: string,
): Promise<void> {
  await db
    .update(workUnits)
    .set({ boardId: null, authorized: false })
    .where(and(eq(workUnits.boardId, boardId), eq(workUnits.status, "queued")));
  await db
    .delete(trackerBoards)
    .where(
      and(
        eq(trackerBoards.id, boardId),
        eq(trackerBoards.projectId, projectId),
      ),
    );
}

/** Every mapped board with its connection and project, for the sync cron. */
export async function boardsToSync(db: Database) {
  return db
    .select({
      board: trackerBoards,
      connection: trackerConnections,
      project: {
        id: projects.id,
        authorizationLabel: projects.authorizationLabel,
        suspendedAt: projects.suspendedAt,
      },
    })
    .from(trackerBoards)
    .innerJoin(
      trackerConnections,
      eq(trackerConnections.id, trackerBoards.connectionId),
    )
    .innerJoin(projects, eq(projects.id, trackerBoards.projectId));
}

/** Queued tickets of a board, to detect removed labels and closed tickets. */
export async function queuedOnBoard(db: Database, boardId: string) {
  return db
    .select({ id: workUnits.id, externalId: workUnits.externalId })
    .from(workUnits)
    .where(
      and(
        eq(workUnits.boardId, boardId),
        eq(workUnits.status, "queued"),
        eq(workUnits.authorized, true),
      ),
    );
}

/** A project's mapped boards, each with its connection. */
export async function boardsForProject(db: Database, projectId: string) {
  return db
    .select({ board: trackerBoards, connection: trackerConnections })
    .from(trackerBoards)
    .innerJoin(
      trackerConnections,
      eq(trackerConnections.id, trackerBoards.connectionId),
    )
    .where(eq(trackerBoards.projectId, projectId));
}

/** The Jira sites connected by the accounts a user belongs to. */
export async function jiraConnectionsForUser(db: Database, userId: string) {
  return db
    .select({
      id: trackerConnections.id,
      accountId: trackerConnections.accountId,
      site: trackerConnections.name,
    })
    .from(trackerConnections)
    .innerJoin(
      accountMembers,
      and(
        eq(accountMembers.accountId, trackerConnections.accountId),
        eq(accountMembers.userId, userId),
      ),
    )
    .where(eq(trackerConnections.tracker, "jira"));
}

/** Where a Jira project is mapped among a user's projects, if anywhere. */
export async function jiraBoardFor(
  db: Database,
  userId: string,
  projectKey: string,
  site?: string,
) {
  const rows = await db
    .select({
      projectId: trackerBoards.projectId,
      site: trackerConnections.name,
    })
    .from(trackerBoards)
    .innerJoin(
      trackerConnections,
      eq(trackerConnections.id, trackerBoards.connectionId),
    )
    .innerJoin(projects, eq(projects.id, trackerBoards.projectId))
    .innerJoin(
      accountMembers,
      and(
        eq(accountMembers.accountId, projects.accountId),
        eq(accountMembers.userId, userId),
      ),
    )
    .where(
      and(
        eq(trackerConnections.tracker, "jira"),
        eq(trackerBoards.externalBoardId, projectKey),
      ),
    );
  return rows.find((row) => !site || row.site === site) ?? null;
}

/** A connection's boards with their projects, for its Jira webhook. */
export async function boardsOfConnection(db: Database, connectionId: string) {
  return db
    .select({
      board: trackerBoards,
      project: {
        id: projects.id,
        authorizationLabel: projects.authorizationLabel,
        suspendedAt: projects.suspendedAt,
      },
    })
    .from(trackerBoards)
    .innerJoin(projects, eq(projects.id, trackerBoards.projectId))
    .where(eq(trackerBoards.connectionId, connectionId));
}

export async function jiraConnections(db: Database) {
  return db
    .select()
    .from(trackerConnections)
    .where(eq(trackerConnections.tracker, "jira"));
}

/** The Jira connections whose webhooks a delivery matched. */
export async function connectionsByWebhook(db: Database, webhookIds: string[]) {
  if (webhookIds.length === 0) return [];
  return db
    .select()
    .from(trackerConnections)
    .where(
      and(
        eq(trackerConnections.tracker, "jira"),
        inArray(trackerConnections.webhookId, webhookIds),
      ),
    );
}

export async function saveWebhook(
  db: Database,
  connectionId: string,
  webhook: {
    webhookId?: string | null;
    webhookFilter?: string | null;
    webhookExpiresAt?: Date | null;
    webhookError: string | null;
  },
): Promise<void> {
  await db
    .update(trackerConnections)
    .set(webhook)
    .where(eq(trackerConnections.id, connectionId));
}

/** Whether Yarrow already holds this ticket (queued once, at work, done). */
export async function ticketKnown(
  db: Database,
  projectId: string,
  source: Tracker,
  externalId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: workUnits.id })
    .from(workUnits)
    .where(
      and(
        eq(workUnits.projectId, projectId),
        eq(workUnits.source, source),
        eq(workUnits.externalId, externalId),
      ),
    );
  return Boolean(row);
}
