import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { PostgresLedger } from "../../src/db/ledger";
import type { Database } from "../../src/db/client";
import * as schema from "../../src/db/schema";
import type { RunRequest, RunResult } from "../../src/core/contracts";

const pg = new PGlite();
const db = drizzle(pg, { schema });
// The SQL transaction API used by this repository is identical for these two
// Drizzle adapters. PGlite runs the real generated PostgreSQL migration in WASM.
const ledger = new PostgresLedger(db as unknown as Database);
const accountId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const workUnitId = crypto.randomUUID();
const sponsorId = crypto.randomUUID();
const contributionId = crypto.randomUUID();
const pullRequestUrl = "https://github.com/test/repo/pull/2";
const abstention: RunResult = {
  outcome: "abstained",
  actualCostCents: 41,
  reason: "ticket_unclear",
  summary: "Needs acceptance criteria",
  evidence: ["ticket commented"],
};
const delivered: RunResult = {
  outcome: "pull_request",
  actualCostCents: 342,
  summary: "Fixed the issue",
  pullRequestUrl,
  pullRequestNumber: 2,
  branch: "yarrow/issue-1",
  evidence: ["tests: passed", "review: approved"],
};
function run(overrides: Partial<RunRequest> = {}): RunRequest {
  return {
    runId: crypto.randomUUID(),
    workUnitId,
    kind: "implementation",
    budgetCents: 800,
    ...overrides,
  } as RunRequest;
}
async function contribution(id = contributionId) {
  return (
    await db
      .select()
      .from(schema.contributions)
      .where(eq(schema.contributions.id, id))
  )[0]!;
}
async function addContribution(
  values: Partial<typeof schema.contributions.$inferInsert> = {},
) {
  const id = crypto.randomUUID();
  await db.insert(schema.contributions).values({
    id,
    userId: crypto.randomUUID(),
    amountCents: 1000,
    creditCents: 1000,
    paymentStatus: "settled",
    ...values,
  });
  return id;
}

beforeAll(async () => {
  for (const file of readdirSync("drizzle")
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
  }
}, 30000);
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await db.execute(
    sql`TRUNCATE events, ledger_entries, results, run_fundings, correction_requests, agent_runs, pull_requests, work_units, tracker_boards, tracker_connections, contributions, sponsor_project_selections, sponsor_profiles, project_secrets, project_run_configs, projects, account_members, accounts CASCADE`,
  );
  await db.insert(schema.accounts).values({ id: accountId, name: "Acme" });
  await db.insert(schema.projects).values({
    id: projectId,
    accountId,
    name: "Test project",
    repository: "test/repo",
    categories: ["saas"],
    stacks: ["supabase", "nextjs"],
  });
  await db.insert(schema.workUnits).values({
    id: workUnitId,
    projectId,
    source: "github",
    externalId: "1",
    title: "An issue",
    url: "https://github.com/test/repo/issues/1",
    authorized: true,
  });
  await db.insert(schema.sponsorProfiles).values({
    userId: sponsorId,
    publicName: "Test sponsor",
  });
  await db.insert(schema.contributions).values({
    id: contributionId,
    userId: sponsorId,
    amountCents: 2500,
    feeCents: 103,
    marginCents: 250,
    creditCents: 2000,
    paymentStatus: "settled",
    createdAt: new Date("2026-10-01T00:00:00Z"),
  });
});

describe("reserve and settle", () => {
  it("deduplicates reserve and settlement, preserving the full trace", async () => {
    const request = run();
    expect(await ledger.reserve(request)).toBe(800);
    expect(await ledger.reserve(request)).toBe(800);
    expect((await contribution()).reservedCents).toBe(800);
    await ledger.settle(request.runId, abstention);
    await ledger.settle(request.runId, abstention);
    expect(await contribution()).toMatchObject({
      reservedCents: 0,
      debitedCents: 41,
    });
    const entries = await db.select().from(schema.ledgerEntries);
    expect(entries.map((entry) => entry.kind).sort()).toEqual([
      "debit",
      "release",
      "reserve",
    ]);
    expect(entries.find((entry) => entry.kind === "release")?.amountCents).toBe(
      759,
    );
    await expect(
      ledger.settle(request.runId, { ...abstention, actualCostCents: 42 }),
    ).rejects.toThrow("idempotency conflict");
    const work = await db.select().from(schema.workUnits);
    expect(work[0]!.status).toBe("abstained");
  });

  it("delivers one pull request and records metrics events", async () => {
    const request = run();
    await ledger.reserve(request);
    await ledger.settle(request.runId, delivered);
    expect(await contribution()).toMatchObject({ debitedCents: 342 });
    expect(await db.select().from(schema.pullRequests)).toMatchObject([
      { workUnitId, url: pullRequestUrl, state: "open" },
    ]);
    expect((await db.select().from(schema.workUnits))[0]!.status).toBe(
      "delivered",
    );
    const events = await db.select().from(schema.events);
    expect(events.map((event) => event.type).sort()).toEqual([
      "run.finished",
      "run.started",
    ]);
    expect(events.find((event) => event.type === "run.started")).toMatchObject({
      accountId,
      projectId,
      workUnitId,
    });
  });

  it("runs queued corrections on the same pull request, one at a time", async () => {
    async function request(instruction: string) {
      const [row] = await db
        .insert(schema.correctionRequests)
        .values({
          workUnitId,
          instruction,
          requestedBy: "owner",
          externalCommentId: crypto.randomUUID(),
        })
        .returning();
      return run({
        kind: "correction",
        instruction,
        correctionRequestId: row!.id,
      });
    }
    const first = run();
    await ledger.reserve(first);
    await ledger.settle(first.runId, delivered);
    await expect(ledger.reserve(run({ kind: "correction" }))).rejects.toThrow();
    const correction = await request("Rename the button");
    const busy = await request("Also the title");
    await ledger.reserve(correction);
    await expect(ledger.reserve(busy)).rejects.toThrow("in progress");
    expect(
      (await db.select().from(schema.correctionRequests))
        .map((row) => row.status)
        .sort(),
    ).toEqual(["dispatched", "queued"]);
    await ledger.settle(correction.runId, {
      ...delivered,
      actualCostCents: 120,
    });
    expect(await db.select().from(schema.pullRequests)).toHaveLength(1);
    expect((await db.select().from(schema.workUnits))[0]!.status).toBe(
      "delivered",
    );
    await ledger.reserve(busy);
    await expect(
      ledger.settle(busy.runId, {
        ...delivered,
        pullRequestUrl: "https://github.com/test/repo/pull/3",
      }),
    ).rejects.toThrow("exactly one pull request");
  });

  it("puts the ticket back in its place when Yarrow's provider account is out of credit", async () => {
    const [before] = await db.select().from(schema.workUnits);
    const unpaid: RunResult = {
      ...abstention,
      actualCostCents: 0,
      reason: "provider_out_of_credit",
      summary: "Yarrow's Anthropic account ran out of credit.",
    };
    const request = run();
    await ledger.reserve(request);
    await ledger.settle(request.runId, unpaid);
    const [after] = await db.select().from(schema.workUnits);
    expect(after).toMatchObject({
      status: "queued",
      queuedAt: before!.queuedAt,
    });
    expect(await contribution()).toMatchObject({
      reservedCents: 0,
      debitedCents: 0,
    });
    // It runs again once the credit is back.
    expect(await ledger.reserve(run())).toBe(800);
  });

  it("requeues a correction stopped for want of credit", async () => {
    const first = run();
    await ledger.reserve(first);
    await ledger.settle(first.runId, delivered);
    const [row] = await db
      .insert(schema.correctionRequests)
      .values({
        workUnitId,
        instruction: "Rename the button",
        requestedBy: "owner",
        externalCommentId: crypto.randomUUID(),
      })
      .returning();
    const correction = run({
      kind: "correction",
      instruction: "Rename the button",
      correctionRequestId: row!.id,
    });
    await ledger.reserve(correction);
    await ledger.settle(correction.runId, {
      ...abstention,
      actualCostCents: 0,
      reason: "provider_out_of_credit",
      summary: "Yarrow's OpenAI account ran out of credit.",
    });
    expect(await db.select().from(schema.correctionRequests)).toMatchObject([
      { status: "queued", agentRunId: null },
    ]);
    expect((await db.select().from(schema.workUnits))[0]!.status).toBe(
      "delivered",
    );
  });

  it("rejects pending money, unauthorized or suspended work, and work already started", async () => {
    await db.update(schema.contributions).set({ paymentStatus: "pending" });
    await expect(ledger.reserve(run())).rejects.toThrow("No eligible funds");
    expect(await db.select().from(schema.agentRuns)).toHaveLength(0);
    await db.update(schema.contributions).set({ paymentStatus: "settled" });
    await db.update(schema.projects).set({ suspendedAt: new Date() });
    await expect(ledger.reserve(run())).rejects.toThrow("suspended");
    await db.update(schema.projects).set({ suspendedAt: null });
    await db.update(schema.workUnits).set({ authorized: false });
    await expect(ledger.reserve(run())).rejects.toThrow("not authorized");
    await db.update(schema.workUnits).set({ authorized: true });
    await ledger.reserve(run());
    await expect(ledger.reserve(run())).rejects.toThrow("not queued");
    expect((await contribution()).reservedCents).toBe(800);
  });
});

describe("funding without a cap", () => {
  it("funds a run from several contributions, oldest money first", async () => {
    await db
      .update(schema.contributions)
      .set({ creditCents: 500, amountCents: 500, feeCents: 0, marginCents: 0 });
    const newer = await addContribution({
      createdAt: new Date("2026-10-02T00:00:00Z"),
    });
    const request = run();
    expect(await ledger.reserve(request)).toBe(800);
    expect((await contribution()).reservedCents).toBe(500);
    expect((await contribution(newer)).reservedCents).toBe(300);
    await ledger.settle(request.runId, { ...delivered, actualCostCents: 600 });
    expect(await contribution()).toMatchObject({
      reservedCents: 0,
      debitedCents: 500,
    });
    expect(await contribution(newer)).toMatchObject({
      reservedCents: 0,
      debitedCents: 100,
    });
  });

  it("tops up a running run idempotently and records uncovered cost", async () => {
    const request = run();
    await ledger.reserve(request);
    expect(await ledger.reserveMore(request.runId, 1000, 1)).toBe(1000);
    expect(await ledger.reserveMore(request.runId, 1000, 1)).toBe(1000);
    expect(await ledger.reserveMore(request.runId, 1000, 2)).toBe(200);
    expect(await ledger.reserveMore(request.runId, 1000, 3)).toBe(0);
    expect((await contribution()).reservedCents).toBe(2000);
    await ledger.settle(request.runId, { ...delivered, actualCostCents: 2600 });
    const [settled] = await db.select().from(schema.agentRuns);
    expect(settled).toMatchObject({
      reservedCents: 2000,
      debitedCents: 2000,
      uncoveredCents: 600,
    });
    expect(await contribution()).toMatchObject({
      reservedCents: 0,
      debitedCents: 2000,
    });
    await ledger.settle(request.runId, { ...delivered, actualCostCents: 2600 });
    await expect(ledger.reserveMore(request.runId, 100, 4)).rejects.toThrow(
      "not active",
    );
  });
});

describe("sponsor filters", () => {
  async function fundable() {
    const request = run();
    try {
      await ledger.reserve(request);
      await ledger.settle(request.runId, { ...abstention, actualCostCents: 0 });
      await db.update(schema.workUnits).set({ status: "queued" });
      return true;
    } catch (error) {
      if ((error as Error).message === "No eligible funds") return false;
      throw error;
    }
  }

  it("funds hidden projects like any other", async () => {
    await db.update(schema.projects).set({ visibility: "hidden" });
    expect(await fundable()).toBe(true);
  });

  it("applies excluded projects and categories in all_except mode", async () => {
    expect(await fundable()).toBe(true);
    await db
      .update(schema.sponsorProfiles)
      .set({ excludedCategories: ["saas"] });
    expect(await fundable()).toBe(false);
    await db.update(schema.sponsorProfiles).set({ excludedCategories: [] });
    await db
      .insert(schema.sponsorProjectSelections)
      .values({ userId: sponsorId, projectId });
    expect(await fundable()).toBe(false);
  });

  it("funds only checked projects in only mode", async () => {
    await db.update(schema.sponsorProfiles).set({ mode: "only" });
    expect(await fundable()).toBe(false);
    await db
      .insert(schema.sponsorProjectSelections)
      .values({ userId: sponsorId, projectId });
    expect(await fundable()).toBe(true);
  });

  it("targets stacks when the sponsor requires them", async () => {
    await db
      .update(schema.sponsorProfiles)
      .set({ requiredStacks: ["firebase"] });
    expect(await fundable()).toBe(false);
    await db
      .update(schema.sponsorProfiles)
      .set({ requiredStacks: ["firebase", "supabase"] });
    expect(await fundable()).toBe(true);
  });

  it("treats a sponsor without a profile as every project", async () => {
    await db.delete(schema.contributions);
    await addContribution();
    expect(await fundable()).toBe(true);
    await db.update(schema.projects).set({ visibility: "hidden" });
    expect(await fundable()).toBe(true);
  });
});

describe("pull request lifecycle", () => {
  it("records merges once and rejects contradictory closes", async () => {
    const request = run();
    await ledger.reserve(request);
    await ledger.settle(request.runId, delivered);
    await ledger.closePullRequest(pullRequestUrl, "merged");
    await ledger.closePullRequest(pullRequestUrl, "merged");
    await expect(
      ledger.closePullRequest(pullRequestUrl, "closed", "out of scope"),
    ).rejects.toThrow("already closed");
    expect((await db.select().from(schema.pullRequests))[0]).toMatchObject({
      state: "merged",
      rejectionReason: null,
    });
    expect((await db.select().from(schema.workUnits))[0]!.status).toBe(
      "closed",
    );
    const merged = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.type, "pull_request.merged"));
    expect(merged).toHaveLength(1);
  });
});

describe("database constraints", () => {
  it("rejects a Stripe breakdown larger than the amount paid", async () => {
    await expect(
      addContribution({ amountCents: 1000, feeCents: 50, creditCents: 1000 }),
    ).rejects.toThrow();
  });
  it("requires an instruction exactly on correction runs", async () => {
    await expect(
      db.insert(schema.agentRuns).values({
        id: crypto.randomUUID(),
        workUnitId,
        kind: "correction",
        implementer: "a",
        reviewer: "b",
      }),
    ).rejects.toThrow();
  });
  it("rejects malformed event types and secret names", async () => {
    await expect(
      db.insert(schema.events).values({ type: "Run Started" }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.projectSecrets).values({
        projectId,
        name: "stripe key",
        providerCredentialId: "cred_1",
        allowedHost: "api.stripe.com",
      }),
    ).rejects.toThrow();
  });
});
