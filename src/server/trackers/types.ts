import type { TrackerStatus } from "../../core/tracker-moves";

export type TrackerName = "linear" | "jira" | "trello";

export interface TrackerTicket {
  externalId: string;
  title: string;
  /** When the ticket last changed in the tracker (ISO), when it says. */
  updatedAt?: string;
  /** When the ticket was written (ISO), and by whom, when the tracker says. */
  createdAt?: string;
  /** Its comments, oldest first, as the agents read them (Jira). */
  discussion?: string;
  author?: string;
  body: string;
  url: string;
  labels: string[];
  closed: boolean;
}

export interface TrackerTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
}

export interface TrackerConnectionInfo extends TrackerTokens {
  /** Linear organization, Jira cloud site, or Trello member. */
  externalId: string;
  name: string;
}

export interface TrackerCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * The calls Yarrow needs from a tracker. Tickets are synced by
 * polling (every 5 minutes from the brain): no webhook to configure.
 */
export interface TrackerAdapter {
  name: TrackerName;
  /** Where the owner authorizes Yarrow. */
  authorizeUrl(input: {
    credentials: TrackerCredentials;
    redirectUri: string;
    state: string;
  }): string;
  /** OAuth code exchange (Linear, Jira). Trello returns the token directly. */
  exchangeCode?(input: {
    credentials: TrackerCredentials;
    code: string;
    redirectUri: string;
  }): Promise<TrackerTokens>;
  /** Refreshes an expiring token (Jira). */
  refresh?(input: {
    credentials: TrackerCredentials;
    refreshToken: string;
  }): Promise<TrackerTokens>;
  /** Identifies the workspace(s) the token can reach. */
  describe(
    tokens: TrackerTokens,
    credentials: TrackerCredentials,
  ): Promise<TrackerConnectionInfo[]>;
  listBoards(
    connection: { externalId: string; accessToken: string },
    credentials: TrackerCredentials,
  ): Promise<{ id: string; name: string }[]>;
  /** Open tickets of a board carrying `label`. */
  labeledTickets(
    connection: { externalId: string; accessToken: string },
    credentials: TrackerCredentials,
    boardId: string,
    label: string,
  ): Promise<TrackerTicket[]>;
  getTicket(
    connection: { externalId: string; accessToken: string },
    credentials: TrackerCredentials,
    externalId: string,
  ): Promise<TrackerTicket | null>;
  comment(
    connection: { externalId: string; accessToken: string },
    credentials: TrackerCredentials,
    externalId: string,
    body: string,
  ): Promise<void>;
  /** Open tickets of a board, labeled or not, for the builder's table (Jira). */
  openTickets?(
    connection: { externalId: string; accessToken: string },
    credentials: TrackerCredentials,
    boardId: string,
  ): Promise<TrackerTicket[]>;
  /** A board's statuses, in board order as far as the tracker tells (Jira). */
  statuses?(
    connection: { externalId: string; accessToken: string },
    credentials: TrackerCredentials,
    boardId: string,
  ): Promise<TrackerStatus[]>;
  /** The status a ticket is in now (Jira, Linear). */
  currentStatus?(
    connection: { externalId: string; accessToken: string },
    credentials: TrackerCredentials,
    externalId: string,
  ): Promise<string | null>;
  /**
   * Moves a ticket to a status, never backwards unless `backwards`:
   * "already" when it is there (or further), "blocked" when the workflow
   * has no way there (Jira).
   */
  moveTo?(
    connection: { externalId: string; accessToken: string },
    credentials: TrackerCredentials,
    externalId: string,
    statusId: string,
    backwards?: boolean,
  ): Promise<"moved" | "already" | "blocked">;
  /** Creates a ticket written in Yarrow (Markdown body); returns its id (Jira). */
  createTicket?(
    connection: { externalId: string; accessToken: string },
    credentials: TrackerCredentials,
    boardId: string,
    ticket: { title: string; body: string },
  ): Promise<string>;
  /** Puts the label on a ticket, or takes it off (Jira). */
  setLabel?(
    connection: { externalId: string; accessToken: string },
    credentials: TrackerCredentials,
    externalId: string,
    label: string,
    on: boolean,
  ): Promise<void>;
}

export type Fetch = typeof fetch;

export async function json<T>(response: Response, what: string): Promise<T> {
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `${what} failed (${response.status}): ${detail.slice(0, 300)}`,
    );
  }
  return (await response.json()) as T;
}
