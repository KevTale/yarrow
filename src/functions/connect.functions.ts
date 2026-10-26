import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { jiraKeyPattern } from "@/core/ticket-link";
import { requestTicket } from "@/db/github-tasks";
import { getViewer, requireViewer } from "@/server/auth.server";
import { CONNECT_COOKIE, readIntent } from "@/server/connect.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import {
  jiraProjects,
  jiraReady,
  linkJiraProject,
  JiraAccessError,
  jiraBoardSettings,
  setJiraMoves,
  setJiraProjects,
  settleJira,
  trackerContext,
  type JiraStep,
} from "@/server/jira.server";

const forget = () => setCookie(CONNECT_COOKIE, "", { path: "/", maxAge: 0 });

/**
 * The ticket pasted on the landing, queued as soon as its repository is
 * connected (after a GitHub install the webhook may lag a few seconds).
 * `waiting` names the repository still being connected. A Jira link waits
 * for Jira instead: `jira` is the step the dashboard shows until then.
 * `projectId` is the repository Jira was just connected from, if so.
 */
export const settleConnectFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: z.uuid().optional() }).optional())
  .handler(async ({ data }) => {
    const none = {
      queued: null as { projectId: string; key: string | null } | null,
      waiting: null as string | null,
      jira: null as JiraStep | null,
    };
    const viewer = await getViewer().catch(() => null);
    if (!viewer || !databaseConfigured()) return none;
    const intent = readIntent(getCookie(CONNECT_COOKIE));
    if (intent.source === "jira" && jiraReady()) {
      const settled = await withDb((db) =>
        settleJira(db, trackerContext(), viewer.userId, intent, data?.projectId),
      ).catch((error: Error) => {
        console.warn("jira settle:", error.message);
        return null;
      });
      if (settled && "queued" in settled) {
        forget();
        return { ...none, queued: settled.queued };
      }
      return { ...none, jira: settled?.step ?? null };
    }
    if (!intent.repository || !intent.issue) {
      if (getCookie(CONNECT_COOKIE)) forget();
      return none;
    }
    const { repository, issue } = intent;
    const projectId = await withDb((db) =>
      requestTicket(db, viewer.userId, repository, issue),
    );
    if (!projectId) return { ...none, waiting: repository };
    forget();
    return { ...none, queued: { projectId, key: String(issue) } };
  });

/**
 * The Jira projects of a connected site. `revoked` when Atlassian refuses
 * the token: the person removed Yarrow's access there.
 */
export const listJiraProjectsFn = createServerFn({ method: "GET" })
  .validator(z.object({ connectionId: z.uuid() }))
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    try {
      const projects = await withDb((db) =>
        jiraProjects(db, trackerContext(), viewer.userId, data.connectionId),
      );
      return { projects, revoked: false };
    } catch (error) {
      if (error instanceof JiraAccessError)
        return { projects: [] as { id: string; name: string }[], revoked: true };
      throw error;
    }
  });

/** Links a Jira project to a repository; the pasted ticket is queued. */
export const linkJiraFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      projectId: z.uuid(),
      connectionId: z.uuid(),
      jiraKey: z.string().regex(/^[A-Z][A-Z0-9_]{0,9}$/),
      ticket: z.string().regex(jiraKeyPattern).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    const linked = await withDb((db) =>
      linkJiraProject(db, trackerContext(), viewer.userId, data),
    );
    forget();
    return linked;
  });

/** The settings page's Jira projects, saved at each tick. */
export const setJiraProjectsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      projectId: z.uuid(),
      connectionId: z.uuid(),
      jiraKeys: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{0,9}$/)).max(50),
    }),
  )
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    await withDb((db) =>
      setJiraProjects(db, trackerContext(), viewer.userId, data),
    );
    return { saved: true };
  });

/** A linked Jira project's statuses and where its tickets move. */
export const getJiraBoardFn = createServerFn({ method: "GET" })
  .validator(z.object({ boardId: z.uuid() }))
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    return withDb((db) =>
      jiraBoardSettings(db, trackerContext(), viewer.userId, data.boardId),
    );
  });

const statusId = z.string().max(40).nullable();

/** Where the tickets move, saved at each change. */
export const setJiraMovesFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      boardId: z.uuid(),
      moves: z.object({
        started: statusId,
        pullRequest: statusId,
        merged: statusId,
      }),
    }),
  )
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    await withDb((db) =>
      setJiraMoves(db, viewer.userId, data.boardId, data.moves),
    );
    return { saved: true };
  });

/** "Not now" on the Jira card: the pasted link is forgotten. */
export const dismissConnectFn = createServerFn({ method: "POST" }).handler(
  async () => {
    forget();
    return { ok: true };
  },
);
