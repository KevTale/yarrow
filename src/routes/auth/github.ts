import { createFileRoute } from "@tanstack/react-router";
import { appEnv } from "@/server/env.server";
import { safeNext, supabaseForRequest } from "@/server/auth-request.server";

/**
 * Starts "Sign in with GitHub" through Supabase Auth (PKCE). Someone
 * already signed in by email gets GitHub linked to that same account, so
 * their sponsoring and their projects never end up on two accounts.
 * `switch` signs in plainly: the GitHub account already has its own.
 */
export const Route = createFileRoute("/auth/github")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const next = safeNext(url.searchParams.get("next"));
        const auth = supabaseForRequest(request);
        const options = {
          redirectTo: `${appEnv().APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
          skipBrowserRedirect: true,
        };
        if (!url.searchParams.has("switch")) {
          const { data: current } = await auth.client.auth.getUser();
          const github = current.user?.identities?.some(
            (identity) => identity.provider === "github",
          );
          if (current.user && !github) {
            const { data, error } = await auth.client.auth.linkIdentity({
              provider: "github",
              options,
            });
            if (data.url) return auth.redirect(data.url);
            // Manual linking off in Supabase: a plain sign-in, as before.
            console.warn("github link:", error?.message);
          }
        }
        const { data, error } = await auth.client.auth.signInWithOAuth({
          provider: "github",
          options,
        });
        if (error || !data.url)
          return auth.redirect(
            `/sign-in?error=${encodeURIComponent(error?.message ?? "GitHub sign-in is unavailable")}`,
          );
        return auth.redirect(data.url);
      },
    },
  },
});
