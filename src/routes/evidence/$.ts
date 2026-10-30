import { createFileRoute } from "@tanstack/react-router";
import { runEvidenceAccess } from "@/db/queries";
import { supabaseForRequest } from "@/server/auth-request.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";

/**
 * Serves screenshots and videos from R2. Keys look like runs/<runId>/<file>;
 * the run's project visibility decides who may see them. A file never
 * changes under its key, so browsers keep it: a private one in the
 * member's own browser only.
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
          await supabaseForRequest(request).client.auth.getClaims();
        const [access, object] = await Promise.all([
          withDb((db) =>
            runEvidenceAccess(db, match[1]!, data?.claims.sub ?? null),
          ),
          bucket.get(key),
        ]);
        // Listed projects show artifacts only to members; hidden ones never leak.
        if (!access?.allowed || !object) {
          await object?.body.cancel();
          return new Response("Not found", { status: 404 });
        }
        return new Response(object.body, {
          headers: {
            "Content-Type":
              object.httpMetadata?.contentType ?? "application/octet-stream",
            "Cache-Control":
              access.visibility === "public"
                ? "public, max-age=604800, immutable"
                : "private, max-age=604800, immutable",
          },
        });
      },
    },
  },
});
