import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureAccount } from "../../src/db/accounts";
import { createProject } from "../../src/db/projects";
import * as schema from "../../src/db/schema";
import { addBoard, saveTrackerConnection } from "../../src/db/trackers";
import { decryptToken, encryptToken } from "../../src/server/trackers/crypto";
import { syncTrackers } from "../../src/server/trackers/index";
import { adfToText, jiraAdapter } from "../../src/server/trackers/jira";
import { linearAdapter } from "../../src/server/trackers/linear";
import { createTestDatabase } from "./helpers/pglite";

const key = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);

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
      "team-1",
      "yarrow",
    );
    expect(sent!.variables).toEqual({ team: "team-1", label: "yarrow" });
    expect(tickets).toEqual([
      {
        externalId: "uuid-1",
        title: "ENG-12 Export crashes",
        body: "Steps",
        url: "https://linear.app/x/issue/ENG-12",
        labels: ["Yarrow"],
        closed: false,
      },
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
      externalBoardId: "board-1",
      name: "Roadmap",
    });
    let labeled = true;
    const card = () => ({
      id: "card-1",
      name: "Dark mode",
      desc: "Add a toggle",
      shortUrl: "https://trello.com/c/abc",
      closed: false,
      labels: labeled ? [{ name: "Yarrow" }] : [{ name: "later" }],
    });
    const fetcher = (async (url: string) => {
      expect(url).toContain("token=trello-token");
      if (url.includes("/boards/board-1/cards/open"))
        return new Response(JSON.stringify([card()]));
      if (url.includes("/cards/card-1"))
        return new Response(JSON.stringify(card()));
      return new Response("not found", { status: 404 });
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
      title: "Dark mode",
      authorized: true,
      status: "queued",
    });
    labeled = false;
    await syncTrackers(db, secrets, fetcher);
    [unit] = await raw.select().from(schema.workUnits);
    expect(unit!.authorized).toBe(false);
  });
});
