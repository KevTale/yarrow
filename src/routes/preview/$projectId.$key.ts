import { createFileRoute } from "@tanstack/react-router";
import { previewPage } from "@/core/preview";
import { requireProjectMember } from "@/db/accounts";
import { pullPanel } from "@/db/pull-panel";
import { supabaseForRequest } from "@/server/auth-request.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";

/**
 * A pull request's preview, opened from the dashboard by a member of the
 * ticket's project: the brain asks its stage up and gives the address that
 * signs the visit in (src/core/preview.ts), where this sends the browser.
 */
export const Route = createFileRoute("/preview/$projectId/$key")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const env = appEnv();
        if (!env.BRAIN || !databaseConfigured())
          return new Response("Not found", { status: 404 });
        const { data } =
          await supabaseForRequest(request).client.auth.getClaims();
        const userId = data?.claims.sub;
        if (!userId)
          return Response.redirect(new URL("/sign-in", request.url), 302);
        const panel = await withDb(async (db) => {
          await requireProjectMember(db, userId, params.projectId);
          return pullPanel(db, params.projectId, params.key);
        }).catch(() => null);
        if (panel?.pullRequest?.state !== "open")
          return new Response("Not found", { status: 404 });
        const found = await env.BRAIN.preview({
          workUnitId: panel.workUnitId,
          path: new URL(request.url).searchParams.get("path"),
        });
        if ("error" in found)
          return new Response(
            previewPage("failed", {
              dashboard: env.APP_URL,
              detail: found.error,
            }),
            {
              status: 409,
              headers: { "content-type": "text/html; charset=utf-8" },
            },
          );
        return new Response(null, {
          status: 302,
          headers: { location: found.url, "cache-control": "no-store" },
        });
      },
    },
  },
});
