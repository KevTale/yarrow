import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../src/db/schema";
import { signalIssues } from "../../src/db/tickets";
import { createTestDatabase } from "./helpers/pglite";

const t = await createTestDatabase();
const { raw } = t;
const accountId = crypto.randomUUID();
const projectId = crypto.randomUUID();
const userId = crypto.randomUUID();

/** Stand-in for Supabase Realtime: realtime.send() writes to a log. */
beforeAll(async () => {
  await t.pg.exec(`
    CREATE SCHEMA realtime;
    CREATE TABLE realtime.log (topic text, private boolean, event text);
    CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true)
    RETURNS void LANGUAGE sql AS $$ INSERT INTO realtime.log VALUES (topic, private, event) $$;
  `);
});
beforeEach(async () => {
  await t.reset();
  await raw.execute(sql`TRUNCATE realtime.log`);
  await raw.insert(schema.accounts).values({ id: accountId, name: "Acme" });
  await raw.insert(schema.projects).values({
    id: projectId,
    accountId,
    name: "halyard",
    repository: "marie/halyard",
  });
  await raw.execute(sql`TRUNCATE realtime.log`);
});
afterAll(() => t.pg.close());

const signals = async () =>
  (
    await raw.execute<{ topic: string; private: boolean }>(
      sql`SELECT topic, private FROM realtime.log`,
    )
  ).rows.map((row) => `${row.topic}${row.private ? "" : " (public)"}`);

describe("realtime signals", () => {
  it("moves the boards only on settled money", async () => {
    const [pending] = await raw
      .insert(schema.contributions)
      .values({
        userId,
        amountCents: 1_000,
        creditCents: 0,
        paymentStatus: "pending",
      })
      .returning();
    expect(await signals()).toEqual([`sponsor:${userId}`]);
    await raw.execute(sql`TRUNCATE realtime.log`);
    await raw
      .update(schema.contributions)
      .set({ paymentStatus: "settled", creditCents: 821 })
      .where(sql`id = ${pending!.id}`);
    expect(await signals()).toEqual([`sponsor:${userId}`, "boards (public)"]);
    await raw.execute(sql`TRUNCATE realtime.log`);
    // Spending credit only concerns the sponsor.
    await raw
      .update(schema.contributions)
      .set({ reservedCents: 100 })
      .where(sql`id = ${pending!.id}`);
    expect(await signals()).toEqual([`sponsor:${userId}`]);
  });

  it("tells the project's members and the run's funders about progress", async () => {
    const [contribution] = await raw
      .insert(schema.contributions)
      .values({
        userId,
        amountCents: 1_000,
        creditCents: 1_000,
        paymentStatus: "settled",
      })
      .returning();
    const [unit] = await raw
      .insert(schema.workUnits)
      .values({
        projectId,
        source: "github",
        externalId: "3",
        title: "Ticket",
        url: "https://github.com/marie/halyard/issues/3",
        authorized: true,
      })
      .returning();
    const runId = crypto.randomUUID();
    await raw.insert(schema.agentRuns).values({
      id: runId,
      workUnitId: unit!.id,
      implementer: "claude-opus-5-5:high",
      reviewer: "openai-astra",
    });
    await raw
      .insert(schema.runFundings)
      .values({ agentRunId: runId, contributionId: contribution!.id });
    await raw.execute(sql`TRUNCATE realtime.log`);
    await raw
      .update(schema.agentRuns)
      .set({ phase: "reviewing" })
      .where(sql`id = ${runId}`);
    // The landing's live board follows phases too.
    expect(await signals()).toEqual([
      `project:${projectId}`,
      `sponsor:${userId}`,
      "boards (public)",
    ]);
    await raw.execute(sql`TRUNCATE realtime.log`);
    await raw
      .update(schema.agentRuns)
      .set({ reservedCents: 300 })
      .where(sql`id = ${runId}`);
    expect(await signals()).toEqual([
      `project:${projectId}`,
      `sponsor:${userId}`,
    ]);
    await raw.execute(sql`TRUNCATE realtime.log`);
    await raw.insert(schema.pullRequests).values({
      workUnitId: unit!.id,
      url: "https://github.com/marie/halyard/pull/4",
      number: 4,
      branch: "yarrow/3",
      state: "merged",
      closedAt: new Date(),
    });
    expect(await signals()).toEqual([
      `project:${projectId}`,
      `sponsor:${userId}`,
      "boards (public)",
    ]);
  });

  it("tells the project's members when GitHub or Jira says an open ticket changed", async () => {
    await signalIssues(t.db, projectId);
    const rows = await raw.execute<{ topic: string; event: string }>(
      sql`SELECT topic, event FROM realtime.log`,
    );
    expect(rows.rows).toEqual([
      { topic: `project:${projectId}`, event: "issues" },
    ]);
  });
});
