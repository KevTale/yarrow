import { and, eq, sql } from "drizzle-orm";
import { TERMS_VERSION } from "../core/terms";
import type { Database } from "./client";
import { events } from "./schema";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type EventType =
  | "account.created"
  | "account.deleted"
  | "account.email_changed"
  | "admin.daily_funding_saved"
  | "builder.terms_accepted"
  | "project.created"
  | "project.updated"
  | "project.github_linked"
  | "project.suspended"
  | "tracker.connected"
  | "sponsor.filters_updated"
  | "sponsor.clicked"
  | "sponsor.guest_claimed"
  | "sponsor.thanked"
  | "contribution.created"
  | "contribution.settled"
  | "contribution.refunded"
  | "contribution.expired"
  | "work_unit.queued"
  | "work_unit.unqueued"
  | "correction.requested"
  | "run.started"
  | "run.restarted"
  | "run.reserved_more"
  | "run.finished"
  | "run.failed"
  | "pull_request.merged"
  | "pull_request.closed";

export interface EventInput {
  type: EventType;
  accountId?: string;
  projectId?: string;
  userId?: string;
  workUnitId?: string;
  agentRunId?: string;
  payload?: Record<string, unknown>;
}

/** Append-only. Write events inside the transaction that performs the action. */
export async function recordEvent(
  db: Database | Transaction,
  event: EventInput,
): Promise<void> {
  await db.insert(events).values(event);
}

/**
 * Whether the user ticked the Terms (the sponsors' card included) in their
 * current version: the proof of consent is the event itself.
 */
export async function termsAccepted(
  db: Database,
  userId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.type, "builder.terms_accepted"),
        eq(events.userId, userId),
        sql`${events.payload}->>'terms' = ${TERMS_VERSION}`,
      ),
    )
    .limit(1);
  return Boolean(row);
}
