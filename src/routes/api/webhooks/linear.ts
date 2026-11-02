import { createFileRoute } from "@tanstack/react-router";
import { kickBrain } from "@/server/brain.server";
import { withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";
import { trackerContext } from "@/server/jira.server";
import {
  handleLinearDelivery,
  verifyLinearWebhook,
  type LinearDelivery,
} from "@/server/trackers/linear-webhooks";

export const Route = createFileRoute("/api/webhooks/linear")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const ctx = trackerContext();
        const secret = appEnv().LINEAR_WEBHOOK_SECRET;
        if (!secret || !ctx.secrets.linear || !ctx.secrets.encryptionKey)
          return Response.json(
            { error: "Linear is not configured yet." },
            { status: 501 },
          );
        const body = await request.text();
        if (
          !(await verifyLinearWebhook(
            secret,
            body,
            request.headers.get("linear-signature"),
          ))
        )
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        const result = await withDb((db) =>
          handleLinearDelivery(db, ctx, JSON.parse(body) as LinearDelivery),
        );
        // A ticket labeled in Linear: the brain takes it now.
        if (result.queued) await kickBrain();
        return Response.json({ received: true, result: result.log });
      },
    },
  },
});
