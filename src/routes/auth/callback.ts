import { createFileRoute } from "@tanstack/react-router";
import { safeNext, supabaseForRequest } from "@/server/auth-request.server";
import { afterSignIn } from "@/server/sign-in.server";

/** GitHub → Supabase → here: exchange the code, then make sure the account exists. */
export const Route = createFileRoute("/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const next = safeNext(url.searchParams.get("next"));
        const code = url.searchParams.get("code");
        const auth = supabaseForRequest(request);
        if (!code) return auth.redirect("/sign-in?error=Missing%20code");
        const { data, error } =
          await auth.client.auth.exchangeCodeForSession(code);
        if (error || !data.user)
          return auth.redirect(
            `/sign-in?error=${encodeURIComponent(error?.message ?? "Sign-in failed")}`,
          );
        await afterSignIn(data.user);
        return auth.redirect(next);
      },
    },
  },
});
