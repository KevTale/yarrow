import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
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
import { fundingMinute, startsTomorrow } from "../../src/core/daily-funding";
import { expireDailyCredit, fundDaily } from "../../src/db/contributions";
import * as schema from "../../src/db/schema";
import { createTestDatabase } from "./helpers/pglite";

const test = await createTestDatabase();
const { db, raw } = test;
const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
// Lands at midnight: credited at once, whatever the hour the test runs.
const now = { windowStart: 0, windowEnd: 0 };
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
    const userId = await createDailyFunding(db, {
      profile,
      amountCents: 1500,
      ...now,
    });
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

  it("adds a sponsor now, whatever its window, or leaves it to the cron", async () => {
    const late = { windowStart: 0, windowEnd: 0 };
    const added = await createDailyFunding(
      db,
      { profile, amountCents: 700, ...late },
      "now",
    );
    const scheduled = await createDailyFunding(
      db,
      {
        profile: { ...profile, publicName: "Quill" },
        amountCents: 300,
        ...late,
      },
      "scheduled",
    );
    // Today's minute (midnight) went by before Quill was scheduled: tomorrow.
    expect(await fundDaily(db)).toEqual([]);
    const rows = await listDailyFundings(db);
    expect(rows.find((r) => r.userId === added)).toMatchObject({
      creditedToday: true,
      landsTomorrow: false,
    });
    expect(rows.find((r) => r.userId === scheduled)).toMatchObject({
      creditedToday: false,
      landsTomorrow: true,
      landsAt: 0,
    });
    expect((await fundDaily(db, tomorrow)).sort()).toEqual(
      [added, scheduled].sort(),
    );
  });

  it("lets a scheduled sponsor land today only if its minute is to come", () => {
    const at = (time: string) => new Date(`2030-01-15T${time}:00Z`);
    // Scheduled at 08:00 for a 07:42 draw: tomorrow; for 09:10, today.
    expect(startsTomorrow(at("08:00"), at("08:05"), 7 * 60 + 42)).toBe(true);
    expect(startsTomorrow(at("08:00"), at("09:10"), 9 * 60 + 10)).toBe(false);
    // From the next day on, every draw counts.
    expect(
      startsTomorrow(
        at("08:00"),
        new Date("2030-01-16T07:42:00Z"),
        7 * 60 + 42,
      ),
    ).toBe(false);
  });

  it("applies a new amount from the next day", async () => {
    const userId = await createDailyFunding(db, {
      profile,
      amountCents: 1500,
      ...now,
    });
    await updateDailyFunding(db, userId, {
      profile: { ...profile, publicName: "Totem Games" },
      amountCents: 500,
      ...now,
    });
    await fundDaily(db);
    await fundDaily(db, tomorrow);
    const [row] = await listDailyFundings(db);
    expect(row).toMatchObject({ name: "Totem Games", creditedCents: 2000 });
  });

  it("skips paused fundings and never credits a day twice", async () => {
    const userId = await createDailyFunding(db, {
      profile,
      amountCents: 1000,
      ...now,
    });
    await pauseDailyFunding(db, userId, true);
    expect(await fundDaily(db, tomorrow)).toEqual([]);
    await pauseDailyFunding(db, userId, false);
    expect(await raw.select().from(schema.contributions)).toHaveLength(1);
    expect(await fundDaily(db, tomorrow)).toEqual([userId]);
  });

  it("lands each day at a minute drawn in its window", async () => {
    const window = { windowStart: 5 * 60, windowEnd: 9 * 60 };
    const day = new Date("2030-01-15T00:00:00Z");
    const at = (minutes: number) => new Date(day.getTime() + minutes * 60_000);
    const userId = await createDailyFunding(db, {
      profile,
      amountCents: 1000,
      ...window,
    });
    const draw = fundingMinute(userId, "2030-01-15", {
      start: window.windowStart,
      end: window.windowEnd,
    });
    expect(draw).toBeGreaterThanOrEqual(300);
    expect(draw).toBeLessThanOrEqual(540);
    expect(await fundDaily(db, at(draw - 1))).toEqual([]);
    expect(await fundDaily(db, at(draw))).toEqual([userId]);
    expect(await fundDaily(db, at(draw + 5))).toEqual([]);
    const [row] = await listDailyFundings(db, at(draw));
    expect(row).toMatchObject({ windowStart: 300, windowEnd: 540 });
    // Another day, another minute: not every day at the same time.
    const days = Array.from({ length: 10 }, (_, i) =>
      fundingMinute(userId, `2030-01-${String(16 + i)}`, {
        start: 300,
        end: 540,
      }),
    );
    expect(new Set(days).size).toBeGreaterThan(5);
  });

  it("lets what a day left unspent expire at midnight", async () => {
    const userId = await createDailyFunding(db, {
      profile,
      amountCents: 1000,
      ...now,
    });
    const [credit] = await raw.select().from(schema.contributions);
    // A run spent $3 and holds $2 for its next step.
    await raw
      .update(schema.contributions)
      .set({ debitedCents: 300, reservedCents: 200 })
      .where(eq(schema.contributions.id, credit!.id));
    expect(await expireDailyCredit(db)).toBe(0);
    expect(await expireDailyCredit(db, tomorrow)).toBe(500);
    expect(await expireDailyCredit(db, tomorrow)).toBe(0);
    // The run releases its hold: that part expires at the next pass.
    await raw
      .update(schema.contributions)
      .set({ reservedCents: 0 })
      .where(eq(schema.contributions.id, credit!.id));
    expect(await expireDailyCredit(db, tomorrow)).toBe(200);
    const [after] = await raw.select().from(schema.contributions);
    expect(after).toMatchObject({ amountCents: 1000, creditCents: 300 });
    // The boards count what was put in; the admin too.
    const [row] = await listDailyFundings(db);
    expect(row).toMatchObject({ userId, creditedCents: 1000, spentCents: 300 });
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
    await expect(
      createDailyFunding(db, {
        profile,
        amountCents: 1000,
        windowStart: 600,
        windowEnd: 300,
      }),
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
    const metaRunId = crypto.randomUUID();
    await raw.insert(schema.agentRuns).values({
      id: metaRunId,
      workUnitId,
      status: "completed",
      implementer: "muse-wonder-1.0:high",
      reviewer: "openai-astra",
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
      // A run Meta implemented: its own line.
      {
        agentRunId: metaRunId,
        role: "implementer",
        model: "muse-wonder-1.0",
        costCents: 40,
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
      { provider: "meta", pause: null, todayCents: 40, exact: false },
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
