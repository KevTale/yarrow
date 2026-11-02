import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { StageStatus } from "@/core/stage";
import { requireProjectMember } from "@/db/accounts";
import { pullPanel } from "@/db/pull-panel";
import { requireViewer } from "@/server/auth.server";
import { withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";

/**
 * A pull request's stage (workers/stage.ts): opened, looked at or closed by
 * a member of the ticket's project, through the brain.
 */
export const stageFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      projectId: z.uuid(),
      key: z.string().min(1).max(64),
      action: z.enum(["open", "status", "close"]),
      fresh: z.boolean().optional(),
    }),
  )
  .handler(async ({ data }): Promise<StageStatus> => {
    const viewer = await requireViewer();
    const panel = await withDb(async (db) => {
      await requireProjectMember(db, viewer.userId, data.projectId);
      return pullPanel(db, data.projectId, data.key);
    });
    const brain = appEnv().BRAIN;
    if (!panel?.pullRequest || !brain)
      return {
        phase: "failed",
        warm: false,
        events: [],
        error: "No stage for this ticket here.",
      };
    return brain.stage({
      workUnitId: panel.workUnitId,
      action: data.action,
      fresh: data.fresh,
    });
  });
