/**
 * Reads what was actually paid from Stripe objects. Kept free of the SDK so
 * it can be tested with plain JSON fixtures.
 */
export interface PaidSession {
  id: string;
  amount_total: number | null;
  currency: string | null;
  payment_status: string;
  total_details?: { amount_tax?: number | null } | null;
  payment_intent:
    | string
    | {
        id: string;
        latest_charge:
          | string
          | null
          | {
              balance_transaction:
                | string
                | null
                | {
                    fee: number;
                    currency: string;
                    exchange_rate: number | null;
                  };
            };
      }
    | null;
}

export interface Settlement {
  stripeCheckoutId: string;
  stripePaymentIntentId: string;
  amountCents: number;
  taxCents: number;
  feeCents: number;
}

/**
 * The Stripe fee in USD cents. A French EURL settles in EUR: the balance
 * transaction is then in EUR and carries the USD→EUR exchange rate.
 */
export function feeInUsdCents(balance: {
  fee: number;
  currency: string;
  exchange_rate: number | null;
}): number {
  if (balance.currency.toLowerCase() === "usd") return balance.fee;
  if (!balance.exchange_rate)
    throw new Error(
      `Fee in ${balance.currency} without an exchange rate cannot be converted`,
    );
  return Math.round(balance.fee / balance.exchange_rate);
}

/** Null when the session is not paid yet (async payment methods). */
export function settlementFromSession(session: PaidSession): Settlement | null {
  if (session.payment_status !== "paid") return null;
  if ((session.currency ?? "usd").toLowerCase() !== "usd")
    throw new Error("Agent Commons only charges in USD");
  const intent = session.payment_intent;
  if (!intent || typeof intent === "string")
    throw new Error("Expand payment_intent.latest_charge.balance_transaction");
  const charge = intent.latest_charge;
  if (!charge || typeof charge === "string")
    throw new Error("Expand payment_intent.latest_charge.balance_transaction");
  const balance = charge.balance_transaction;
  if (!balance || typeof balance === "string")
    throw new Error("The balance transaction is not available yet");
  return {
    stripeCheckoutId: session.id,
    stripePaymentIntentId: intent.id,
    amountCents: session.amount_total ?? 0,
    taxCents: session.total_details?.amount_tax ?? 0,
    feeCents: feeInUsdCents(balance),
  };
}
