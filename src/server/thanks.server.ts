import { and, eq, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import { recordEvent } from "@/db/events";
import { contributions, events } from "@/db/schema";
import { sponsorStandings } from "@/db/sponsor-dashboard";
import { isGuestSponsor, recordGuestEmail } from "@/db/sponsors";
import { emailConfigured, sendThanks, signInLink } from "./email.server";
import { appEnv } from "./env.server";
import { sendSignInLink } from "./sign-in.server";

const DASHBOARD = "/dashboard?tab=sponsor";

/**
 * After a payment settles: thanks the sponsor once, with their place on the
 * boards. A guest's button signs them in (the email proves the address);
 * a member's opens the dashboard. Stripe retries the webhook, so a payment
 * already thanked is skipped.
 */
export async function thankSponsor(
  db: Database,
  checkoutId: string,
  email: string,
): Promise<string> {
  const firstGuestEmail = await recordGuestEmail(db, checkoutId, email);
  // Read after recordGuestEmail: a guest's payment may have joined an earlier one.
  const [payment] = await db
    .select({
      id: contributions.id,
      userId: contributions.userId,
      amountCents: contributions.amountCents,
    })
    .from(contributions)
    .where(eq(contributions.stripeCheckoutId, checkoutId));
  if (!payment) return "unknown payment";
  const [thanked] = await db
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.type, "sponsor.thanked"),
        sql`${events.payload}->>'contributionId' = ${payment.id}`,
      ),
    );
  if (thanked) return "already thanked";

  if (!emailConfigured()) {
    // Without Resend, a guest still gets Supabase's plain sign-in email.
    if (!firstGuestEmail) return "no email to send";
    await sendSignInLink(email, DASHBOARD);
    return "sign-in link sent";
  }
  const guest = await isGuestSponsor(db, payment.userId);
  const { today, all } = await sponsorStandings(db, payment.userId);
  await sendThanks({
    to: email,
    amountCents: payment.amountCents,
    todayRank: today.rank,
    allRank: all.rank,
    link: guest
      ? await signInLink(email, DASHBOARD)
      : `${appEnv().APP_URL}${DASHBOARD}`,
  });
  await recordEvent(db, {
    type: "sponsor.thanked",
    userId: payment.userId,
    payload: { contributionId: payment.id, guest },
  });
  return "thanks sent";
}
