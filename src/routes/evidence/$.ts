import { createFileRoute } from "@tanstack/react-router";
import { byteRange, span } from "@/core/byte-range";
import { runEvidenceAccess } from "@/db/queries";
import { supabaseForRequest } from "@/server/auth-request.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";

/**
 * Serves screenshots, videos and presentations from R2. Keys look like
 * runs/<runId>/<file>; the run's project visibility decides who may see
 * them. A file never changes under its key, so browsers keep it: a private
 * one in the member's own browser only. Videos are read in ranges, as
 * players seek.
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
        const range = byteRange(request.headers.get("range"));
        const { data } =
          await supabaseForRequest(request).client.auth.getClaims();
        const [access, object] = await Promise.all([
          withDb((db) =>
            runEvidenceAccess(db, match[1]!, data?.claims.sub ?? null),
          ),
          bucket
            .get(key, range ? { range } : undefined)
            // A range past the end.
            .catch(() => undefined),
        ]);
        // Listed projects show artifacts only to members; hidden ones never leak.
        if (!access?.allowed || object === null) {
          await object?.body.cancel();
          return new Response("Not found", { status: 404 });
        }
        if (!object) return new Response(null, { status: 416 });
        const headers = new Headers({
          "Content-Type":
            object.httpMetadata?.contentType ?? "application/octet-stream",
          "Cache-Control":
            access.visibility === "public"
              ? "public, max-age=604800, immutable"
              : "private, max-age=604800, immutable",
          "Accept-Ranges": "bytes",
        });
        if (range) {
          const { offset, length } = span(range, object.size);
          headers.set(
            "Content-Range",
            `bytes ${offset}-${offset + length - 1}/${object.size}`,
          );
          headers.set("Content-Length", String(length));
          return new Response(object.body, { status: 206, headers });
        }
        headers.set("Content-Length", String(object.size));
        return new Response(object.body, { headers });
      },
    },
  },
});
