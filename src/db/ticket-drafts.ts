import { and, eq, gte, sql } from "drizzle-orm";
import { chatDayStart, type ChatUsage } from "../core/chat";
import type { DraftLine, DraftText } from "../core/new-ticket";
import type { Database } from "./client";
import { projects, ticketDrafts } from "./schema";

/** Whose draft: one person's, in one project. */
export interface DraftRef {
  id: string;
  projectId: string;
  userId: string;
}

const own = (ref: DraftRef) =>
  and(
    eq(ticketDrafts.id, ref.id),
    eq(ticketDrafts.projectId, ref.projectId),
    eq(ticketDrafts.userId, ref.userId),
  );

/**
 * A draft, made the first time the page names it, with the form's text when
 * it comes. Someone else's stays out of reach: null.
 */
export async function openDraft(
  db: Database,
  ref: DraftRef,
  text?: DraftText,
  now = new Date(),
) {
  const [row] = await db
    .insert(ticketDrafts)
    .values({ ...ref, ...text })
    .onConflictDoUpdate({
      target: ticketDrafts.id,
      set: { ...text, updatedAt: now },
      where: and(
        eq(ticketDrafts.projectId, ref.projectId),
        eq(ticketDrafts.userId, ref.userId),
      ),
    })
    .returning();
  return row ?? null;
}

/** The form as the draft has it, for a page following a call. */
export async function readDraft(
  db: Database,
  ref: DraftRef,
): Promise<DraftText | null> {
  const [row] = await db
    .select({ title: ticketDrafts.title, body: ticketDrafts.body })
    .from(ticketDrafts)
    .where(own(ref));
  return row ?? null;
}

/** A turn ended: what was said joins the thread. */
export async function saveDraftTurn(
  db: Database,
  ref: DraftRef,
  turn: { said: string; words: string; usage: ChatUsage },
  now = new Date(),
): Promise<void> {
  const lines: DraftLine[] = [
    { author: "builder", body: turn.said },
    { author: "agent", body: turn.words },
  ];
  await db
    .update(ticketDrafts)
    .set({
      thread: sql`${ticketDrafts.thread} || ${JSON.stringify(lines)}::jsonb`,
      turns: sql`${ticketDrafts.turns} + 1`,
      usage: turn.usage,
      updatedAt: now,
    })
    .where(own(ref));
}

/** Turns one person took today (UTC), every project together. */
export async function draftTurnsToday(
  db: Database,
  userId: string,
  now = new Date(),
): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${ticketDrafts.turns}), 0)::int` })
    .from(ticketDrafts)
    .where(
      and(
        eq(ticketDrafts.userId, userId),
        gte(ticketDrafts.updatedAt, chatDayStart(now)),
      ),
    );
  return row?.n ?? 0;
}

/** The project, as the agent's tools read it. */
export async function draftProject(db: Database, projectId: string) {
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      repository: projects.repository,
      defaultBranch: projects.defaultBranch,
      githubInstallationId: projects.githubInstallationId,
      githubRepositoryId: projects.githubRepositoryId,
    })
    .from(projects)
    .where(eq(projects.id, projectId));
  return project ?? null;
}
