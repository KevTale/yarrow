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
        };
      const project = await requireProjectMember(db, viewer.userId, chosen.id);
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
        },
        tickets: await projectTickets(db, project.id),
        issues: data.issues ? await openIssues(project) : null,
        review,
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

const ticketsInput = z.object({
  projectId: z.uuid(),
  numbers: z.array(z.number().int().positive()).min(1).max(100),
});

/** Queue: the brain puts the project's label on each issue. */
export const queueTicketsFn = createServerFn({ method: "POST" })
  .validator(ticketsInput)
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    await withDb(async (db) => {
      await requireProjectMember(db, viewer.userId, data.projectId);
      for (const issueNumber of new Set(data.numbers))
        await requestGithubTask(db, {
          projectId: data.projectId,
          kind: "label_issue",
          issueNumber,
        });
    });
    return { ok: true };
  });

/** Remove from the queue: the brain takes the label off. Running work finishes. */
export const unqueueTicketsFn = createServerFn({ method: "POST" })
  .validator(ticketsInput)
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    await withDb(async (db) => {
      await requireProjectMember(db, viewer.userId, data.projectId);
      for (const issueNumber of new Set(data.numbers))
        await requestGithubTask(db, {
          projectId: data.projectId,
          kind: "unlabel_issue",
          issueNumber,
        });
    });
    return { ok: true };
  });

/** Retry an abstained ticket (the label is still on it). */
export const retryTicketFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: z.uuid(), number: z.number().int() }))
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    return withDb(async (db) => {
      await requireProjectMember(db, viewer.userId, data.projectId);
      return { retried: await retryTicket(db, data.projectId, data.number) };
    });
  });
