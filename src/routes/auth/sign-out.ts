import { createFileRoute } from "@tanstack/react-router";
import { supabaseForRequest } from "@/server/auth-request.server";

export const Route = createFileRoute("/auth/sign-out")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = supabaseForRequest(request);
        await auth.client.auth.signOut();
        return auth.redirect("/");
      },
    },
  },
});
