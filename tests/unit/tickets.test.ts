import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  formatSeconds,
  formatTokens,
  mergeTickets,
  ticketIdentity,
  type TicketRow,
} from "../../src/core/tickets";
import { ensureAccount } from "../../src/db/accounts";
import { requestGithubTask, projectsForUser } from "../../src/db/github-tasks";
import { recordRunModels } from "../../src/db/runs";
import * as schema from "../../src/db/schema";
import { projectTickets, retryTicket, reviewQueue } from "../../src/db/tickets";
import { upsertTicket } from "../../src/db/workunits";
import { runGithubTasks } from "../../src/server/github/tasks";
import { handleGitHubEvent } from "../../src/server/github/webhook";
import { createTestDatabase } from "./helpers/pglite";

const t = await createTestDatabase();
const { db, raw } = t;
const marie = { userId: crypto.randomUUID(), githubLogin: "Marie", name: null };
let projectId = "";

beforeEach(async () => {
  await t.reset();
  await ensureAccount(db, marie);
  await handleGitHubEvent(db, "installation", {
    action: "created",
    sender: { login: "marie" },
    installation: { id: 42 },
    repositories: [{ id: 999, full_name: "marie/halyard", private: false }],
  });
  projectId = (await projectsForUser(db, marie.userId))[0]!.id;
});
afterAll(() => t.pg.close());

async function ticket(number: number, labeled = true) {
  const { workUnitId } = await upsertTicket(db, {
    projectId,
    source: "github",
    externalId: String(number),
    title: `Ticket ${number}`,
    body: "",
    url: `https://github.com/marie/halyard/issues/${number}`,
    labeled,
    closed: false,
  });
  return workUnitId;
}
async function run(
  workUnitId: string,
  values: Partial<typeof schema.agentRuns.$inferInsert> = {},
) {
  const id = crypto.randomUUID();
  await raw.insert(schema.agentRuns).values({
    id,
    workUnitId,
    implementer: "claude-opus-5-5:high",
    reviewer: "openai-astra",
    ...values,
  });
  return id;
}
const byNumber = (rows: TicketRow[], number: number) =>
  rows.find((row) => row.number === number)!;

describe("the builder's ticket table", () => {
  it("names who paid for each ticket, the largest share first", async () => {
    const shipped = await ticket(3);
    await raw
      .update(schema.workUnits)
      .set({ status: "delivered" })
      .where(eq(schema.workUnits.id, shipped));
    const first = await run(shipped, { status: "completed" });
    const correction = await run(shipped, {
      status: "completed",
      kind: "correction",
      instruction: "Rename the button",
    });
    const fund = async (
      runId: string,
      cents: number,
      profile: { publicName: string | null; description?: string } | null,
      userId = crypto.randomUUID(),
    ) => {
      if (profile)
        await raw
          .insert(schema.sponsorProfiles)
          .values({ userId, ...profile })
          .onConflictDoNothing();
      const [contribution] = await raw
        .insert(schema.contributions)
        .values({
          userId,
          amountCents: 1000,
          creditCents: 1000,
          debitedCents: cents,
          paymentStatus: "settled",
        })
        .returning();
      await raw.insert(schema.runFundings).values({
        agentRunId: runId,
        contributionId: contribution!.id,
        reservedCents: cents,
        debitedCents: cents,
      });
      return userId;
    };
    const northbeam = await fund(first, 40, {
      publicName: "Northbeam",
      description: "Managed Postgres.",
    });
    await fund(first, 30, { publicName: null });
    // The correction's money adds to the same sponsor's share.
    await fund(correction, 20, null, northbeam);
    await ticket(1);

    const rows = await projectTickets(db, projectId);
    expect(byNumber(rows, 3).paidBy).toEqual([
      {
        name: "Northbeam",
        publicId: expect.any(String),
        description: "Managed Postgres.",
        logoUrl: null,
        websiteUrl: null,
      },
      {
        name: null,
        publicId: null,
        description: null,
        logoUrl: null,
        websiteUrl: null,
      },
    ]);
    expect(byNumber(rows, 1).paidBy).toEqual([]);
  });

  it("shows each ticket's status, pull request and models", async () => {
    await ticket(1);
    const writing = await ticket(2);
    await raw
      .update(schema.workUnits)
      .set({ status: "running" })
      .where(eq(schema.workUnits.id, writing));
    await run(writing, { phase: "implementing" });
    const shipped = await ticket(3);
    await raw
      .update(schema.workUnits)
      .set({ status: "delivered" })
      .where(eq(schema.workUnits.id, shipped));
    const shippedRun = await run(shipped, { status: "completed" });
    await raw.insert(schema.pullRequests).values({
      workUnitId: shipped,
      url: "https://github.com/marie/halyard/pull/4",
      number: 4,
      branch: "yarrow/3",
    });
    await recordRunModels(db, shippedRun, [
      {
        role: "implementer",
        model: "claude-opus-5-5",
        effort: "high",
        sessions: 1,
        seconds: 72,
        secondsExact: true,
        inputTokens: 43_000,
        cachedInputTokens: 40_000,
        outputTokens: 5_000,
        costCents: 27,
        costExact: true,
      },
    ]);
    // Recording twice (a retried Workflow step) keeps one row.
    await recordRunModels(db, shippedRun, [
      {
        role: "implementer",
        model: "claude-opus-5-5",
        effort: "high",
        sessions: 1,
        seconds: 72,
        secondsExact: true,
        inputTokens: 43_000,
        cachedInputTokens: 40_000,
        outputTokens: 5_000,
        costCents: 27,
        costExact: true,
      },
    ]);
    const abstained = await ticket(5);
    await raw
      .update(schema.workUnits)
      .set({ status: "abstained" })
      .where(eq(schema.workUnits.id, abstained));
    const abstainedRun = await run(abstained, { status: "abstained" });
    await raw.insert(schema.results).values({
      agentRunId: abstainedRun,
      outcome: "abstained",
      summary: "Unclear",
      abstentionReason: "ticket_unclear",
    });

    const rows = await projectTickets(db, projectId);
    expect(byNumber(rows, 1)).toMatchObject({ status: "queued", models: [] });
    expect(byNumber(rows, 2)).toMatchObject({
      status: "writing",
      models: [{ role: "implementer", name: "Claude Opus 5.5", active: true }],
    });
    expect(byNumber(rows, 3)).toMatchObject({
      status: "pull_request",
      pullRequest: { number: 4 },
      models: [
        {
          name: "Claude Opus 5.5",
          effort: "high",
          seconds: 72,
          costCents: 27,
          costExact: true,
        },
      ],
    });
    expect(byNumber(rows, 5)).toMatchObject({
      status: "abstained",
      reason: "ticket_unclear",
    });

    expect(await retryTicket(db, projectId, "5")).toBe(true);
    expect(byNumber(await projectTickets(db, projectId), 5).status).toBe(
      "queued",
    );
    expect(await retryTicket(db, projectId, "1")).toBe(false);
  });

  it("lists the pull requests waiting for review across projects", async () => {
    await ticket(1);
    const shipped = await ticket(3);
    await raw
      .update(schema.workUnits)
      .set({ status: "delivered" })
      .where(eq(schema.workUnits.id, shipped));
    await run(shipped, { status: "completed" });
    await raw.insert(schema.pullRequests).values({
      workUnitId: shipped,
      url: "https://github.com/marie/halyard/pull/4",
      number: 4,
      branch: "yarrow/3",
    });
    const halyard = { id: projectId, name: "halyard", logoUrl: null };
    const empty = { id: crypto.randomUUID(), name: "empty", logoUrl: null };
    expect(await reviewQueue(db, [halyard, empty])).toMatchObject([
      { number: 3, pullRequest: { number: 4 }, project: { name: "halyard" } },
    ]);
    expect(await reviewQueue(db, [])).toEqual([]);
  });

  it("shows label changes the brain has not made yet", async () => {
    await ticket(1);
    await requestGithubTask(db, {
      projectId,
      kind: "unlabel_issue",
      issueNumber: 1,
    });
    await requestGithubTask(db, {
      projectId,
      kind: "label_issue",
      issueNumber: 7,
    });
    const rows = await projectTickets(db, projectId);
    expect(byNumber(rows, 1)).toMatchObject({ status: "none", pending: true });
    expect(byNumber(rows, 7)).toMatchObject({
      status: "queued",
      pending: true,
    });
    // The last request wins: queue #1 again cancels the removal.
    await requestGithubTask(db, {
      projectId,
      kind: "label_issue",
      issueNumber: 1,
    });
    const tasks = await raw.select().from(schema.githubTasks);
    expect(
      tasks
        .filter((task) => task.issueNumber === 1)
        .map((task) => [task.kind, task.doneAt !== null]),
    ).toEqual(
      expect.arrayContaining([
        ["unlabel_issue", true],
        ["label_issue", false],
      ]),
    );
  });

  it("removes the label on GitHub, and a missing label is fine", async () => {
    await requestGithubTask(db, {
      projectId,
      kind: "unlabel_issue",
      issueNumber: 1,
    });
    await raw
      .update(schema.githubTasks)
      .set({ doneAt: new Date() })
      .where(eq(schema.githubTasks.kind, "setup_project"));
    const calls: string[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url.replace("https://api.github.com", "")}`);
      if (url.endsWith("/access_tokens"))
        return new Response(JSON.stringify({ token: "t", expires_at: "x" }), {
          status: 201,
        });
      return new Response(JSON.stringify({ message: "Label does not exist" }), {
        status: 404,
      });
    }) as typeof fetch;
    const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
      .privateKey.export({ type: "pkcs8", format: "pem" })
      .toString();
    expect(
      await runGithubTasks(db, { appId: "1", privateKey }, fetcher),
    ).toEqual(["unlabel_issue marie/halyard done"]);
    expect(calls.at(-1)).toBe(
      "DELETE /repos/marie/halyard/issues/1/labels/yarrow",
    );
  });
});

describe("merging GitHub's open issues", () => {
  it("adds untouched issues and keeps GitHub's title", () => {
    const yarrow: TicketRow = {
      ...ticketIdentity("github", "3"),
      title: "Old title",
      url: "",
      status: "queued",
      paidBy: [],
      runId: null,
      pending: true,
      pullRequest: null,
      reason: null,
      summary: null,
      models: [],
      createdAt: "2026-10-07T10:00:00.000Z",
      updatedAt: "2026-10-07T10:00:00.000Z",
    };
    const rows = mergeTickets(
      [yarrow],
      [
        {
          ...ticketIdentity("github", "3"),
          title: "New title",
          url: "https://github.com/o/r/issues/3",
          createdAt: "2026-10-05T08:00:00.000Z",
          updatedAt: "2026-10-07T09:00:00.000Z",
        },
        {
          ...ticketIdentity("github", "9"),
          title: "Untouched",
          url: "https://github.com/o/r/issues/9",
          createdAt: "2026-10-06T08:00:00.000Z",
          updatedAt: "2026-10-07T11:00:00.000Z",
        },
      ],
    );
    expect(rows.map((row) => [row.number, row.status, row.title])).toEqual([
      [9, "none", "Untouched"],
      [3, "queued", "New title"],
    ]);
    expect(rows[1]!.url).toBe("https://github.com/o/r/issues/3");
    // The tracker's date, not when Yarrow first saw the ticket.
    expect(rows[1]!.createdAt).toBe("2026-10-05T08:00:00.000Z");
    expect(yarrow.title).toBe("Old title");
  });

  it("orders tickets by number, GitHub first, whatever was last touched", () => {
    const issue = (
      source: "github" | "jira",
      key: string,
      updatedAt: string,
    ) => ({
      ...ticketIdentity(source, key),
      title: key,
      url: "",
      createdAt: updatedAt,
      updatedAt,
    });
    const rows = mergeTickets(
      [],
      [
        issue("jira", "APP-3", "2026-10-07T12:00:00.000Z"),
        issue("github", "4", "2026-10-07T09:00:00.000Z"),
        issue("jira", "APP-10", "2026-10-07T07:00:00.000Z"),
        issue("github", "12", "2026-10-07T08:00:00.000Z"),
        issue("github", "7", "2026-10-07T11:00:00.000Z"),
      ],
    );
    expect(rows.map((row) => row.ref)).toEqual([
      "#12",
      "#7",
      "#4",
      "APP-10",
      "APP-3",
    ]);
  });

  it("formats time and tokens", () => {
    expect(formatSeconds(28)).toBe("28 s");
    expect(formatSeconds(72)).toBe("1 min 12 s");
    expect(formatTokens(182_400)).toBe("182k");
    expect(formatTokens(6_400)).toBe("6.4k");
    expect(formatTokens(950)).toBe("950");
  });
});
