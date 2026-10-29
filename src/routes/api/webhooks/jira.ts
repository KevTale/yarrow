import { createFileRoute } from "@tanstack/react-router";
import { kickBrain } from "@/server/brain.server";
import { withDb } from "@/server/db.server";
import { trackerContext } from "@/server/jira.server";
import {
  handleJiraDelivery,
  verifyJiraWebhook,
  type JiraDelivery,
} from "@/server/trackers/jira-webhooks";

export const Route = createFileRoute("/api/webhooks/jira")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ctx = trackerContext();
        const secret = ctx.secrets.jira?.clientSecret;
        if (!secret || !ctx.secrets.encryptionKey)
          return Response.json(
            { error: "Jira is not configured yet." },
            { status: 501 },
          );
        if (
          !(await verifyJiraWebhook(
            secret,
            request.headers.get("authorization"),
          ))
        )
          return Response.json({ error: "Invalid token" }, { status: 401 });
        const delivery = (await request.json()) as JiraDelivery;
        const result = await withDb((db) =>
          handleJiraDelivery(db, ctx, delivery),
        );
        // A ticket labeled in Jira: the brain takes it now.
        if (result.queued) await kickBrain();
        return Response.json({ received: true, result: result.log });
      },
    },
  },
});
