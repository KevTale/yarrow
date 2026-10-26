/**
 * Generates the Yarrow logo files in public/brand/, and the favicons, app
 * icons and web manifest at the root of public/.
 *
 *   pnpm brand:assets
 *
 * The mark is five small yarrow florets around a pollen heart. Each floret is
 * itself five petals around a heart, so the whole repeats the part: what looks
 * like one flower is many small ones. The wordmark is "yarrow" in Jost Medium,
 * outlined so the logo files need no font. Change the parameters below and
 * rerun; never edit the generated files by hand.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import opentype from "opentype.js"; // UMD build: no named exports in Node

const OUT_DIR = "public/brand";
const SITE_DIR = "public";

// "Nuit" palette.
const NIGHT = "#141714";
const CREAM = "#F5F0E3";
const POLLEN = "#E6AE38";

// Geometry in design units, centred on the heart at (0, 0).
const FLORET_RADIUS = 18.5; // floret centre to the outer edge of a petal
const PETAL_DISTANCE = FLORET_RADIUS * (6.9 / 10.8);
const PETAL_RADIUS = FLORET_RADIUS * (3.9 / 10.8);
const FLORET_HEART_RADIUS = FLORET_RADIUS * (2.6 / 10.8);
// Ring radius of the first sketch (D0): 7 units between neighbouring florets.
const RING_D0 = (2 * FLORET_RADIUS + 7) / (2 * Math.sin(Math.PI / 5));
const RING = RING_D0 - 2; // florets pulled 2 units towards the heart
const HEART_RADIUS = (RING_D0 - FLORET_RADIUS - 7) * 0.8;

// Wordmark and logo (mark + wordmark).
const JOST = opentype.parse(
  readFileSync(
    "node_modules/@fontsource/jost/files/jost-latin-500-normal.woff",
  ),
);
const FONT_SIZE = 100; // design units per em
const TRACKING = -0.02; // em
const MARK_HEIGHT = 1.98; // in x-heights
const MARK_GAP = 0.3; // em, between the mark and the "y"

type Circle = { x: number; y: number; r: number; heart: boolean };

function markCircles(): Circle[] {
  const circles: Circle[] = [{ x: 0, y: 0, r: HEART_RADIUS, heart: true }];
  for (let k = 0; k < 5; k++) {
    const angle = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
    const fx = Math.cos(angle) * RING;
    const fy = Math.sin(angle) * RING;
    for (let i = 0; i < 5; i++) {
      // One petal of each floret points away from the heart.
      const a = angle + (i * 2 * Math.PI) / 5;
      circles.push({
        x: fx + Math.cos(a) * PETAL_DISTANCE,
        y: fy + Math.sin(a) * PETAL_DISTANCE,
        r: PETAL_RADIUS,
        heart: false,
      });
    }
    circles.push({ x: fx, y: fy, r: FLORET_HEART_RADIUS, heart: true });
  }
  return circles;
}

const CIRCLES = markCircles();
const MIN_X = Math.min(...CIRCLES.map((c) => c.x - c.r));
const MAX_X = Math.max(...CIRCLES.map((c) => c.x + c.r));
const MIN_Y = Math.min(...CIRCLES.map((c) => c.y - c.r));
const MAX_Y = Math.max(...CIRCLES.map((c) => c.y + c.r));
// The pentagon points up, so its box sits higher than the heart. Centring on
// a point halfway between the box centre and the heart looks balanced.
const OPTICAL_X = (MIN_X + MAX_X) / 2;
const OPTICAL_Y = (MIN_Y + MAX_Y) / 4;

const num = (v: number, digits = 2) => Number(v.toFixed(digits)).toString();

const svg = (viewBox: string, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>\n`;

function shapes(petal: string, heart: string): string {
  const circle = (c: Circle) =>
    `<circle cx="${num(c.x)}" cy="${num(c.y)}" r="${num(c.r)}"/>`;
  const petals = CIRCLES.filter((c) => !c.heart).map(circle);
  const hearts = CIRCLES.filter((c) => c.heart).map(circle);
  if (petal === heart)
    return `<g fill="${petal}">${[...petals, ...hearts].join("")}</g>`;
  return `<g fill="${petal}">${petals.join("")}</g><g fill="${heart}">${hearts.join("")}</g>`;
}

function markSvg(petal: string, heart: string): string {
  const viewBox = [MIN_X, MIN_Y, MAX_X - MIN_X, MAX_Y - MIN_Y]
    .map((v) => num(v))
    .join(" ");
  return svg(viewBox, shapes(petal, heart));
}

const WORD = JOST.getPath("yarrow", 0, 0, FONT_SIZE, {
  kerning: true,
  letterSpacing: TRACKING,
});
// Serialised here: opentype.js's toPathData writes NaN for coordinates with
// float noise (e.g. 47.300000000000004).
type PathCommand = {
  type: string;
  x: number;
  y: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};
const WORD_PATH = (WORD.commands as PathCommand[])
  .map((c) => {
    if (c.type === "M" || c.type === "L")
      return `${c.type}${num(c.x)} ${num(c.y)}`;
    if (c.type === "Q")
      return `Q${num(c.x1)} ${num(c.y1)} ${num(c.x)} ${num(c.y)}`;
    if (c.type === "C")
      return `C${num(c.x1)} ${num(c.y1)} ${num(c.x2)} ${num(c.y2)} ${num(c.x)} ${num(c.y)}`;
    return "Z";
  })
  .join("");
const WORD_BOX = WORD.getBoundingBox();
const X_HEIGHT =
  (JOST.charToGlyph("x").getBoundingBox().y2 * FONT_SIZE) / JOST.unitsPerEm;

function wordmarkSvg(color: string): string {
  const { x1, y1, x2, y2 } = WORD_BOX;
  const viewBox = [x1, y1, x2 - x1, y2 - y1].map((v) => num(v)).join(" ");
  return svg(viewBox, `<path d="${WORD_PATH}" fill="${color}"/>`);
}

/** The mark left of the wordmark, its optical centre on the x-height middle. */
function logoSvg(petal: string, heart: string, text: string): string {
  const scale = (MARK_HEIGHT * X_HEIGHT) / (MAX_Y - MIN_Y);
  const tx = WORD_BOX.x1 - MARK_GAP * FONT_SIZE - MAX_X * scale;
  const ty = -X_HEIGHT / 2 - OPTICAL_Y * scale;
  const left = tx + MIN_X * scale;
  const top = Math.min(WORD_BOX.y1, ty + MIN_Y * scale);
  const bottom = Math.max(WORD_BOX.y2, ty + MAX_Y * scale);
  const viewBox = [left, top, WORD_BOX.x2 - left, bottom - top]
    .map((v) => num(v))
    .join(" ");
  return svg(
    viewBox,
    `<g transform="translate(${num(tx)} ${num(ty)}) scale(${num(scale, 4)})">${shapes(petal, heart)}</g>` +
      `<path d="${WORD_PATH}" fill="${text}"/>`,
  );
}

/**
 * A square tile with the mark in cream. `fill` is the share of the tile
 * width the mark spans; `safe` instead keeps the whole mark inside a centred
 * circle of that share of the width (the maskable icon safe zone).
 */
function tileSvg(opts: { radius: number; fill?: number; safe?: number }) {
  const size = 120;
  let scale =
    (size * (opts.fill ?? 0.74)) / Math.max(MAX_X - MIN_X, MAX_Y - MIN_Y);
  if (opts.safe) {
    const reach = Math.max(
      ...CIRCLES.map((c) => Math.hypot(c.x - OPTICAL_X, c.y - OPTICAL_Y) + c.r),
    );
    scale = (size * opts.safe) / 2 / reach;
  }
  const tx = size / 2 - OPTICAL_X * scale;
  const ty = size / 2 - OPTICAL_Y * scale;
  const rx = opts.radius ? ` rx="${num(opts.radius)}"` : "";
  return svg(
    `0 0 ${size} ${size}`,
    `<rect width="${size}" height="${size}"${rx} fill="${NIGHT}"/>` +
      `<g transform="translate(${num(tx)} ${num(ty)}) scale(${num(scale, 4)})">${shapes(CREAM, POLLEN)}</g>`,
  );
}

/** An .ico file that embeds PNG images, one per size. */
function ico(images: { size: number; png: Buffer }[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(16 * images.length);
  let offset = header.length + entries.length;
  images.forEach(({ size, png }, i) => {
    const at = i * 16;
    entries.writeUInt8(size >= 256 ? 0 : size, at);
    entries.writeUInt8(size >= 256 ? 0 : size, at + 1);
    entries.writeUInt16LE(1, at + 4); // colour planes
    entries.writeUInt16LE(32, at + 6); // bits per pixel
    entries.writeUInt32LE(png.length, at + 8);
    entries.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, entries, ...images.map((image) => image.png)]);
}

const files: Record<string, string> = {
  "yarrow-mark.svg": markSvg(NIGHT, POLLEN),
  "yarrow-mark-on-dark.svg": markSvg(CREAM, POLLEN),
  "yarrow-mark-mono.svg": markSvg("currentColor", "currentColor"),
  "yarrow-logo.svg": logoSvg(NIGHT, POLLEN, NIGHT),
  "yarrow-logo-on-dark.svg": logoSvg(CREAM, POLLEN, CREAM),
  "yarrow-logo-mono.svg": logoSvg(
    "currentColor",
    "currentColor",
    "currentColor",
  ),
  "yarrow-wordmark.svg": wordmarkSvg(NIGHT),
  "yarrow-wordmark-on-dark.svg": wordmarkSvg(CREAM),
  "yarrow-icon.svg": tileSvg({ radius: 27 }),
};
// Tiny sizes: the mark grows to stay readable.
const favicon = tileSvg({ radius: 26, fill: 0.84 });
const touchSvg = tileSvg({ radius: 0, fill: 0.68 }); // iOS rounds the corners
const maskableSvg = tileSvg({ radius: 0, safe: 0.76 });
const manifest = {
  name: "Yarrow",
  short_name: "Yarrow",
  icons: [
    { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    {
      src: "/icon-maskable-512.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
  theme_color: "#0c0d0f",
  background_color: "#0c0d0f",
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, content] of Object.entries(files))
  writeFileSync(join(OUT_DIR, name), content);
writeFileSync(join(SITE_DIR, "favicon.svg"), favicon);
// The header draws the logo inline, so the mark can move on hover.
writeFileSync(
  "src/components/brand-svg.ts",
  `// Generated by \`pnpm brand:assets\`.
export const logoOnDark =
  ${JSON.stringify(files["yarrow-logo-on-dark.svg"])};
`,
);
writeFileSync(
  join(SITE_DIR, "manifest.webmanifest"),
  JSON.stringify(manifest, null, 2) + "\n",
);

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(source: string, size: number): Promise<Buffer> {
  await page.setViewportSize({ width: size, height: size });
  const sized = source.replace(
    "<svg ",
    `<svg width="${size}" height="${size}" style="display:block" `,
  );
  await page.setContent(
    `<body style="margin:0;background:transparent">${sized}</body>`,
  );
  return page.screenshot({ omitBackground: true });
}

const icon = files["yarrow-icon.svg"]!;
writeFileSync(
  join(SITE_DIR, "favicon.ico"),
  ico([
    { size: 16, png: await png(favicon, 16) },
    { size: 32, png: await png(favicon, 32) },
    { size: 48, png: await png(favicon, 48) },
  ]),
);
writeFileSync(join(SITE_DIR, "apple-touch-icon.png"), await png(touchSvg, 180));
writeFileSync(join(SITE_DIR, "icon-192.png"), await png(icon, 192));
writeFileSync(join(SITE_DIR, "icon-512.png"), await png(icon, 512));
writeFileSync(
  join(SITE_DIR, "icon-maskable-512.png"),
  await png(maskableSvg, 512),
);
// Email clients do not show SVG: the logo for Yarrow's emails, at 2x for a 28 px height.
async function wide(source: string, height: number): Promise<Buffer> {
  const [, , w, h] = source.match(/viewBox="([^"]+)"/)![1]!.split(/\s+/).map(Number);
  const width = Math.round((height * w!) / h!);
  await page.setViewportSize({ width, height });
  const sized = source.replace(
    "<svg ",
    `<svg width="${width}" height="${height}" style="display:block" `,
  );
  await page.setContent(
    `<body style="margin:0;background:transparent">${sized}</body>`,
  );
  return page.screenshot({ omitBackground: true });
}
writeFileSync(
  join(OUT_DIR, "yarrow-logo-on-dark.png"),
  await wide(files["yarrow-logo-on-dark.svg"]!, 56),
);
await browser.close();

console.log(`Wrote ${OUT_DIR}/ and the site icons in ${SITE_DIR}/`);
