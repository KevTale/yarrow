import { categoryRank, type TrackerStatus } from "../../core/tracker-moves";
import { boardOfKey } from "../../core/ticket-link";
import {
  json,
  type Fetch,
  type TrackerAdapter,
  type TrackerTicket,
} from "./types";

const API = "https://api.trello.com/1";

/**
 * Trello for builders, as Jira and Linear: a board is named by its short
 * link ("AbCd1234", from its address) and a ticket by that and the card's
 * number on the board ("AbCd1234-42"), which is how a ticket finds its
 * board. The lists are its statuses.
 */
interface TrelloCard {
  id: string;
  idShort: number;
  idList: string;
  name: string;
  desc: string;
  shortUrl: string;
  closed: boolean;
  dateLastActivity?: string;
  labels: { id: string; name: string }[];
}

interface TrelloList {
  id: string;
  name: string;
}

const cardFields =
  "idShort,idList,name,desc,shortUrl,closed,dateLastActivity,labels";

/** A card's id starts with the second it was made at. */
const madeAt = (id: string) => {
  const seconds = parseInt(id.slice(0, 8), 16);
  return Number.isNaN(seconds)
    ? undefined
    : new Date(seconds * 1000).toISOString();
};

function toTicket(board: string, card: TrelloCard): TrackerTicket {
  return {
    externalId: `${board}-${card.idShort}`,
    title: card.name,
    body: card.desc,
    url: card.shortUrl,
    createdAt: madeAt(card.id),
    updatedAt: card.dateLastActivity,
    labels: card.labels.map((label) => label.name),
    closed: card.closed,
  };
}

const doneName =
  /\b(done|closed|shipped|merged|finished|complete[d]?|termin|fait|fini)/i;
const progressName = /progress|doing|review|revue|cours|wip|qa\b|test/i;

/**
 * A board's lists as statuses. Trello's say nothing of what they mean: their
 * names do, and a board with no list that reads as done ends with its last.
 */
function statusesOf(lists: TrelloList[]): TrackerStatus[] {
  const done = lists.some((list) => doneName.test(list.name));
  return lists.map((list, i) => ({
    id: list.id,
    name: list.name,
    category:
      doneName.test(list.name) || (!done && i > 0 && i === lists.length - 1)
        ? "done"
        : progressName.test(list.name)
          ? "progress"
          : "todo",
  }));
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

  function client(accessToken: string, apiKey: string) {
    const get = async <T>(path: string, what: string, params = {}) =>
      json<T>(await fetcher(url(path, apiKey, accessToken, params)), what);
    const send = async <T>(
      method: "POST" | "PUT" | "DELETE",
      path: string,
      what: string,
      params = {},
    ) =>
      json<T>(
        await fetcher(url(path, apiKey, accessToken, params), { method }),
        what,
      );
    const lists = (board: string) =>
      get<TrelloList[]>(`/boards/${board}/lists`, "Trello lists", {
        filter: "open",
        fields: "name",
      });
    /** Its cards still to be done: none archived, none in a list that ends. */
    const open = async (board: string) => {
      const [cards, statuses] = await Promise.all([
        get<TrelloCard[]>(`/boards/${board}/cards/open`, "Trello cards", {
          fields: cardFields,
        }),
        lists(board).then(statusesOf),
      ]);
      const finished = new Set(
        statuses
          .filter((status) => status.category === "done")
          .map((status) => status.id),
      );
      return cards.filter((card) => !finished.has(card.idList));
    };
    /** The card a key names, archived or not: the API takes no card number. */
    const card = async (key: string) => {
      const number = Number(/\d+$/.exec(key)?.[0]);
      const cards = await get<TrelloCard[]>(
        `/boards/${boardOfKey(key)}/cards/all`,
        "Trello cards",
        { fields: cardFields },
      );
      return cards.find((one) => one.idShort === number) ?? null;
    };
    const held = async (key: string) => {
      const found = await card(key);
      if (!found) throw new Error(`${key} is not on its Trello board.`);
      return found;
    };
    return { get, send, lists, open, card, held };
  }

  return {
    name: "trello",
    authorizeUrl({ credentials, redirectUri, state }) {
      const target = new URL("https://trello.com/1/authorize");
      target.search = new URLSearchParams({
        expiration: "never",
        name: "Yarrow",
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
      const boards = await client(accessToken, credentials.clientId).get<
        { shortLink: string; name: string; closed: boolean }[]
      >("/members/me/boards", "Trello boards", {
        fields: "name,closed,shortLink",
      });
      return boards
        .filter((board) => !board.closed)
        .map((board) => ({ id: board.shortLink, name: board.name }));
    },
    async labeledTickets({ accessToken }, credentials, boardId, label) {
      const cards = await client(accessToken, credentials.clientId).open(
        boardId,
      );
      const wanted = label.toLowerCase();
      return cards
        .filter((card) =>
          card.labels.some(
            (cardLabel) => cardLabel.name.toLowerCase() === wanted,
          ),
        )
        .map((card) => toTicket(boardId, card));
    },
    async openTickets({ accessToken }, credentials, boardId) {
      const cards = await client(accessToken, credentials.clientId).open(
        boardId,
      );
      return cards.map((card) => toTicket(boardId, card));
    },
    async getTicket({ accessToken }, credentials, key) {
      const trello = client(accessToken, credentials.clientId);
      const card = await trello.card(key);
      if (!card) return null;
      const [made, comments, lists] = await Promise.all([
        trello.get<{ memberCreator?: { fullName?: string } }[]>(
          `/cards/${card.id}/actions`,
          "Trello card's maker",
          { filter: "createCard", limit: 1 },
        ),
        trello.get<
          {
            date: string;
            data: { text?: string };
            memberCreator?: { fullName?: string };
          }[]
        >(`/cards/${card.id}/actions`, "Trello comments", {
          filter: "commentCard",
          limit: 20,
        }),
        trello.lists(boardOfKey(key)),
      ]);
      const finished = statusesOf(lists).some(
        (status) => status.id === card.idList && status.category === "done",
      );
      const discussion = [...comments]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map(
          (comment) =>
            `${comment.memberCreator?.fullName ?? "Someone"}: ${(comment.data.text ?? "").trim()}`,
        )
        .join("\n\n");
      const author = made[0]?.memberCreator?.fullName;
      return {
        ...toTicket(boardOfKey(key), card),
        closed: card.closed || finished,
        ...(author ? { author } : {}),
        ...(discussion ? { discussion } : {}),
      };
    },
    async statuses({ accessToken }, credentials, boardId) {
      return statusesOf(
        await client(accessToken, credentials.clientId).lists(boardId),
      );
    },
    async currentStatus({ accessToken }, credentials, key) {
      const card = await client(accessToken, credentials.clientId).card(key);
      return card?.idList ?? null;
    },
    async moveTo(
      { accessToken },
      credentials,
      key,
      statusId,
      backwards = false,
    ) {
      const trello = client(accessToken, credentials.clientId);
      const card = await trello.held(key);
      if (card.idList === statusId) return "already";
      const statuses = statusesOf(await trello.lists(boardOfKey(key)));
      const rank = (id: string) => {
        const status = statuses.find((one) => one.id === id);
        return status ? categoryRank[status.category] : 0;
      };
      // Never backwards: a card already further stays where it is.
      if (!backwards && rank(card.idList) > rank(statusId)) return "already";
      // Any card goes to any list of its board.
      await trello.send("PUT", `/cards/${card.id}`, "Trello move", {
        idList: statusId,
      });
      return "moved";
    },
    async setLabel({ accessToken }, credentials, key, label, on) {
      const trello = client(accessToken, credentials.clientId);
      const card = await trello.held(key);
      const lower = label.toLowerCase();
      const onCard = card.labels.find(
        (one) => one.name.toLowerCase() === lower,
      );
      if (!on) {
        if (onCard)
          await trello.send(
            "DELETE",
            `/cards/${card.id}/idLabels/${onCard.id}`,
            "Trello label off",
          );
        return;
      }
      if (onCard) return;
      const board = boardOfKey(key);
      const labels = await trello.get<{ id: string; name: string }[]>(
        `/boards/${board}/labels`,
        "Trello labels",
        { fields: "name", limit: 1000 },
      );
      // The board's label, else a new one for it.
      const id =
        labels.find((one) => one.name.toLowerCase() === lower)?.id ??
        (
          await trello.send<{ id: string }>(
            "POST",
            `/boards/${board}/labels`,
            "Trello label",
            { name: label, color: "yellow" },
          )
        ).id;
      await trello.send("POST", `/cards/${card.id}/idLabels`, "Trello label", {
        value: id,
      });
    },
    async createTicket({ accessToken }, credentials, boardId, { title, body }) {
      const trello = client(accessToken, credentials.clientId);
      const [list] = statusesOf(await trello.lists(boardId));
      if (!list) throw new Error(`${boardId} has no list to take a ticket.`);
      // Trello writes Markdown: the description goes as written.
      const card = await trello.send<{ idShort: number }>(
        "POST",
        "/cards",
        "Trello card",
        { idList: list.id, name: title, desc: body },
      );
      return `${boardId}-${card.idShort}`;
    },
    async comment({ accessToken }, credentials, key, body) {
      const trello = client(accessToken, credentials.clientId);
      const card = await trello.held(key);
      await trello.send(
        "POST",
        `/cards/${card.id}/actions/comments`,
        "Trello comment",
        { text: body },
      );
    },
  };
}
