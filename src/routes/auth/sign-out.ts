import { createFileRoute } from "@tanstack/react-router";
import { stateCookie, supabaseForRequest } from "@/server/auth-request.server";

export const Route = createFileRoute("/auth/sign-out")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = supabaseForRequest(request);
        await auth.client.auth.signOut();
        // Also forgets the sponsor who paid from this browser.
        return auth.redirect("/", [stateCookie("yarrow_guest", "", 0)]);
      },
    },
  },
});
