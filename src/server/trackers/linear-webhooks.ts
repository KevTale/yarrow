import type { Database } from "../../db/client";
import { connectionsOfWorkspace } from "../../db/trackers";
import { hmacSha256Hex, safeEqual } from "../github/app";
import type { TrackerContext } from "./context";
import { followTicket } from "./follow";

/**
 * Linear's webhook: a label set in Linear itself queues the ticket in
 * seconds, as GitHub's and Jira's do; the 5-minute sync stays as the
 * safety net. Nothing to register: the webhook set in the OAuth app's
 * settings reaches Yarrow for every workspace that allowed it.
 */

/**
 * Linear signs the raw body (HMAC-SHA256, hex, `Linear-Signature`) and
 * stamps the delivery; one older than a minute is a replay.
 */
export async function verifyLinearWebhook(
  secret: string,
  body: string,
  signature: string | null,
  now = Date.now(),
): Promise<boolean> {
  if (!signature) return false;
  if (!safeEqual(await hmacSha256Hex(secret, body), signature)) return false;
  try {
    const { webhookTimestamp } = JSON.parse(body) as {
      webhookTimestamp?: number;
    };
    return (
      typeof webhookTimestamp === "number" &&
      Math.abs(now - webhookTimestamp) <= 60_000
    );
  } catch {
    return false;
  }
}

export interface LinearDelivery {
  type?: string;
  action?: string;
  organizationId?: string;
  data?: { identifier?: string };
}

/** One delivery about an issue, followed on each connection to its workspace. */
export async function handleLinearDelivery(
  db: Database,
  ctx: TrackerContext,
  delivery: LinearDelivery,
): Promise<{ queued: boolean; log: string[] }> {
  const key = delivery.data?.identifier;
  if (delivery.type !== "Issue" || !key || !delivery.organizationId)
    return { queued: false, log: ["not an issue"] };
  let queued = false;
  const log: string[] = [];
  for (const connection of await connectionsOfWorkspace(
    db,
    "linear",
    delivery.organizationId,
  )) {
    const result = await followTicket(db, ctx, connection, key);
    queued ||= result.queued;
    log.push(...result.log);
  }
  return { queued, log };
}
