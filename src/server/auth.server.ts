import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
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

/**
 * Who the user is on GitHub. An account opened by email that linked GitHub
 * later has it on the identity only, not yet in its metadata.
 */
export function githubProfile(user: User) {
  const meta = user.user_metadata as Record<string, string | undefined>;
  const github = user.identities?.find(
    (identity) => identity.provider === "github",
  )?.identity_data as Record<string, string | undefined> | undefined;
  const pick = (key: string) => meta[key] ?? github?.[key];
  return {
    githubLogin: pick("user_name") ?? pick("preferred_username") ?? null,
    name: pick("full_name") ?? pick("name") ?? null,
    avatarUrl: pick("avatar_url") ?? null,
  };
}

/** The signed-in user, verified against Supabase Auth, or null. */
export async function getViewer(): Promise<Viewer | null> {
  const { data, error } = await supabaseServer().auth.getUser();
  if (error || !data.user) return null;
  return {
    userId: data.user.id,
    ...githubProfile(data.user),
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
