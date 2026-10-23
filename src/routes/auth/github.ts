import { createFileRoute } from "@tanstack/react-router";
import { appEnv } from "@/server/env.server";
import { safeNext, supabaseForRequest } from "@/server/auth-request.server";

/** Starts "Sign in with GitHub" through Supabase Auth (PKCE). */
export const Route = createFileRoute("/auth/github")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const next = safeNext(url.searchParams.get("next"));
        const auth = supabaseForRequest(request);
        const { data, error } = await auth.client.auth.signInWithOAuth({
          provider: "github",
          options: {
            redirectTo: `${appEnv().APP_URL}/auth/callback?next=${encodeURIComponent(next)}`,
            skipBrowserRedirect: true,
          },
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
