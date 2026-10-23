import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { sponsorLeaderboard } from "@/db/ledger";
import { homeStats, runDetail, showcase, workFeed } from "@/db/queries";
import { getViewer } from "@/server/auth.server";
import { databaseConfigured, withDb } from "@/server/db.server";

export const getHomeFn = createServerFn({ method: "GET" }).handler(async () => {
  if (!databaseConfigured()) return { configured: false as const };
  return withDb(async (db) => ({
    configured: true as const,
    stats: await homeStats(db),
    feed: await workFeed(db, 6),
    leaders: (await sponsorLeaderboard(db)).slice(0, 5),
    projects: (await showcase(db)).slice(0, 5),
  }));
});

export const getLeaderboardFn = createServerFn({ method: "GET" }).handler(
  async () => {
    if (!databaseConfigured()) return { configured: false as const };
    return withDb(async (db) => ({
      configured: true as const,
      leaders: await sponsorLeaderboard(db),
    }));
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
