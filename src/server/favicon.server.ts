/**
 * A website's icon, for a sponsor's card: its apple-touch-icon, declared or
 * at /apple-touch-icon.png (drawn on a solid background, so it shows on a
 * dark card where a black favicon vanishes), else the largest icon its home
 * page declares, else /favicon.ico, else Google's favicon service. Returned
 * as a data URL the browser redraws at 128 px like an upload, so ICO and SVG
 * never reach storage.
 */

const TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_ICON_BYTES = 256 * 1024;

interface Candidate {
  url: string;
  score: number;
}

/** Only public https hosts: no IP literals, no single-label names. */
export function publicHost(site: string): string | null {
  let url: URL;
  try {
    url = new URL(site);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.port) return null;
  if (!host.includes(".") || host.endsWith(".localhost")) return null;
  if (/^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("["))
    return null;
  return host;
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(
    `\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  ).exec(tag);
  return match ? (match[1] ?? match[2] ?? match[3] ?? "") : null;
}

/** The icons a page declares: apple-touch-icons, then the largest first. */
export function declaredIcons(html: string, base: string): Candidate[] {
  const found: Candidate[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attribute(tag, "rel")?.toLowerCase().split(/\s+/) ?? [];
    const href = attribute(tag, "href");
    if (!href || href.startsWith("data:")) continue;
    const apple = rel.some((r) => r.startsWith("apple-touch-icon"));
    if (!apple && !rel.includes("icon")) continue;
    const sizes = attribute(tag, "sizes")?.toLowerCase() ?? "";
    const type = attribute(tag, "type")?.toLowerCase() ?? "";
    const side = Math.max(
      0,
      ...[...sizes.matchAll(/(\d+)x\d+/g)].map((m) => Number(m[1])),
    );
    const svg = type.includes("svg") || /\.svg(\?|$)/i.test(href);
    const score = apple
      ? 1000 + (side || 180)
      : sizes === "any" || svg
        ? 256
        : side || 32;
    try {
      found.push({ url: new URL(href, base).toString(), score });
    } catch {
      // A malformed href: skip it.
    }
  }
  return found.sort((a, b) => b.score - a.score);
}

async function get(url: string, accept: string): Promise<Response | null> {
  try {
    const response = await fetch(url, {
      headers: { accept, "user-agent": "Mozilla/5.0 (compatible; Yarrow)" },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return response.ok ? response : null;
  } catch {
    return null;
  }
}

/** A response's body, or null past `limit` bytes. */
async function body(response: Response, limit: number) {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > limit) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  return bytes.length && bytes.length <= limit ? bytes : null;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function icon(url: string): Promise<string | null> {
  const response = await get(url, "image/*");
  const type = response?.headers.get("content-type")?.split(";")[0]?.trim();
  if (!response || !type?.startsWith("image/")) return null;
  const bytes = await body(response, MAX_ICON_BYTES);
  return bytes ? `data:${type};base64,${base64(bytes)}` : null;
}

export async function findFavicon(site: string): Promise<string | null> {
  const host = publicHost(site);
  if (!host) return null;
  const home = `https://${host}/`;
  const candidates: Candidate[] = [];
  const page = await get(home, "text/html");
  if (page?.headers.get("content-type")?.includes("html")) {
    const bytes = await body(page, MAX_HTML_BYTES);
    if (bytes)
      candidates.push(
        ...declaredIcons(new TextDecoder().decode(bytes), page.url || home),
      );
  }
  candidates.push(
    // Where iOS looks when a page declares none.
    { url: `https://${host}/apple-touch-icon.png`, score: 1000 },
    { url: `https://${host}/favicon.ico`, score: 16 },
    {
      url: `https://www.google.com/s2/favicons?domain=${host}&sz=128`,
      score: 0,
    },
  );
  candidates.sort((a, b) => b.score - a.score);
  const tried = new Set<string>();
  for (const candidate of candidates) {
    const url = candidate.url.replace(/^http:\/\//i, "https://");
    if (tried.has(url) || !url.startsWith("https://")) continue;
    tried.add(url);
    const found = await icon(url);
    if (found) return found;
  }
  return null;
}
