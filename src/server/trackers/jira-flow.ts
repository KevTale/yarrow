import { jiraProject } from "../../core/ticket-link";
import { bareTitle, ticketIdentity, type OpenIssue } from "../../core/tickets";
import { requireProjectMember } from "../../db/accounts";
import type { Database } from "../../db/client";
import { projectsForUser } from "../../db/github-tasks";
import {
  addBoard,
  boardsForProject,
  getConnection,
  jiraBoardFor,
  jiraConnectionsForUser,
  removeBoard,
} from "../../db/trackers";
import { upsertTicket } from "../../db/workunits";
import { eq } from "drizzle-orm";
import { trackerBoards, trackerConnections, workUnits } from "../../db/schema";
import {
  defaultMoves,
  type MoveEvent,
  type TicketMoves,
  type TrackerStatus,
} from "../../core/tracker-moves";
import {
  accessTokenFor,
  trackerAdapter,
  type TrackerName,
  type TrackerSecrets,
} from "./index";
import type { Fetch } from "./types";

/**
 * Jira for builders: the open tickets of a linked Jira project, the label
 * put on or taken off from the dashboard, and the link between a Jira
 * project and the repository that holds its code.
 */

/** The deployment's tracker secrets (and a fetch, for tests). */
export type TrackerContext = { secrets: TrackerSecrets; fetcher?: Fetch };

type Connection = NonNullable<Awaited<ReturnType<typeof getConnection>>>;

async function api(db: Database, ctx: TrackerContext, connection: Connection) {
  const name = connection.tracker as TrackerName;
  const credentials = ctx.secrets[name];
  if (!credentials || !ctx.secrets.encryptionKey)
    throw new Error(`${name} is not configured on this deployment`);
  return {
    name,
    credentials,
    adapter: trackerAdapter(name, ctx.fetcher),
    scope: {
      externalId: connection.externalId,
      accessToken: await accessTokenFor(
        db,
        connection,
        ctx.secrets,
        ctx.fetcher,
      ),
    },
  };
}

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
          updatedAt: ticket.updatedAt ?? new Date(0).toISOString(),
        });
    } catch (error) {
      // One unreachable board leaves the others (and GitHub's issues) shown.
      console.warn(`open tickets of ${board.name}:`, (error as Error).message);
    }
  }
  return tickets;
}

/**
 * Queues (on) or unqueues (off) tracker tickets from the dashboard: the
 * label goes on or off the ticket in Jira, and Yarrow's copy follows at
 * once. The 5-minute sync would come to the same result.
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
    const entry = boards.find(
      ({ board, connection }) =>
        connection.tracker === "jira" &&
        board.externalBoardId === jiraProject(key),
    );
    if (!entry) throw new Error(`${key} is not in a linked Jira project`);
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
    if (!ticket) throw new Error(`${key} was not found in Jira`);
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
 * Links a Jira project to a repository (a Yarrow project): its labeled
 * tickets are synced from then on. A pasted ticket is queued right away.
 */
export async function linkJiraProject(
  db: Database,
  ctx: TrackerContext,
  userId: string,
  input: {
    projectId: string;
    connectionId: string;
    jiraKey: string;
    ticket?: string | null;
  },
): Promise<{ projectId: string; key: string | null }> {
  const project = await requireProjectMember(db, userId, input.projectId);
  const connection = await getConnection(db, input.connectionId);
  if (
    !connection ||
    connection.tracker !== "jira" ||
    connection.accountId !== project.accountId
  )
    throw new Error("Connect Jira for this repository first.");
  const tracker = await api(db, ctx, connection);
  const board = (
    await tracker.adapter.listBoards(tracker.scope, tracker.credentials)
  ).find((item) => item.id === input.jiraKey);
  if (!board)
    throw new Error(`${input.jiraKey} is not a project of ${connection.name}.`);
  await addBoard(db, {
    connectionId: connection.id,
    projectId: project.id,
    externalBoardId: board.id,
    name: board.name,
  });
  if (input.ticket)
    await labelTrackerTickets(db, ctx, project, [input.ticket], true);
  return { projectId: project.id, key: input.ticket ?? null };
}

/**
 * The settings page's Jira projects: the repository takes the tickets of
 * exactly these (none at all with an empty list). Queued tickets of a
 * project taken off leave the queue.
 */
export async function setJiraProjects(
  db: Database,
  ctx: TrackerContext,
  userId: string,
  input: { projectId: string; connectionId: string; jiraKeys: string[] },
): Promise<void> {
  const project = await requireProjectMember(db, userId, input.projectId);
  const kept = new Set<string>();
  for (const { board, connection } of await boardsForProject(db, project.id)) {
    if (connection.tracker !== "jira") continue;
    if (
      connection.id === input.connectionId &&
      input.jiraKeys.includes(board.externalBoardId)
    )
      kept.add(board.externalBoardId);
    else await removeBoard(db, project.id, board.id);
  }
  for (const jiraKey of input.jiraKeys)
    if (!kept.has(jiraKey))
      await linkJiraProject(db, ctx, userId, {
        projectId: project.id,
        connectionId: input.connectionId,
        jiraKey,
      });
}

/** Atlassian refused the token: the person removed Yarrow's access. */
export class JiraAccessError extends Error {
  constructor() {
    super("Jira access was removed in Atlassian");
  }
}
const refused = (error: unknown) =>
  error instanceof Error && /\((401|403)\)/.test(error.message);

/** The Jira projects a connection reaches, for the dashboard's link card. */
export async function jiraProjects(
  db: Database,
  ctx: TrackerContext,
  userId: string,
  connectionId: string,
): Promise<{ id: string; name: string }[]> {
  const connection = await getConnection(db, connectionId);
  const reachable = (await jiraConnectionsForUser(db, userId)).some(
    (row) => row.id === connectionId,
  );
  if (!connection || !reachable) throw new Error("Connection not found");
  try {
    const tracker = await api(db, ctx, connection);
    return await tracker.adapter.listBoards(tracker.scope, tracker.credentials);
  } catch (error) {
    throw refused(error) ? new JiraAccessError() : error;
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
  | { queued: { projectId: string; key: string | null } }
  | { step: JiraStep }
> {
  const site = intent.site ?? null;
  const ticket = intent.ticket ?? null;
  if (ticket) {
    const mapped = await jiraBoardFor(
      db,
      userId,
      jiraProject(ticket),
      site ?? undefined,
    );
    if (mapped) {
      const project = await requireProjectMember(db, userId, mapped.projectId);
      await labelTrackerTickets(db, ctx, project, [ticket], true);
      return { queued: { projectId: project.id, key: ticket } };
    }
  }
  const connections = await jiraConnectionsForUser(db, userId);
  const projects = (await projectsForUser(db, userId)).filter(
    (project) => project.linked,
  );
  const connectionFor = (accountId: string) =>
    connections.filter(
      (row) => row.accountId === accountId && (!site || row.site === site),
    );
  const chosen = projects.find((project) => project.id === projectId);
  const [only, ...others] = chosen ? connectionFor(chosen.accountId) : [];
  if (chosen && only && others.length === 0) {
    const jiraKey = ticket
      ? jiraProject(ticket)
      : await jiraProjects(db, ctx, userId, only.id).then((list) =>
          list.length === 1 ? list[0]!.id : null,
        );
    if (jiraKey)
      return {
        queued: await linkJiraProject(db, ctx, userId, {
          projectId: chosen.id,
          connectionId: only.id,
          jiraKey,
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
 * The settings page's "Board" block: the Jira project's statuses, where
 * tickets move (the builder's choice, or the defaults), and the last move
 * Jira refused.
 */
export async function jiraBoardSettings(
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
    moves: board.moves ?? defaultMoves(statuses),
    chosen: board.moves !== null,
    warning: board.moveWarning,
  };
}

export async function setJiraMoves(
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
  if (!adapter.moveTo || !adapter.statuses) return "tracker cannot move tickets";
  const statuses = await adapter.statuses(
    scope,
    credentials,
    row.board.externalBoardId,
  );
  const target = (row.board.moves ?? defaultMoves(statuses))[event];
  if (!target) return "not moved (builder's choice)";
  const result = await adapter.moveTo(scope, credentials, row.key, target);
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
