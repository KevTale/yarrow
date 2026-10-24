import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  mergedToday,
  mergedTotals,
  projectBoard,
  sponsorBoard,
} from "@/db/boards";
import { runDetail, showcase, workFeed } from "@/db/queries";
import { getViewer } from "@/server/auth.server";
import { databaseConfigured, withDb } from "@/server/db.server";

/** Both sponsor boards and both shipped boards: the landing and its pages. */
export const getBoardsFn = createServerFn({ method: "GET" }).handler(
  async () => {
    if (!databaseConfigured()) return { configured: false as const };
    return withDb(async (db) => {
      const [today, all, merged, projects, totals] = await Promise.all([
        sponsorBoard(db, "today"),
        sponsorBoard(db, "all"),
        mergedToday(db),
        projectBoard(db),
        mergedTotals(db),
      ]);
      return {
        configured: true as const,
        sponsors: { today, all },
        shipped: { today: merged, projects, totals },
      };
    });
  },
);

export const getShowcaseFn = createServerFn({ method: "GET" }).handler(
  async () => {
    if (!databaseConfigured()) return { configured: false as const };
    return withDb(async (db) => ({
      configured: true as const,
      projects: await showcase(db),
    }));
  },
);

export const getWorkFeedFn = createServerFn({ method: "GET" }).handler(
  async () => {
    if (!databaseConfigured()) return { configured: false as const };
    return withDb(async (db) => ({
      configured: true as const,
      runs: await workFeed(db, 100),
    }));
  },
);

export const getRunFn = createServerFn({ method: "GET" })
  .validator(z.object({ runId: z.uuid() }))
  .handler(async ({ data }) => {
    if (!databaseConfigured()) throw notFound();
    const viewer = await getViewer().catch(() => null);
    const run = await withDb((db) =>
      runDetail(db, data.runId, viewer?.userId ?? null),
    );
    if (!run) throw notFound();
    return run;
  });
