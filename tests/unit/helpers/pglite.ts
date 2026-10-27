import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import type { Database } from "../../../src/db/client";
import * as schema from "../../../src/db/schema";

/**
 * A real PostgreSQL (WASM) with the generated migrations applied. The
 * Drizzle API used by the app is identical for PGlite and postgres-js.
 */
export async function createTestDatabase() {
  const pg = new PGlite();
  for (const file of readdirSync("drizzle")
    .filter((name) => name.endsWith(".sql"))
    .sort())
    await pg.exec(readFileSync(`drizzle/${file}`, "utf8"));
  const raw = drizzle(pg, { schema });
  return {
    pg,
    raw,
    db: raw as unknown as Database,
    async reset() {
      await raw.execute(
        sql`TRUNCATE events, daily_fundings, ledger_entries, results, run_fundings, correction_requests, agent_runs, pull_requests, work_units, tracker_boards, tracker_connections, contributions, sponsor_project_selections, sponsor_profiles, project_secrets, project_run_configs, projects, account_members, accounts CASCADE`,
      );
    },
  };
}
