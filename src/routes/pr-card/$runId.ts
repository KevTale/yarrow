import { createFileRoute } from "@tanstack/react-router";
import { prCardSvg } from "@/core/pr-card";
import { runCardSponsors } from "@/db/pr-card";
import { databaseConfigured, withDb } from "@/server/db.server";

/**
 * The card at the foot of each pull request: who paid for it. Public, like
 * the sponsors on the boards. GitHub caches it through its image proxy.
 * `?theme=light` draws it light, for readers on GitHub's dark theme.
 */
export const Route = createFileRoute("/pr-card/$runId")({
  server: {
    handlers: {
      GET: async ({ params, request }) => {
        const theme =
          new URL(request.url).searchParams.get("theme") === "light"
            ? "light"
            : "dark";
        const valid = /^[0-9a-f-]{36}$/.test(params.runId);
        const sponsors =
          valid && databaseConfigured()
            ? await withDb((db) => runCardSponsors(db, params.runId)).catch(
                () => null,
              )
            : null;
        if (!sponsors || sponsors.length === 0)
          return new Response("Not found", { status: 404 });
        return new Response(prCardSvg({ sponsors, theme }), {
          headers: {
            "Content-Type": "image/svg+xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
            "Content-Security-Policy":
              "default-src 'none'; img-src data:; style-src 'unsafe-inline'",
            "X-Content-Type-Options": "nosniff",
          },
        });
      },
    },
  },
});
