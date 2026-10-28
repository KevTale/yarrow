import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  computeSummary,
  createDailyFunding,
  listDailyFundings,
  pauseDailyFunding,
  updateDailyFunding,
} from "../../src/db/admin";
import {
  activePauses,
  clearPause,
  pauseProvider,
  PAUSE_MINUTES,
} from "../../src/db/pauses";
import { sponsorBoard } from "../../src/db/boards";
import { fundDaily } from "../../src/db/contributions";
import * as schema from "../../src/db/schema";
import { createTestDatabase } from "./helpers/pglite";

const test = await createTestDatabase();
const { db, raw } = test;
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
const profile = {
  publicName: "Totem",
  tagline: null,
  description: "Games made by hand.",
  websiteUrl: "https://totem.game",
};

afterAll(() => test.pg.close());

describe("admin: daily fundings", () => {
  beforeEach(() => test.reset());

  it("creates a sponsor row with no account and credits today at once", async () => {
    const userId = await createDailyFunding(db, { profile, amountCents: 1500 });
    const [row] = await listDailyFundings(db);
    expect(row).toMatchObject({
      userId,
      name: "Totem",
      websiteUrl: "https://totem.game",
      amountCents: 1500,
      paused: false,
      creditedCents: 1500,
      spentCents: 0,
      creditedToday: true,
    });
    const today = await sponsorBoard(db, "today");
    expect(today.map((r) => [r.name, r.paidCents])).toEqual([["Totem", 1500]]);
  });

  it("applies a new amount from the next day", async () => {
    const userId = await createDailyFunding(db, { profile, amountCents: 1500 });
    await updateDailyFunding(db, userId, {
      profile: { ...profile, publicName: "Totem Games" },
      amountCents: 500,
    });
    await fundDaily(db);
    await fundDaily(db, tomorrow);
    const [row] = await listDailyFundings(db);
    expect(row).toMatchObject({ name: "Totem Games", creditedCents: 2000 });
  });

  it("skips paused fundings and never credits a day twice", async () => {
    const userId = await createDailyFunding(db, { profile, amountCents: 1000 });
    await pauseDailyFunding(db, userId, true);
    expect(await fundDaily(db, tomorrow)).toEqual([]);
    await pauseDailyFunding(db, userId, false);
    expect(await raw.select().from(schema.contributions)).toHaveLength(1);
    expect(await fundDaily(db, tomorrow)).toEqual([userId]);
  });

  it("refuses an incomplete row", async () => {
    await expect(
      createDailyFunding(db, {
        profile: { ...profile, publicName: "" },
        amountCents: 1000,
      }),
    ).rejects.toThrow();
    await expect(
      createDailyFunding(db, { profile, amountCents: 50 }),
    ).rejects.toThrow();
    expect(await listDailyFundings(db)).toEqual([]);
  });
});

describe("admin: compute", () => {
  beforeEach(() => test.reset());

  it("pauses a provider once per outage and lets it go after the wait", async () => {
    const now = new Date("2026-10-11T12:00:00Z");
    expect(
      await pauseProvider(db, "anthropic", "credit balance is too low", now),
    ).toBe(true);
    // The retry finds no credit either: the same outage, a later try.
    const later = new Date(now.getTime() + PAUSE_MINUTES * 60_000 + 1000);
    expect(await pauseProvider(db, "anthropic", "still too low", later)).toBe(
      false,
    );
    const [pause] = await raw.select().from(schema.providerPauses);
    expect(pause).toMatchObject({
      provider: "anthropic",
      since: now,
      message: "still too low",
    });
    expect(await activePauses(db, later)).toHaveLength(1);
    expect(
      await activePauses(
        db,
        new Date(later.getTime() + PAUSE_MINUTES * 60_000 + 1000),
      ),
    ).toHaveLength(0);
    await clearPause(db, "anthropic");
    expect(await pauseProvider(db, "anthropic", "again", later)).toBe(true);
  });

  it("sums what each provider cost and what sponsors still have", async () => {
    const now = new Date();
    const accountId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const workUnitId = crypto.randomUUID();
    const runId = crypto.randomUUID();
    await raw.insert(schema.accounts).values({ id: accountId, name: "Acme" });
    await raw.insert(schema.projects).values({
      id: projectId,
      accountId,
      name: "app",
      repository: "acme/app",
    });
    await raw.insert(schema.workUnits).values({
      id: workUnitId,
      projectId,
      source: "github",
      externalId: "1",
      title: "A ticket",
      url: "https://github.com/acme/app/issues/1",
    });
    await raw.insert(schema.agentRuns).values({
      id: runId,
      workUnitId,
      status: "completed",
      implementer: "claude-opus-5-5:high",
      reviewer: "openai-astra",
      uncoveredCents: 7,
      finishedAt: now,
    });
    await raw.insert(schema.runModels).values([
      {
        agentRunId: runId,
        role: "implementer",
        model: "claude-opus-5-5",
        costCents: 80,
        costExact: true,
      },
      {
        agentRunId: runId,
        role: "reviewer",
        model: "gpt-6-astra",
        costCents: 30,
      },
    ]);
    await raw.insert(schema.contributions).values([
      {
        userId: crypto.randomUUID(),
        amountCents: 1000,
        creditCents: 800,
        debitedCents: 300,
        paymentStatus: "settled",
      },
      {
        userId: crypto.randomUUID(),
        source: "direct",
        amountCents: 500,
        creditCents: 500,
        paymentStatus: "settled",
      },
      {
        userId: crypto.randomUUID(),
        amountCents: 900,
        creditCents: 700,
        paymentStatus: "pending",
      },
    ]);
    await pauseProvider(db, "openai", "insufficient_quota", now);

    const summary = await computeSummary(db, now);
    expect(summary.providers).toMatchObject([
      {
        provider: "anthropic",
        pause: null,
        todayCents: 80,
        weekCents: 80,
        monthCents: 80,
        exact: true,
      },
      {
        provider: "openai",
        pause: { message: "insufficient_quota" },
        todayCents: 30,
        exact: false,
      },
    ]);
    expect(summary.owedCents).toEqual({ stripe: 500, direct: 500, promo: 0 });
    expect(summary.absorbedCents).toBe(7);
  });
});
