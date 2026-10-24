import { createFileRoute } from "@tanstack/react-router";
import { safeNext, supabaseForRequest } from "@/server/auth-request.server";
import { appEnv } from "@/server/env.server";
import { afterSignIn } from "@/server/sign-in.server";

/** Email sign-in link → here: verify the one-time token, then continue. */
export const Route = createFileRoute("/auth/confirm")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tokenHash = url.searchParams.get("token_hash");
        // The template passes the full redirect URL; keep only our own path.
        const rawNext = url.searchParams.get("next") ?? "/dashboard";
        const next = safeNext(
          rawNext.startsWith(appEnv().APP_URL)
            ? rawNext.slice(appEnv().APP_URL.length) || "/"
            : rawNext,
        );
        const auth = supabaseForRequest(request);
        if (!tokenHash) return auth.redirect("/sign-in?error=Missing%20link");
        const { data, error } = await auth.client.auth.verifyOtp({
          type: "email",
          token_hash: tokenHash,
        });
        if (error || !data.user)
          return auth.redirect(
            `/sign-in?error=${encodeURIComponent(error?.message ?? "This link has expired")}`,
          );
        await afterSignIn(data.user);
        return auth.redirect(next);
      },
    },
  },
});
