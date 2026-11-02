import {
  and,
  asc,
  count,
  eq,
  gte,
  isNotNull,
  isNull,
  lt,
  sql,
} from "drizzle-orm";
import {
  CHAT_DAILY_QUESTIONS,
  chatDayStart,
  type ChatUsage,
} from "../core/chat";
import type { Database } from "./client";
import { pullPanel, type PanelData } from "./pull-panel";
import { chatMessages, projects, pullRequests, workUnits } from "./schema";

/** One line of the conversation, as the dashboard shows it. */
export interface PanelMessage {
  id: string;
  author: "builder" | "agent";
  body: string;
  status: "pending" | "done" | "failed";
  /** A change the agent proposes; once made, the correction it queued. */
  change: string | null;
  correctionRequestId: string | null;
  createdAt: string;
}

/** An answer still pending after this long is taken as lost. */
const LOST_AFTER_MS = 5 * 60_000;

export type AskResult =
  | { ok: true; questionId: string; answerId: string }
  | { ok: false; reason: "limit" | "busy" };

/**
 * A member's question, and the place of its answer, pending until the
 * agent writes it. One answer at a time per pull request; one person asks
 * at most CHAT_DAILY_QUESTIONS a day, every project together.
 */
export async function askQuestion(
  db: Database,
  input: { workUnitId: string; userId: string; text: string },
  now = new Date(),
): Promise<AskResult> {
  return db.transaction(async (tx) => {
    // Questions on one pull request wait for each other.
    await tx
      .select({ id: workUnits.id })
      .from(workUnits)
      .where(eq(workUnits.id, input.workUnitId))
      .for("update");
    await tx
      .update(chatMessages)
      .set({ status: "failed" })
      .where(
        and(
          eq(chatMessages.workUnitId, input.workUnitId),
          eq(chatMessages.status, "pending"),
          lt(chatMessages.createdAt, new Date(now.getTime() - LOST_AFTER_MS)),
        ),
      );
    const [pending] = await tx
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.workUnitId, input.workUnitId),
          eq(chatMessages.status, "pending"),
        ),
      )
      .limit(1);
    if (pending) return { ok: false, reason: "busy" };
    const [asked] = await tx
      .select({ n: count() })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.userId, input.userId),
          eq(chatMessages.author, "builder"),
          gte(chatMessages.createdAt, chatDayStart(now)),
        ),
      );
    if ((asked?.n ?? 0) >= CHAT_DAILY_QUESTIONS)
      return { ok: false, reason: "limit" };
    const [question, answer] = await tx
      .insert(chatMessages)
      .values([
        {
          workUnitId: input.workUnitId,
          author: "builder",
          userId: input.userId,
          body: input.text,
          createdAt: now,
        },
        {
          workUnitId: input.workUnitId,
          author: "agent",
          userId: input.userId,
          status: "pending",
          // A millisecond later, so the thread's order never ties.
          createdAt: new Date(now.getTime() + 1),
        },
      ])
      .returning({ id: chatMessages.id });
    return { ok: true, questionId: question!.id, answerId: answer!.id };
  });
}

/** The answer as the agent wrote it, unless it was given up as lost. */
export async function saveAnswer(
  db: Database,
  answerId: string,
  answer: { body: string; change: string | null; usage: ChatUsage | null },
): Promise<void> {
  await db
    .update(chatMessages)
    .set({ ...answer, status: "done" })
    .where(
      and(eq(chatMessages.id, answerId), eq(chatMessages.status, "pending")),
    );
}

export async function failAnswer(
  db: Database,
  answerId: string,
  usage: ChatUsage | null = null,
): Promise<void> {
  await db
    .update(chatMessages)
    .set({ status: "failed", usage })
    .where(
      and(eq(chatMessages.id, answerId), eq(chatMessages.status, "pending")),
    );
}

/** The conversation, oldest first. */
export async function threadMessages(
  db: Database,
  workUnitId: string,
): Promise<PanelMessage[]> {
  const rows = await db
    .select()
    .from(chatMessages)
    .where(eq(chatMessages.workUnitId, workUnitId))
    .orderBy(asc(chatMessages.createdAt));
  return rows.map((row) => ({
    id: row.id,
    author: row.author,
    body: row.body,
    status: row.status,
    change: row.change,
    correctionRequestId: row.correctionRequestId,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}

/** The change the agent proposed, while it is still there to make. */
export async function openProposal(
  db: Database,
  input: { messageId: string; workUnitId: string },
): Promise<string | null> {
  const [row] = await db
    .select({ change: chatMessages.change })
    .from(chatMessages)
    .where(
      and(
        eq(chatMessages.id, input.messageId),
        eq(chatMessages.workUnitId, input.workUnitId),
        isNotNull(chatMessages.change),
        isNull(chatMessages.correctionRequestId),
      ),
    );
  return row?.change ?? null;
}

/** A proposed change made from its card: the correction it queued. */
export async function linkChange(
  db: Database,
  input: { messageId: string; workUnitId: string; correctionRequestId: string },
): Promise<void> {
  await db
    .update(chatMessages)
    .set({ correctionRequestId: input.correctionRequestId })
    .where(
      and(
        eq(chatMessages.id, input.messageId),
        eq(chatMessages.workUnitId, input.workUnitId),
        isNull(chatMessages.correctionRequestId),
      ),
    );
}

/** Everything the agent is told before the question. */
export interface ChatContext {
  answerId: string;
  project: {
    id: string;
    name: string;
    repository: string;
    defaultBranch: string;
    githubInstallationId: string | null;
    githubRepositoryId: string | null;
  };
  ticket: {
    source: string;
    key: string;
    title: string;
    body: string;
    url: string;
  };
  pullRequest: {
    number: number;
    url: string;
    branch: string;
    state: "open" | "merged" | "closed";
  } | null;
  panel: PanelData | null;
  /** Earlier questions and answers, then the question being answered. */
  history: { author: "builder" | "agent"; body: string }[];
}

export async function chatContext(
  db: Database,
  answerId: string,
): Promise<ChatContext | null> {
  const [row] = await db
    .select({ answer: chatMessages, unit: workUnits, project: projects })
    .from(chatMessages)
    .innerJoin(workUnits, eq(workUnits.id, chatMessages.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(eq(chatMessages.id, answerId));
  if (!row) return null;
  const [about, earlier] = await Promise.all([
    describePull(db, row),
    db
      .select({
        author: chatMessages.author,
        body: chatMessages.body,
        status: chatMessages.status,
      })
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.workUnitId, row.unit.id),
          lt(chatMessages.createdAt, row.answer.createdAt),
        ),
      )
      .orderBy(asc(chatMessages.createdAt)),
  ]);
  return {
    answerId,
    ...about,
    // A failed answer left its question unanswered: both stay out.
    history: earlier
      .filter((message, i) => {
        if (message.author === "agent")
          return message.status === "done" && message.body.trim() !== "";
        const next = earlier[i + 1];
        return !next || (next.author === "agent" && next.status === "done");
      })
      .map(({ author, body }) => ({ author, body })),
  };
}

/** The pull request alone, for the live call: no question, no history. */
export async function pullContext(
  db: Database,
  workUnitId: string,
): Promise<Omit<ChatContext, "answerId" | "history"> | null> {
  const [row] = await db
    .select({ unit: workUnits, project: projects })
    .from(workUnits)
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(eq(workUnits.id, workUnitId));
  return row ? describePull(db, row) : null;
}

async function describePull(
  db: Database,
  row: {
    unit: typeof workUnits.$inferSelect;
    project: typeof projects.$inferSelect;
  },
): Promise<Omit<ChatContext, "answerId" | "history">> {
  const [[pull], panel] = await Promise.all([
    db
      .select()
      .from(pullRequests)
      .where(eq(pullRequests.workUnitId, row.unit.id)),
    pullPanel(db, row.unit.projectId, row.unit.externalId),
  ]);
  return {
    project: {
      id: row.project.id,
      name: row.project.name,
      repository: row.project.repository,
      defaultBranch: row.project.defaultBranch,
      githubInstallationId: row.project.githubInstallationId,
      githubRepositoryId: row.project.githubRepositoryId,
    },
    ticket: {
      source: row.unit.source,
      key: row.unit.externalId,
      title: row.unit.title,
      body: row.unit.body,
      url: row.unit.url,
    },
    pullRequest: pull
      ? {
          number: pull.number,
          url: pull.url,
          branch: pull.branch,
          state: pull.state,
        }
      : null,
    panel,
  };
}

/** The project's tickets Yarrow knows, newest first, for the agent. */
export async function ticketsForChat(
  db: Database,
  projectId: string,
): Promise<
  {
    source: string;
    key: string;
    title: string;
    status: string;
    pullRequest: { number: number; state: string } | null;
  }[]
> {
  const rows = await db
    .select({
      source: workUnits.source,
      key: workUnits.externalId,
      title: workUnits.title,
      status: workUnits.status,
      number: pullRequests.number,
      state: pullRequests.state,
    })
    .from(workUnits)
    .leftJoin(pullRequests, eq(pullRequests.workUnitId, workUnits.id))
    .where(eq(workUnits.projectId, projectId))
    .orderBy(sql`${workUnits.createdAt} desc`)
    .limit(200);
  return rows.map((row) => ({
    source: row.source,
    key: row.key,
    title: row.title,
    status: row.status,
    pullRequest:
      row.number === null ? null : { number: row.number, state: row.state! },
  }));
}

/** One ticket Yarrow knows, with what it asks. */
export async function ticketForChat(
  db: Database,
  projectId: string,
  key: string,
): Promise<{
  source: string;
  title: string;
  body: string;
  url: string;
} | null> {
  const [row] = await db
    .select({
      source: workUnits.source,
      title: workUnits.title,
      body: workUnits.body,
      url: workUnits.url,
    })
    .from(workUnits)
    .where(
      and(eq(workUnits.projectId, projectId), eq(workUnits.externalId, key)),
    );
  return row ?? null;
}
