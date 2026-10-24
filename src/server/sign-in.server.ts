import { createClient, type User } from "@supabase/supabase-js";
import { ensureAccount } from "@/db/accounts";
import { claimGuestSponsorships } from "@/db/sponsors";
import { databaseConfigured, withDb } from "./db.server";
import { appEnv } from "./env.server";

/**
 * Emails a one-time sign-in link through Supabase Auth. The "Magic Link"
 * email template must point to {{ .SiteURL }}/auth/confirm with the token
 * hash, so the link works on any device (no PKCE verifier needed).
 */
export async function sendSignInLink(
  email: string,
  next = "/dashboard",
): Promise<void> {
  const env = appEnv();
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: `${env.APP_URL}${next}`,
    },
  });
  if (error) throw new Error(`Sign-in link not sent: ${error.message}`);
}

/** After any sign-in: the user's account, and their guest payments if any. */
export async function afterSignIn(user: User): Promise<void> {
  if (!databaseConfigured()) return;
  const meta = user.user_metadata as Record<string, string | undefined>;
  await withDb(async (db) => {
    await ensureAccount(db, {
      userId: user.id,
      githubLogin: meta.user_name ?? meta.preferred_username ?? null,
      name: meta.full_name ?? meta.name ?? null,
    });
    if (user.email) await claimGuestSponsorships(db, user.id, user.email);
  });
}
