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
        // Linking refused: this GitHub account already has its own Yarrow
        // account, which is where its projects are. Sign in to it.
        if (url.searchParams.get("error_code") === "identity_already_exists")
          return auth.redirect(
            `/auth/github?switch&next=${encodeURIComponent(next)}`,
          );
        if (!code)
          return auth.redirect(
            `/sign-in?error=${encodeURIComponent(url.searchParams.get("error_description") ?? "Missing code")}`,
          );
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
