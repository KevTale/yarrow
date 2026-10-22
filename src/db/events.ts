import type { Database } from "./client";
import { events } from "./schema";

export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type EventType =
  | "run.started"
  | "run.reserved_more"
  | "run.finished"
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
