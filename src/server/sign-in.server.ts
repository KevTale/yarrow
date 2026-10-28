import { createClient, type User } from "@supabase/supabase-js";
import { ensureAccount } from "@/db/accounts";
import { claimGuestSponsorships } from "@/db/sponsors";
import { githubProfile } from "./auth.server";
import { databaseConfigured, withDb } from "./db.server";
import { cookieGuestId } from "./guest.server";
import { emailConfigured, sendSignInEmail } from "./email.server";
import { appEnv } from "./env.server";

/**
 * Emails a one-time sign-in link. With Resend configured, Yarrow sends its
 * own email (one link for new and known addresses); otherwise Supabase's
 * template does, pointing at /auth/confirm (or the URL fragment, which
 * SessionFromLink picks up).
 */
export async function sendSignInLink(
  email: string,
  next = "/dashboard",
): Promise<void> {
  if (emailConfigured()) return sendSignInEmail(email, next);
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
  const { githubLogin, name } = githubProfile(user);
  await withDb(async (db) => {
    await ensureAccount(db, { userId: user.id, githubLogin, name });
    // The verified email, and the payment made from this very browser.
    await claimGuestSponsorships(db, user.id, {
      email: user.email,
      guestId: await cookieGuestId(),
    });
  });
}
