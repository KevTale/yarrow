/**
 * Money rules from the brief. All amounts are integer USD cents.
 * credit = amount paid excluding VAT − actual Stripe fee − platform margin.
 */
export const PLATFORM_MARGIN_BPS = 1000; // 10% (hypothesis)
export const FOUNDING_MARGIN_BPS = 500; // Founding sponsors, for life (hypothesis)

/** Display-only estimate of a US card fee. Settlement uses the real fee. */
const ESTIMATED_FEE_BPS = 290;
const ESTIMATED_FEE_FIXED_CENTS = 30;

function cents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`Invalid ${label}`);
}

export function marginCents(
  amountExcludingTaxCents: number,
  founding: boolean,
) {
  cents(amountExcludingTaxCents, "amount");
  const bps = founding ? FOUNDING_MARGIN_BPS : PLATFORM_MARGIN_BPS;
  return Math.round((amountExcludingTaxCents * bps) / 10_000);
}

export interface Breakdown {
  amountCents: number;
  taxCents: number;
  feeCents: number;
  marginCents: number;
  creditCents: number;
}

/** The authoritative split, from the amounts Stripe actually reports. */
export function settleBreakdown(input: {
  amountCents: number;
  taxCents: number;
  feeCents: number;
  founding: boolean;
}): Breakdown {
  cents(input.amountCents, "amount");
  cents(input.taxCents, "tax");
  cents(input.feeCents, "fee");
  if (input.taxCents > input.amountCents) throw new Error("Tax exceeds amount");
  const excludingTax = input.amountCents - input.taxCents;
  const margin = marginCents(excludingTax, input.founding);
  return {
    amountCents: input.amountCents,
    taxCents: input.taxCents,
    feeCents: input.feeCents,
    marginCents: margin,
    creditCents: Math.max(0, excludingTax - input.feeCents - margin),
  };
}

/**
 * Checkout preview. `vatRateBps` is 0 for businesses and outside the EU,
 * e.g. 2000 for a French consumer (prices are VAT-inclusive).
 */
export function estimateBreakdown(
  amountCents: number,
  options: { vatRateBps?: number; founding?: boolean } = {},
): Breakdown {
  cents(amountCents, "amount");
  const vat = options.vatRateBps ?? 0;
  const taxCents =
    vat > 0
      ? amountCents - Math.round((amountCents * 10_000) / (10_000 + vat))
      : 0;
  const feeCents =
    Math.round((amountCents * ESTIMATED_FEE_BPS) / 10_000) +
    ESTIMATED_FEE_FIXED_CENTS;
  return settleBreakdown({
    amountCents,
    taxCents,
    feeCents,
    founding: options.founding ?? false,
  });
}

/**
 * What a run costs on average before Yarrow has finished any: the figure
 * every "≈ N pull requests" starts from (hypothesis, replaced by the real
 * average as soon as runs finish).
 */
export const TYPICAL_RUN_COST_CENTS = 300;

/**
 * About how many pull requests a credit buys at the average cost of a run,
 * never less than one for a credit above zero.
 */
export function pullRequestsFor(
  creditCents: number,
  averageRunCents: number | null,
): number {
  cents(creditCents, "credit");
  if (creditCents === 0) return 0;
  const average =
    averageRunCents && averageRunCents > 0
      ? averageRunCents
      : TYPICAL_RUN_COST_CENTS;
  return Math.max(1, Math.round(creditCents / average));
}
