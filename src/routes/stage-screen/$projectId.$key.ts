import { createFileRoute } from "@tanstack/react-router";
import { requireProjectMember } from "@/db/accounts";
import { pullPanel } from "@/db/pull-panel";
import { supabaseForRequest } from "@/server/auth-request.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";

/**
 * A stage's screen, as a WebSocket (VNC) for a member of the ticket's
 * project, forwarded to the brain, which bridges it to the container.
 */
export const Route = createFileRoute("/stage-screen/$projectId/$key")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const brain = appEnv().BRAIN;
        if (!brain || !databaseConfigured())
          return new Response("Not found", { status: 404 });
        const { data } =
          await supabaseForRequest(request).client.auth.getClaims();
        const userId = data?.claims.sub;
        if (!userId) return new Response("Not found", { status: 404 });
        const panel = await withDb(async (db) => {
          await requireProjectMember(db, userId, params.projectId);
          return pullPanel(db, params.projectId, params.key);
        }).catch(() => null);
        if (!panel?.pullRequest)
          return new Response("Not found", { status: 404 });
        return brain.fetch(
          new Request(`https://brain/stage/${panel.workUnitId}`, request),
        );
      },
    },
  },
});
