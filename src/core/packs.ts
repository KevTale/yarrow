import { z } from "zod";

export const packs = [
  {
    id: "starter",
    name: "Starter",
    amountCents: 1_000,
    description: "Ship a first ticket.",
  },
  {
    id: "builder",
    name: "Builder",
    amountCents: 2_500,
    description: "Keep good work moving.",
  },
  {
    id: "sprint",
    name: "Sprint",
    amountCents: 10_000,
    description: "Give builders momentum.",
  },
] as const;
export type PackId = (typeof packs)[number]["id"];

/** Custom amounts: whole dollars, $10 to $1,000. */
export const MIN_AMOUNT_CENTS = 1_000;
export const MAX_AMOUNT_CENTS = 100_000;

export const amountCentsSchema = z
  .number()
  .int()
  .min(MIN_AMOUNT_CENTS, "The minimum is $10.")
  .max(MAX_AMOUNT_CENTS, "The maximum is $1,000.")
  .refine((cents) => cents % 100 === 0, "Use whole dollars.");

export function money(cents: number, decimals = true): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(cents / 100);
}
