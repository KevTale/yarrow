import { createFileRoute } from "@tanstack/react-router";
import { withDb } from "@/server/db.server";
import {
  readCookie,
  stateCookie,
  supabaseForRequest,
} from "@/server/auth-request.server";
import {
  callbackUrl,
  STATE_COOKIE,
  storeTrackerTokens,
  trackerConfig,
} from "@/server/integrations.server";
import { trackerAdapter, type TrackerName } from "@/server/trackers/index";

/** OAuth return for Linear and Jira (Trello returns to a page, see trello-callback). */
export const Route = createFileRoute("/integrations/$tracker/callback")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const tracker = params.tracker as TrackerName;
        const url = new URL(request.url);
        const auth = supabaseForRequest(request);
        const clear = stateCookie(STATE_COOKIE, "", 0);
        const [expectedTracker, expectedState, projectId, next] = (
          readCookie(request, STATE_COOKIE) ?? ""
        ).split(":");
        const setup = `/start?project=${projectId}&step=tickets`;
        const back =
          next === "start" ? `${setup}&` : `/projects/${projectId ?? ""}?`;
        // From the dashboard's Jira card: back there, where the pasted
        // ticket is linked and queued.
        const done =
          next === "dashboard"
            ? `/dashboard?tab=builder&project=${projectId}&from=${tracker}`
            : next === "start"
              ? setup
              : `${back}connected=${tracker}`;
        if (
          !projectId ||
          expectedTracker !== tracker ||
          expectedState !== url.searchParams.get("state")
        )
          return auth.redirect(
            `${back}error=${encodeURIComponent("The authorization expired. Try again.")}`,
            [clear],
          );
        const { data } = await auth.client.auth.getUser();
        if (!data.user) return auth.redirect("/sign-in", [clear]);
        const code = url.searchParams.get("code");
        const adapter = trackerAdapter(tracker);
        if (!code || !adapter.exchangeCode)
          return auth.redirect(
            `${back}error=${encodeURIComponent("The authorization was declined.")}`,
            [clear],
          );
        try {
          const { credentials } = trackerConfig(tracker);
          const tokens = await adapter.exchangeCode({
            credentials,
            code,
            redirectUri: callbackUrl(tracker),
          });
          await withDb((db) =>
            storeTrackerTokens(db, {
              userId: data.user.id,
              projectId,
              tracker,
              tokens,
            }),
          );
          return auth.redirect(done, [clear]);
        } catch (error) {
          return auth.redirect(
            `${back}error=${encodeURIComponent((error as Error).message)}`,
            [clear],
          );
        }
      },
    },
  },
});
