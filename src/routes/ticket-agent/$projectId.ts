import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { BODY_MAX, TITLE_MAX } from "@/core/new-ticket";
import { requireProjectMember } from "@/db/accounts";
import { supabaseForRequest } from "@/server/auth-request.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";

const turnSchema = z.object({
  draftId: z.uuid(),
  text: z.string().trim().min(1).max(4000),
  title: z.string().max(TITLE_MAX),
  body: z.string().max(BODY_MAX),
});

/**
 * A written turn of the agent that writes a ticket, for a member of the
 * project: forwarded to the brain, its answer streamed as it comes.
 */
export const Route = createFileRoute("/ticket-agent/$projectId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const brain = appEnv().BRAIN;
        if (!brain || !databaseConfigured())
          return new Response("Not found", { status: 404 });
        const { data } =
          await supabaseForRequest(request).client.auth.getClaims();
        const userId = data?.claims.sub;
        if (!userId) return new Response("Not found", { status: 404 });
        const turn = turnSchema.safeParse(
          await request.json().catch(() => null),
        );
        if (!turn.success) return new Response("Bad request", { status: 400 });
        const member = await withDb((db) =>
          requireProjectMember(db, userId, params.projectId),
        ).then(
          () => true,
          () => false,
        );
        if (!member) return new Response("Not found", { status: 404 });
        return brain.fetch(
          new Request("https://brain/ticket-agent", {
            method: "POST",
            body: JSON.stringify({
              ...turn.data,
              projectId: params.projectId,
              userId,
            }),
          }),
        );
      },
    },
  },
});
