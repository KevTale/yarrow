import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  createDailyFunding,
  listDailyFundings,
  pauseDailyFunding,
  updateDailyFunding,
} from "../../src/db/admin";
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

describe("admin: daily fundings", () => {
  beforeEach(() => test.reset());
  afterAll(() => test.pg.close());

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
