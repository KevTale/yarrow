import { createFileRoute } from "@tanstack/react-router";
import { runDetail } from "@/db/queries";
import { supabaseForRequest } from "@/server/auth-request.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";

/**
 * Serves screenshots and videos from R2. Keys look like runs/<runId>/<file>;
 * the run's project visibility decides who may see them.
 */
export const Route = createFileRoute("/evidence/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const key = params._splat ?? "";
        const match = key.match(/^runs\/([0-9a-f-]{36})\/[\w.-]+$/);
        const bucket = appEnv().EVIDENCE;
        if (!match || !bucket || !databaseConfigured())
          return new Response("Not found", { status: 404 });
        const { data } =
          await supabaseForRequest(request).client.auth.getUser();
        const run = await withDb((db) =>
          runDetail(db, match[1]!, data.user?.id ?? null),
        );
        // Listed projects show artifacts only to members; hidden ones never leak.
        if (!run || (run.visibility !== "public" && !run.member))
          return new Response("Not found", { status: 404 });
        const object = await bucket.get(key);
        if (!object) return new Response("Not found", { status: 404 });
        return new Response(object.body, {
          headers: {
            "Content-Type":
              object.httpMetadata?.contentType ?? "application/octet-stream",
            "Cache-Control":
              run.visibility === "public"
                ? "public, max-age=86400"
                : "private, no-store",
          },
        });
      },
    },
  },
});
