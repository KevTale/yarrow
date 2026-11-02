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
        presentation: null,
      };
    const status = await found.brain.stage({
      workUnitId: found.workUnitId,
      action: data.action,
      fresh: data.fresh,
    });
    const film = found.panel.screens.find(
      (screen) => screen.kind === "presentation",
    );
    return { ...status, presentation: film?.key ?? null };
  });

/** The presentation played live on it: the opening, then each chapter. */
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
