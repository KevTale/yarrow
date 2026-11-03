import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureAccount } from "../../src/db/accounts";
import { createProject } from "../../src/db/projects";
import * as schema from "../../src/db/schema";
import { projectTickets } from "../../src/db/tickets";
import { saveTrackerConnection } from "../../src/db/trackers";
import { hmacSha256Hex } from "../../src/server/github/app";
import { encryptToken } from "../../src/server/trackers/crypto";
import {
  closeTrackerTicket,
  createTrackerTicket,
  labelTrackerTickets,
  listTrackerBoards,
  moveTrackerTicket,
  openTrackerTickets,
  setTrackerBoards,
  trackerTicketDetail,
  type TrackerContext,
} from "../../src/server/trackers/flow";
import { syncTrackers } from "../../src/server/trackers/index";
import { linearAdapter } from "../../src/server/trackers/linear";
import {
  handleLinearDelivery,
  verifyLinearWebhook,
} from "../../src/server/trackers/linear-webhooks";
import { createTestDatabase } from "./helpers/pglite";

const key = btoa(
  String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
);

/** A Linear workspace with one team, answering like Linear's GraphQL API. */
function fakeLinear() {
  const states = [
    { id: "s-done", name: "Done", type: "completed", position: 0 },
    { id: "s-backlog", name: "Backlog", type: "backlog", position: 0 },
    { id: "s-todo", name: "Todo", type: "unstarted", position: 1 },
    { id: "s-review", name: "In Review", type: "started", position: 3 },
    { id: "s-progress", name: "In Progress", type: "started", position: 2 },
    { id: "s-canceled", name: "Canceled", type: "canceled", position: 0 },
  ];
  const state = (id: string) => states.find((item) => item.id === id)!;
  const labels = new Map<string, { name: string; team: string | null }>();
  const issues = new Map<
    string,
    {
      id: string;
      title: string;
      description: string | null;
      state: string;
      labels: string[];
      comments: { body: string; createdAt: string; user: { name: string } }[];
    }
  >([
    [
      "ENG-1",
      {
        id: "uuid-1",
        title: "Export crashes",
        description: "Steps to reproduce",
        state: "s-todo",
        labels: [],
        comments: [
          {
            body: "Only with an empty table.",
            createdAt: "2026-10-21T10:00:00.000Z",
            user: { name: "Grace" },
          },
          {
            body: "Seen on Safari.",
            createdAt: "2026-10-20T10:00:00.000Z",
            user: { name: "Ada" },
          },
        ],
      },
    ],
    [
      "ENG-2",
      {
        id: "uuid-2",
        title: "Dark mode",
        description: null,
        state: "s-backlog",
        labels: [],
        comments: [],
      },
    ],
  ]);
  const byId = (id: string) =>
    [...issues.entries()].find(
      ([identifier, issue]) => identifier === id || issue.id === id,
    );
  const node = (identifier: string) => {
    const issue = issues.get(identifier)!;
    return {
      id: issue.id,
      identifier,
      title: issue.title,
      description: issue.description,
      url: `https://linear.app/acme/issue/${identifier}`,
      createdAt: "2026-10-20T09:00:00.000Z",
      updatedAt: "2026-10-21T09:00:00.000Z",
      creator: { name: "Ada" },
      state: { id: issue.state, type: state(issue.state).type },
      team: { id: "team-1" },
      labels: {
        nodes: issue.labels.map((id) => ({ id, name: labels.get(id)!.name })),
      },
      comments: { nodes: issue.comments },
    };
  };
  const calls: { query: string; variables: Record<string, unknown> }[] = [];
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const json = (data: unknown) =>
      new Response(JSON.stringify(data), { status: 200 });
    if (url === "https://api.linear.app/oauth/token") {
      const body = new URLSearchParams(String(init.body));
      return json({
        access_token: `access-${body.get("grant_type")}`,
        refresh_token: "refresh-2",
        expires_in: 86399,
      });
    }
    const { query, variables = {} } = JSON.parse(String(init.body)) as {
      query: string;
      variables?: Record<string, string>;
    };
    calls.push({ query, variables });
    const missing = { errors: [{ message: "Entity not found: Issue" }] };
    if (query.includes("issueLabelCreate")) {
      const id = `label-${labels.size + 1}`;
      labels.set(id, { name: variables.name!, team: variables.team! });
      return json({ data: { issueLabelCreate: { issueLabel: { id } } } });
    }
    if (query.includes("issueAddLabel") || query.includes("issueRemoveLabel")) {
      const [, issue] = byId(variables.id!)!;
      issue.labels = issue.labels.filter((id) => id !== variables.label);
      if (query.includes("issueAddLabel")) issue.labels.push(variables.label!);
      return json({ data: { result: { success: true } } });
    }
    if (query.includes("issueUpdate")) {
      byId(variables.id!)![1].state = variables.state!;
      return json({ data: { issueUpdate: { success: true } } });
    }
    if (query.includes("issueCreate")) {
      const input = variables.input as unknown as {
        teamId: string;
        title: string;
        description?: string;
      };
      expect(input.teamId).toBe("team-1");
      const identifier = `ENG-${issues.size + 1}`;
      issues.set(identifier, {
        id: `uuid-${issues.size + 1}`,
        title: input.title,
        description: input.description ?? null,
        state: "s-todo",
        labels: [],
        comments: [],
      });
      return json({ data: { issueCreate: { issue: { identifier } } } });
    }
    if (query.includes("commentCreate")) {
      const input = variables.input as unknown as {
        issueId: string;
        body: string;
      };
      byId(input.issueId)![1].comments.push({
        body: input.body,
        createdAt: "2026-10-28T10:00:00.000Z",
        user: { name: "Marie" },
      });
      return json({ data: { commentCreate: { success: true } } });
    }
    if (query.includes("organization"))
      return json({ data: { organization: { id: "org-1", name: "Acme" } } });
    if (query.includes("teams(first: 100)"))
      return json({
        data: { teams: { nodes: [{ key: "ENG", name: "Engineering" }] } },
      });
    if (query.includes("teams(filter")) {
      const teams =
        variables.key === "ENG"
          ? [{ id: "team-1", states: { nodes: states } }]
          : [];
      return json({ data: { teams: { nodes: teams } } });
    }
    if (query.includes("issues(")) {
      const open = [...issues.keys()].filter((identifier) => {
        const issue = issues.get(identifier)!;
        const done = ["completed", "canceled"].includes(
          state(issue.state).type,
        );
        const labeled = issue.labels.some(
          (id) =>
            labels.get(id)!.name.toLowerCase() ===
            String(variables.label).toLowerCase(),
        );
        return !done && (!("label" in variables) || labeled);
      });
      return json({ data: { issues: { nodes: open.map(node) } } });
    }
    if (query.includes("issue(id")) {
      const found = byId(variables.id!);
      if (!found) return json(missing);
      return json({
        data: {
          issue: node(found[0]),
          issueLabels: {
            nodes: [...labels.entries()]
              .filter(
                ([, label]) =>
                  label.name.toLowerCase() ===
                  String(variables.label).toLowerCase(),
              )
              .map(([id, label]) => ({
                id,
                team: label.team ? { id: label.team } : null,
              })),
          },
          workflowState: variables.state
            ? { type: state(variables.state).type }
            : null,
        },
      });
    }
    return json({ errors: [{ message: `unexpected ${query}` }] });
  }) as typeof fetch;
  return { fetcher, issues, labels, calls, state };
}

const scope = { externalId: "org-1", accessToken: "token" };
const credentials = { clientId: "c", clientSecret: "s" };

describe("Linear adapter", () => {
  it("keeps the refresh token Linear now gives with its 24-hour tokens", async () => {
    const linear = fakeLinear();
    const adapter = linearAdapter(linear.fetcher);
    const tokens = await adapter.exchangeCode!({
      credentials,
      code: "code",
      redirectUri: "https://app/integrations/linear/callback",
    });
    expect(tokens).toMatchObject({
      accessToken: "access-authorization_code",
      refreshToken: "refresh-2",
    });
    expect(tokens.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    expect(
      await adapter.refresh!({ credentials, refreshToken: "refresh-1" }),
    ).toMatchObject({
      accessToken: "access-refresh_token",
      refreshToken: "refresh-2",
    });
  });

  it("names teams and tickets by their keys, and reads the discussion", async () => {
    const linear = fakeLinear();
    const adapter = linearAdapter(linear.fetcher);
    expect(await adapter.listBoards(scope, credentials)).toEqual([
      { id: "ENG", name: "ENG · Engineering" },
    ]);
    const open = await adapter.openTickets!(scope, credentials, "ENG");
    expect(open.map((ticket) => ticket.externalId)).toEqual(["ENG-1", "ENG-2"]);
    const ticket = await adapter.getTicket(scope, credentials, "ENG-1");
    expect(ticket).toMatchObject({
      externalId: "ENG-1",
      title: "ENG-1 Export crashes",
      body: "Steps to reproduce",
      author: "Ada",
      closed: false,
      // Oldest first, as the agents read a thread.
      discussion: "Ada: Seen on Safari.\n\nGrace: Only with an empty table.",
    });
    expect(await adapter.getTicket(scope, credentials, "ENG-99")).toBeNull();
  });

  it("lists the team's statuses in board order and never moves a ticket backwards", async () => {
    const linear = fakeLinear();
    const adapter = linearAdapter(linear.fetcher);
    expect(await adapter.statuses!(scope, credentials, "ENG")).toEqual([
      { id: "s-backlog", name: "Backlog", category: "todo" },
      { id: "s-todo", name: "Todo", category: "todo" },
      { id: "s-progress", name: "In Progress", category: "progress" },
      { id: "s-review", name: "In Review", category: "progress" },
      { id: "s-done", name: "Done", category: "done" },
      { id: "s-canceled", name: "Canceled", category: "done" },
    ]);
    expect(await adapter.moveTo!(scope, credentials, "ENG-1", "s-review")).toBe(
      "moved",
    );
    expect(linear.issues.get("ENG-1")!.state).toBe("s-review");
    expect(await adapter.moveTo!(scope, credentials, "ENG-1", "s-review")).toBe(
      "already",
    );
    expect(await adapter.moveTo!(scope, credentials, "ENG-1", "s-todo")).toBe(
      "already",
    );
    // Stopped: the builder may send it back.
    expect(
      await adapter.moveTo!(scope, credentials, "ENG-1", "s-todo", true),
    ).toBe("moved");
  });

  it("creates the label once for the team, then puts it on and takes it off", async () => {
    const linear = fakeLinear();
    const adapter = linearAdapter(linear.fetcher);
    await adapter.setLabel!(scope, credentials, "ENG-1", "yarrow", true);
    await adapter.setLabel!(scope, credentials, "ENG-2", "Yarrow", true);
    expect([...linear.labels.values()]).toEqual([
      { name: "yarrow", team: "team-1" },
    ]);
    expect(linear.issues.get("ENG-2")!.labels).toEqual(["label-1"]);
    const labeled = await adapter.labeledTickets(
      scope,
      credentials,
      "ENG",
      "yarrow",
    );
    expect(labeled.map((ticket) => ticket.externalId)).toEqual([
      "ENG-1",
      "ENG-2",
    ]);
    await adapter.setLabel!(scope, credentials, "ENG-1", "yarrow", false);
    expect(linear.issues.get("ENG-1")!.labels).toEqual([]);
  });
});

describe("Linear for builders", async () => {
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
    await raw
      .update(schema.projects)
      .set({ githubInstallationId: "42", githubRepositoryId: "999" })
      .where(eq(schema.projects.id, projectId));
    const linear = fakeLinear();
    const ctx: TrackerContext = {
      secrets: { encryptionKey: key, linear: credentials },
      fetcher: linear.fetcher,
    };
    const connectionId = await saveTrackerConnection(db, {
      accountId,
      tracker: "linear",
      externalId: "org-1",
      name: "Acme",
      encryptedAccessToken: await encryptToken(key, "linear-token"),
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
    });
    return { projectId, ctx, linear, connectionId };
  }

  it("links a team, then queues, answers, closes and moves its tickets from Yarrow", async () => {
    const { projectId, ctx, linear, connectionId } = await setup();
    expect(
      await listTrackerBoards(db, ctx, marie.userId, connectionId),
    ).toEqual([{ id: "ENG", name: "ENG · Engineering" }]);
    await setTrackerBoards(db, ctx, marie.userId, {
      projectId,
      connectionId,
      keys: ["ENG"],
    });
    expect(await openTrackerTickets(db, ctx, projectId)).toEqual([
      {
        key: "ENG-1",
        source: "linear",
        ref: "ENG-1",
        number: 1,
        title: "Export crashes",
        url: "https://linear.app/acme/issue/ENG-1",
        createdAt: "2026-10-20T09:00:00.000Z",
        updatedAt: "2026-10-21T09:00:00.000Z",
        author: "Ada",
      },
      expect.objectContaining({ key: "ENG-2", title: "Dark mode" }),
    ]);
    const project = { id: projectId, authorizationLabel: "yarrow" };
    await labelTrackerTickets(db, ctx, project, ["ENG-1"], true);
    const [unit] = await raw.select().from(schema.workUnits);
    expect(unit).toMatchObject({
      source: "linear",
      externalId: "ENG-1",
      title: "ENG-1 Export crashes",
      status: "queued",
    });
    expect(
      await trackerTicketDetail(db, ctx, projectId, "ENG-1"),
    ).toMatchObject({ body: "Steps to reproduce" });
    // Yarrow starts: the ticket goes to the first "in progress" status.
    expect(await moveTrackerTicket(db, ctx, unit!.id, "started")).toBe(
      "ENG-1 moved",
    );
    expect(linear.issues.get("ENG-1")!.state).toBe("s-progress");
    // Yarrow stops: back to Todo, where it found the ticket.
    expect(await moveTrackerTicket(db, ctx, unit!.id, "stopped")).toBe(
      "ENG-1 moved",
    );
    expect(linear.issues.get("ENG-1")!.state).toBe("s-todo");
    // Started again once a person had moved it further: nothing to undo.
    linear.issues.get("ENG-1")!.state = "s-done";
    expect(await moveTrackerTicket(db, ctx, unit!.id, "started")).toBe(
      "ENG-1 already",
    );
    expect(await moveTrackerTicket(db, ctx, unit!.id, "stopped")).toBe(
      "not moved (Yarrow had not moved it)",
    );
    expect(linear.issues.get("ENG-1")!.state).toBe("s-done");
    linear.issues.get("ENG-1")!.state = "s-progress";
    const created = await createTrackerTicket(
      db,
      ctx,
      project,
      "ENG",
      { title: "Empty state", body: "**Bold** as written" },
      true,
    );
    expect(created).toBe("ENG-3");
    expect(linear.issues.get("ENG-3")).toMatchObject({
      title: "Empty state",
      description: "**Bold** as written",
    });
    const rows = await projectTickets(db, projectId);
    expect(rows.map((row) => [row.ref, row.status]).sort()).toEqual([
      ["ENG-1", "queued"],
      ["ENG-3", "queued"],
    ]);
    expect(await closeTrackerTicket(db, ctx, projectId, "ENG-2")).toBe(
      "linear",
    );
    expect(linear.issues.get("ENG-2")!.state).toBe("s-done");
    // The brain's sync follows the label taken off in Linear itself.
    linear.issues.get("ENG-1")!.labels = [];
    expect(await syncTrackers(db, ctx.secrets, linear.fetcher)).toEqual([
      "linear:ENG · Engineering: 1 labeled",
    ]);
    const units = await raw.select().from(schema.workUnits);
    expect(units.map((row) => [row.externalId, row.authorized]).sort()).toEqual(
      [
        ["ENG-1", false],
        ["ENG-3", true],
      ],
    );
  });

  it("queues a ticket labeled in Linear as soon as its webhook says so", async () => {
    const { projectId, ctx, linear, connectionId } = await setup();
    await setTrackerBoards(db, ctx, marie.userId, {
      projectId,
      connectionId,
      keys: ["ENG"],
    });
    await linearAdapter(linear.fetcher).setLabel!(
      scope,
      credentials,
      "ENG-2",
      "yarrow",
      true,
    );
    const delivery = {
      type: "Issue",
      action: "update",
      organizationId: "org-1",
      data: { identifier: "ENG-2" },
      webhookTimestamp: Date.now(),
    };
    const body = JSON.stringify(delivery);
    const signature = await hmacSha256Hex("whsec", body);
    expect(await verifyLinearWebhook("whsec", body, signature)).toBe(true);
    expect(await verifyLinearWebhook("other", body, signature)).toBe(false);
    expect(
      await verifyLinearWebhook(
        "whsec",
        body,
        signature,
        Date.now() + 5 * 60_000,
      ),
    ).toBe(false);
    expect(await handleLinearDelivery(db, ctx, delivery)).toEqual({
      queued: true,
      log: ["ENG-2 labeled"],
    });
    // Another workspace, or not an issue: nothing happens.
    expect(
      await handleLinearDelivery(db, ctx, { ...delivery, organizationId: "x" }),
    ).toEqual({ queued: false, log: [] });
    expect(
      await handleLinearDelivery(db, ctx, { ...delivery, type: "Comment" }),
    ).toEqual({ queued: false, log: ["not an issue"] });
  });
});
