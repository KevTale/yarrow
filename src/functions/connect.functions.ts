import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { projectsForUser, requestTicket } from "@/db/github-tasks";
import { getViewer } from "@/server/auth.server";
import { CONNECT_COOKIE, readIntent } from "@/server/connect.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";

/**
 * Back from the GitHub install: the viewer's projects, and the pasted ticket
 * queued as soon as its repository is connected (the webhook may lag).
 */
export const settleConnectFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const viewer = await getViewer().catch(() => null);
    if (!viewer) return { status: "signed_out" as const };
    if (!databaseConfigured()) return { status: "not_configured" as const };
    const intent = readIntent(getCookie(CONNECT_COOKIE));
    return withDb(async (db) => {
      let queued: { repository: string; issue: number } | null = null;
      if (intent.repository && intent.issue) {
        const projectId = await requestTicket(
          db,
          viewer.userId,
          intent.repository,
          intent.issue,
        );
        if (projectId) {
          queued = { repository: intent.repository, issue: intent.issue };
          setCookie(CONNECT_COOKIE, "", { path: "/", maxAge: 0 });
        }
      }
      return {
        status: "ok" as const,
        projects: await projectsForUser(db, viewer.userId),
        intent: queued ? {} : intent,
        queued,
        installUrl: `https://github.com/apps/${appEnv().GITHUB_APP_SLUG}/installations/new`,
      };
    });
  },
);
