import { and, asc, desc, eq, lt, sql } from "drizzle-orm";
import {
  activityFromEvent,
  type ActivityLine,
  type SessionEvent,
} from "../core/activity";
import type { Database } from "./client";
import { agentRuns, runActivity, runActivityReads } from "./schema";

/**
 * Keeps activity lines, once each. A tool result is not a line of its own:
 * it completes its tool call's line (ok, test counts).
 */
export async function recordActivity(
  db: Database,
  agentRunId: string,
  lines: ActivityLine[],
): Promise<void> {
  const fresh = lines.filter((line) => !line.detail.toolUseId);
  if (fresh.length)
    await db
      .insert(runActivity)
      .values(
        fresh.map((line) => ({
          agentRunId,
          at: new Date(line.at),
          actor: line.actor,
          kind: line.kind,
          detail: line.detail as Record<string, unknown>,
          externalId: line.externalId,
        })),
      )
      .onConflictDoNothing();
  for (const result of lines.filter((line) => line.detail.toolUseId)) {
    const { toolUseId, ...outcome } = result.detail;
    await db
      .update(runActivity)
      .set({
        detail: sql`${runActivity.detail} || ${JSON.stringify(outcome)}::jsonb`,
      })
      .where(
        and(
          eq(runActivity.agentRunId, agentRunId),
          eq(runActivity.externalId, toolUseId!),
        ),
      );
  }
}

/** The calls a sync needs from the Claude session client. */
export interface SessionEvents {
  listEvents(
    sessionId: string,
    after: string | null,
    pages?: number,
  ): Promise<SessionEvent[]>;
}

/** Where a sync reads the implementer session's actions since `after` (ISO). */
export interface ActivitySource {
  activity(sessionId: string, after: string | null): Promise<ActivityLine[]>;
}

/** A Claude session's events, as feed lines. */
export const sessionActivity = (sessions: SessionEvents): ActivitySource => ({
  async activity(sessionId, after) {
    return (await sessions.listEvents(sessionId, after))
      .map(activityFromEvent)
      .filter((line): line is ActivityLine => line !== null);
  },
});

/**
 * Reads the implementer session's new actions into the run's feed. At most
 * one read every `every` ms per run, whoever asks (the brain while it
 * waits, a viewer watching the run), so the provider is never hammered.
 * Returns whether a read happened.
 */
export async function syncRunActivity(
  db: Database,
  source: ActivitySource,
  agentRunId: string,
  every = 8_000,
): Promise<boolean> {
  const [run] = await db
    .select({ session: agentRuns.implementerSession })
    .from(agentRuns)
    .where(eq(agentRuns.id, agentRunId));
  if (!run?.session) return false;
  // Claim the read: only one caller passes per window.
  const now = new Date();
  const [claimed] = await db
    .insert(runActivityReads)
    .values({ agentRunId, readAt: now })
    .onConflictDoUpdate({
      target: runActivityReads.agentRunId,
      set: { readAt: now },
      // Through the column, so the driver gets a timestamp, not a raw Date.
      setWhere: lt(runActivityReads.readAt, new Date(now.getTime() - every)),
    })
    .returning({ readAt: runActivityReads.readAt });
  if (!claimed) return false;
  const [last] = await db
    .select({ at: runActivity.at })
    .from(runActivity)
    .where(
      and(
        eq(runActivity.agentRunId, agentRunId),
        eq(runActivity.actor, "implementer"),
      ),
    )
    .orderBy(desc(runActivity.at))
    .limit(1);
  // A second back: results may share the last call's timestamp.
  const after = last ? new Date(last.at.getTime() - 1_000).toISOString() : null;
  await recordActivity(
    db,
    agentRunId,
    await source.activity(run.session, after),
  );
  return true;
}

/** A run's feed, oldest first. */
export async function runActivityLines(
  db: Database,
  agentRunId: string,
): Promise<ActivityLine[]> {
  const rows = await db
    .select()
    .from(runActivity)
    .where(eq(runActivity.agentRunId, agentRunId))
    .orderBy(asc(runActivity.at), asc(runActivity.createdAt));
  return rows.map((row) => ({
    externalId: row.externalId,
    at: row.at.toISOString(),
    actor: row.actor as ActivityLine["actor"],
    kind: row.kind as ActivityLine["kind"],
    detail: row.detail,
  }));
}
