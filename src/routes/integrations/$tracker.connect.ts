import { createFileRoute } from "@tanstack/react-router";
import { requireProjectMember } from "@/db/accounts";
import { withDb } from "@/server/db.server";
import { stateCookie, supabaseForRequest } from "@/server/auth-request.server";
import {
  callbackUrl,
  STATE_COOKIE,
  trackerConfig,
} from "@/server/integrations.server";
import {
  trackerAdapter,
  trackerNames,
  type TrackerName,
} from "@/server/trackers/index";

/**
 * Starts the Linear, Jira or Trello authorization for one project.
 * `next=dashboard` brings the builder back to the dashboard (the Jira card)
 * instead of the project's settings.
 */
export const Route = createFileRoute("/integrations/$tracker/connect")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const tracker = params.tracker as TrackerName;
        if (!trackerNames.includes(tracker))
          return new Response("Unknown tracker", { status: 404 });
        const url = new URL(request.url);
        const projectId = url.searchParams.get("projectId") ?? "";
        const next =
          url.searchParams.get("next") === "dashboard" ? "dashboard" : "";
        const auth = supabaseForRequest(request);
        const { data } = await auth.client.auth.getUser();
        if (!data.user)
          return auth.redirect(
            `/sign-in?next=${encodeURIComponent(`/projects/${projectId}`)}`,
          );
        try {
          await withDb((db) =>
            requireProjectMember(db, data.user.id, projectId),
          );
          const { credentials } = trackerConfig(tracker);
          const state = crypto.randomUUID();
          const location = trackerAdapter(tracker).authorizeUrl({
            credentials,
            redirectUri: callbackUrl(tracker),
            state,
          });
          return auth.redirect(location, [
            stateCookie(
              STATE_COOKIE,
              `${tracker}:${state}:${projectId}:${next}`,
            ),
          ]);
        } catch (error) {
          return auth.redirect(
            `/projects/${projectId}?error=${encodeURIComponent((error as Error).message)}`,
          );
        }
      },
    },
  },
});
