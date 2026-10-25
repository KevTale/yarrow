import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { requestTicket } from "@/db/github-tasks";
import { getViewer } from "@/server/auth.server";
import { CONNECT_COOKIE, readIntent } from "@/server/connect.server";
import { databaseConfigured, withDb } from "@/server/db.server";

/**
 * The ticket pasted on the landing, queued as soon as its repository is
 * connected (after a GitHub install the webhook may lag a few seconds).
 * `waiting` names the repository still being connected.
 */
export const settleConnectFn = createServerFn({ method: "POST" }).handler(
  async () => {
    const none = { queued: null, waiting: null };
    const viewer = await getViewer().catch(() => null);
    if (!viewer || !databaseConfigured()) return none;
    const intent = readIntent(getCookie(CONNECT_COOKIE));
    if (!intent.repository || !intent.issue) {
      if (getCookie(CONNECT_COOKIE))
        setCookie(CONNECT_COOKIE, "", { path: "/", maxAge: 0 });
      return none;
    }
    const { repository, issue } = intent;
    const projectId = await withDb((db) =>
      requestTicket(db, viewer.userId, repository, issue),
    );
    if (!projectId) return { queued: null, waiting: repository };
    setCookie(CONNECT_COOKIE, "", { path: "/", maxAge: 0 });
    return { queued: { projectId, repository, issue }, waiting: null };
  },
);
