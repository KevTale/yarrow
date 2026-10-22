export const packs = [
  {
    id: "starter",
    name: "Starter",
    amountCents: 500,
    description: "Start something small.",
    estimate: "A first issue, a real beginning.",
  },
  {
    id: "builder",
    name: "Builder",
    amountCents: 2000,
    description: "Keep good work moving.",
    estimate: "A little more room to build.",
  },
  {
    id: "sprint",
    name: "Sprint",
    amountCents: 10000,
    description: "Give a project momentum.",
    estimate: "Back a bigger stretch of work.",
  },
] as const;
export type PackId = (typeof packs)[number]["id"];

export function money(cents: number, decimals = true): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  }).format(cents / 100);
}
