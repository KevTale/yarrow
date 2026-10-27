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
/** The card with no description; each line of description adds to it. */
export const PR_CARD_MIN_HEIGHT = 116;

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

/** The card's own colors: dark on light pages, light on dark ones. */
export type PrCardTheme = "dark" | "light";

const palettes = {
  dark: {
    background: "#111215",
    border: "#25282e",
    label: "#f2b544",
    name: "#edeef0",
    text: "#bdc1c9",
    muted: "#8a909b",
    tile: "#17191d",
    tileBorder: "#2a2e35",
  },
  light: {
    background: "#ffffff",
    border: "#d0d7de",
    label: "#a8660a",
    name: "#1f2328",
    text: "#424a53",
    muted: "#6e7781",
    tile: "#f6f8fa",
    tileBorder: "#d0d7de",
  },
} as const;

/** Where the description's lines start and end. */
const TEXT_X = 88;
const TEXT_RIGHT = 24;
const DESCRIPTION_SIZE = 13;
const DESCRIPTION_LINE = 18;

/**
 * About how wide a character is in the reader's system sans, in em. The
 * card cannot measure text (it is an image, with no font of its own), so
 * lines are broken on a generous estimate rather than cut.
 */
function charWidth(char: string): number {
  if (char === " ") return 0.28;
  if ("ijlI.,:;'!|ftr()[]".includes(char)) return 0.32;
  if ("mwMW@".includes(char)) return 0.86;
  if (/[A-Z]/.test(char)) return 0.68;
  if (/[0-9]/.test(char)) return 0.57;
  return 0.55;
}

/** The text broken into lines that fit `width` pixels; never cut. */
export function wrapText(text: string, width: number, size: number): string[] {
  const words = text.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const measure = (value: string) =>
    [...value].reduce((sum, char) => sum + charWidth(char), 0) * size;
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * The first sponsor large, "+N" for the others. Fonts are the reader's
 * system ones (GitHub's own stack): an image cannot load web fonts. The
 * description is never cut: it wraps and the card grows. `links` makes the
 * site and "Yarrow" open their pages where the SVG sits in a page (an
 * image in a pull request carries one link, set around it).
 */
export function prCardSvg(input: {
  sponsors: readonly PrCardSponsor[];
  theme?: PrCardTheme;
  links?: { site?: string | null; yarrow?: string };
}): string {
  const [first, ...rest] = input.sponsors;
  const sponsor: PrCardSponsor = first ?? {
    name: null,
    description: null,
    site: null,
    logo: null,
  };
  const color = palettes[input.theme ?? "dark"];
  const name = sponsor.name ? clip(sponsor.name, 38) : "Anonymous sponsor";
  const initial = (sponsor.name?.trim()[0] ?? "?").toUpperCase();
  const w = PR_CARD_WIDTH;
  const description =
    sponsor.name && sponsor.description
      ? wrapText(sponsor.description, w - TEXT_X - TEXT_RIGHT, DESCRIPTION_SIZE)
      : [];
  const site = sponsor.name && sponsor.site ? clip(sponsor.site, 40) : null;
  const more = rest.length;
  const sans =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif";
  const mono =
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace";

  // Baselines, top to bottom: the name, each line of description, the site.
  const nameY = description.length || site ? 62 : 74;
  const descriptionY = (i: number) => 82 + i * DESCRIPTION_LINE;
  const siteY = description.length
    ? descriptionY(description.length - 1) + 19
    : 84;
  const lastY = site
    ? siteY
    : description.length
      ? descriptionY(description.length - 1)
      : nameY;
  const h = Math.max(PR_CARD_MIN_HEIGHT, lastY + 17);

  const link = (href: string | null | undefined, body: string) =>
    href
      ? `<a href="${escape(href)}" target="_blank">${body}</a>`
      : body;

  const logo = sponsor.logo
    ? `<image href="${escape(sponsor.logo)}" x="24" y="44" width="48" height="48" preserveAspectRatio="xMidYMid slice" clip-path="url(#logo)"/>`
    : `<rect x="24" y="44" width="48" height="48" rx="12" fill="${color.tile}" stroke="${color.tileBorder}"/>
  <text x="48" y="75" text-anchor="middle" font-family="${sans}" font-size="20" font-weight="600" fill="${color.text}">${escape(initial)}</text>`;

  const lines = [
    `<text x="${TEXT_X}" y="${nameY}" font-family="${sans}" font-size="18" font-weight="600" fill="${color.name}">${escape(name)}</text>`,
    ...description.map(
      (line, i) =>
        `<text x="${TEXT_X}" y="${descriptionY(i)}" font-family="${sans}" font-size="${DESCRIPTION_SIZE}" fill="${color.text}">${escape(line)}</text>`,
    ),
    site
      ? link(
          input.links?.site,
          `<text x="${TEXT_X}" y="${siteY}" font-family="${mono}" font-size="12" fill="${color.muted}">${escape(site)}</text>`,
        )
      : "",
  ].join("\n  ");

  const yarrow = link(
    input.links?.yarrow,
    `<tspan font-weight="600" fill="${color.name}">Yarrow</tspan>`,
  );

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${escape(`Sponsored by ${name}${more ? ` and ${more} more` : ""}, powered by Yarrow`)}">
  <defs>
    <clipPath id="logo"><rect x="24" y="44" width="48" height="48" rx="12"/></clipPath>
    <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#f2b544" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#f2b544" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="${color.background}" stroke="${color.border}"/>
  <rect x="1" y="1" width="${w - 2}" height="2" rx="1" fill="url(#edge)"/>
  <text x="24" y="28" font-family="${mono}" font-size="11" letter-spacing="1.2" fill="${color.label}">SPONSORED BY</text>
  <text x="${w - 24}" y="28" text-anchor="end" font-family="${sans}" font-size="12" fill="${color.muted}">Powered by ${yarrow}</text>
  ${logo}
  ${lines}
  ${more ? `<text x="${w - 24}" y="74" text-anchor="end" font-family="${sans}" font-size="13" fill="${color.text}">+${more} sponsor${more === 1 ? "" : "s"}</text>` : ""}
</svg>`;
}
