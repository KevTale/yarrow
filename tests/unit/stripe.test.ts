import { describe, expect, it } from "vitest";
import {
  feeInUsdCents,
  settlementFromSession,
  type PaidSession,
} from "../../src/server/stripe/settlement";

const session = (overrides: Partial<PaidSession> = {}): PaidSession => ({
  id: "cs_1",
  amount_total: 10_000,
  currency: "usd",
  payment_status: "paid",
  total_details: { amount_tax: 1_667 },
  payment_intent: {
    id: "pi_1",
    latest_charge: {
      balance_transaction: { fee: 320, currency: "usd", exchange_rate: null },
    },
  },
  ...overrides,
});

describe("Stripe settlement", () => {
  it("reads amount, VAT and the real fee", () => {
    expect(settlementFromSession(session())).toEqual({
      stripeCheckoutId: "cs_1",
      stripePaymentIntentId: "pi_1",
      amountCents: 10_000,
      taxCents: 1_667,
      feeCents: 320,
    });
  });
  it("converts a fee settled in EUR back to USD cents", () => {
    // $100 charged, settled as €92.00 at 0.92 EUR per USD, fee €2.94.
    expect(
      feeInUsdCents({ fee: 294, currency: "eur", exchange_rate: 0.92 }),
    ).toBe(320);
    expect(() =>
      feeInUsdCents({ fee: 294, currency: "eur", exchange_rate: null }),
    ).toThrow();
  });
  it("waits for async payments and refuses other currencies", () => {
    expect(
      settlementFromSession(session({ payment_status: "unpaid" })),
    ).toBeNull();
    expect(() => settlementFromSession(session({ currency: "eur" }))).toThrow();
    expect(() =>
      settlementFromSession(session({ payment_intent: "pi_unexpanded" })),
    ).toThrow("Expand");
  });
});
