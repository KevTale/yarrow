/**
 * A pull request's preview: its stage's app (src/core/stage.ts) at an
 * address of its own, on a domain apart from Yarrow's, for the members of
 * its project. The dashboard's link signs the visit in once (a code, then a
 * cookie of the preview's own host); every request then goes on to the app
 * as if the stage's own browser sent it. No I/O here.
 */

import { stageSignIn } from "./stage";

/** The preview's own cookie: never sent on to the app. */
export const PREVIEW_COOKIE = "yarrow_preview";
/** Where the dashboard's link lands, with its one-time code. */
export const ENTER_PATH = "/.yarrow/enter";
/**
 * Set by the brain on a preview's requests to the stage, to the dashboard's
 * address; a visitor's own is replaced.
 */
export const PREVIEW_HEADER = "x-yarrow-preview";
/** A visit signed in lasts this long. */
export const PREVIEW_SESSION_S = 12 * 3600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The dashboard's way to a ticket's preview (src/routes/preview). */
export const previewHref = (projectId: string, key: string) =>
  `/preview/${projectId}/${encodeURIComponent(key)}`;

/** A work unit's preview host: its id, then the environment's suffix. */
export const previewHost = (workUnitId: string, suffix: string) =>
  `${workUnitId}${suffix}`;

/** The work unit a host previews, on this environment's suffix ("-dev.yarrow.page"). */
export function previewUnit(host: string, suffix: string): string | null {
  if (!suffix || !host.endsWith(suffix)) return null;
  const id = host.slice(0, -suffix.length);
  return UUID.test(id) ? id : null;
}

/** The visitor's Cookie header: the preview's session apart, the app's own left. */
export function splitCookie(header: string | null): {
  session: string | null;
  rest: string | null;
} {
  let session: string | null = null;
  const rest: string[] = [];
  for (const part of (header ?? "").split(";")) {
    const pair = part.trim();
    if (!pair) continue;
    if (pair.startsWith(`${PREVIEW_COOKIE}=`))
      session = pair.slice(PREVIEW_COOKIE.length + 1);
    else rest.push(pair);
  }
  return { session, rest: rest.length ? rest.join("; ") : null };
}

/**
 * Every way the app's own origin may be written in what it sends: as the
 * recipe gives it, through 127.0.0.1 or localhost, and its WebSockets.
 */
function origins(app: string): string[] {
  const url = new URL(app);
  const hosts = new Set([url.host]);
  for (const name of ["localhost", "127.0.0.1", "0.0.0.0"])
    hosts.add(url.port ? `${name}:${url.port}` : name);
  return [...hosts];
}

/** Text that names the app's origin (a page, a script, JSON): the preview's instead. */
export function rewriteText(
  text: string,
  app: string,
  preview: string,
): string {
  const to = new URL(preview);
  const socket = `${to.protocol === "https:" ? "wss" : "ws"}://${to.host}`;
  let out = text;
  for (const host of origins(app)) {
    if (!out.includes(host)) continue;
    out = out
      .replaceAll(`http://${host}`, to.origin)
      .replaceAll(`https://${host}`, to.origin)
      .replaceAll(`ws://${host}`, socket)
      .replaceAll(`wss://${host}`, socket);
  }
  return out;
}

/** What is worth reading through for the app's origin. */
export const rewritable = (contentType: string | null) =>
  /text\/html|javascript|json|text\/css|xml/i.test(contentType ?? "");

/**
 * The visitor's request headers as the app expects them: its own cookies
 * only, and the Origin and Referer of the app's address (a form's check of
 * where it was sent from passes).
 */
export function toApp(headers: Headers, app: string, preview: string): Headers {
  const out = new Headers(headers);
  out.delete(PREVIEW_HEADER);
  const { rest } = splitCookie(headers.get("cookie"));
  if (rest) out.set("cookie", rest);
  else out.delete("cookie");
  const from = new URL(preview).origin;
  const to = new URL(app).origin;
  for (const name of ["origin", "referer"]) {
    const value = out.get(name);
    if (value?.startsWith(from)) out.set(name, to + value.slice(from.length));
  }
  return out;
}

/**
 * The app's response headers for the visitor: its redirects and CORS on
 * the preview's address, its cookies on the preview's host.
 */
export function fromApp(
  headers: Headers,
  app: string,
  preview: string,
): Headers {
  const out = new Headers();
  for (const [name, value] of headers)
    if (name !== "set-cookie") out.append(name, value);
  for (const cookie of headers.getSetCookie())
    out.append(
      "set-cookie",
      cookie
        .split(";")
        .filter((part) => !/^\s*domain\s*=/i.test(part))
        .join(";"),
    );
  for (const name of [
    "location",
    "content-location",
    "access-control-allow-origin",
  ]) {
    const value = out.get(name);
    if (value) out.set(name, rewriteText(value, app, preview));
  }
  return out;
}

/** A browser's session as Playwright saves it (storageState). */
interface SavedSession {
  cookies?: {
    name: string;
    value: string;
    domain: string;
    path: string;
    /** Seconds; -1 for a cookie of the browser's session. */
    expires: number;
    httpOnly: boolean;
    sameSite?: string;
  }[];
  origins?: {
    origin: string;
    localStorage: { name: string; value: string }[];
  }[];
}

/**
 * The stage's browser signed in with the recipe's account (present.mjs): what
 * of that session is the app's, for the visitor's browser to take, so the
 * app opens signed in. Its cookies as Set-Cookie values on the preview's
 * host, what it keeps in localStorage. Null when there is none.
 */
export function previewSession(
  raw: string,
  app: string,
  preview: string,
): { cookies: string[]; items: [string, string][] } | null {
  let saved: SavedSession;
  try {
    saved = JSON.parse(raw) as SavedSession;
  } catch {
    return null;
  }
  const { hostname, origin } = new URL(app);
  const now = Date.now() / 1000;
  const cookies = (saved.cookies ?? [])
    .filter(
      (cookie) =>
        cookie.domain.replace(/^\./, "") === hostname &&
        (cookie.expires < 0 || cookie.expires > now),
    )
    .map((cookie) =>
      [
        `${cookie.name}=${cookie.value}`,
        `Path=${cookie.path || "/"}`,
        ...(cookie.expires > 0
          ? [`Expires=${new Date(cookie.expires * 1000).toUTCString()}`]
          : []),
        ...(cookie.httpOnly ? ["HttpOnly"] : []),
        "Secure",
        `SameSite=${cookie.sameSite ?? "Lax"}`,
      ].join("; "),
    );
  const items = (saved.origins ?? [])
    .filter((entry) => entry.origin === origin)
    .flatMap((entry) => entry.localStorage)
    .map(({ name, value }): [string, string] => [
      name,
      rewriteText(value, app, preview),
    ]);
  return cookies.length || items.length ? { cookies, items } : null;
}

/** The app's session put in the visitor's browser, then on to the page asked. */
export function sessionPage(items: [string, string][], to: string): string {
  // Inside a <script>: nothing may close it.
  const json = (value: unknown) =>
    JSON.stringify(value).replaceAll("<", "\\u003c");
  return `<!doctype html>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Starting the app · Yarrow</title>
<script>
for (const [name, value] of ${json(items)}) localStorage.setItem(name, value);
location.replace(${json(to)});
</script>`;
}

/** The recipe's sign-in, as the member types it: an email or user name, and a password. */
export function previewSignIn(
  words: string | null,
): { login: string; password: string } | null {
  const found = stageSignIn(words);
  if (!found) return null;
  const [login, password] = Object.values(found.fields);
  return login && password ? { login, password } : null;
}

export type PreviewPage = "starting" | "failed" | "signed-out";

const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );

/** What the preview's address shows while the app comes up, or when it cannot. */
export function previewPage(
  page: PreviewPage,
  input: { dashboard: string; detail?: string | null },
): string {
  const title = {
    starting: "Starting the app",
    failed: "The app did not start",
    "signed-out": "Open this preview from Yarrow",
  }[page];
  const body =
    page === "starting"
      ? `<span class="dot" aria-hidden="true"></span>`
      : page === "failed" && input.detail
        ? `<pre>${escape(input.detail.slice(-1200))}</pre>`
        : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
${page === "starting" ? '<meta http-equiv="refresh" content="3">' : ""}
<title>${title} · Yarrow</title>
<style>
:root { color-scheme: light dark; --bg: #fafaf9; --fg: #1c1917; --muted: #78716c; --line: #e7e5e4; }
@media (prefers-color-scheme: dark) { :root { --bg: #0c0a09; --fg: #fafaf9; --muted: #a8a29e; --line: #292524; } }
body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--fg); font: 15px/1.5 system-ui, sans-serif; }
main { display: grid; gap: 16px; justify-items: center; padding: 24px 16px; max-width: 640px; text-align: center; }
h1 { margin: 0; font-size: 18px; font-weight: 500; }
a { color: var(--muted); }
pre { margin: 0; padding: 12px; max-width: 100%; overflow: auto; border: 1px solid var(--line); border-radius: 8px; color: var(--muted); font-size: 12px; text-align: left; white-space: pre-wrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.25; } }
@media (prefers-reduced-motion: reduce) { .dot { animation: none; } }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
${body}
<a href="${escape(input.dashboard)}/dashboard">Yarrow</a>
</main>
</body>
</html>
`;
}
