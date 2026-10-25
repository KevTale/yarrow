import Stripe from "stripe";
import type { Database } from "@/db/client";
import {
  createPendingContribution,
  discardPendingContribution,
  refundContribution,
  settleStripeContribution,
} from "@/db/contributions";
import { appEnv, NotConfiguredError } from "../env.server";
import { thankSponsor } from "../thanks.server";
import { settlementFromSession, type PaidSession } from "./settlement";

function stripeClient(): Stripe {
  const key = appEnv().STRIPE_SECRET_KEY;
  if (!key) throw new NotConfiguredError("Payments (STRIPE_SECRET_KEY)");
  return new Stripe(key, { httpClient: Stripe.createFetchHttpClient() });
}

export function paymentsConfigured(): boolean {
  return Boolean(appEnv().STRIPE_SECRET_KEY);
}

/**
 * A Checkout Session for compute credit. Prices are VAT-inclusive for EU
 * consumers; EU businesses with a VAT number are reverse-charged.
 */
export async function createCheckout(
  db: Database,
  input: {
    userId: string;
    email: string | null;
    amountCents: number;
    /** Where Stripe sends the sponsor back, e.g. /leaderboard?checkout=success */
    successPath: string;
  },
): Promise<string> {
  const env = appEnv();
  const stripe = stripeClient();
  const tax = env.STRIPE_TAX === "on";
  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    client_reference_id: input.userId,
    customer_email: input.email ?? undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: input.amountCents,
          tax_behavior: "inclusive",
          product_data: {
            name: "Yarrow compute credit",
            description:
              "Sponsoring of AI compute for builders' tickets. Non-refundable as cash once compute starts.",
          },
        },
      },
    ],
    automatic_tax: { enabled: tax },
    tax_id_collection: { enabled: tax },
    billing_address_collection: tax ? "required" : "auto",
    // A numbered invoice for every payment, emailed by Stripe.
    invoice_creation: { enabled: true },
    metadata: { userId: input.userId, kind: "compute_credit" },
    payment_intent_data: { metadata: { userId: input.userId } },
    success_url: `${env.APP_URL}${input.successPath}`,
    cancel_url: `${env.APP_URL}/fund?checkout=cancelled`,
  });
  if (!session.url) throw new Error("Stripe returned no checkout URL");
  await createPendingContribution(db, {
    userId: input.userId,
    amountCents: input.amountCents,
    stripeCheckoutId: session.id,
    withdrawalWaiverAt: new Date(),
  });
  return session.url;
}

/** Verifies and applies one Stripe webhook. Returns a log line. */
export async function handleStripeWebhook(
  db: Database,
  body: string,
  signature: string | null,
): Promise<string> {
  const secret = appEnv().STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new NotConfiguredError("Stripe webhooks");
  if (!signature) throw new Error("Missing Stripe-Signature");
  const stripe = stripeClient();
  const event = await stripe.webhooks.constructEventAsync(
    body,
    signature,
    secret,
    undefined,
    Stripe.createSubtleCryptoProvider(),
  );
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = await stripe.checkout.sessions.retrieve(
        event.data.object.id,
        { expand: ["payment_intent.latest_charge.balance_transaction"] },
      );
      const settlement = settlementFromSession(
        session as unknown as PaidSession,
      );
      if (!settlement) return "checkout not paid yet";
      const found = await settleStripeContribution(db, settlement);
      if (!found) return "unknown checkout session";
      const email = session.customer_details?.email;
      if (!email) return "contribution settled";
      // The payment stands either way; the email only thanks and signs in.
      const thanks = await thankSponsor(db, session.id, email).catch(
        (error: Error) => `thanks failed: ${error.message}`,
      );
      return `contribution settled, ${thanks}`;
    }
    case "checkout.session.expired":
    case "checkout.session.async_payment_failed":
      await discardPendingContribution(db, event.data.object.id);
      return "pending contribution discarded";
    case "charge.refunded":
    case "charge.dispute.created": {
      const intent = event.data.object.payment_intent;
      const id = typeof intent === "string" ? intent : intent?.id;
      if (id) await refundContribution(db, id);
      return "contribution refunded";
    }
    default:
      return `ignored: ${event.type}`;
  }
}
