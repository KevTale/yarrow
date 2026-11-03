import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { BODY_MAX, TITLE_MAX, type DraftText } from "@/core/new-ticket";
import { requireProjectMember } from "@/db/accounts";
import { openDraft, readDraft } from "@/db/ticket-drafts";
import { requireViewer } from "@/server/auth.server";
import { withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";

const draft = { projectId: z.uuid(), draftId: z.uuid() };
const form = {
  title: z.string().max(TITLE_MAX),
  body: z.string().max(BODY_MAX),
};

export type TicketCall =
  | { ok: true; conversationToken: string; grant: string }
  | { ok: false; reason: string };

/**
 * A call with the agent that writes a ticket: what the page starts it with.
 * The form as it stands goes in the draft, where the call's turns read it.
 */
export const ticketCallFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...draft,
      ...form,
      language: z
        .string()
        .regex(/^[a-z]{2,3}$/)
        .default("en"),
    }),
  )
  .handler(async ({ data }): Promise<TicketCall> => {
    const { userId } = await requireViewer();
    const { projectId, draftId, title, body, language } = data;
    const opened = await withDb(async (db) => {
      await requireProjectMember(db, userId, projectId);
      return openDraft(db, { id: draftId, projectId, userId }, { title, body });
    });
    const brain = appEnv().BRAIN;
    if (!opened || !brain)
      return { ok: false, reason: "No call for this ticket here." };
    return brain.ticketCall({ draftId, projectId, userId, language });
  });

/** The form as the agent left it, read back while a call goes on. */
export const draftFormFn = createServerFn({ method: "POST" })
  .validator(z.object(draft))
  .handler(async ({ data }): Promise<DraftText | null> => {
    const { userId } = await requireViewer();
    const { projectId, draftId: id } = data;
    return withDb((db) => readDraft(db, { id, projectId, userId }));
  });

/** What the member changed by hand during a call: the agent's next turn sees it. */
export const saveDraftFormFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...draft, ...form }))
  .handler(async ({ data }) => {
    const { userId } = await requireViewer();
    const { projectId, draftId: id, title, body } = data;
    await withDb(async (db) => {
      await requireProjectMember(db, userId, projectId);
      await openDraft(db, { id, projectId, userId }, { title, body });
    });
  });
