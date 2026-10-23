import { createFileRoute } from "@tanstack/react-router";
import { withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";
import { verifyGitHubSignature } from "@/server/github/app";
import { handleGitHubEvent, type GitHubPayload } from "@/server/github/webhook";

export const Route = createFileRoute("/api/webhooks/github")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = appEnv().GITHUB_APP_WEBHOOK_SECRET;
        if (!secret)
          return Response.json(
            { error: "The GitHub App is not configured yet." },
            { status: 501 },
          );
        const body = await request.text();
        if (
          !(await verifyGitHubSignature(
            secret,
            body,
            request.headers.get("x-hub-signature-256"),
          ))
        )
          return Response.json({ error: "Invalid signature" }, { status: 401 });
        const event = request.headers.get("x-github-event") ?? "";
        const result = await withDb((db) =>
          handleGitHubEvent(db, event, JSON.parse(body) as GitHubPayload),
        );
        return Response.json({ received: true, result });
      },
    },
  },
});
