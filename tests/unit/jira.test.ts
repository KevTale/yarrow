import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { parseTicketLink } from "../../src/core/ticket-link";
import { ensureAccount } from "../../src/db/accounts";
import { createProject } from "../../src/db/projects";
import * as schema from "../../src/db/schema";
import { projectTickets } from "../../src/db/tickets";
import { saveTrackerConnection } from "../../src/db/trackers";
import { branchName } from "../../src/server/github/delivery";
import { pullRequestTitle } from "../../src/runner/pull-request";
import { encryptToken } from "../../src/server/trackers/crypto";
import { syncTrackers } from "../../src/server/trackers/index";
import { jiraAdapter } from "../../src/server/trackers/jira";
import {
  JiraAccessError,
  jiraBoardSettings,
  jiraProjects,
  moveTrackerTicket,
  setJiraMoves,
  labelTrackerTickets,
  openTrackerTickets,
  setJiraProjects,
  settleJira,
  type TrackerContext,
} from "../../src/server/trackers/jira-flow";
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
  const issue = (id: string) => ({
    id,
    key: id,
    fields: {
      ...issues.get(id)!,
      description: null,
      updated: "2026-10-08T09:00:00.000+0000",
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
    return json({ message: `unexpected ${url}` }, 404);
  }) as typeof fetch;
  return { fetcher, issues };
}

describe("Jira for builders", async () => {
  const t = await createTestDatabase();
  const { db, raw } = t;
  afterAll(() => t.pg.close());
  beforeEach(() => t.reset());

  const marie = { userId: crypto.randomUUID(), githubLogin: "marie", name: null };
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
      secrets: { encryptionKey: key, jira: { clientId: "c", clientSecret: "s" } },
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
    expect(
      await settleJira(db, ctx, marie.userId, intent, projectId),
    ).toEqual({ queued: { projectId, key: "APP-1" } });
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
    expect(
      units.map((row) => [row.externalId, row.authorized]).sort(),
    ).toEqual([
      ["APP-1", false],
      ["APP-2", true],
    ]);
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
        updatedAt: "2026-10-08T09:00:00.000Z",
      },
      expect.objectContaining({ key: "APP-2", title: "Dark mode" }),
    ]);
    const project = { id: projectId, authorizationLabel: "yarrow" };
    await labelTrackerTickets(db, ctx, project, ["APP-1"], false);
    expect(jira.issues.get("APP-1")!.labels).toEqual([]);
    await labelTrackerTickets(db, ctx, project, ["APP-2"], true);
    const rows = await projectTickets(db, projectId);
    expect(
      rows.map((row) => [row.ref, row.title, row.status]).sort(),
    ).toEqual([
      ["APP-1", "Export crashes", "none"],
      ["APP-2", "Dark mode", "queued"],
    ]);
    await expect(
      labelTrackerTickets(db, ctx, project, ["OPS-3"], true),
    ).rejects.toThrow("not in a linked Jira project");
    // From the settings page: no Jira project any more, then APP again.
    const [connection] = await raw
      .select({ id: schema.trackerConnections.id })
      .from(schema.trackerConnections);
    const connectionId = connection!.id;
    await setJiraProjects(db, ctx, marie.userId, {
      projectId,
      connectionId,
      jiraKeys: [],
    });
    expect(await raw.select().from(schema.trackerBoards)).toEqual([]);
    expect(await openTrackerTickets(db, ctx, projectId)).toBeNull();
    await setJiraProjects(db, ctx, marie.userId, {
      projectId,
      connectionId,
      jiraKeys: ["APP"],
    });
    expect(await raw.select().from(schema.trackerBoards)).toHaveLength(1);
    // Access removed in Atlassian: told apart from Jira being down.
    const refusing = (async () =>
      new Response("{}", { status: 401 })) as typeof fetch;
    await expect(
      jiraProjects(db, { ...ctx, fetcher: refusing }, marie.userId, connectionId),
    ).rejects.toBeInstanceOf(JiraAccessError);
  });

  it("names sites by their address and changes labels in one request", async () => {
    const { jira } = { jira: fakeJira() };
    const adapter = jiraAdapter(jira.fetcher);
    expect(
      await adapter.describe({ accessToken: "t" }, { clientId: "", clientSecret: "" }),
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
});

describe("moving Jira tickets", async () => {
  const t = await createTestDatabase();
  const { db, raw } = t;
  afterAll(() => t.pg.close());

  it("proposes moves from the statuses, follows the builder's choice, and never moves a ticket back", async () => {
    const owner = { userId: crypto.randomUUID(), githubLogin: "lea", name: null };
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
      secrets: { encryptionKey: key, jira: { clientId: "c", clientSecret: "s" } },
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

    const settings = await jiraBoardSettings(db, ctx, owner.userId, board!.id);
    expect(settings.statuses.map((status) => [status.name, status.category])).toEqual([
      ["To Do", "todo"],
      ["In Progress", "progress"],
      ["Code review", "progress"],
      ["Done", "done"],
    ]);
    // Defaults: work → In Progress, PR → the review status, merge → stay.
    expect(settings).toMatchObject({
      moves: { started: "20", pullRequest: "30", merged: null },
      chosen: false,
    });

    // From To Do, the workflow has no way straight to Code review.
    expect(await moveTrackerTicket(db, ctx, unit!.id, "pullRequest")).toBe(
      "APP-1 blocked",
    );
    expect(
      (await jiraBoardSettings(db, ctx, owner.userId, board!.id)).warning,
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
    await setJiraMoves(db, owner.userId, board!.id, {
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

  it("keeps the Jira key in capitals in the branch and the PR title", () => {
    expect(branchName("APP-42 Fix the export", "1234567890")).toBe(
      "yarrow/APP-42-fix-the-export-12345678",
    );
    expect(branchName("Fix the export", "1234567890")).toBe(
      "yarrow/fix-the-export-12345678",
    );
    const ticket = { title: "APP-42 Fix the export", url: "", source: "jira" };
    expect(pullRequestTitle({ ticket })).toBe("APP-42 Fix the export");
    expect(
      pullRequestTitle({ ticket: { ...ticket, title: "ENG-7 Dark mode", source: "linear" } }),
    ).toBe("Dark mode");
  });
});
