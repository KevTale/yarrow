import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { homeStats } from "../../src/db/queries";
import { sponsorBoard } from "../../src/db/boards";
import { fundDaily } from "../../src/db/contributions";
import * as schema from "../../src/db/schema";
import { createTestDatabase } from "./helpers/pglite";

const test = await createTestDatabase();
const { db, raw } = test;
const morning = new Date("2026-10-10T00:05:00Z");
const evening = new Date("2026-10-10T21:00:00Z");
const tomorrow = new Date("2026-10-11T00:00:00Z");

async function funded(name: string, amountCents: number) {
  const userId = crypto.randomUUID();
  await raw.insert(schema.sponsorProfiles).values({ userId, publicName: name });
  // Lands at midnight: the draw in a wider window is tested in admin.test.ts.
  await raw
    .insert(schema.dailyFundings)
    .values({ userId, amountCents, windowStart: 0, windowEnd: 0 });
  return userId;
}

describe("daily fundings", () => {
  beforeEach(() => test.reset());
  afterAll(() => test.pg.close());

  it("credits each sponsor once per UTC day, with no fee or margin", async () => {
    const north = await funded("North", 1000);
    const ada = await funded("Ada", 500);
    expect((await fundDaily(db, morning)).sort()).toEqual([ada, north].sort());
    expect(await fundDaily(db, evening)).toEqual([]);
    expect(await fundDaily(db, tomorrow)).toHaveLength(2);

    const rows = await raw.select().from(schema.contributions);
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row).toMatchObject({
        source: "direct",
        paymentStatus: "settled",
        feeCents: 0,
        marginCents: 0,
        taxCents: 0,
      });
      expect(row.creditCents).toBe(row.amountCents);
    }
    const credits = await raw.select().from(schema.ledgerEntries);
    expect(credits.map((entry) => entry.kind)).toEqual(Array(4).fill("credit"));
  });

  it("ranks direct credit on Today and All time like a card payment", async () => {
    await funded("North", 1000);
    await fundDaily(db, morning);
    const today = await sponsorBoard(db, "today", evening);
    expect(today.map((row) => [row.name, row.paidCents])).toEqual([
      ["North", 1000],
    ]);
    expect(await sponsorBoard(db, "today", tomorrow)).toEqual([]);
    await fundDaily(db, tomorrow);
    const all = await sponsorBoard(db, "all", tomorrow);
    expect(all[0]?.paidCents).toBe(2000);
    expect((await homeStats(db)).sponsors).toBe(1);
  });
});
