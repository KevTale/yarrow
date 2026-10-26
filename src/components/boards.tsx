import { money } from "@/core/packs";

export type SponsorRow = {
  publicId: string;
  /** Null for an anonymous sponsor. */
  name: string | null;
  tagline: string | null;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  paidCents: number;
  creditCents: number;
  spentCents: number;
  clicks: number;
  tickets: number;
  pullRequests: number;
  merged: number;
};

export function Logo({
  name,
  url,
  size,
}: {
  /** Null for an anonymous sponsor. */
  name: string | null;
  url?: string | null;
  size: "large" | "small";
}) {
  if (name === null)
    return (
      <span className={`board-logo ${size} anonymous`} aria-hidden="true">
        ?
      </span>
    );
  if (url)
    return (
      <img className={`board-logo ${size}`} src={url} alt="" loading="lazy" />
    );
  // No logo: the initial on a plain tile, never a loud color.
  return (
    <span className={`board-logo ${size} initial`} aria-hidden="true">
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const plural = (n: number, word: string) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** What a sponsor's money shipped: "5 merged PRs". */
export function Impact({ row }: { row: Pick<SponsorRow, "merged"> }) {
  return <span>{plural(row.merged, "merged PR")}</span>;
}

/** The amount paid, and under it how much of its credit is already work. */
export function Paid({
  row,
}: {
  row: Pick<SponsorRow, "paidCents" | "creditCents" | "spentCents">;
}) {
  const share = row.creditCents
    ? Math.min(100, Math.round((row.spentCents / row.creditCents) * 100))
    : 0;
  return (
    <span className="board-amount">
      {money(row.paidCents, false)}
      {row.spentCents > 0 && (
        <span className="board-spent">
          <span className="board-spent-bar" aria-hidden="true">
            <i style={{ width: `${share}%` }} />
          </span>
          {money(row.spentCents)} spent
        </span>
      )}
    </span>
  );
}

/** "Anonymous sponsor" in place of a name. */
export function SponsorName({ name }: { name: string | null }) {
  return name ? <b>{name}</b> : <b className="anonymous">Anonymous sponsor</b>;
}
