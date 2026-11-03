import { sql } from "drizzle-orm";
import type { Database } from "./client";
import { tryDays } from "./schema";

/** One more turn of the sample agent today; how many that makes. */
export async function countTryTurn(db: Database): Promise<number> {
  const [row] = await db
    .insert(tryDays)
    .values({ day: sql`(now() at time zone 'utc')::date`, turns: 1 })
    .onConflictDoUpdate({
      target: tryDays.day,
      set: { turns: sql`${tryDays.turns} + 1` },
    })
    .returning({ turns: tryDays.turns });
  return row!.turns;
}
