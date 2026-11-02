import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseTicketLink } from "../../src/core/ticket-link";
import { ensureAccount } from "../../src/db/accounts";
import { createProject } from "../../src/db/projects";
import * as schema from "../../src/db/schema";
import { projectTickets } from "../../src/db/tickets";
import {
  connectionsForAccount,
  saveTrackerConnection,
} from "../../src/db/trackers";
import { branchName } from "../../src/server/github/delivery";
import { pullRequestTitle } from "../../src/runner/pull-request";
import { encryptToken } from "../../src/server/trackers/crypto";
import { syncTrackers } from "../../src/server/trackers/index";
import { jiraAdapter, markdownToAdf } from "../../src/server/trackers/jira";
import { openedFromYarrow } from "../../src/core/new-ticket";
import {
  ensureJiraWebhooks,
  handleJiraDelivery,
  verifyJiraWebhook,
} from "../../src/server/trackers/jira-webhooks";
import {
  closeTrackerTicket,
  createTrackerTicket,
  TrackerAccessError,
  trackerBoardSettings,
  listTrackerBoards,
  moveTrackerTicket,
  setTrackerMoves,
  labelTrackerTickets,
  openTrackerTickets,
  setTrackerBoards,
  settleJira,
  type TrackerContext,
} from "../../src/server/trackers/flow";
import { createTestDatabase } from "./helpers/pglite";

const key = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);

/** A Jira Cloud site with one project, answering like Atlassian's API. */
function fakeJira() {
  const issues = new Map(
    [
      ["APP-1", "Export crashes", [] as string[]],
      ["APP-2", "Dark mode", ["yarrow"]],
    ].map(([id, summary, labels]) => [
      id as string,
      { summary: summary as string, labels: labels as string[], status: "10" },
    ]),
  );
  // A workflow: To Do → In Progress → Code review → Done (no shortcut).
  const statuses = [
    { id: "10", name: "To Do", statusCategory: { key: "new" } },
    { id: "20", name: "In Progress", statusCategory: { key: "indeterminate" } },
    { id: "30", name: "Code review", statusCategory: { key: "indeterminate" } },
    { id: "40", name: "Done", statusCategory: { key: "done" } },
  ];
  const status = (id: string) => statuses.find((item) => item.id === id)!;
  const next: Record<string, string[]> = {
    "10": ["20"],
    "20": ["30", "40"],
    "30": ["20", "40"],
    "40": ["20"],
  };
  const api = "https://api.atlassian.com/ex/jira/cloud-1/rest/api/3";
  // Fields a project requires beyond the summary (none by default).
  const required: string[] = [];
  const created: unknown[] = [];
  const issue = (id: string) => ({
    id,
    key: id,
    fields: {
      ...issues.get(id)!,
      description: null,
      updated: "2026-10-08T09:00:00.000+0000",
      created: "2026-10-06T14:00:00.000+0000",
      status: status(issues.get(id)!.status),
    },
  });
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status });
    if (url.endsWith("/oauth/token/accessible-resources"))
      return json([
        {
          id: "cloud-1",
          name: "acme",
          url: "https://acme.atlassian.net",
          scopes: ["read:jira-work", "write:jira-work"],
        },
      ]);
    if (url.startsWith(`${api}/project/search`))
      return json({ values: [{ key: "APP", name: "Acme app" }] });
    if (url === `${api}/search/jql`) {
      const { jql } = JSON.parse(String(init.body)) as { jql: string };
      const labeled = jql.includes("labels =");
      return json({
        issues: [...issues.keys()]
          .filter((id) => !labeled || issues.get(id)!.labels.includes("yarrow"))
          .map(issue),
      });
    }
    if (url === `${api}/project/APP/statuses`)
      return json([{ statuses: statuses.slice(0, 3) }, { statuses }]);
    const moves = /\/issue\/([A-Z]+-\d+)\/transitions$/.exec(url);
    if (moves) {
      const ticket = issues.get(moves[1]!)!;
      if (init.method === "POST") {
        const { transition } = JSON.parse(String(init.body)) as {
          transition: { id: string };
        };
        ticket.status = transition.id.replace("t", "");
        return new Response(null, { status: 204 });
      }
      return json({
        transitions: next[ticket.status]!.map((id) => ({
          id: `t${id}`,
          to: status(id),
        })),
      });
    }
    const match = /\/issue\/([A-Z]+-\d+)(\?.*)?$/.exec(url);
    if (match && init.method === "PUT") {
      const { update } = JSON.parse(String(init.body)) as {
        update: { labels: { add?: string; remove?: string }[] };
      };
      const labels = issues.get(match[1]!)!.labels;
      for (const change of update.labels) {
        if (change.add) labels.push(change.add);
        if (change.remove) labels.splice(labels.indexOf(change.remove), 1);
      }
      return new Response(null, { status: 204 });
    }
    if (match) return json(issue(match[1]!));
    // New tickets: the project's issue types, their fields, the creation.
    if (url.startsWith(`${api}/issue/createmeta/APP/issuetypes/`))
      return json({
        fields: [
          { fieldId: "summary", name: "Summary", required: true },
          { fieldId: "description", name: "Description", required: false },
          ...required.map((name) => ({
            fieldId: "customfield_1",
            name,
            required: true,
            hasDefaultValue: false,
          })),
        ],
      });
    if (url.startsWith(`${api}/issue/createmeta/APP/issuetypes`))
      return json({
        issueTypes: [
          { id: "1", name: "Epic" },
          { id: "3", name: "Task" },
          { id: "5", name: "Sub-task", subtask: true },
        ],
      });
    if (url === `${api}/issue` && init.method === "POST") {
      const { fields } = JSON.parse(String(init.body)) as {
        fields: { summary: string; issuetype: { id: string } };
      };
      const key = `APP-${issues.size + 1}`;
      created.push(JSON.parse(String(init.body)));
      issues.set(key, { summary: fields.summary, labels: [], status: "10" });
      return json({ id: "100", key }, 201);
    }
    return json({ message: `unexpected ${url}` }, 404);
  }) as typeof fetch;
  return { fetcher, issues, required, created };
}

describe("Jira for builders", async () => {
  const t = await createTestDatabase();
  const { db, raw } = t;
  afterAll(() => t.pg.close());
  beforeEach(() => t.reset());

  const marie = {
    userId: crypto.randomUUID(),
    githubLogin: "marie",
    name: null,
  };
  async function setup() {
    const accountId = await ensureAccount(db, marie);
    const projectId = await createProject(db, accountId, marie.userId, {
      name: "Halyard",
      description: "",
      productUrl: "",
      repository: "marie/halyard",
      visibility: "public",
      categories: ["saas"],
      stacks: [],
      authorizationLabel: "yarrow",
    });
    // Installed on GitHub: the code side is connected.
    await raw
      .update(schema.projects)
      .set({ githubInstallationId: "42", githubRepositoryId: "999" })
      .where(eq(schema.projects.id, projectId));
    const jira = fakeJira();
    const ctx: TrackerContext = {
      secrets: {
        encryptionKey: key,
        jira: { clientId: "c", clientSecret: "s" },
      },
      fetcher: jira.fetcher,
    };
    const connect = () =>
      encryptToken(key, "jira-token").then((token) =>
        saveTrackerConnection(db, {
          accountId,
          tracker: "jira",
          externalId: "cloud-1",
          name: "acme.atlassian.net",
          encryptedAccessToken: token,
          encryptedRefreshToken: null,
          tokenExpiresAt: null,
        }),
      );
    return { projectId, ctx, jira, connect };
  }
  const intent = {
    source: "jira",
    site: "acme.atlassian.net",
    ticket: "APP-1",
  } as const;

  it("asks for Jira, then links its project to the repository and queues the pasted ticket", async () => {
    const { projectId, ctx, jira, connect } = await setup();
    expect(await settleJira(db, ctx, marie.userId, intent)).toEqual({
      step: {
        site: "acme.atlassian.net",
        ticket: "APP-1",
        projects: [
          {
            id: projectId,
            name: "halyard",
            repository: "marie/halyard",
            connectionId: null,
          },
        ],
      },
    });
    const connectionId = await connect();
    // Connected, but the repository was not chosen: the dashboard asks.
    const asked = await settleJira(db, ctx, marie.userId, intent);
    expect(asked).toMatchObject({
      step: { projects: [{ connectionId }] },
    });
    // Back from Jira's authorization, started from this repository.
    expect(await settleJira(db, ctx, marie.userId, intent, projectId)).toEqual({
      queued: { projectId, key: "APP-1" },
    });
    expect(jira.issues.get("APP-1")!.labels).toEqual(["yarrow"]);
    const [board] = await raw.select().from(schema.trackerBoards);
    expect(board).toMatchObject({
      projectId,
      externalBoardId: "APP",
      name: "APP · Acme app",
    });
    const [unit] = await raw.select().from(schema.workUnits);
    expect(unit).toMatchObject({
      source: "jira",
      externalId: "APP-1",
      title: "APP-1 Export crashes",
      url: "https://acme.atlassian.net/browse/APP-1",
      authorized: true,
      status: "queued",
    });
    // The next APP ticket pasted goes straight to the queue.
    expect(
      await settleJira(db, ctx, marie.userId, { ...intent, ticket: "APP-2" }),
    ).toEqual({ queued: { projectId, key: "APP-2" } });
    // The brain's sync then follows the labels set in Jira itself.
    jira.issues.get("APP-1")!.labels.length = 0;
    expect(await syncTrackers(db, ctx.secrets, jira.fetcher)).toEqual([
      "jira:APP · Acme app: 1 labeled",
    ]);
    const units = await raw.select().from(schema.workUnits);
    expect(units.map((row) => [row.externalId, row.authorized]).sort()).toEqual(
      [
        ["APP-1", false],
        ["APP-2", true],
      ],
    );
  });

  it("lists open Jira tickets and queues or unqueues them from the dashboard", async () => {
    const { projectId, ctx, jira, connect } = await setup();
    expect(await openTrackerTickets(db, ctx, projectId)).toBeNull();
    await connect();
    await settleJira(db, ctx, marie.userId, intent, projectId);
    expect(await openTrackerTickets(db, ctx, projectId)).toEqual([
      {
        key: "APP-1",
        source: "jira",
        ref: "APP-1",
        number: 1,
        title: "Export crashes",
        url: "https://acme.atlassian.net/browse/APP-1",
        createdAt: "2026-10-06T14:00:00.000Z",
        updatedAt: "2026-10-08T09:00:00.000Z",
      },
      expect.objectContaining({ key: "APP-2", title: "Dark mode" }),
    ]);
    const project = { id: projectId, authorizationLabel: "yarrow" };
    await labelTrackerTickets(db, ctx, project, ["APP-1"], false);
    expect(jira.issues.get("APP-1")!.labels).toEqual([]);
    await labelTrackerTickets(db, ctx, project, ["APP-2"], true);
    const rows = await projectTickets(db, projectId);
    expect(rows.map((row) => [row.ref, row.title, row.status]).sort()).toEqual([
      ["APP-1", "Export crashes", "none"],
      ["APP-2", "Dark mode", "queued"],
    ]);
    await expect(
      labelTrackerTickets(db, ctx, project, ["OPS-3"], true),
    ).rejects.toThrow("not in a linked board");
    // From the settings page: no Jira project any more, then APP again.
    const [connection] = await raw
      .select({ id: schema.trackerConnections.id })
      .from(schema.trackerConnections);
    const connectionId = connection!.id;
    await setTrackerBoards(db, ctx, marie.userId, {
      projectId,
      connectionId,
      keys: [],
    });
    expect(await raw.select().from(schema.trackerBoards)).toEqual([]);
    expect(await openTrackerTickets(db, ctx, projectId)).toBeNull();
    await setTrackerBoards(db, ctx, marie.userId, {
      projectId,
      connectionId,
      keys: ["APP"],
    });
    expect(await raw.select().from(schema.trackerBoards)).toHaveLength(1);
    // Access removed in Atlassian: told apart from Jira being down.
    const refusing = (async () =>
      new Response("{}", { status: 401 })) as typeof fetch;
    await expect(
      listTrackerBoards(
        db,
        { ...ctx, fetcher: refusing },
        marie.userId,
        connectionId,
      ),
    ).rejects.toBeInstanceOf(TrackerAccessError);
  });

  it("names sites by their address and changes labels in one request", async () => {
    const { jira } = { jira: fakeJira() };
    const adapter = jiraAdapter(jira.fetcher);
    expect(
      await adapter.describe(
        { accessToken: "t" },
        { clientId: "", clientSecret: "" },
      ),
    ).toMatchObject([{ externalId: "cloud-1", name: "acme.atlassian.net" }]);
    await adapter.setLabel!(
      { externalId: "cloud-1", accessToken: "t" },
      { clientId: "", clientSecret: "" },
      "APP-1",
      "yarrow",
      true,
    );
    expect(jira.issues.get("APP-1")!.labels).toEqual(["yarrow"]);
  });

  /** Jira's webhook API on top of the fake site. */
  function withWebhooks(base: typeof fetch, refuse = false) {
    const hooks = new Map<number, { url: string; jqlFilter: string }>();
    const calls: string[] = [];
    let next = 1000;
    const fetcher = (async (url: string, init: RequestInit = {}) => {
      const hook = /\/rest\/api\/3\/webhook(\/refresh)?(\?.*)?$/.exec(url);
      if (!hook) return base(url, init);
      const method = init.method ?? "GET";
      calls.push(`${method}${hook[1] ?? ""}`);
      if (refuse)
        return new Response('{"errorMessages":["scope"]}', { status: 403 });
      const body = init.body ? JSON.parse(String(init.body)) : {};
      if (method === "POST") {
        const id = next++;
        hooks.set(id, { url: body.url, jqlFilter: body.webhooks[0].jqlFilter });
        return Response.json({
          webhookRegistrationResult: [{ createdWebhookId: id }],
        });
      }
      if (method === "DELETE") {
        for (const id of body.webhookIds) hooks.delete(id);
        return new Response(null, { status: 202 });
      }
      if (hook[1])
        return Response.json({ expirationDate: Date.parse("2026-12-01") });
      return Response.json({
        isLast: true,
        values: [...hooks].map(([id, value]) => ({ id, ...value })),
      });
    }) as typeof fetch;
    return { fetcher, hooks, calls };
  }

  it("keeps one Jira webhook per connection on its linked projects, refreshed before it expires", async () => {
    const { projectId, ctx, jira, connect } = await setup();
    const site = withWebhooks(jira.fetcher);
    const live = {
      ...ctx,
      appUrl: "https://yarrow.run",
      fetcher: site.fetcher,
    };
    const connectionId = await connect();
    // No public address on this machine: nothing asked of Jira.
    await setTrackerBoards(
      db,
      { ...ctx, fetcher: site.fetcher },
      marie.userId,
      {
        projectId,
        connectionId,
        keys: ["APP"],
      },
    );
    expect(site.calls).toEqual([]);
    expect(await ensureJiraWebhooks(db, live)).toEqual([
      "acme.atlassian.net: registered",
    ]);
    expect([...site.hooks.values()]).toEqual([
      {
        url: "https://yarrow.run/api/webhooks/jira",
        jqlFilter: 'project in ("APP")',
      },
    ]);
    const [registered] = await raw.select().from(schema.trackerConnections);
    expect(registered).toMatchObject({
      webhookId: "1000",
      webhookFilter: 'project in ("APP")',
      webhookError: null,
    });
    const now = Date.now();
    const day = 86_400_000;
    expect(await ensureJiraWebhooks(db, live, now + 5 * day)).toEqual([
      "acme.atlassian.net: up to date",
    ]);
    // Less than 20 days left: refreshed, the same webhook.
    expect(await ensureJiraWebhooks(db, live, now + 11 * day)).toEqual([
      "acme.atlassian.net: refreshed",
    ]);
    const [refreshed] = await raw.select().from(schema.trackerConnections);
    expect(refreshed!.webhookExpiresAt).toEqual(new Date("2026-12-01"));
    // Gone on Jira's side (expired, deleted): registered again.
    site.hooks.clear();
    expect(
      await ensureJiraWebhooks(db, live, Date.parse("2026-11-20")),
    ).toEqual(["acme.atlassian.net: registered"]);
    // No linked project left: the webhook goes.
    await setTrackerBoards(db, live, marie.userId, {
      projectId,
      connectionId,
      keys: [],
    });
    expect(site.hooks.size).toBe(0);
    const [removed] = await raw.select().from(schema.trackerConnections);
    expect(removed).toMatchObject({ webhookId: null, webhookFilter: null });
    // A connection made before Yarrow asked for webhooks: linking still
    // works, the refusal is kept and the sync covers it.
    const refusing = withWebhooks(jira.fetcher, true);
    await setTrackerBoards(
      db,
      { ...live, fetcher: refusing.fetcher },
      marie.userId,
      { projectId, connectionId, keys: ["APP"] },
    );
    expect(await raw.select().from(schema.trackerBoards)).toHaveLength(1);
    const [failed] = await raw.select().from(schema.trackerConnections);
    expect(failed!.webhookError).toContain("(403)");
    // The settings page then offers Reconnect, and a new consent clears it.
    const refused = async () =>
      (await connectionsForAccount(db, failed!.accountId))[0]!.webhookRefused;
    expect(await refused()).toBe(true);
    expect(await ensureJiraWebhooks(db, live)).toEqual([
      "acme.atlassian.net: registered",
    ]);
    expect(await refused()).toBe(false);
  });

  it("queues and unqueues a ticket labeled in Jira from its webhook", async () => {
    const { projectId, ctx, jira, connect } = await setup();
    const site = withWebhooks(jira.fetcher);
    const live = {
      ...ctx,
      appUrl: "https://yarrow.run",
      fetcher: site.fetcher,
    };
    const connectionId = await connect();
    await setTrackerBoards(db, live, marie.userId, {
      projectId,
      connectionId,
      keys: ["APP"],
    });
    const delivery = (key: string) => ({
      webhookEvent: "jira:issue_updated",
      issue: { key },
      matchedWebhookIds: [1000],
    });
    // APP-2 carries the label in Jira: queued at once.
    expect(await handleJiraDelivery(db, live, delivery("APP-2"))).toEqual({
      queued: true,
      log: ["APP-2 labeled"],
    });
    // APP-1 has no label and Yarrow never held it: nothing stored.
    expect(await handleJiraDelivery(db, live, delivery("APP-1"))).toEqual({
      queued: false,
      log: [],
    });
    // The label taken off in Jira: out of the queue.
    jira.issues.get("APP-2")!.labels.length = 0;
    expect(await handleJiraDelivery(db, live, delivery("APP-2"))).toEqual({
      queued: false,
      log: ["APP-2 unlabeled"],
    });
    expect(
      (await projectTickets(db, projectId)).map((row) => [row.ref, row.status]),
    ).toEqual([["APP-2", "none"]]);
    // Another app's webhook, or one Yarrow no longer holds: ignored.
    expect(
      await handleJiraDelivery(db, live, {
        ...delivery("APP-2"),
        matchedWebhookIds: [7],
      }),
    ).toEqual({ queued: false, log: [] });
  });

  it("accepts only deliveries signed with the app's secret", async () => {
    const encode = (bytes: Uint8Array) =>
      btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    const text = (value: object) =>
      encode(new TextEncoder().encode(JSON.stringify(value)));
    const sign = async (secret: string, claims: object) => {
      const head = text({ alg: "HS256", typ: "JWT" });
      const body = text(claims);
      const hmac = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const signature = await crypto.subtle.sign(
        "HMAC",
        hmac,
        new TextEncoder().encode(`${head}.${body}`),
      );
      return `Bearer ${head}.${body}.${encode(new Uint8Array(signature))}`;
    };
    const now = Date.now();
    const exp = Math.floor(now / 1000) + 300;
    expect(await verifyJiraWebhook("s", await sign("s", { exp }), now)).toBe(
      true,
    );
    expect(
      await verifyJiraWebhook("s", await sign("other", { exp }), now),
    ).toBe(false);
    expect(
      await verifyJiraWebhook("s", await sign("s", { exp: exp - 3600 }), now),
    ).toBe(false);
    expect(await verifyJiraWebhook("s", null, now)).toBe(false);
    expect(await verifyJiraWebhook("s", "Bearer nonsense", now)).toBe(false);
  });
  it("creates a ticket written in Yarrow in the linked Jira project, queued when asked", async () => {
    const { projectId, ctx, jira, connect } = await setup();
    const connectionId = await connect();
    await setTrackerBoards(db, ctx, marie.userId, {
      projectId,
      connectionId,
      keys: ["APP"],
    });
    const project = { id: projectId, authorizationLabel: "yarrow" };
    const body = openedFromYarrow("Follow the **system** theme.", "marie");
    expect(
      await createTrackerTicket(
        db,
        ctx,
        project,
        "APP",
        { title: "Dark mode everywhere", body },
        true,
      ),
    ).toBe("APP-3");
    // A plain task, the summary, the description in Jira's format.
    expect(jira.created[0]).toEqual({
      fields: {
        project: { key: "APP" },
        issuetype: { id: "3" },
        summary: "Dark mode everywhere",
        description: markdownToAdf(body),
      },
    });
    expect(jira.issues.get("APP-3")!.labels).toEqual(["yarrow"]);
    const queued = await projectTickets(db, projectId);
    expect(queued.map((row) => [row.ref, row.status])).toEqual([
      ["APP-3", "queued"],
    ]);
    // Added, not queued: in To queue, no label.
    await createTrackerTicket(
      db,
      ctx,
      project,
      "APP",
      { title: "Export as CSV", body: "" },
      false,
    );
    expect(jira.issues.get("APP-4")!.labels).toEqual([]);
    expect(jira.created[1]).toMatchObject({
      fields: { summary: "Export as CSV" },
    });
    expect(jira.created[1]).not.toHaveProperty("fields.description");
    // A project asking for fields Yarrow cannot fill says which.
    jira.required.push("Team");
    await expect(
      createTrackerTicket(
        db,
        ctx,
        project,
        "APP",
        { title: "x", body: "" },
        true,
      ),
    ).rejects.toThrow("APP requires Team: create this ticket in Jira.");
    await expect(
      createTrackerTicket(
        db,
        ctx,
        project,
        "OPS",
        { title: "x", body: "" },
        true,
      ),
    ).rejects.toThrow("OPS is not a linked board.");
  });

  it("writes Markdown in Jira's document format", () => {
    expect(
      markdownToAdf(
        "# Goal\n\nUse `theme` with **care**, see [docs](https://x.dev).\nNext line\n\n- one\n- two\n\n1. first\n\n```ts\nconst a = 1;\n```\n\n> quoted\n\nsnake_case_name stays",
      ).content,
    ).toEqual([
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Goal" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Use " },
          { type: "text", text: "theme", marks: [{ type: "code" }] },
          { type: "text", text: " with " },
          { type: "text", text: "care", marks: [{ type: "strong" }] },
          { type: "text", text: ", see " },
          {
            type: "text",
            text: "docs",
            marks: [{ type: "link", attrs: { href: "https://x.dev" } }],
          },
          { type: "text", text: "." },
          { type: "hardBreak" },
          { type: "text", text: "Next line" },
        ],
      },
      {
        type: "bulletList",
        content: ["one", "two"].map((text) => ({
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text }] }],
        })),
      },
      {
        type: "orderedList",
        content: [
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "first" }] },
            ],
          },
        ],
      },
      {
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [{ type: "text", text: "const a = 1;" }],
      },
      {
        type: "blockquote",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "quoted" }] },
        ],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: "snake_case_name stays" }],
      },
    ]);
  });
});

describe("moving Jira tickets", async () => {
  const t = await createTestDatabase();
  const { db, raw } = t;
  afterAll(() => t.pg.close());

  it("proposes moves from the statuses, follows the builder's choice, and never moves a ticket back", async () => {
    const owner = {
      userId: crypto.randomUUID(),
      githubLogin: "lea",
      name: null,
    };
    const accountId = await ensureAccount(db, owner);
    const projectId = await createProject(db, accountId, owner.userId, {
      repository: "lea/app",
      description: "",
      productUrl: "",
      visibility: "public",
      categories: ["saas"],
      stacks: [],
      authorizationLabel: "yarrow",
    });
    await raw
      .update(schema.projects)
      .set({ githubInstallationId: "1", githubRepositoryId: "2" })
      .where(eq(schema.projects.id, projectId));
    const jira = fakeJira();
    const ctx: TrackerContext = {
      secrets: {
        encryptionKey: key,
        jira: { clientId: "c", clientSecret: "s" },
      },
      fetcher: jira.fetcher,
    };
    await saveTrackerConnection(db, {
      accountId,
      tracker: "jira",
      externalId: "cloud-1",
      name: "acme.atlassian.net",
      encryptedAccessToken: await encryptToken(key, "token"),
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
    });
    await settleJira(db, ctx, owner.userId, { ticket: "APP-1" }, projectId);
    const [board] = await raw.select().from(schema.trackerBoards);
    const [unit] = await raw.select().from(schema.workUnits);

    const settings = await trackerBoardSettings(
      db,
      ctx,
      owner.userId,
      board!.id,
    );
    expect(
      settings.statuses.map((status) => [status.name, status.category]),
    ).toEqual([
      ["To Do", "todo"],
      ["In Progress", "progress"],
      ["Code review", "progress"],
      ["Done", "done"],
    ]);
    // Defaults: work → In Progress, PR → the review status, merge → stay.
    expect(settings).toMatchObject({
      moves: { started: "20", pullRequest: "30", merged: null, stopped: null },
      chosen: false,
    });

    // From To Do, the workflow has no way straight to Code review.
    expect(await moveTrackerTicket(db, ctx, unit!.id, "pullRequest")).toBe(
      "APP-1 blocked",
    );
    expect(
      (await trackerBoardSettings(db, ctx, owner.userId, board!.id)).warning,
    ).toContain("APP-1 could not move to Code review");
    expect(await moveTrackerTicket(db, ctx, unit!.id, "started")).toBe(
      "APP-1 moved",
    );
    expect(await moveTrackerTicket(db, ctx, unit!.id, "pullRequest")).toBe(
      "APP-1 moved",
    );
    expect(await moveTrackerTicket(db, ctx, unit!.id, "merged")).toBe(
      "not moved (builder's choice)",
    );
    await setTrackerMoves(db, owner.userId, board!.id, {
      started: "20",
      pullRequest: "30",
      merged: "40",
    });
    expect(await moveTrackerTicket(db, ctx, unit!.id, "merged")).toBe(
      "APP-1 moved",
    );
    expect(jira.issues.get("APP-1")!.status).toBe("40");
    // A retried start never pulls a done ticket back.
    expect(await moveTrackerTicket(db, ctx, unit!.id, "started")).toBe(
      "APP-1 already",
    );
    expect(jira.issues.get("APP-1")!.status).toBe("40");
    // Stopped: nowhere by default, then where the builder said, even back.
    expect(await moveTrackerTicket(db, ctx, unit!.id, "stopped")).toBe(
      "not moved (builder's choice)",
    );
    await setTrackerMoves(db, owner.userId, board!.id, {
      started: "20",
      pullRequest: "30",
      merged: "40",
      stopped: "20",
    });
    expect(await moveTrackerTicket(db, ctx, unit!.id, "stopped")).toBe(
      "APP-1 moved",
    );
    expect(jira.issues.get("APP-1")!.status).toBe("20");

    // Closed from the dashboard: to Done when the workflow allows it.
    await closeTrackerTicket(db, ctx, projectId, "APP-1");
    expect(jira.issues.get("APP-1")!.status).toBe("40");
    await expect(
      closeTrackerTicket(db, ctx, projectId, "APP-2"),
    ).rejects.toThrow("no way to close APP-2");
    expect(jira.issues.get("APP-2")!.status).toBe("10");
  });
});

describe("Jira links, branches and pull requests", () => {
  it("reads the site and the issue key from the links people paste", () => {
    for (const link of [
      "https://acme.atlassian.net/browse/APP-42",
      "acme.atlassian.net/jira/software/projects/APP/boards/3?selectedIssue=APP-42",
      "https://Acme.atlassian.net/jira/software/c/projects/APP/issues/APP-42/",
    ])
      expect(parseTicketLink(link)).toMatchObject({
        source: { id: "jira" },
        site: "acme.atlassian.net",
        ticket: "APP-42",
      });
    expect(
      parseTicketLink("acme.atlassian.net/jira/software/projects/APP/boards/3"),
    ).not.toHaveProperty("ticket");
  });

  it("keeps the Jira or Linear key in capitals in the branch and the PR title", () => {
    expect(branchName("APP-42 Fix the export", "1234567890")).toBe(
      "yarrow/APP-42-fix-the-export-12345678",
    );
    expect(branchName("Fix the export", "1234567890")).toBe(
      "yarrow/fix-the-export-12345678",
    );
    const ticket = { title: "APP-42 Fix the export", url: "", source: "jira" };
    expect(pullRequestTitle({ ticket })).toBe("APP-42 Fix the export");
    expect(
      pullRequestTitle({
        ticket: { ...ticket, title: "ENG-7 Dark mode", source: "linear" },
      }),
    ).toBe("ENG-7 Dark mode");
    expect(
      pullRequestTitle({
        ticket: { ...ticket, title: "ENG-7 Dark mode", source: "trello" },
      }),
    ).toBe("Dark mode");
  });
});
