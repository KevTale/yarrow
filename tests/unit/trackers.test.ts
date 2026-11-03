import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureAccount } from "../../src/db/accounts";
import { createProject } from "../../src/db/projects";
import * as schema from "../../src/db/schema";
import { addBoard, saveTrackerConnection } from "../../src/db/trackers";
import { decryptToken, encryptToken } from "../../src/server/trackers/crypto";
import { syncTrackers } from "../../src/server/trackers/index";
import { adfToText, jiraAdapter } from "../../src/server/trackers/jira";
import { linearAdapter } from "../../src/server/trackers/linear";
import { trelloAdapter } from "../../src/server/trackers/trello";
import { createTestDatabase } from "./helpers/pglite";

const key = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);

/** A Trello board, as its API answers: To Do, Doing, Done. */
function fakeTrello() {
  const lists = [
    { id: "todo", name: "To Do" },
    { id: "doing", name: "Doing" },
    { id: "done", name: "Done" },
  ];
  const card = (idShort: number, idList: string, name: string) => ({
    // Made at 2026-10-20T09:00:00Z.
    id: `${(1792486800).toString(16)}0000000000000${idShort}`,
    idShort,
    idList,
    name,
    desc: "Add a toggle",
    shortUrl: `https://trello.com/c/x${idShort}`,
    closed: false,
    dateLastActivity: "2026-10-21T09:00:00.000Z",
    labels: [] as { id: string; name: string }[],
  });
  const cards = [card(7, "todo", "Dark mode"), card(9, "done", "Shipped")];
  const labels = [{ id: "later", name: "later" }];
  const sent: string[] = [];
  const fetcher = (async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    const path = url.pathname.replace("/1/", "/");
    const given = url.searchParams;
    const answer = (value: unknown) => new Response(JSON.stringify(value));
    const method = init?.method ?? "GET";
    if (method !== "GET") sent.push(`${method} ${path}`);
    if (method === "GET") {
      if (path === "/boards/AbCd1234/lists") return answer(lists);
      if (path === "/boards/AbCd1234/labels") return answer(labels);
      if (path === "/boards/AbCd1234/cards/open")
        return answer(cards.filter((one) => !one.closed));
      if (path === "/boards/AbCd1234/cards/all") return answer(cards);
      if (path.endsWith("/actions"))
        return answer(
          given.get("filter") === "createCard"
            ? [{ memberCreator: { fullName: "Ada" } }]
            : [
                {
                  date: "2026-10-21T10:00:00.000Z",
                  data: { text: "Later" },
                  memberCreator: { fullName: "Bob" },
                },
                {
                  date: "2026-10-21T09:00:00.000Z",
                  data: { text: "First" },
                  memberCreator: { fullName: "Ada" },
                },
              ],
        );
    }
    if (method === "POST" && path === "/boards/AbCd1234/labels") {
      const label = { id: "made", name: given.get("name")! };
      labels.push(label);
      return answer(label);
    }
    if (method === "POST" && path === "/cards") {
      const made = card(10, given.get("idList")!, given.get("name")!);
      cards.push(made);
      return answer(made);
    }
    const held = cards.find((one) => path.startsWith(`/cards/${one.id}`));
    if (held && method === "PUT") {
      held.idList = given.get("idList")!;
      return answer(held);
    }
    if (held && method === "POST" && path.endsWith("/idLabels")) {
      held.labels.push(labels.find((one) => one.id === given.get("value"))!);
      return answer([]);
    }
    if (held && method === "DELETE") {
      held.labels = [];
      return answer({});
    }
    if (held && method === "POST") return answer({});
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetcher, cards, labels, sent };
}

describe("token encryption", () => {
  it("round-trips and uses a fresh IV each time", async () => {
    const a = await encryptToken(key, "lin_oauth_secret");
    const b = await encryptToken(key, "lin_oauth_secret");
    expect(a).not.toBe(b);
    expect(await decryptToken(key, a)).toBe("lin_oauth_secret");
    const other = btoa(String.fromCharCode(...new Uint8Array(32)));
    await expect(decryptToken(other, a)).rejects.toThrow();
    await expect(encryptToken("short", "x")).rejects.toThrow("32 bytes");
  });
});

describe("tracker adapters", () => {
  it("turns Jira ADF descriptions into text", () => {
    expect(
      adfToText({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Export fails." }],
          },
          {
            type: "bulletList",
            content: [
              {
                type: "listItem",
                content: [
                  {
                    type: "paragraph",
                    content: [{ type: "text", text: "zero rows" }],
                  },
                ],
              },
            ],
          },
        ],
      }).trim(),
    ).toBe("Export fails.\n\n- zero rows");
  });
  it("builds the OAuth URLs with the right scopes", () => {
    const credentials = { clientId: "id", clientSecret: "secret" };
    const linear = new URL(
      linearAdapter().authorizeUrl({
        credentials,
        redirectUri: "https://app/integrations/linear/callback",
        state: "s1",
      }),
    );
    expect(linear.searchParams.get("scope")).toBe("read,write,comments:create");
    expect(linear.searchParams.get("state")).toBe("s1");
    const jira = new URL(
      jiraAdapter().authorizeUrl({
        credentials,
        redirectUri: "https://app/integrations/jira/callback",
        state: "s2",
      }),
    );
    expect(jira.searchParams.get("audience")).toBe("api.atlassian.com");
    expect(jira.searchParams.get("scope")).toContain("offline_access");
  });
  it("queries Linear for labeled open issues of a team", async () => {
    let sent: { query: string; variables: Record<string, string> } | null =
      null;
    const fetcher = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  id: "uuid-1",
                  identifier: "ENG-12",
                  title: "Export crashes",
                  description: "Steps",
                  url: "https://linear.app/x/issue/ENG-12",
                  createdAt: "2026-10-20T09:00:00.000Z",
                  updatedAt: "2026-10-21T09:00:00.000Z",
                  creator: { name: "Ada" },
                  state: { type: "started" },
                  labels: { nodes: [{ name: "Yarrow" }] },
                },
              ],
            },
          },
        }),
      );
    }) as typeof fetch;
    const tickets = await linearAdapter(fetcher).labeledTickets(
      { externalId: "org", accessToken: "t" },
      { clientId: "", clientSecret: "" },
      "ENG",
      "yarrow",
    );
    expect(sent!.variables).toEqual({ team: "ENG", label: "yarrow" });
    expect(tickets).toEqual([
      {
        externalId: "ENG-12",
        title: "ENG-12 Export crashes",
        body: "Steps",
        url: "https://linear.app/x/issue/ENG-12",
        createdAt: "2026-10-20T09:00:00.000Z",
        updatedAt: "2026-10-21T09:00:00.000Z",
        author: "Ada",
        labels: ["Yarrow"],
        closed: false,
      },
    ]);
  });
});

describe("Trello", () => {
  const scope = { externalId: "member-1", accessToken: "t" };
  const credentials = { clientId: "api-key", clientSecret: "" };

  it("lists a board's open cards, numbered by board, none finished", async () => {
    const adapter = trelloAdapter(fakeTrello().fetcher);
    const open = await adapter.openTickets!(scope, credentials, "AbCd1234");
    expect(open).toEqual([
      {
        externalId: "AbCd1234-7",
        title: "Dark mode",
        body: "Add a toggle",
        url: "https://trello.com/c/x7",
        createdAt: "2026-10-20T09:00:00.000Z",
        updatedAt: "2026-10-21T09:00:00.000Z",
        labels: [],
        closed: false,
      },
    ]);
  });

  it("reads a card with who made it and what was said", async () => {
    const adapter = trelloAdapter(fakeTrello().fetcher);
    await expect(
      adapter.getTicket(scope, credentials, "AbCd1234-7"),
    ).resolves.toMatchObject({
      author: "Ada",
      discussion: "Ada: First\n\nBob: Later",
      closed: false,
    });
    await expect(
      adapter.getTicket(scope, credentials, "AbCd1234-9"),
    ).resolves.toMatchObject({ closed: true });
    await expect(
      adapter.getTicket(scope, credentials, "AbCd1234-404"),
    ).resolves.toBeNull();
  });

  it("reads what a list means from its name, or its place", async () => {
    const { fetcher } = fakeTrello();
    await expect(
      trelloAdapter(fetcher).statuses!(scope, credentials, "AbCd1234"),
    ).resolves.toEqual([
      { id: "todo", name: "To Do", category: "todo" },
      { id: "doing", name: "Doing", category: "progress" },
      { id: "done", name: "Done", category: "done" },
    ]);
    const unnamed = (async () =>
      new Response(
        JSON.stringify([
          { id: "a", name: "Ideas" },
          { id: "b", name: "This week" },
          { id: "c", name: "Shelf" },
        ]),
      )) as unknown as typeof fetch;
    const statuses = await trelloAdapter(unnamed).statuses!(
      scope,
      credentials,
      "AbCd1234",
    );
    expect(statuses.map((status) => status.category)).toEqual([
      "todo",
      "todo",
      "done",
    ]);
  });

  it("moves a card, never backwards unless told", async () => {
    const trello = fakeTrello();
    const adapter = trelloAdapter(trello.fetcher);
    const move = (status: string, back?: boolean) =>
      adapter.moveTo!(scope, credentials, "AbCd1234-7", status, back);
    await expect(move("todo")).resolves.toBe("already");
    await expect(move("doing")).resolves.toBe("moved");
    await expect(move("todo")).resolves.toBe("already");
    expect(trello.cards[0]!.idList).toBe("doing");
    await expect(move("todo", true)).resolves.toBe("moved");
    expect(trello.cards[0]!.idList).toBe("todo");
  });

  it("makes the label the first time, then puts and takes it", async () => {
    const trello = fakeTrello();
    const adapter = trelloAdapter(trello.fetcher);
    const label = (on: boolean) =>
      adapter.setLabel!(scope, credentials, "AbCd1234-7", "yarrow", on);
    await label(true);
    await label(true);
    expect(trello.cards[0]!.labels).toEqual([{ id: "made", name: "yarrow" }]);
    expect(trello.labels).toHaveLength(2);
    await label(false);
    expect(trello.cards[0]!.labels).toEqual([]);
  });

  it("writes a new card in the board's first list", async () => {
    const trello = fakeTrello();
    const adapter = trelloAdapter(trello.fetcher);
    await expect(
      adapter.createTicket!(scope, credentials, "AbCd1234", {
        title: "Export",
        body: "As CSV",
      }),
    ).resolves.toBe("AbCd1234-10");
    expect(trello.cards.at(-1)).toMatchObject({
      idList: "todo",
      name: "Export",
    });
  });

  it("comments on the card a key names", async () => {
    const trello = fakeTrello();
    await trelloAdapter(trello.fetcher).comment(
      scope,
      credentials,
      "AbCd1234-7",
      "Done",
    );
    expect(trello.sent).toEqual([
      `POST /cards/${trello.cards[0]!.id}/actions/comments`,
    ]);
  });
});

describe("tracker sync", async () => {
  const t = await createTestDatabase();
  const { db, raw } = t;
  afterAll(() => t.pg.close());
  beforeEach(() => t.reset());

  it("queues labeled Trello cards and unqueues cards that lose the label", async () => {
    const owner = {
      userId: crypto.randomUUID(),
      githubLogin: "marie",
      name: null,
    };
    const accountId = await ensureAccount(db, owner);
    const projectId = await createProject(db, accountId, owner.userId, {
      name: "Halyard",
      description: "",
      productUrl: "",
      repository: "marie/halyard",
      visibility: "listed",
      categories: ["saas"],
      stacks: [],
      authorizationLabel: "yarrow",
    });
    const connectionId = await saveTrackerConnection(db, {
      accountId,
      tracker: "trello",
      externalId: "member-1",
      name: "marie",
      encryptedAccessToken: await encryptToken(key, "trello-token"),
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
    });
    await addBoard(db, {
      connectionId,
      projectId,
      externalBoardId: "AbCd1234",
      name: "Roadmap",
    });
    const trello = fakeTrello();
    const card = trello.cards[0]!;
    card.labels = [{ id: "l", name: "Yarrow" }];
    const fetcher = ((url: string, init?: RequestInit) => {
      expect(url).toContain("token=trello-token");
      return trello.fetcher(url, init);
    }) as typeof fetch;
    const secrets = {
      encryptionKey: key,
      trello: { clientId: "api-key", clientSecret: "" },
    };
    expect(await syncTrackers(db, secrets, fetcher)).toEqual([
      "trello:Roadmap: 1 labeled",
    ]);
    let [unit] = await raw.select().from(schema.workUnits);
    expect(unit).toMatchObject({
      source: "trello",
      externalId: "AbCd1234-7",
      title: "Dark mode",
      authorized: true,
      status: "queued",
    });
    card.labels = [{ id: "later", name: "later" }];
    await syncTrackers(db, secrets, fetcher);
    [unit] = await raw.select().from(schema.workUnits);
    expect(unit!.authorized).toBe(false);
  });
});
