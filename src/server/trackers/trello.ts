import {
  json,
  type Fetch,
  type TrackerAdapter,
  type TrackerTicket,
} from "./types";

const API = "https://api.trello.com/1";

interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  shortUrl: string;
  closed: boolean;
  labels: { name: string }[];
}

function toTicket(card: TrelloCard): TrackerTicket {
  return {
    externalId: card.id,
    title: card.name,
    body: card.desc,
    url: card.shortUrl,
    labels: card.labels.map((label) => label.name),
    closed: card.closed,
  };
}

/**
 * Trello uses an API key plus a user token. The authorize page returns the
 * token in the URL fragment of `return_url`; there is no code exchange.
 */
export function trelloAdapter(fetcher: Fetch = fetch): TrackerAdapter {
  function url(path: string, key: string, token: string, params = {}) {
    const target = new URL(`${API}${path}`);
    target.search = new URLSearchParams({ ...params, key, token }).toString();
    return target.toString();
  }
  return {
    name: "trello",
    authorizeUrl({ credentials, redirectUri, state }) {
      const target = new URL("https://trello.com/1/authorize");
      target.search = new URLSearchParams({
        expiration: "never",
        name: "Agent Commons",
        scope: "read,write",
        response_type: "token",
        key: credentials.clientId,
        callback_method: "fragment",
        return_url: `${redirectUri}?state=${encodeURIComponent(state)}`,
      }).toString();
      return target.toString();
    },
    async describe(tokens, credentials) {
      const member = await json<{ id: string; username: string }>(
        await fetcher(
          url("/members/me", credentials.clientId, tokens.accessToken),
        ),
        "Trello member",
      );
      return [{ ...tokens, externalId: member.id, name: member.username }];
    },
    async listBoards({ accessToken }, credentials) {
      const boards = await json<
        { id: string; name: string; closed: boolean }[]
      >(
        await fetcher(
          url("/members/me/boards", credentials.clientId, accessToken, {
            fields: "name,closed",
          }),
        ),
        "Trello boards",
      );
      return boards
        .filter((board) => !board.closed)
        .map((board) => ({ id: board.id, name: board.name }));
    },
    async labeledTickets({ accessToken }, credentials, boardId, label) {
      const cards = await json<TrelloCard[]>(
        await fetcher(
          url(
            `/boards/${boardId}/cards/open`,
            credentials.clientId,
            accessToken,
            {
              fields: "name,desc,shortUrl,closed,labels",
            },
          ),
        ),
        "Trello cards",
      );
      const wanted = label.toLowerCase();
      return cards
        .filter((card) =>
          card.labels.some(
            (cardLabel) => cardLabel.name.toLowerCase() === wanted,
          ),
        )
        .map(toTicket);
    },
    async getTicket({ accessToken }, credentials, externalId) {
      const response = await fetcher(
        url(`/cards/${externalId}`, credentials.clientId, accessToken, {
          fields: "name,desc,shortUrl,closed,labels",
        }),
      );
      if (response.status === 404) return null;
      return toTicket(await json<TrelloCard>(response, "Trello card"));
    },
    async comment({ accessToken }, credentials, externalId, body) {
      await json(
        await fetcher(
          url(
            `/cards/${externalId}/actions/comments`,
            credentials.clientId,
            accessToken,
            {
              text: body,
            },
          ),
          { method: "POST" },
        ),
        "Trello comment",
      );
    },
  };
}
