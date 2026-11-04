import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { StageCueResult, StageStatus } from "@/core/stage";
import { requireProjectMember } from "@/db/accounts";
import { pullPanel } from "@/db/pull-panel";
import { requireViewer } from "@/server/auth.server";
import { withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";

const ticket = { projectId: z.uuid(), key: z.string().min(1).max(64) };

/** The ticket's pull request, for a member of its project. */
async function stageOf(data: { projectId: string; key: string }) {
  const viewer = await requireViewer();
  const panel = await withDb(async (db) => {
    await requireProjectMember(db, viewer.userId, data.projectId);
    return pullPanel(db, data.projectId, data.key);
  });
  const brain = appEnv().BRAIN;
  return panel?.pullRequest && brain
    ? { brain, workUnitId: panel.workUnitId, panel }
    : null;
}

export interface StageView extends StageStatus {
  /** The presentation's timeline, by its key in the evidence store. */
  presentation: string | null;
}

/**
 * A pull request's stage (workers/stage.ts): opened, looked at or closed by
 * a member of the ticket's project, through the brain.
 */
export const stageFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...ticket,
      action: z.enum(["open", "status", "close"]),
      fresh: z.boolean().optional(),
      live: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<StageView> => {
    const found = await stageOf(data);
    if (!found)
      return {
        phase: "failed",
        warm: false,
        events: [],
        error: "No stage for this ticket here.",
        live: false,
        signedIn: null,
        presentation: null,
      };
    const status = await found.brain.stage({
      workUnitId: found.workUnitId,
      action: data.action,
      fresh: data.fresh,
      live: data.live,
    });
    const film = found.panel.screens.find(
      (screen) => screen.kind === "presentation",
    );
    return { ...status, presentation: film?.key ?? null };
  });

/**
 * The presentation played live on it: the opening, then each chapter;
 * held while the member talks, and on again. Or the app in their hands.
 */
export const stageCueFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...ticket,
      cue: z.discriminatedUnion("action", [
        z.object({ action: z.literal("set") }),
        z.object({
          action: z.literal("chapter"),
          index: z.number().int().min(0).max(11),
          voiceMs: z.number().int().min(0).max(120_000),
        }),
        z.object({ action: z.literal("pause") }),
        z.object({
          action: z.literal("resume"),
          restore: z.boolean().optional(),
        }),
        z.object({ action: z.literal("stop") }),
        z.object({
          action: z.literal("reach"),
          index: z.number().int().min(0).max(11),
          part: z.number().min(0).max(1),
        }),
        z.object({
          action: z.literal("beat"),
          n: z.number().int().min(0).max(255).nullable(),
        }),
        z.object({ action: z.literal("stir") }),
        z.object({ action: z.literal("control"), on: z.boolean() }),
        z.object({ action: z.literal("state") }),
        z.object({ action: z.literal("cancel"), on: z.boolean() }),
      ]),
    }),
  )
  .handler(async ({ data }): Promise<StageCueResult> => {
    const found = await stageOf(data);
    if (!found)
      return { ok: false, problems: ["No stage for this ticket here."] };
    return found.brain.stageCue({
      workUnitId: found.workUnitId,
      cue: data.cue,
    });
  });

/** An answer of the conversation, in the agent's voice. */
export const stageVoiceFn = createServerFn({ method: "POST" })
  .validator(z.object({ ...ticket, messageId: z.string().uuid() }))
  .handler(async ({ data }) => {
    const found = await stageOf(data);
    if (!found) return null;
    return found.brain.answerVoice({
      workUnitId: found.workUnitId,
      messageId: data.messageId,
    });
  });

export type TalkCall =
  | {
      ok: true;
      conversationToken: string;
      grant: string;
      /** The member's words shown as they say them (Scribe realtime). */
      transcriptionToken: string | null;
    }
  | { ok: false; reason: string };

/**
 * A live call about the pull request, by voice: what the page starts it
 * with (src/runner/talk.ts). The member's language picks the one heard.
 * Over the stage when the ticket has one; otherwise by voice alone.
 */
export const stageTalkFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      ...ticket,
      language: z
        .string()
        .regex(/^[a-z]{2,3}$/)
        .default("en"),
      stage: z.boolean().default(true),
    }),
  )
  .handler(async ({ data }): Promise<TalkCall> => {
    const viewer = await requireViewer();
    const found = await stageOf(data);
    if (!found) return { ok: false, reason: "No call for this ticket here." };
    return found.brain.talkCall({
      workUnitId: found.workUnitId,
      userId: viewer.userId,
      language: data.language,
      stage: data.stage,
    });
  });
