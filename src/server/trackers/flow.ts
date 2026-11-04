import { ticketAuthor } from "../../core/new-ticket";
import { boardOfKey } from "../../core/ticket-link";
import { bareTitle, ticketIdentity, type OpenIssue } from "../../core/tickets";
import { requireProjectMember } from "../../db/accounts";
import type { Database } from "../../db/client";
import { projectsForUser } from "../../db/github-tasks";
import {
  addBoard,
  boardsForProject,
  connectionsForUser,
  getConnection,
  jiraBoardFor,
  removeBoard,
} from "../../db/trackers";
import { upsertTicket } from "../../db/workunits";
import { and, eq, inArray, isNotNull, or } from "drizzle-orm";
import { recordEvent } from "../../db/events";
import {
  agentRuns,
  correctionRequests,
  projects,
  trackerBoards,
  trackerConnections,
  workUnits,
} from "../../db/schema";
import {
  BACK,
  movesOf,
  type MoveEvent,
  type TicketMoves,
  type TrackerStatus,
} from "../../core/tracker-moves";
import { trackerApi as api, type TrackerContext } from "./context";
import { ensureJiraWebhook } from "./jira-webhooks";
import type { TrackerName } from "./types";

export type { TrackerContext } from "./context";

/**
 * Trackers for builders: the open tickets of a linked board, the label put
 * on or taken off from the dashboard, and the link between a board and the
 * repository that holds its code. Each names a ticket by its board's key
 * ("APP-42" in the Jira project APP, "ENG-42" in the Linear team ENG,
 * "AbCd1234-42" on a Trello board), which is how a ticket finds its board.
 */

type Board = Awaited<ReturnType<typeof boardsForProject>>[number];
const keyedTrackers = ["jira", "linear", "trello"];

/** The linked board holding a keyed ticket, if any. */
const boardOf = (boards: Board[], key: string) =>
  boards.find(
    ({ board, connection }) =>
      keyedTrackers.includes(connection.tracker) &&
      board.externalBoardId === boardOfKey(key),
  );

const trackerTitle = (name: string) =>
  `${name[0]!.toUpperCase()}${name.slice(1)}`;

/** Open tickets of the project's linked boards. Null without any board. */
export async function openTrackerTickets(
  db: Database,
  ctx: TrackerContext,
  projectId: string,
): Promise<OpenIssue[] | null> {
  const boards = await boardsForProject(db, projectId);
  if (boards.length === 0) return null;
  const tickets: OpenIssue[] = [];
  for (const { board, connection } of boards) {
    try {
      const tracker = await api(db, ctx, connection);
      if (!tracker.adapter.openTickets) continue;
      for (const ticket of await tracker.adapter.openTickets(
        tracker.scope,
        tracker.credentials,
        board.externalBoardId,
      ))
        tickets.push({
          ...ticketIdentity(tracker.name, ticket.externalId),
          title: bareTitle(ticket.title, ticket.externalId),
          url: ticket.url,
          createdAt:
            ticket.createdAt ?? ticket.updatedAt ?? new Date(0).toISOString(),
          updatedAt: ticket.updatedAt ?? new Date(0).toISOString(),
          author: ticketAuthor(ticket.author, ticket.body),
        });
    } catch (error) {
      // One unreachable board leaves the others (and GitHub's issues) shown.
      console.warn(`open tickets of ${board.name}:`, (error as Error).message);
    }
  }
  return tickets;
}

/**
 * A tracker ticket as its opened row shows it, read live. Null when no
 * linked project holds it or the tracker cannot be reached.
 */
export async function trackerTicketDetail(
  db: Database,
  ctx: TrackerContext,
  projectId: string,
  key: string,
): Promise<{
  body: string;
  createdAt: string | null;
  labels: string[];
  url: string;
} | null> {
  const entry = boardOf(await boardsForProject(db, projectId), key);
  if (!entry) return null;
  try {
    const tracker = await api(db, ctx, entry.connection);
    const ticket = await tracker.adapter.getTicket(
      tracker.scope,
      tracker.credentials,
      key,
    );
    return ticket
      ? {
          body: ticket.body,
          createdAt: ticket.createdAt ?? null,
          labels: ticket.labels,
          url: ticket.url,
        }
      : null;
  } catch (error) {
    console.warn(`ticket ${key}:`, (error as Error).message);
    return null;
  }
}

/** The linked board holding a ticket, with its connection. */
async function trackerEntry(db: Database, projectId: string, key: string) {
  const entry = boardOf(await boardsForProject(db, projectId), key);
  if (!entry) throw new Error(`${key} is not in a linked board`);
  return entry;
}

/**
 * The agents' questions answered from the dashboard: a comment on the
 * ticket (as the person who connected its tracker), which the agents read
 * next.
 */
export async function answerTrackerTicket(
  db: Database,
  ctx: TrackerContext,
  projectId: string,
  key: string,
  text: string,
): Promise<void> {
  const entry = await trackerEntry(db, projectId, key);
  const tracker = await api(db, ctx, entry.connection);
  await tracker.adapter.comment(tracker.scope, tracker.credentials, key, text);
}

/**
 * Closes a tracker ticket from the dashboard: moved to the first status of
 * the "done" category its workflow can reach. Says so when none can be.
 */
export async function closeTrackerTicket(
  db: Database,
  ctx: TrackerContext,
  projectId: string,
  key: string,
): Promise<TrackerName> {
  const entry = await trackerEntry(db, projectId, key);
  const tracker = await api(db, ctx, entry.connection);
  const name = tracker.name;
  const { statuses, moveTo } = tracker.adapter;
  if (!statuses || !moveTo) throw new Error(`${key} cannot be closed here`);
  const done = (
    await statuses(
      tracker.scope,
      tracker.credentials,
      entry.board.externalBoardId,
    )
  ).filter((status) => status.category === "done");
  for (const status of done) {
    const moved = await moveTo(
      tracker.scope,
      tracker.credentials,
      key,
      status.id,
    );
    if (moved !== "blocked") return name;
  }
  throw new Error(
    `${trackerTitle(tracker.name)}'s workflow has no way to close ${key} from its status`,
  );
}

/**
 * Queues (on) or unqueues (off) tracker tickets from the dashboard: the
 * label goes on or off the ticket in its tracker, and Yarrow's copy follows
 * at once. The 5-minute sync would come to the same result.
 */
export async function labelTrackerTickets(
  db: Database,
  ctx: TrackerContext,
  project: { id: string; authorizationLabel: string },
  keys: string[],
  on: boolean,
): Promise<void> {
  const boards = await boardsForProject(db, project.id);
  for (const key of keys) {
    const entry = boardOf(boards, key);
    if (!entry) throw new Error(`${key} is not in a linked board`);
    const tracker = await api(db, ctx, entry.connection);
    await tracker.adapter.setLabel!(
      tracker.scope,
      tracker.credentials,
      key,
      project.authorizationLabel,
      on,
    );
    const ticket = await tracker.adapter.getTicket(
      tracker.scope,
      tracker.credentials,
      key,
    );
    if (!ticket)
      throw new Error(`${key} was not found in ${trackerTitle(tracker.name)}`);
    await upsertTicket(db, {
      projectId: project.id,
      source: tracker.name,
      boardId: entry.board.id,
      externalId: key,
      title: ticket.title,
      body: ticket.body,
      url: ticket.url,
      labeled: on,
      closed: ticket.closed,
    });
  }
}

/**
 * A ticket written in Yarrow, created on a linked board (as the person who
 * connected its tracker) and queued at once when asked. Yarrow's copy is
 * kept either way, so the row shows before the tracker's search has it.
 */
export async function createTrackerTicket(
  db: Database,
  ctx: TrackerContext,
  project: { id: string; authorizationLabel: string },
  boardKey: string,
  ticket: { title: string; body: string },
  queue: boolean,
): Promise<string> {
  const entry = (await boardsForProject(db, project.id)).find(
    ({ board, connection }) =>
      keyedTrackers.includes(connection.tracker) &&
      board.externalBoardId === boardKey,
  );
  if (!entry) throw new Error(`${boardKey} is not a linked board.`);
  const tracker = await api(db, ctx, entry.connection);
  const key = await tracker.adapter.createTicket!(
    tracker.scope,
    tracker.credentials,
    boardKey,
    ticket,
  );
  if (queue)
    await tracker.adapter.setLabel!(
      tracker.scope,
      tracker.credentials,
      key,
      project.authorizationLabel,
      true,
    );
  const created = await tracker.adapter.getTicket(
    tracker.scope,
    tracker.credentials,
    key,
  );
  await upsertTicket(db, {
    projectId: project.id,
    source: tracker.name,
    boardId: entry.board.id,
    externalId: key,
    title: created?.title ?? `${key} ${ticket.title}`,
    body: created?.body ?? ticket.body,
    url: created?.url ?? "",
    labeled: queue,
    closed: false,
  });
  return key;
}

/**
 * Links a board (a Jira project, a Linear team) to a repository (a Yarrow
 * project): its labeled tickets are synced from then on, and its tracker's
 * webhook covers it too. A pasted ticket is queued right away.
 */
export async function linkTrackerBoard(
  db: Database,
  ctx: TrackerContext,
  userId: string,
  input: {
    projectId: string;
    connectionId: string;
    boardKey: string;
    ticket?: string | null;
  },
  /** False when the caller updates the webhook once for several links. */
  listen = true,
): Promise<{ projectId: string; key: string | null }> {
  const project = await requireProjectMember(db, userId, input.projectId);
  const connection = await getConnection(db, input.connectionId);
  if (
    !connection ||
    !keyedTrackers.includes(connection.tracker) ||
    connection.accountId !== project.accountId
  )
    throw new Error("Connect the tracker for this repository first.");
  const tracker = await api(db, ctx, connection);
  const board = (
    await tracker.adapter.listBoards(tracker.scope, tracker.credentials)
  ).find((item) => item.id === input.boardKey);
  if (!board)
    throw new Error(`${input.boardKey} is not on ${connection.name}.`);
  await addBoard(db, {
    connectionId: connection.id,
    projectId: project.id,
    externalBoardId: board.id,
    name: board.name,
  });
  if (listen && connection.tracker === "jira")
    await ensureJiraWebhook(db, ctx, connection.id);
  if (input.ticket)
    await labelTrackerTickets(db, ctx, project, [input.ticket], true);
  return { projectId: project.id, key: input.ticket ?? null };
}

/**
 * The settings page's boards of one tracker (Jira projects, Linear teams):
 * the repository takes the tickets of exactly these (none at all with an
 * empty list). Queued tickets of a board taken off leave the queue.
 */
export async function setTrackerBoards(
  db: Database,
  ctx: TrackerContext,
  userId: string,
  input: { projectId: string; connectionId: string; keys: string[] },
): Promise<void> {
  const project = await requireProjectMember(db, userId, input.projectId);
  const chosen = await getConnection(db, input.connectionId);
  if (!chosen) throw new Error("Connection not found");
  const kept = new Set<string>();
  const touched = new Set<string>();
  for (const { board, connection } of await boardsForProject(db, project.id)) {
    if (connection.tracker !== chosen.tracker) continue;
    if (
      connection.id === input.connectionId &&
      input.keys.includes(board.externalBoardId)
    )
      kept.add(board.externalBoardId);
    else {
      await removeBoard(db, project.id, board.id);
      touched.add(connection.id);
    }
  }
  for (const boardKey of input.keys)
    if (!kept.has(boardKey)) {
      await linkTrackerBoard(
        db,
        ctx,
        userId,
        { projectId: project.id, connectionId: input.connectionId, boardKey },
        false,
      );
      touched.add(input.connectionId);
    }
  // Each Jira webhook follows its connection's projects, once for all changes.
  if (chosen.tracker === "jira")
    for (const connectionId of touched)
      await ensureJiraWebhook(db, ctx, connectionId);
}

/**
 * Remove project, from its settings: the repository leaves Yarrow (off the
 * dashboard, not imported again in the setup) and its boards are unlinked;
 * the GitHub App, the tracker connections and the other projects stay.
 * Refused while one of its tickets is queued or at work, or a change asked
 * waits. Imported again, it starts afresh.
 */
export async function removeProject(
  db: Database,
  ctx: TrackerContext,
  userId: string,
  projectId: string,
): Promise<"removed" | "busy"> {
  const project = await requireProjectMember(db, userId, projectId);
  const [busy] = await db
    .select({ id: workUnits.id })
    .from(workUnits)
    .leftJoin(
      agentRuns,
      and(
        eq(agentRuns.workUnitId, workUnits.id),
        eq(agentRuns.status, "running"),
      ),
    )
    .leftJoin(
      correctionRequests,
      and(
        eq(correctionRequests.workUnitId, workUnits.id),
        eq(correctionRequests.status, "queued"),
      ),
    )
    .where(
      and(
        eq(workUnits.projectId, project.id),
        or(
          and(eq(workUnits.status, "queued"), eq(workUnits.authorized, true)),
          inArray(workUnits.status, ["running"]),
          isNotNull(agentRuns.id),
          isNotNull(correctionRequests.id),
        ),
      ),
    )
    .limit(1);
  if (busy) return "busy";
  const jira = new Set<string>();
  for (const { board, connection } of await boardsForProject(db, project.id)) {
    await removeBoard(db, project.id, board.id);
    if (connection.tracker === "jira") jira.add(connection.id);
  }
  await db
    .update(projects)
    .set({ importedAt: null })
    .where(eq(projects.id, project.id));
  await recordEvent(db, {
    type: "project.removed",
    projectId: project.id,
    userId,
  });
  // Each Jira webhook follows its connection's projects.
  for (const connectionId of jira)
    await ensureJiraWebhook(db, ctx, connectionId);
  return "removed";
}

/** The tracker refused the token: the person removed Yarrow's access. */
export class TrackerAccessError extends Error {
  constructor() {
    super("Access was removed in the tracker");
  }
}
const refused = (error: unknown) =>
  error instanceof Error && /\((401|403)\)/.test(error.message);

/** The boards a connection reaches (Jira projects, Linear teams). */
export async function listTrackerBoards(
  db: Database,
  ctx: TrackerContext,
  userId: string,
  connectionId: string,
): Promise<{ id: string; name: string }[]> {
  const connection = await getConnection(db, connectionId);
  const reachable =
    connection &&
    (
      await connectionsForUser(db, userId, connection.tracker as TrackerName)
    ).some((row) => row.id === connectionId);
  if (!connection || !reachable) throw new Error("Connection not found");
  try {
    const tracker = await api(db, ctx, connection);
    return await tracker.adapter.listBoards(tracker.scope, tracker.credentials);
  } catch (error) {
    throw refused(error) ? new TrackerAccessError() : error;
  }
}

/** What the dashboard shows until a Jira ticket or site is set up. */
export type JiraStep = {
  site: string | null;
  ticket: string | null;
  /** Each repository, with the Jira connection its account has (or null). */
  projects: {
    id: string;
    name: string;
    repository: string;
    connectionId: string | null;
  }[];
};

/**
 * A Jira link pasted on the landing (or "Connect Jira"), once GitHub is
 * connected: queued at once when its Jira project is already linked;
 * linked to `projectId` when Jira was just connected from that repository
 * (and the choice is clear); otherwise the dashboard asks.
 */
export async function settleJira(
  db: Database,
  ctx: TrackerContext,
  userId: string,
  /** What was pasted on the landing (see connect.server). */
  intent: { site?: string; ticket?: string },
  projectId?: string,
): Promise<
  { queued: { projectId: string; key: string | null } } | { step: JiraStep }
> {
  const site = intent.site ?? null;
  const ticket = intent.ticket ?? null;
  if (ticket) {
    const mapped = await jiraBoardFor(
      db,
      userId,
      boardOfKey(ticket),
      site ?? undefined,
    );
    if (mapped) {
      const project = await requireProjectMember(db, userId, mapped.projectId);
      await labelTrackerTickets(db, ctx, project, [ticket], true);
      return { queued: { projectId: project.id, key: ticket } };
    }
  }
  const connections = await connectionsForUser(db, userId, "jira");
  const projects = (await projectsForUser(db, userId)).filter(
    (project) => project.linked && project.imported,
  );
  const connectionFor = (accountId: string) =>
    connections.filter(
      (row) => row.accountId === accountId && (!site || row.site === site),
    );
  const chosen = projects.find((project) => project.id === projectId);
  const [only, ...others] = chosen ? connectionFor(chosen.accountId) : [];
  if (chosen && only && others.length === 0) {
    const boardKey = ticket
      ? boardOfKey(ticket)
      : await listTrackerBoards(db, ctx, userId, only.id).then((list) =>
          list.length === 1 ? list[0]!.id : null,
        );
    if (boardKey)
      return {
        queued: await linkTrackerBoard(db, ctx, userId, {
          projectId: chosen.id,
          connectionId: only.id,
          boardKey,
          ticket,
        }),
      };
  }
  return {
    step: {
      site,
      ticket,
      projects: projects.map((project) => ({
        id: project.id,
        name: project.name,
        repository: project.repository,
        connectionId: connectionFor(project.accountId)[0]?.id ?? null,
      })),
    },
  };
}

/** A linked board with its connection, checked against the user's projects. */
async function memberBoard(db: Database, userId: string, boardId: string) {
  const [row] = await db
    .select({ board: trackerBoards, connection: trackerConnections })
    .from(trackerBoards)
    .innerJoin(
      trackerConnections,
      eq(trackerConnections.id, trackerBoards.connectionId),
    )
    .where(eq(trackerBoards.id, boardId));
  if (!row) throw new Error("Board not found");
  await requireProjectMember(db, userId, row.board.projectId);
  return row;
}

/**
 * The settings page's "Board" block: the board's statuses, where tickets
 * move (the builder's choice, or the defaults), and the last move the
 * tracker refused.
 */
export async function trackerBoardSettings(
  db: Database,
  ctx: TrackerContext,
  userId: string,
  boardId: string,
): Promise<{
  statuses: TrackerStatus[];
  moves: TicketMoves;
  chosen: boolean;
  warning: string | null;
}> {
  const { board, connection } = await memberBoard(db, userId, boardId);
  const tracker = await api(db, ctx, connection);
  const statuses = await tracker.adapter.statuses!(
    tracker.scope,
    tracker.credentials,
    board.externalBoardId,
  );
  return {
    statuses,
    moves: movesOf(board.moves, statuses),
    chosen: board.moves !== null,
    warning: board.moveWarning,
  };
}

export async function setTrackerMoves(
  db: Database,
  userId: string,
  boardId: string,
  moves: TicketMoves,
): Promise<void> {
  await memberBoard(db, userId, boardId);
  await db
    .update(trackerBoards)
    .set({ moves, moveWarning: null })
    .where(eq(trackerBoards.id, boardId));
}

const eventLabel: Record<MoveEvent, string> = {
  started: "when Yarrow started",
  pullRequest: "when the pull request opened",
  merged: "when the pull request was merged",
  stopped: "when Yarrow stopped",
};

/**
 * Moves a tracker ticket as its work advances, as the builder chose. Never
 * blocks the work: a move the workflow refuses is kept as a warning for the
 * settings page. Returns what happened, for logs.
 */
export async function moveTrackerTicket(
  db: Database,
  ctx: TrackerContext,
  workUnitId: string,
  event: MoveEvent,
): Promise<string> {
  const [row] = await db
    .select({
      key: workUnits.externalId,
      before: workUnits.trackerStatusBefore,
      board: trackerBoards,
      connection: trackerConnections,
    })
    .from(workUnits)
    .innerJoin(trackerBoards, eq(trackerBoards.id, workUnits.boardId))
    .innerJoin(
      trackerConnections,
      eq(trackerConnections.id, trackerBoards.connectionId),
    )
    .where(eq(workUnits.id, workUnitId));
  if (!row) return "no tracker board";
  const tracker = await api(db, ctx, row.connection);
  const { adapter, scope, credentials } = tracker;
  if (!adapter.moveTo || !adapter.statuses)
    return "tracker cannot move tickets";
  const statuses = await adapter.statuses(
    scope,
    credentials,
    row.board.externalBoardId,
  );
  const chosen = movesOf(row.board.moves, statuses)[event] ?? null;
  // Back where it was before Yarrow moved it; nowhere if Yarrow did not.
  const target = chosen === BACK ? row.before : chosen;
  if (!target)
    return chosen === BACK
      ? "not moved (Yarrow had not moved it)"
      : "not moved (builder's choice)";
  const from =
    event === "started"
      ? await adapter.currentStatus?.(scope, credentials, row.key)
      : null;
  // A stopped ticket goes where the builder said, back to "to do" included.
  const result = await adapter.moveTo(
    scope,
    credentials,
    row.key,
    target,
    event === "stopped",
  );
  // Kept until Yarrow stops, so a stop after a retry goes back there too.
  if (event === "started" && result === "moved" && from)
    await db
      .update(workUnits)
      .set({ trackerStatusBefore: from })
      .where(eq(workUnits.id, workUnitId));
  if (event === "stopped" && chosen === BACK && result !== "blocked")
    await db
      .update(workUnits)
      .set({ trackerStatusBefore: null })
      .where(eq(workUnits.id, workUnitId));
  if (result === "blocked") {
    const name = statuses.find((status) => status.id === target)?.name;
    await db
      .update(trackerBoards)
      .set({
        moveWarning: `${row.key} could not move to ${name ?? "its status"} ${eventLabel[event]}: the workflow does not allow it from where it was.`,
      })
      .where(eq(trackerBoards.id, row.board.id));
  }
  return `${row.key} ${result}`;
}
