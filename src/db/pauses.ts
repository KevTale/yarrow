import { eq, gt, sql } from "drizzle-orm";
import type { Provider } from "../core/failures";
import type { Database } from "./client";
import { providerPauses } from "./schema";

/** How long dispatch waits before trying a provider out of credit again. */
export const PAUSE_MINUTES = 30;

export type ProviderPause = typeof providerPauses.$inferSelect;

/**
 * Pauses dispatch for `provider`. True when the pause is new, false when it
 * only extends one already there (the retry found no credit either): the
 * founder is told once per outage.
 */
export async function pauseProvider(
  db: Database,
  provider: Provider,
  message: string,
  now = new Date(),
): Promise<boolean> {
  const until = new Date(now.getTime() + PAUSE_MINUTES * 60_000);
  const [row] = await db
    .insert(providerPauses)
    .values({ provider, message: message.slice(0, 500), since: now, until })
    .onConflictDoUpdate({
      target: providerPauses.provider,
      set: { message: message.slice(0, 500), until },
    })
    .returning({ created: sql<boolean>`(xmax = 0)` });
  return Boolean(row?.created);
}

/** The pauses dispatch must still wait for. */
export function activePauses(
  db: Database,
  now = new Date(),
): Promise<ProviderPause[]> {
  return db.select().from(providerPauses).where(gt(providerPauses.until, now));
}

export function listPauses(db: Database): Promise<ProviderPause[]> {
  return db.select().from(providerPauses);
}

/** The provider took work again, or the admin resumed it. */
export async function clearPause(
  db: Database,
  provider: Provider,
): Promise<void> {
  await db.delete(providerPauses).where(eq(providerPauses.provider, provider));
}
