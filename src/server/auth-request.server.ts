import {
  createServerClient,
  parseCookieHeader,
  serializeCookieHeader,
} from "@supabase/ssr";
import { appEnv } from "./env.server";

/**
 * Supabase Auth for raw server routes (OAuth redirects). Cookies set by
 * Supabase are collected and must be applied to the returned Response.
 */
export function supabaseForRequest(request: Request) {
  const env = appEnv();
  const pending: string[] = [];
  const client = createServerClient(
    env.SUPABASE_URL,
    env.SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll: () =>
          parseCookieHeader(request.headers.get("cookie") ?? "").map(
            (cookie) => ({ name: cookie.name, value: cookie.value ?? "" }),
          ),
        setAll: (cookies) => {
          for (const { name, value, options } of cookies)
            pending.push(serializeCookieHeader(name, value, options));
        },
      },
    },
  );
  return {
    client,
    /** A redirect carrying every cookie Supabase asked to set. */
    redirect(location: string, extraCookies: string[] = []): Response {
      const headers = new Headers({ Location: location });
      for (const cookie of [...pending, ...extraCookies])
        headers.append("Set-Cookie", cookie);
      return new Response(null, { status: 302, headers });
    },
  };
}

export function readCookie(request: Request, name: string): string | null {
  const match = parseCookieHeader(request.headers.get("cookie") ?? "").find(
    (cookie) => cookie.name === name,
  );
  return match?.value ?? null;
}

/** Short-lived, HttpOnly cookie for OAuth state (CSRF) and return paths. */
export function stateCookie(name: string, value: string, maxAge = 600): string {
  return serializeCookieHeader(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });
}

/** Only same-site relative paths, never an open redirect. */
export function safeNext(next: string | null, fallback = "/dashboard"): string {
  return next && next.startsWith("/") && !next.startsWith("//")
    ? next
    : fallback;
}
