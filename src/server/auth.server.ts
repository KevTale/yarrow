import { createServerClient } from "@supabase/ssr";
import { getCookies, setCookie } from "@tanstack/react-start/server";
import { appEnv } from "./env.server";

/** Supabase Auth bound to the current request's cookies (GitHub login). */
export function supabaseServer() {
  const env = appEnv();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () =>
        Object.entries(getCookies()).map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value, options } of cookies)
          setCookie(name, value, options as Parameters<typeof setCookie>[2]);
      },
    },
  });
}

export interface Viewer {
  userId: string;
  githubLogin: string | null;
  name: string | null;
  avatarUrl: string | null;
  email: string | null;
}

/** The signed-in user, verified against Supabase Auth, or null. */
export async function getViewer(): Promise<Viewer | null> {
  const { data, error } = await supabaseServer().auth.getUser();
  if (error || !data.user) return null;
  const meta = data.user.user_metadata as Record<string, string | undefined>;
  return {
    userId: data.user.id,
    githubLogin: meta.user_name ?? meta.preferred_username ?? null,
    name: meta.full_name ?? meta.name ?? null,
    avatarUrl: meta.avatar_url ?? null,
    email: data.user.email ?? null,
  };
}

export class UnauthorizedError extends Error {
  constructor() {
    super("Sign in with GitHub to continue.");
  }
}

/** For server functions: the data boundary. Route guards are only UX. */
export async function requireViewer(): Promise<Viewer> {
  const viewer = await getViewer();
  if (!viewer) throw new UnauthorizedError();
  return viewer;
}
