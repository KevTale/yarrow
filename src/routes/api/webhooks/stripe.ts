import { createFileRoute } from "@tanstack/react-router";
import { withDb } from "@/server/db.server";
import { NotConfiguredError } from "@/server/env.server";
import { handleStripeWebhook } from "@/server/stripe/stripe.server";

export const Route = createFileRoute("/api/webhooks/stripe")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.text();
        try {
          const result = await withDb((db) =>
            handleStripeWebhook(
              db,
              body,
              request.headers.get("stripe-signature"),
            ),
          );
          return Response.json({ received: true, result });
        } catch (error) {
          if (error instanceof NotConfiguredError)
            return Response.json({ error: error.message }, { status: 501 });
          // Invalid signature or a processing error: Stripe retries 4xx/5xx.
          return Response.json(
            { error: (error as Error).message },
            { status: 400 },
          );
        }
      },
    },
  },
});
