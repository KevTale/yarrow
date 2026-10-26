import { notFound } from "@tanstack/react-router";
import { jiraReady } from "@/server/jira.server";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  liveToday,
  sponsorBoard,
} from "@/db/boards";
import { runActivityFor, runDetail, showcase, workFeed } from "@/db/queries";
import { syncRunActivity } from "@/db/activity";
import { appEnv } from "@/server/env.server";
import { ManagedAgentsClient } from "@/runner/anthropic";
import { getViewer } from "@/server/auth.server";
import { databaseConfigured, withDb } from "@/server/db.server";

/** Both sponsor boards and both shipped boards: the landing and its pages. */
export const getBoardsFn = createServerFn({ method: "GET" }).handler(
  async () => {
    // Jira lights up on the landing once its OAuth app is configured.
    const sources = { jira: jiraReady() };
    if (!databaseConfigured()) return { configured: false as const, sources };
    return withDb(async (db) => {
      const [today, all, live] = await Promise.all([
        sponsorBoard(db, "today"),
        sponsorBoard(db, "all"),
        liveToday(db),
      ]);
      return {
        configured: true as const,
        sponsors: { today, all },
        live,
        sources,
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

/**
 * A run's activity feed. While the run works, a viewer's request also reads
 * the session's newest actions (at most every few seconds, whoever asks).
 */
export const getRunActivityFn = createServerFn({ method: "GET" })
  .validator(z.object({ runId: z.uuid() }))
  .handler(async ({ data }) => {
    if (!databaseConfigured()) throw notFound();
    const viewer = await getViewer().catch(() => null);
    const apiKey = appEnv().ANTHROPIC_API_KEY;
    const activity = await withDb(async (db) => {
      const first = await runActivityFor(db, data.runId, viewer?.userId ?? null);
      if (!first || first.status !== "running" || !apiKey) return first;
      const read = await syncRunActivity(
        db,
        new ManagedAgentsClient(apiKey),
        data.runId,
      ).catch(() => false);
      return read
        ? runActivityFor(db, data.runId, viewer?.userId ?? null)
        : first;
    });
    if (!activity) throw notFound();
    return activity;
  });

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
