import { createFileRoute } from "@tanstack/react-router";
import { projectsForUser } from "@/db/github-tasks";
import { stateCookie, supabaseForRequest } from "@/server/auth-request.server";
import { CONNECT_COOKIE, connectIntentSchema } from "@/server/connect.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";

/**
 * "Connect GitHub" and "Get a pull request": sign in with GitHub, then install
 * the App on the repositories. Projects are created from the installation;
 * a repository that is already connected skips GitHub entirely.
 */
export const Route = createFileRoute("/connect/github")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const parsed = connectIntentSchema.safeParse(
          Object.fromEntries(url.searchParams),
        );
        const intent = parsed.success ? parsed.data : {};
        const auth = supabaseForRequest(request);
        const { data } = await auth.client.auth.getUser();
        const github = data.user?.identities?.some(
          (identity) => identity.provider === "github",
        );
        if (!data.user || !github)
          return auth.redirect(
            `/auth/github?next=${encodeURIComponent(url.pathname + url.search)}`,
          );
        const cookie = stateCookie(
          CONNECT_COOKIE,
          JSON.stringify(intent),
          1800,
        );
        const repository = intent.repository?.toLowerCase();
        const connected =
          repository && databaseConfigured()
            ? (await withDb((db) => projectsForUser(db, data.user!.id))).some(
                (project) =>
                  project.linked &&
                  project.repository.toLowerCase() === repository,
              )
            : false;
        if (connected) return auth.redirect("/dashboard", [cookie]);
        return auth.redirect(
          `https://github.com/apps/${appEnv().GITHUB_APP_SLUG}/installations/new`,
          [cookie],
        );
      },
    },
  },
});
