import { createFileRoute } from "@tanstack/react-router";
import { recordEvent } from "@/db/events";
import { supabaseForRequest } from "@/server/auth-request.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { readEmailChangeToken } from "@/server/email-change";
import { sendEmailChangedNotice, supabaseAdmin } from "@/server/email.server";
import { appEnv } from "@/server/env.server";

const back = (message: string) =>
  `/account?error=${encodeURIComponent(message)}`;

/**
 * The link mailed to a new address. Opened while signed in as the person
 * who asked, it proves the address and makes it theirs.
 */
export const Route = createFileRoute("/account/email")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token = url.searchParams.get("token") ?? "";
        const auth = supabaseForRequest(request);
        const key = appEnv().TOKEN_ENCRYPTION_KEY;
        const claim = key ? await readEmailChangeToken(key, token) : null;
        if (!claim) return auth.redirect(back("This link has expired"));
        const { data } = await auth.client.auth.getUser();
        if (!data.user)
          return auth.redirect(
            `/sign-in?next=${encodeURIComponent(`/account/email?token=${token}`)}`,
          );
        if (data.user.id !== claim.userId)
          return auth.redirect(back("This link is for another account"));
        const before = data.user.email ?? null;
        const { error } = await supabaseAdmin().auth.admin.updateUserById(
          claim.userId,
          { email: claim.email, email_confirm: true },
        );
        if (error)
          return auth.redirect(
            back(
              /already|exists|registered/i.test(error.message)
                ? "That email belongs to another account"
                : "The email could not be changed",
            ),
          );
        // The session carries the old address until it refreshes.
        await auth.client.auth.refreshSession().catch(() => undefined);
        if (databaseConfigured())
          await withDb((db) =>
            recordEvent(db, {
              type: "account.email_changed",
              userId: claim.userId,
            }),
          );
        if (before && before !== claim.email)
          await sendEmailChangedNotice(before, claim.email).catch(
            () => undefined,
          );
        return auth.redirect("/account?email=changed");
      },
    },
  },
});
