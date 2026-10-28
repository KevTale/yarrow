import { and, eq, isNull, like, lt, sql } from "drizzle-orm";
import { fundingMinute } from "../core/daily-funding";
import { settleBreakdown } from "../core/pricing";
import type { Database } from "./client";
import { recordEvent } from "./events";
import { startOfUtcDay } from "./boards";
import {
  contributions,
  dailyFundings,
  ledgerEntries,
  sponsorProfiles,
} from "./schema";

/** Created when the Checkout Session is created. Never spendable until settled. */
export async function createPendingContribution(
  db: Database,
  input: {
    userId: string;
    amountCents: number;
    stripeCheckoutId: string;
    withdrawalWaiverAt: Date;
  },
): Promise<string> {
  const [row] = await db
    .insert(contributions)
    .values({
      userId: input.userId,
      source: "stripe",
      paymentStatus: "pending",
      amountCents: input.amountCents,
      creditCents: 0,
      stripeCheckoutId: input.stripeCheckoutId,
      withdrawalWaiverAt: input.withdrawalWaiverAt,
    })
    .returning({ id: contributions.id });
  await recordEvent(db, {
    type: "contribution.created",
    userId: input.userId,
    payload: { amountCents: input.amountCents },
  });
  return row!.id;
}

/**
 * Settles a paid Checkout Session with the amounts Stripe reports (amount,
 * tax, actual fee). Idempotent: webhook redeliveries change nothing.
 * Returns false when no pending contribution matches the session.
 */
export async function settleStripeContribution(
  db: Database,
  input: {
    stripeCheckoutId: string;
    stripePaymentIntentId: string;
    amountCents: number;
    taxCents: number;
    feeCents: number;
  },
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [contribution] = await tx
      .select()
      .from(contributions)
      .where(eq(contributions.stripeCheckoutId, input.stripeCheckoutId))
      .for("update");
    if (!contribution) return false;
    if (contribution.paymentStatus !== "pending") return true;
    const [profile] = await tx
      .select({ founding: sponsorProfiles.foundingSponsor })
      .from(sponsorProfiles)
      .where(eq(sponsorProfiles.userId, contribution.userId));
    const breakdown = settleBreakdown({
      amountCents: input.amountCents,
      taxCents: input.taxCents,
      feeCents: input.feeCents,
      founding: profile?.founding ?? false,
    });
    await tx
      .update(contributions)
      .set({
        paymentStatus: "settled",
        stripePaymentIntentId: input.stripePaymentIntentId,
        amountCents: breakdown.amountCents,
        taxCents: breakdown.taxCents,
        feeCents: breakdown.feeCents,
        marginCents: breakdown.marginCents,
        creditCents: breakdown.creditCents,
      })
      .where(eq(contributions.id, contribution.id));
    await tx.insert(ledgerEntries).values({
      contributionId: contribution.id,
      kind: "credit",
      amountCents: breakdown.creditCents,
      idempotencyKey: `${contribution.id}:credit`,
    });
    await recordEvent(tx, {
      type: "contribution.settled",
      userId: contribution.userId,
      payload: { ...breakdown },
    });
    return true;
  });
}

/** An expired or abandoned Checkout Session: the pending row is removed. */
export async function discardPendingContribution(
  db: Database,
  stripeCheckoutId: string,
): Promise<void> {
  await db
    .delete(contributions)
    .where(
      sql`${contributions.stripeCheckoutId} = ${stripeCheckoutId} and ${contributions.paymentStatus} = 'pending'`,
    );
}

/**
 * A refund or a lost dispute. Compute already reserved or spent cannot be
 * returned, so the remaining credit is frozen; a contribution with no spend
 * is marked refunded and leaves the leaderboard.
 */
export async function refundContribution(
  db: Database,
  stripePaymentIntentId: string,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [contribution] = await tx
      .select()
      .from(contributions)
      .where(eq(contributions.stripePaymentIntentId, stripePaymentIntentId))
      .for("update");
    if (!contribution || contribution.paymentStatus === "refunded") return;
    const spent = contribution.reservedCents + contribution.debitedCents;
    const frozen = contribution.creditCents - spent;
    await tx
      .update(contributions)
      .set(
        spent === 0
          ? { paymentStatus: "refunded", creditCents: 0 }
          : { creditCents: spent },
      )
      .where(eq(contributions.id, contribution.id));
    await recordEvent(tx, {
      type: "contribution.refunded",
      userId: contribution.userId,
      payload: { frozenCents: frozen, alreadySpentCents: spent },
    });
  });
}

/**
 * Each daily funding's credit for today (UTC), settled once its minute of
 * the window has come: no fee, no tax, no margin. Idempotent: the cron runs
 * every minute and a day is credited once. Returns the users credited by
 * this call.
 */
export async function fundDaily(
  db: Database,
  now = new Date(),
): Promise<string[]> {
  const day = startOfUtcDay(now);
  const date = day.toISOString().slice(0, 10);
  const minute = Math.floor((now.getTime() - day.getTime()) / 60_000);
  const key = (userId: string) => `daily:${userId}:${date}`;
  const fundings = await db
    .select()
    .from(dailyFundings)
    .where(isNull(dailyFundings.pausedAt));
  const credited: string[] = [];
  for (const funding of fundings) {
    const at = fundingMinute(funding.userId, date, {
      start: funding.windowStart,
      end: funding.windowEnd,
    });
    if (minute < at) continue;
    const done = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(contributions)
        .values({
          userId: funding.userId,
          source: "direct",
          paymentStatus: "settled",
          directKey: key(funding.userId),
          amountCents: funding.amountCents,
          creditCents: funding.amountCents,
          createdAt: now,
        })
        .onConflictDoNothing({ target: contributions.directKey })
        .returning({ id: contributions.id });
      if (!row) return false;
      await tx.insert(ledgerEntries).values({
        contributionId: row.id,
        kind: "credit",
        amountCents: funding.amountCents,
        idempotencyKey: `${row.id}:credit`,
      });
      await recordEvent(tx, {
        type: "contribution.settled",
        userId: funding.userId,
        payload: { source: "direct", creditCents: funding.amountCents },
      });
      return true;
    });
    if (done) credited.push(funding.userId);
  }
  return credited;
}

/**
 * A daily funding's credit is for its day: at midnight UTC what it left
 * unspent expires, so unused days never pile up into a balance. Compute
 * reserved by a run at work stays until the run settles; whatever it
 * releases then expires at the next pass. Returns the cents expired.
 */
export async function expireDailyCredit(
  db: Database,
  now = new Date(),
): Promise<number> {
  return db.transaction(async (tx) => {
    const spent = sql`(${contributions.reservedCents} + ${contributions.debitedCents})`;
    const rows = await tx
      .select({
        id: contributions.id,
        userId: contributions.userId,
        unspent: sql<number>`(${contributions.creditCents} - ${spent})::int`,
      })
      .from(contributions)
      .where(
        and(
          eq(contributions.source, "direct"),
          like(contributions.directKey, "daily:%"),
          lt(contributions.createdAt, startOfUtcDay(now)),
          sql`${contributions.creditCents} > ${spent}`,
        ),
      )
      .for("update");
    let expired = 0;
    for (const row of rows) {
      await tx
        .update(contributions)
        .set({ creditCents: sql`${spent}` })
        .where(eq(contributions.id, row.id));
      await recordEvent(tx, {
        type: "contribution.expired",
        userId: row.userId,
        payload: { expiredCents: row.unspent },
      });
      expired += row.unspent;
    }
    return expired;
  });
}
