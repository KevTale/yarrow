/**
 * The card that closes every pull request: who paid for it, drawn as their
 * row on the boards. One SVG for the pull request (served by
 * `/pr-card/$runId`, every image inlined, since GitHub's image proxy loads
 * nothing else) and for the previews on the landing (inlined in the page).
 * No I/O here.
 */

export interface PrCardSponsor {
  /** Null for an anonymous sponsor. */
  name: string | null;
  description: string | null;
  /** "acme.com", already shortened. */
  site: string | null;
  /** A data: URL in pull requests; any URL in the page's own previews. */
  logo: string | null;
}

export const PR_CARD_WIDTH = 640;
export const PR_CARD_HEIGHT = 116;

function escape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Cut to `max` characters with an ellipsis: SVG text does not wrap. */
function clip(text: string, max: number): string {
  const value = text.trim().replace(/\s+/g, " ");
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;
}

/** "https://www.acme.com/pricing" → "acme.com". */
export function shortSite(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * The first sponsor large, "+N" for the others. Fonts are the reader's
 * system ones (GitHub's own stack): an image cannot load web fonts.
 */
export function prCardSvg(input: {
  sponsors: readonly PrCardSponsor[];
}): string {
  const [first, ...rest] = input.sponsors;
  const sponsor: PrCardSponsor = first ?? {
    name: null,
    description: null,
    site: null,
    logo: null,
  };
  const name = sponsor.name ? clip(sponsor.name, 38) : "Anonymous sponsor";
  const initial = (sponsor.name?.trim()[0] ?? "?").toUpperCase();
  const description =
    sponsor.name && sponsor.description ? clip(sponsor.description, 72) : null;
  const site = sponsor.name && sponsor.site ? clip(sponsor.site, 40) : null;
  const more = rest.length;
  const sans =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";
  const mono =
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";
  const w = PR_CARD_WIDTH;
  const h = PR_CARD_HEIGHT;

  const logo = sponsor.logo
    ? `<image href="${escape(sponsor.logo)}" x="24" y="44" width="48" height="48" preserveAspectRatio="xMidYMid slice" clip-path="url(#logo)"/>`
    : `<rect x="24" y="44" width="48" height="48" rx="12" fill="#17191d" stroke="#2a2e35"/>
  <text x="48" y="75" text-anchor="middle" font-family="${sans}" font-size="20" font-weight="600" fill="#bdc1c9">${escape(initial)}</text>`;

  const lines = [
    `<text x="88" y="${description || site ? 62 : 74}" font-family="${sans}" font-size="18" font-weight="600" fill="#edeef0">${escape(name)}</text>`,
    description
      ? `<text x="88" y="${site ? 81 : 84}" font-family="${sans}" font-size="13" fill="#bdc1c9">${escape(description)}</text>`
      : "",
    site
      ? `<text x="88" y="${description ? 99 : 84}" font-family="${mono}" font-size="12" fill="#8a909b">${escape(site)}</text>`
      : "",
  ].join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(`Paid for by ${name}${more ? ` and ${more} more` : ""} on Yarrow`)}">
  <defs>
    <clipPath id="logo"><rect x="24" y="44" width="48" height="48" rx="12"/></clipPath>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f2b544" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#f2b544" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="#111215" stroke="#25282e"/>
  <rect x="1" y="1" width="${w - 2}" height="2" rx="1" fill="url(#edge)"/>
  <text x="24" y="28" font-family="${mono}" font-size="11" letter-spacing="1.2" fill="#f2b544">PAID FOR BY</text>
  <text x="${w - 24}" y="28" text-anchor="end" font-family="${sans}" font-size="12" fill="#8a909b">Free AI pull requests · yarrow.run</text>
  ${logo}
  ${lines}
  ${more ? `<text x="${w - 24}" y="74" text-anchor="end" font-family="${sans}" font-size="13" fill="#bdc1c9">+${more} sponsor${more === 1 ? "" : "s"}</text>` : ""}
</svg>`;
}
