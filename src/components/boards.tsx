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

export const plural = (n: number, word: string) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/** "Anonymous sponsor" in place of a name. */
export function SponsorName({ name }: { name: string | null }) {
  return name ? <b>{name}</b> : <b className="anonymous">Anonymous sponsor</b>;
}
