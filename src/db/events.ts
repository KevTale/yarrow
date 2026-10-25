import type { Database } from "./client";
import { events } from "./schema";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type EventType =
  | "account.created"
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
  | "work_unit.queued"
  | "work_unit.unqueued"
  | "correction.requested"
  | "run.started"
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
