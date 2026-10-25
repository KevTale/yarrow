import { afterAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import {
  sponsorShipped,
  sponsorStandings,
} from "../../src/db/sponsor-dashboard";
import { createTestDatabase } from "./helpers/pglite";

const t = await createTestDatabase();
const { db, raw } = t;
const accountId = crypto.randomUUID();

async function sponsor(name: string | null, paidCents: number) {
  const userId = crypto.randomUUID();
  await raw.insert(schema.sponsorProfiles).values({ userId, publicName: name });
  const id = crypto.randomUUID();
  await raw.insert(schema.contributions).values({
    id,
    userId,
    amountCents: paidCents,
    creditCents: paidCents,
    paymentStatus: "settled",
  });
  return { userId, contributionId: id };
}

beforeEach(async () => {
  await t.reset();
  await raw.insert(schema.accounts).values({ id: accountId, name: "Acme" });
});
afterAll(() => t.pg.close());

describe("sponsor standings", () => {
  it("shows the sponsor between the one ahead and the one behind", async () => {
    await sponsor("Northwind", 40_000);
    await sponsor("Acme", 30_000);
    const me = await sponsor("TOTEM", 20_000);
    await sponsor("Bolt", 10_000);
    await sponsor("Lumen", 5_000);
    const { today, anonymous } = await sponsorStandings(db, me.userId);
    expect(anonymous).toBe(false);
    expect(today.rank).toBe(3);
    expect(today.rows.map((row) => [row.rank, row.name, row.you])).toEqual([
      [2, "Acme", false],
      [3, "TOTEM", true],
      [4, "Bolt", false],
    ]);
    expect(today.paidCents).toBe(20_000);
    expect(today.totalCents).toBe(105_000);
    expect(today.others).toEqual([40_000, 30_000, 10_000, 5_000]);
  });

  it("keeps three rows at the top and shows the top for anonymous sponsors", async () => {
    const first = await sponsor("Northwind", 40_000);
    await sponsor("Acme", 30_000);
    await sponsor("Bolt", 10_000);
    expect(
      (await sponsorStandings(db, first.userId)).all.rows.map(
        (row) => row.name,
      ),
    ).toEqual(["Northwind", "Acme", "Bolt"]);
    const hidden = await sponsor(null, 90_000);
    const standing = await sponsorStandings(db, hidden.userId);
    expect(standing.anonymous).toBe(true);
    expect(standing.all.rank).toBeNull();
    expect(standing.all.rows.map((row) => row.name)).toEqual([
      "Northwind",
      "Acme",
      "Bolt",
    ]);
  });
});

describe("shipped with your money", () => {
  it("names public tickets and masks the others", async () => {
    const me = await sponsor("TOTEM", 10_000);
    for (const [name, visibility] of [
      ["open", "public"],
      ["secret", "listed"],
    ] as const) {
      const projectId = crypto.randomUUID();
      await raw.insert(schema.projects).values({
        id: projectId,
        accountId,
        name,
        visibility,
        repository: `o/${name}`,
      });
      const workUnitId = crypto.randomUUID();
      await raw.insert(schema.workUnits).values({
        id: workUnitId,
        projectId,
        source: "github",
        externalId: "1",
        title: `Ticket of ${name}`,
        url: `https://github.com/o/${name}/issues/1`,
        authorized: true,
        status: "delivered",
      });
      const runId = crypto.randomUUID();
      await raw.insert(schema.agentRuns).values({
        id: runId,
        workUnitId,
        status: "completed",
        implementer: "claude-opus-5-5:high",
        reviewer: "openai-astra",
        reservedCents: 50,
        debitedCents: 41,
      });
      await raw.insert(schema.runFundings).values({
        agentRunId: runId,
        contributionId: me.contributionId,
        reservedCents: 50,
        debitedCents: 41,
      });
      await raw.insert(schema.results).values({
        agentRunId: runId,
        outcome: "pull_request",
        summary: "done",
        pullRequestUrl: `https://github.com/o/${name}/pull/2`,
      });
    }
    const rows = await sponsorShipped(db, me.userId);
    expect(
      rows
        .map((row) => [row.projectName, row.title, row.url, row.costCents])
        .sort(),
    ).toEqual([
      ["open", "Ticket of open", "https://github.com/o/open/pull/2", 41],
      ["secret", null, null, 41],
    ]);
    expect(rows[0]!.models.map((model) => model.name)).toEqual([
      "Claude Opus 5.5",
      "OpenAI Astra",
    ]);
  });
});
