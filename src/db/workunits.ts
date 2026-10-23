import { and, eq } from "drizzle-orm";
import type { Database } from "./client";
import { recordEvent } from "./events";
import {
  correctionRequests,
  projects,
  pullRequests,
  workUnits,
} from "./schema";

export interface TicketSnapshot {
  projectId: string;
  source: "github" | "linear" | "jira" | "trello";
  boardId?: string | null;
  externalId: string;
  title: string;
  body: string;
  url: string;
  /** The ticket carries the project's authorization label. */
  labeled: boolean;
  /** Closed or done in the tracker. */
  closed: boolean;
}

/**
 * Mirrors a tracker ticket. A ticket enters the queue when it gets the
 * label, and leaves it when the label is removed or the ticket is closed
 * before a run starts. Running and delivered work is never interrupted.
 */
export async function upsertTicket(
  db: Database,
  ticket: TicketSnapshot,
): Promise<{ workUnitId: string; queued: boolean }> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(workUnits)
      .where(
        and(
          eq(workUnits.projectId, ticket.projectId),
          eq(workUnits.source, ticket.source),
          eq(workUnits.externalId, ticket.externalId),
        ),
      )
      .for("update");
    const eligible = ticket.labeled && !ticket.closed;
    if (!existing) {
      const [created] = await tx
        .insert(workUnits)
        .values({
          projectId: ticket.projectId,
          source: ticket.source,
          boardId: ticket.boardId ?? null,
          externalId: ticket.externalId,
          title: ticket.title,
          body: ticket.body,
          url: ticket.url,
          authorized: ticket.labeled,
          status: ticket.closed ? "closed" : "queued",
        })
        .returning({ id: workUnits.id });
      if (eligible)
        await recordEvent(tx, {
          type: "work_unit.queued",
          projectId: ticket.projectId,
          workUnitId: created!.id,
          payload: { source: ticket.source },
        });
      return { workUnitId: created!.id, queued: eligible };
    }
    // A closed ticket can come back (reopened), unless it already shipped a PR.
    const [shipped] =
      existing.status === "closed"
        ? await tx
            .select({ id: pullRequests.id })
            .from(pullRequests)
            .where(eq(pullRequests.workUnitId, existing.id))
        : [];
    const waiting =
      ["queued", "abstained"].includes(existing.status) ||
      (existing.status === "closed" && !shipped);
    const requeue =
      eligible && waiting && (!existing.authorized || existing.status !== "queued");
    await tx
      .update(workUnits)
      .set({
        title: ticket.title,
        body: ticket.body,
        url: ticket.url,
        authorized: ticket.labeled,
        ...(requeue ? { status: "queued" as const, queuedAt: new Date() } : {}),
        ...(ticket.closed && existing.status === "queued"
          ? { status: "closed" as const }
          : {}),
      })
      .where(eq(workUnits.id, existing.id));
    if (requeue)
      await recordEvent(tx, {
        type: "work_unit.queued",
        projectId: ticket.projectId,
        workUnitId: existing.id,
        payload: { source: ticket.source, requeued: true },
      });
    else if (!eligible && existing.status === "queued" && existing.authorized)
      await recordEvent(tx, {
        type: "work_unit.unqueued",
        projectId: ticket.projectId,
        workUnitId: existing.id,
        payload: { closed: ticket.closed },
      });
    return {
      workUnitId: existing.id,
      queued: requeue || (eligible && existing.status === "queued"),
    };
  });
}

/**
 * Queues an `@agent-commons <request>` comment from a delivered PR.
 * Returns null when the PR is not ours or is closed.
 */
export async function queueCorrection(
  db: Database,
  input: {
    pullRequestUrl: string;
    instruction: string;
    requestedBy: string;
    externalCommentId: string;
  },
): Promise<string | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ pullRequest: pullRequests, projectId: workUnits.projectId })
      .from(pullRequests)
      .innerJoin(workUnits, eq(workUnits.id, pullRequests.workUnitId))
      .innerJoin(projects, eq(projects.id, workUnits.projectId))
      .where(eq(pullRequests.url, input.pullRequestUrl));
    if (!row || row.pullRequest.state !== "open") return null;
    const [created] = await tx
      .insert(correctionRequests)
      .values({
        workUnitId: row.pullRequest.workUnitId,
        instruction: input.instruction,
        requestedBy: input.requestedBy,
        externalCommentId: input.externalCommentId,
      })
      .onConflictDoNothing()
      .returning({ id: correctionRequests.id });
    if (!created) return null;
    await recordEvent(tx, {
      type: "correction.requested",
      projectId: row.projectId,
      workUnitId: row.pullRequest.workUnitId,
      payload: { requestedBy: input.requestedBy },
    });
    return created.id;
  });
}
