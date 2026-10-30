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

/**
 * The signed-in user, or null. The session's token is checked against the
 * project's public signing key, held after the first request, so it costs
 * no call to Supabase Auth. Only an account whose GitHub link is not in its
 * token yet (opened by email, linked later) asks Auth for the full user.
 */
export async function getViewer(): Promise<Viewer | null> {
  const auth = supabaseServer().auth;
  const { data, error } = await auth.getClaims();
  if (error || !data?.claims.sub) return null;
  const { claims } = data;
  const fromToken = githubProfile({
    user_metadata: claims.user_metadata ?? {},
  } as User);
  const providers = (claims.app_metadata?.providers ?? []) as string[];
  if (!fromToken.githubLogin && providers.includes("github")) {
    const { data: full } = await auth.getUser();
    if (full.user)
      return {
        userId: full.user.id,
        ...githubProfile(full.user),
        email: full.user.email ?? null,
      };
  }
  return {
    userId: claims.sub,
    ...fromToken,
    email: claims.email ?? null,
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
