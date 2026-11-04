import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { logoSchema } from "@/core/forms";
import {
  BODY_MAX,
  DESTINATION,
  openedFromYarrow,
  TITLE_MAX,
} from "@/core/new-ticket";
import { projectLogo } from "@/core/logos";
import type { OpenIssue, ReviewRow, TicketRow } from "@/core/tickets";
import { requireProjectMember } from "@/db/accounts";
import { projectsForUser, requestGithubTask } from "@/db/github-tasks";
import { ownerDashboard } from "@/db/queries";
import { resolveLogo } from "@/db/images";
import { projects as projectsTable, workUnits } from "@/db/schema";
import { linkTicket, proposedTicketKey, threadMessages } from "@/db/chat";
import { projectTickets, retryTicket, reviewQueue } from "@/db/tickets";
import { getViewer, requireViewer } from "@/server/auth.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";
import { openIssues, readIssue } from "@/server/github/issues.server";
import {
  closeTrackerTicket,
  createTrackerTicket,
  jiraReady,
  labelTrackerTickets,
  openTrackerTickets,
  trackerContext,
  trackerTicketDetail,
} from "@/server/jira.server";
import { boardsForProject } from "@/db/trackers";
import { madeSpottedTicket, pullNumber, pullPanel } from "@/db/pull-panel";
import { liveChecks, livePull, pullFiles } from "@/server/github/pulls.server";
import { kickBrain } from "@/server/brain.server";
import type { TrackerName } from "@/server/trackers/types";

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
          // Repositories came with the install, none imported yet.
          importable: (await projectsForUser(db, viewer.userId)).some(
            (project) => project.linked,
          ),
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
            name: board.name,
            site: connection.name,
          })),
        },
        tickets: await projectTickets(db, project.id),
        issues: data.issues ? await openTickets(db, project) : null,
        review,
        jiraReady: jiraReady(),
        importable: false,
      };
    });
  });

const ticketRef = z.object({
  projectId: z.uuid(),
  key: z.string().min(1).max(64),
});

/**
 * A ticket's opened row: Yarrow's side (what the agents did, the review,
 * the corrections, the cost, who paid) and GitHub's (draft, size, risks).
 */
export const getPullPanelFn = createServerFn({ method: "GET" })
  .validator(ticketRef)
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    return withDb(async (db) => {
      const project = await requireProjectMember(
        db,
        viewer.userId,
        data.projectId,
      );
      // GitHub is read while Yarrow's side is.
      const [panel, live] = await Promise.all([
        pullPanel(db, project.id, data.key),
        pullNumber(db, project.id, data.key).then((number) =>
          number === null ? null : livePull(project, number),
        ),
      ]);
      if (!panel) return null;
      const [messages, checks] = await Promise.all([
        threadMessages(db, panel.workUnitId),
        panel.pullRequest && panel.proofs?.some((p) => p.kind === "check")
          ? liveChecks(project, panel.pullRequest.branch, panel.pullRequest.url)
          : null,
      ]);
      return {
        ...panel,
        // Only where the brain runs stages.
        preview: appEnv().BRAIN ? panel.preview : null,
        live,
        messages,
        checks,
      };
    });
  });

/**
 * What a ticket asks, read live from GitHub or Jira when its row opens:
 * the description, when and by whom it was written, its labels. Yarrow's
 * own copy of the description stands in when the tracker cannot be read.
 */
export const getTicketFn = createServerFn({ method: "GET" })
  .validator(ticketRef)
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    const { project, stored } = await withDb(async (db) => {
      const project = await requireProjectMember(
        db,
        viewer.userId,
        data.projectId,
      );
      const [stored] = await db
        .select({
          body: workUnits.body,
          url: workUnits.url,
          createdAt: workUnits.createdAt,
        })
        .from(workUnits)
        .where(
          and(
            eq(workUnits.projectId, project.id),
            eq(workUnits.externalId, data.key),
          ),
        )
        .limit(1);
      return { project, stored };
    });
    const live = /^\d+$/.test(data.key)
      ? await readIssue(project, Number(data.key))
      : await withDb((db) =>
          trackerTicketDetail(db, trackerContext(), project.id, data.key),
        );
    if (live) return live;
    if (!stored) return null;
    return {
      body: stored.body,
      createdAt: stored.createdAt.toISOString(),
      labels: [] as string[],
      url: stored.url,
    };
  });

/** The pull request's changes, read when the builder asks for them. */
export const getPullFilesFn = createServerFn({ method: "GET" })
  .validator(ticketRef)
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    const { project, number } = await withDb(async (db) => {
      const project = await requireProjectMember(
        db,
        viewer.userId,
        data.projectId,
      );
      return { project, number: await pullNumber(db, project.id, data.key) };
    });
    if (number === null) return null;
    return pullFiles(project, number);
  });

async function memberPanel(projectId: string, key: string) {
  const viewer = await requireViewer();
  const panel = await withDb(async (db) => {
    await requireProjectMember(db, viewer.userId, projectId);
    return pullPanel(db, projectId, key);
  });
  return { viewer, panel };
}

const unavailable = {
  ok: false as const,
  error: "Yarrow cannot reach GitHub right now. Try again in a minute.",
};

/** Ready for review, or Merge (ready first when it is a draft). */
export const pullRequestActionFn = createServerFn({ method: "POST" })
  .validator(ticketRef.extend({ action: z.enum(["ready", "merge"]) }))
  .handler(async ({ data }) => {
    const { panel } = await memberPanel(data.projectId, data.key);
    const brain = appEnv().BRAIN;
    if (!panel?.pullRequest || !brain) return unavailable;
    return brain.pullRequestAction({
      workUnitId: panel.workUnitId,
      action: data.action,
    });
  });

/**
 * A change the agent proposed in the conversation, made from its card: the
 * App writes it on the pull request under the builder's GitHub name, then
 * Claude takes it like an `@yarrow-run` comment.
 */
export const requestChangeFn = createServerFn({ method: "POST" })
  .validator(ticketRef.extend({ messageId: z.uuid() }))
  .handler(async ({ data }) => {
    const { viewer, panel } = await memberPanel(data.projectId, data.key);
    const brain = appEnv().BRAIN;
    if (!panel?.pullRequest || !brain) return unavailable;
    return brain.requestCorrection({
      workUnitId: panel.workUnitId,
      login: viewer.githubLogin ?? viewer.name ?? "A maintainer",
      chatMessageId: data.messageId,
    });
  });

/**
 * A question in a ticket's conversation, on its pull request or beside why it
 * stopped: the agent answers in the background, the opened row polls until it
 * has. Asked beside the stage, the agent may act on it while it is up.
 */
export const askChatFn = createServerFn({ method: "POST" })
  .validator(
    ticketRef.extend({
      text: z.string().trim().min(1).max(4000),
      stage: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { viewer, panel } = await memberPanel(data.projectId, data.key);
    const brain = appEnv().BRAIN;
    if (!panel || !brain) return unavailable;
    return brain.askChat({
      workUnitId: panel.workUnitId,
      userId: viewer.userId,
      text: data.text,
      stage: data.stage,
    });
  });

type Outcome = { ok: true } | { ok: false; error: string };
const githubKey = (key: string) => /^\d+$/.test(key);

/**
 * Closes a ticket where it lives (a GitHub issue as not planned, a Jira or
 * Linear ticket moved to done) and its open pull request; it leaves the list.
 */
export const closeTicketFn = createServerFn({ method: "POST" })
  .validator(ticketRef)
  .handler(async ({ data }): Promise<Outcome> => {
    const viewer = await requireViewer();
    const project = await withDb((db) =>
      requireProjectMember(db, viewer.userId, data.projectId),
    );
    const brain = appEnv().BRAIN;
    if (!brain) return unavailable;
    let source: "github" | TrackerName = "github";
    if (!githubKey(data.key))
      try {
        source = await withDb((db) =>
          closeTrackerTicket(db, trackerContext(), project.id, data.key),
        );
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    return brain.closeTicket({ projectId: project.id, key: data.key, source });
  });

/** Closes a ticket's pull request alone; the ticket stays open. */
export const closePullRequestFn = createServerFn({ method: "POST" })
  .validator(ticketRef)
  .handler(async ({ data }): Promise<Outcome> => {
    const { panel } = await memberPanel(data.projectId, data.key);
    const brain = appEnv().BRAIN;
    if (!panel?.pullRequest || !brain) return unavailable;
    return brain.closePullRequest({ workUnitId: panel.workUnitId });
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
  await kickBrain();
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

/**
 * A ticket written on the dashboard: an issue opened by the App (through
 * the brain), or a ticket in a linked Jira project. Queued at once when
 * asked, like a ticket labeled where it lives.
 */
export const createTicketFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      projectId: z.uuid(),
      destination: z.string().regex(DESTINATION),
      title: z.string().trim().min(1).max(TITLE_MAX),
      body: z.string().max(BODY_MAX),
      queue: z.boolean(),
      // Drafted from a pull request: a suggestion leaves that list, a card
      // in its conversation links to the ticket.
      from: z
        .object({
          key: z.string().max(40),
          note: z.string().min(1).max(BODY_MAX).optional(),
          messageId: z.uuid().optional(),
        })
        .optional(),
    }),
  )
  .handler(
    async ({
      data,
    }): Promise<{ ok: true; key: string } | { ok: false; error: string }> => {
      const made = async (ticketKey: string) => {
        const { projectId, from } = data;
        if (!from) return;
        const { key, note, messageId } = from;
        // The ticket is made either way: a suggestion left listed is the lesser harm.
        await withDb(async (db) => {
          if (note)
            await madeSpottedTicket(db, { projectId, key, note, ticketKey });
          if (messageId)
            await linkTicket(db, { projectId, messageId, ticketKey });
        }).catch(() => {});
      };
      const viewer = await requireViewer();
      const body = openedFromYarrow(
        data.body,
        viewer.githubLogin ?? viewer.name ?? "a maintainer",
      );
      const project = await withDb((db) =>
        requireProjectMember(db, viewer.userId, data.projectId),
      );
      const messageId = data.from?.messageId;
      if (messageId) {
        const key = await withDb((db) =>
          proposedTicketKey(db, { projectId: project.id, messageId }),
        );
        if (key) return { ok: true, key };
      }
      if (data.destination === "github") {
        const brain = appEnv().BRAIN;
        if (!brain) return unavailable;
        // The brain starts it at once when queued.
        const result = await brain.createIssue({
          projectId: project.id,
          title: data.title,
          body,
          queue: data.queue,
        });
        if (result.ok) await made(result.key);
        return result;
      }
      try {
        const key = await withDb((db) =>
          createTrackerTicket(
            db,
            trackerContext(),
            project,
            data.destination,
            { title: data.title, body },
            data.queue,
          ),
        );
        if (data.queue) await kickBrain();
        await made(key);
        return { ok: true, key };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },
  );

/** Retry an abstained ticket (the label is still on it). */
export const retryTicketFn = createServerFn({ method: "POST" })
  .validator(z.object({ projectId: z.uuid(), key: z.string().max(40) }))
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    return withDb(async (db) => {
      await requireProjectMember(db, viewer.userId, data.projectId);
      return { retried: await retryTicket(db, data.projectId, data.key) };
    }).then(async (result) => {
      await kickBrain();
      return result;
    });
  });
