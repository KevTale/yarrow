export type TrackerName = "linear" | "jira" | "trello";

export interface TrackerTicket {
  externalId: string;
  title: string;
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
