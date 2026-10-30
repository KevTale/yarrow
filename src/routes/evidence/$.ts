import { createFileRoute } from "@tanstack/react-router";
import { runEvidenceAccess } from "@/db/queries";
import { supabaseForRequest } from "@/server/auth-request.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";

/** The bytes a range asked for, as R2 resolved it. */
function span(
  range: R2Range,
  size: number,
): { offset: number; length: number } {
  if ("suffix" in range) {
    const length = Math.min(range.suffix, size);
    return { offset: size - length, length };
  }
  const offset = range.offset ?? 0;
  return { offset, length: range.length ?? size - offset };
}

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
        const ranged = request.headers.has("range");
        const { data } =
          await supabaseForRequest(request).client.auth.getClaims();
        const [access, object] = await Promise.all([
          withDb((db) =>
            runEvidenceAccess(db, match[1]!, data?.claims.sub ?? null),
          ),
          bucket.get(key, ranged ? { range: request.headers } : undefined),
        ]);
        // Listed projects show artifacts only to members; hidden ones never leak.
        if (!access?.allowed || !object) {
          await object?.body.cancel();
          return new Response("Not found", { status: 404 });
        }
        const headers = new Headers({
          "Content-Type":
            object.httpMetadata?.contentType ?? "application/octet-stream",
          "Cache-Control":
            access.visibility === "public"
              ? "public, max-age=604800, immutable"
              : "private, max-age=604800, immutable",
          "Accept-Ranges": "bytes",
        });
        if (ranged && object.range) {
          const { offset, length } = span(object.range, object.size);
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
