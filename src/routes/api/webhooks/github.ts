import { createFileRoute } from "@tanstack/react-router";
import { withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";
import { verifyGitHubSignature } from "@/server/github/app";
import { eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { pullRequests } from "@/db/schema";
import { kickBrain } from "@/server/brain.server";
import { handleGitHubEvent, type GitHubPayload } from "@/server/github/webhook";
import { moveTrackerTicket, trackerContext } from "@/server/jira.server";

async function moveMergedTicket(db: Database, url: string) {
  const [pull] = await db
    .select({ workUnitId: pullRequests.workUnitId })
    .from(pullRequests)
    .where(eq(pullRequests.url, url));
  if (pull)
    await moveTrackerTicket(
      db,
      trackerContext(),
      pull.workUnitId,
      "merged",
    ).catch((error: Error) => console.warn("move merged:", error.message));
}

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
        const payload = JSON.parse(body) as GitHubPayload;
        const result = await withDb(async (db) => {
          const result = await handleGitHubEvent(db, event, payload);
          // A merged pull request may move its Jira ticket (see settings).
          if (result === "pull request merged" && payload.pull_request)
            await moveMergedTicket(db, payload.pull_request.html_url);
          return result;
        });
        // Issues and comments queue work; the brain takes it now.
        if (event === "issues" || event === "issue_comment") await kickBrain();
        return Response.json({ received: true, result });
      },
    },
  },
});
