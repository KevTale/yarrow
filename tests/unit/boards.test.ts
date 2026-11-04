import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  liveToday,
  pullRequestCostCents,
  mergedToday,
  mergedTotals,
  projectBoard,
  recordSponsorClick,
  sponsorBoard,
  startOfUtcDay,
} from "../../src/db/boards";
import * as schema from "../../src/db/schema";
import { createTestDatabase } from "./helpers/pglite";

const test = await createTestDatabase();
const { db, raw } = test;
const now = new Date("2026-10-07T15:00:00Z");
const yesterday = new Date("2026-10-06T22:00:00Z");
const accountId = crypto.randomUUID();

async function sponsor(
  name: string | null,
  extra: Partial<typeof schema.sponsorProfiles.$inferInsert> = {},
) {
  const userId = crypto.randomUUID();
  await raw
    .insert(schema.sponsorProfiles)
    .values({ userId, publicName: name, ...extra });
  return userId;
}
async function pay(
  userId: string,
  amountCents: number,
  values: Partial<typeof schema.contributions.$inferInsert> = {},
) {
  const id = crypto.randomUUID();
  await raw.insert(schema.contributions).values({
    id,
    userId,
    amountCents,
    creditCents: amountCents - (values.taxCents ?? 0),
    paymentStatus: "settled",
    createdAt: now,
    ...values,
  });
  return id;
}
async function project(
  name: string,
  visibility: "public" | "listed" | "hidden",
) {
  const id = crypto.randomUUID();
  await raw.insert(schema.projects).values({
    id,
    accountId,
    name,
    visibility,
    repository: `test/${name}`,
    importedAt: now,
  });
  return id;
}
/** A work unit whose run, funded by `contributionId`, opened a pull request. */
async function shipped(
  projectId: string,
  contributionId: string,
  state: "open" | "merged",
  closedAt: Date | null,
) {
  const workUnitId = crypto.randomUUID();
  const runId = crypto.randomUUID();
  const n = Math.floor(Math.random() * 100000);
  await raw.insert(schema.workUnits).values({
    id: workUnitId,
    projectId,
    source: "github",
    externalId: String(n),
    title: `Ticket ${n}`,
    url: `https://github.com/t/${n}`,
    authorized: true,
    status: state === "merged" ? "closed" : "delivered",
  });
  await raw.insert(schema.agentRuns).values({
    id: runId,
    workUnitId,
    status: "completed",
    implementer: "claude",
    reviewer: "openai",
  });
  await raw
    .insert(schema.runFundings)
    .values({ agentRunId: runId, contributionId });
  await raw.insert(schema.results).values({
    agentRunId: runId,
    outcome: "pull_request",
    summary: "done",
    pullRequestUrl: `https://github.com/t/pull/${n}`,
  });
  await raw.insert(schema.pullRequests).values({
    workUnitId,
    url: `https://github.com/t/pull/${n}`,
    number: n,
    branch: `yarrow/${n}`,
    state,
    closedAt,
  });
  return runId;
}

beforeAll(async () => {});
afterAll(async () => {
  await test.pg.close();
});
beforeEach(async () => {
  await test.reset();
  await raw.insert(schema.accounts).values({ id: accountId, name: "Acme" });
});

describe("sponsor boards", () => {
  it("rank by money paid, VAT included, today and all time", async () => {
    const north = await sponsor("Northwind", {
      tagline: "Analytics",
      websiteUrl: "https://northwind.dev",
    });
    const ada = await sponsor("Ada L.");
    const anonymous = await sponsor(null);
    await pay(north, 12000, { taxCents: 2000, createdAt: yesterday });
    await pay(north, 1000);
    await pay(ada, 5000);
    await pay(anonymous, 90000);
    await pay(ada, 70000, { source: "promo" });
    await pay(ada, 70000, { paymentStatus: "refunded" });
    await pay(ada, 70000, { paymentStatus: "pending" });

    const today = await sponsorBoard(db, "today", now);
    expect(today.map((row) => [row.name, row.paidCents])).toEqual([
      [null, 90000],
      ["Ada L.", 5000],
      ["Northwind", 1000],
    ]);
    const all = await sponsorBoard(db, "all", now);
    expect(all.map((row) => [row.name, row.paidCents])).toEqual([
      [null, 90000],
      ["Northwind", 13000],
      ["Ada L.", 5000],
    ]);
    expect(all[1]).toMatchObject({
      tagline: "Analytics",
      websiteUrl: "https://northwind.dev",
      clicks: 0,
      pullRequests: 0,
    });
    expect(all[1]!.publicId).toMatch(/^[0-9a-f-]{36}$/);
    // An anonymous sponsor shows nothing of their profile.
    expect(all[0]).toMatchObject({ tagline: null, websiteUrl: null });
  });

  it("count clicks and funded pull requests", async () => {
    const north = await sponsor("Northwind", {
      websiteUrl: "https://northwind.dev",
    });
    const paid = await pay(north, 1000);
    const site = await project("site", "public");
    await shipped(site, paid, "open", null);
    await shipped(site, paid, "merged", now);
    const [row] = await sponsorBoard(db, "all", now);
    const { publicId } = row!;
    expect(await recordSponsorClick(db, publicId)).toBe(
      "https://northwind.dev",
    );
    await recordSponsorClick(db, publicId);
    expect(await recordSponsorClick(db, crypto.randomUUID())).toBeNull();
    expect((await sponsorBoard(db, "all", now))[0]).toMatchObject({
      clicks: 2,
      pullRequests: 2,
    });
  });
});

describe("pull request cost", () => {
  it("spreads every measured run's compute over the pull requests opened", async () => {
    const paid = await pay(await sponsor("Northwind"), 1000);
    const site = await project("site", "hidden");
    expect(await pullRequestCostCents(db, now)).toBe(250);
    const measured = [
      await shipped(site, paid, "merged", now),
      await shipped(site, paid, "open", null),
    ];
    // A pull request without a measured run (demo data) does not count.
    await shipped(site, paid, "merged", now);
    for (const [index, agentRunId] of measured.entries())
      await raw.insert(schema.runModels).values({
        agentRunId,
        role: "implementer",
        model: "claude-opus-5-5",
        costCents: index === 0 ? 300 : 900,
        createdAt: now,
      });
    // ($12 spent + $25 of hypothesis) / (2 pull requests + 10)
    expect(await pullRequestCostCents(db, now)).toBe(308);
    // Past 90 days, it no longer counts: past them from the clock too, as the
    // pull requests are dated by the database.
    expect(
      await pullRequestCostCents(db, new Date(Date.now() + 91 * 86_400_000)),
    ).toBe(250);
  });
});

describe("shipped boards", () => {
  it("list today's merges on public projects and rank projects by merges", async () => {
    const north = await sponsor("Northwind");
    const paid = await pay(north, 1000);
    const open = await project("open-source", "public");
    const listedOnly = await project("listed-app", "listed");
    const hidden = await project("hidden-app", "hidden");
    await shipped(open, paid, "merged", now);
    await shipped(open, paid, "merged", yesterday);
    await shipped(open, paid, "open", null);
    await shipped(listedOnly, paid, "merged", now);
    await shipped(hidden, paid, "merged", now);

    const feed = await mergedToday(db, now);
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      repository: "test/open-source",
      sponsors: [{ name: "Northwind" }],
    });
    expect(await mergedTotals(db, now)).toEqual({ today: 2, all: 3 });
    expect(await projectBoard(db)).toMatchObject([
      { name: "open-source", merged: 2, repository: "test/open-source" },
      { name: "listed-app", merged: 1, repository: null },
    ]);
  });

  it("shows tickets at work first, then today's pull requests; private tickets stay untitled", async () => {
    const north = await sponsor("Northwind");
    const paid = await pay(north, 1000);
    const open = await project("live-open", "public");
    const listedOnly = await project("live-listed", "listed");
    const hidden = await project("live-hidden", "hidden");
    for (const projectId of [open, listedOnly, hidden]) {
      const workUnitId = crypto.randomUUID();
      await raw.insert(schema.workUnits).values({
        id: workUnitId,
        projectId,
        source: "github",
        externalId: "1",
        title: "Working ticket",
        url: "https://github.com/t/1",
        authorized: true,
        status: "running",
      });
      const runId = crypto.randomUUID();
      await raw.insert(schema.agentRuns).values({
        id: runId,
        workUnitId,
        status: "running",
        phase: "reviewing",
        implementer: "claude-opus-5-5:high",
        reviewer: "openai-astra",
      });
      await raw
        .insert(schema.runFundings)
        .values({ agentRunId: runId, contributionId: paid });
    }
    await shipped(open, paid, "open", null);

    const rows = (await liveToday(db)).filter((row) =>
      row.project.startsWith("test/live-"),
    );
    expect(rows).toMatchObject([
      {
        project: "test/live-listed",
        logoUrl: null,
        status: "reviewing",
        title: null,
        issueUrl: null,
        repository: null,
      },
      {
        project: "test/live-open",
        logoUrl: "https://github.com/test.png?size=96",
        status: "reviewing",
        title: "Working ticket",
        repository: "test/live-open",
        issueRef: "#1",
        issueUrl: "https://github.com/t/1",
        sponsors: [{ name: "Northwind", publicId: expect.any(String) }],
      },
      {
        project: "test/live-open",
        status: "pull_request",
        title: expect.stringMatching(/^Ticket/),
        prUrl: expect.stringContaining("/pull/"),
      },
    ]);
  });

  it("starts the day at midnight UTC", () => {
    expect(
      startOfUtcDay(new Date("2026-10-07T00:30:00+02:00")).toISOString(),
    ).toBe("2026-10-06T00:00:00.000Z");
  });
});
