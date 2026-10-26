import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { logoSchema } from "@/core/forms";
import { projectLogo } from "@/core/logos";
import type { OpenIssue, ReviewRow, TicketRow } from "@/core/tickets";
import { requireProjectMember } from "@/db/accounts";
import { requestGithubTask } from "@/db/github-tasks";
import { ownerDashboard } from "@/db/queries";
import { resolveLogo } from "@/db/images";
import { projects as projectsTable } from "@/db/schema";
import { projectTickets, retryTicket, reviewQueue } from "@/db/tickets";
import { getViewer, requireViewer } from "@/server/auth.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { openIssues } from "@/server/github/issues.server";
import {
  jiraReady,
  labelTrackerTickets,
  openTrackerTickets,
  trackerContext,
} from "@/server/jira.server";
import { boardsForProject } from "@/db/trackers";

/**
 * The builder side of the dashboard: the viewer's projects, one project's
 * tickets, and the pull requests waiting for review across all of them.
 * `issues` also reads the open issues from GitHub; the table polls without
 * it, so GitHub is not called every few seconds.
 */
export const getBuilderFn = createServerFn({ method: "GET" })
  .validator(z.object({ projectId: z.uuid().optional(), issues: z.boolean() }))
  .handler(async ({ data }) => {
    const viewer = await getViewer().catch(() => null);
    if (!viewer) return { status: "signed_out" as const };
    if (!databaseConfigured()) return { status: "not_configured" as const };
    return withDb(async (db) => {
      const { projects: owned } = await ownerDashboard(db, viewer.userId);
      // The builder's own dashboard: every project may show its owner's avatar.
      const projects = owned.map((project) => ({
        ...project,
        logoUrl: projectLogo(project.logoUrl, project.repository),
      }));
      const review = await reviewQueue(db, projects);
      const chosen =
        projects.find((project) => project.id === data.projectId) ??
        projects.find((project) => project.linked) ??
        projects[0];
      if (!chosen)
        return {
          status: "ok" as const,
          projects,
          project: null,
          tickets: [] as TicketRow[],
          issues: null as OpenIssue[] | null,
          review: [] as ReviewRow[],
          jiraReady: jiraReady(),
        };
      const project = await requireProjectMember(db, viewer.userId, chosen.id);
      const boards = await boardsForProject(db, project.id);
      return {
        status: "ok" as const,
        projects,
        project: {
          id: project.id,
          name: project.name,
          repository: project.repository,
          visibility: project.visibility,
          linked: project.githubInstallationId !== null,
          label: project.authorizationLabel,
          logoUrl: chosen.logoUrl,
          uploadedLogo: project.logoUrl !== null,
          // Linked tracker projects ("APP" on acme.atlassian.net).
          boards: boards.map(({ board, connection }) => ({
            tracker: connection.tracker,
            key: board.externalBoardId,
            site: connection.name,
          })),
        },
        tickets: await projectTickets(db, project.id),
        issues: data.issues ? await openTickets(db, project) : null,
        review,
        jiraReady: jiraReady(),
      };
    });
  });

/** The logo tile in the project's head: saved as soon as it is chosen. */
export const setProjectLogoFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: z.uuid(), logo: logoSchema }))
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    return withDb(async (db) => {
      const project = await requireProjectMember(
        db,
        viewer.userId,
        data.projectId,
      );
      const logoUrl = (await resolveLogo(db, data.logo)) ?? null;
      await db
        .update(projectsTable)
        .set({ logoUrl })
        .where(eq(projectsTable.id, project.id));
      return { logoUrl: projectLogo(logoUrl, project.repository) };
    });
  });

/**
 * GitHub's open issues and the linked trackers' open tickets. Null when
 * neither answers (the table then shows Yarrow's tickets only).
 */
async function openTickets(
  db: Parameters<typeof openTrackerTickets>[0],
  project: Parameters<typeof openIssues>[0] & { id: string },
) {
  const [github, trackers] = await Promise.all([
    openIssues(project),
    openTrackerTickets(db, trackerContext(), project.id),
  ]);
  return github === null && trackers === null
    ? null
    : [...(github ?? []), ...(trackers ?? [])];
}

/** The visibility chip in the project's head: saved as soon as it changes. */
export const setProjectVisibilityFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      projectId: z.uuid(),
      visibility: z.enum(["public", "listed", "hidden"]),
    }),
  )
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    await withDb(async (db) => {
      const project = await requireProjectMember(
        db,
        viewer.userId,
        data.projectId,
      );
      await db
        .update(projectsTable)
        .set({ visibility: data.visibility })
        .where(eq(projectsTable.id, project.id));
    });
    return { saved: true };
  });

const ticketsInput = z.object({
  projectId: z.uuid(),
  /** "42" for a GitHub issue, "APP-42" for a Jira ticket. */
  keys: z
    .array(z.string().regex(/^(\d{1,9}|[A-Z][A-Z0-9_]{0,9}-\d{1,9})$/))
    .min(1)
    .max(100),
});
const isGithub = (key: string) => /^\d+$/.test(key);

/**
 * Add to the queue (on) or remove from it: GitHub labels go through the
 * brain; Jira labels are set from here. Running work finishes either way.
 */
async function setQueued(
  userId: string,
  data: z.infer<typeof ticketsInput>,
  on: boolean,
) {
  await withDb(async (db) => {
    const project = await requireProjectMember(db, userId, data.projectId);
    const keys = [...new Set(data.keys)];
    for (const key of keys.filter(isGithub))
      await requestGithubTask(db, {
        projectId: project.id,
        kind: on ? "label_issue" : "unlabel_issue",
        issueNumber: Number(key),
      });
    const tracked = keys.filter((key) => !isGithub(key));
    if (tracked.length)
      await labelTrackerTickets(db, trackerContext(), project, tracked, on);
  });
  return { ok: true };
}

export const queueTicketsFn = createServerFn({ method: "POST" })
  .validator(ticketsInput)
  .handler(async ({ data }) =>
    setQueued((await requireViewer()).userId, data, true),
  );

export const unqueueTicketsFn = createServerFn({ method: "POST" })
  .validator(ticketsInput)
  .handler(async ({ data }) =>
    setQueued((await requireViewer()).userId, data, false),
  );

/** Retry an abstained ticket (the label is still on it). */
export const retryTicketFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: z.uuid(), key: z.string().max(40) }))
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    return withDb(async (db) => {
      await requireProjectMember(db, viewer.userId, data.projectId);
      return { retried: await retryTicket(db, data.projectId, data.key) };
    });
  });
