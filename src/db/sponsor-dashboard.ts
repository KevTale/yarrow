import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  phaseStatus,
  runModelsView,
  type TicketModel,
  type TicketStatus,
} from "../core/tickets";
import { sponsorBoard, type SponsorRow } from "./boards";
import type { Database } from "./client";
import {
  agentRuns,
  contributions,
  projects,
  pullRequests,
  results,
  runFundings,
  runModels,
  sponsorProfiles,
  workUnits,
} from "./schema";

export interface Standing {
  /** The rows to show: the viewer and their neighbours. */
  rows: (SponsorRow & { rank: number; you: boolean })[];
  /** 1-based, null when the viewer is not on this board. */
  rank: number | null;
  paidCents: number;
  totalCents: number;
  /** What every other sponsor paid, to price the next rank. */
  others: number[];
}

function standing(board: SponsorRow[], publicId: string | null): Standing {
  const index = board.findIndex((row) => row.publicId === publicId);
  const ranked = board.map((row, i) => ({
    ...row,
    rank: i + 1,
    you: i === index,
  }));
  // Above, you, below; or the top three when the viewer is not ranked.
  const from =
    index < 0 ? 0 : Math.max(0, Math.min(index - 1, board.length - 3));
  return {
    rows: ranked.slice(from, from + 3),
    rank: index < 0 ? null : index + 1,
    paidCents: index < 0 ? 0 : board[index]!.paidCents,
    totalCents: board.reduce((sum, row) => sum + row.paidCents, 0),
    others: board.filter((_, i) => i !== index).map((row) => row.paidCents),
  };
}

/** Where the viewer stands today and all time, among real paid sponsors. */
export async function sponsorStandings(
  db: Database,
  userId: string,
  now = new Date(),
) {
  const [profile] = await db
    .select({
      publicId: sponsorProfiles.publicId,
      publicName: sponsorProfiles.publicName,
    })
    .from(sponsorProfiles)
    .where(eq(sponsorProfiles.userId, userId));
  const publicId = profile?.publicId ?? null;
  const [today, all] = await Promise.all([
    sponsorBoard(db, "today", now),
    sponsorBoard(db, "all", now),
  ]);
  return {
    anonymous: !profile?.publicName,
    today: standing(today, publicId),
    all: standing(all, publicId),
  };
}

export interface ShippedRow {
  runId: string;
  title: string | null;
  url: string | null;
  projectName: string;
  /** Null on hidden projects, like the logo. */
  repository: string | null;
  logoUrl: string | null;
  /** The run's page opens for everyone but on hidden projects. */
  linkable: boolean;
  createdAt: string;
  status: TicketStatus;
  models: TicketModel[];
  /** The viewer's share of the run's cost. */
  costCents: number;
}

/**
 * The tickets the viewer's money worked on, newest first. Only public
 * projects show the ticket and link the pull request.
 */
export async function sponsorShipped(
  db: Database,
  userId: string,
  limit = 50,
): Promise<ShippedRow[]> {
  const runs = await db
    .select({
      runId: agentRuns.id,
      status: agentRuns.status,
      phase: agentRuns.phase,
      implementer: agentRuns.implementer,
      reviewer: agentRuns.reviewer,
      workUnitId: agentRuns.workUnitId,
      title: workUnits.title,
      projectName: projects.name,
      repository: projects.repository,
      logoUrl: projects.logoUrl,
      visibility: projects.visibility,
      createdAt: agentRuns.createdAt,
      pullRequestUrl: results.pullRequestUrl,
      shareCents: sql<number>`sum(${runFundings.debitedCents})::int`,
    })
    .from(runFundings)
    .innerJoin(contributions, eq(contributions.id, runFundings.contributionId))
    .innerJoin(agentRuns, eq(agentRuns.id, runFundings.agentRunId))
    .innerJoin(workUnits, eq(workUnits.id, agentRuns.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .leftJoin(results, eq(results.agentRunId, agentRuns.id))
    .where(eq(contributions.userId, userId))
    .groupBy(agentRuns.id, workUnits.id, projects.id, results.id)
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);
  if (runs.length === 0) return [];
  const [stats, pulls] = await Promise.all([
    db
      .select()
      .from(runModels)
      .where(
        inArray(
          runModels.agentRunId,
          runs.map((run) => run.runId),
        ),
      ),
    db
      .select({
        workUnitId: pullRequests.workUnitId,
        state: pullRequests.state,
      })
      .from(pullRequests)
      .where(
        inArray(
          pullRequests.workUnitId,
          runs.map((run) => run.workUnitId),
        ),
      ),
  ]);
  return runs.map((run) => {
    const pull = pulls.find((row) => row.workUnitId === run.workUnitId);
    const status: TicketStatus =
      run.status === "running"
        ? phaseStatus(run.phase)
        : run.status === "abstained"
          ? "abstained"
          : pull?.state === "merged"
            ? "merged"
            : pull?.state === "closed"
              ? "pr_closed"
              : "pull_request";
    const models = runModelsView(
      stats.filter((model) => model.agentRunId === run.runId),
      run,
      status,
    );
    const open = run.visibility === "public";
    const hidden = run.visibility === "hidden";
    return {
      runId: run.runId,
      title: open ? run.title : null,
      url: open ? run.pullRequestUrl : null,
      projectName: hidden ? "a private project" : run.projectName,
      repository: hidden ? null : run.repository,
      logoUrl: hidden ? null : run.logoUrl,
      linkable: !hidden,
      createdAt: run.createdAt.toISOString(),
      status,
      models,
      costCents: run.shareCents,
    };
  });
}

/** The viewer's leaderboard profile and where their money goes. */
/**
 * What the viewer's money produced: the tickets it worked on, the pull
 * requests they got, and how many were merged.
 */
export async function sponsorImpact(db: Database, userId: string) {
  const funded = db
    .selectDistinct({ workUnitId: agentRuns.workUnitId })
    .from(runFundings)
    .innerJoin(contributions, eq(contributions.id, runFundings.contributionId))
    .innerJoin(agentRuns, eq(agentRuns.id, runFundings.agentRunId))
    .where(eq(contributions.userId, userId))
    .as("funded");
  const [row] = await db
    .select({
      tickets: sql<number>`count(distinct ${funded.workUnitId})::int`,
      pullRequests: sql<number>`count(distinct ${pullRequests.id})::int`,
      merged: sql<number>`(count(distinct ${pullRequests.id}) filter (where ${pullRequests.state} = 'merged'))::int`,
    })
    .from(funded)
    .leftJoin(pullRequests, eq(pullRequests.workUnitId, funded.workUnitId));
  return row ?? { tickets: 0, pullRequests: 0, merged: 0 };
}

export async function sponsorSettings(db: Database, userId: string) {
  const [profile] = await db
    .select()
    .from(sponsorProfiles)
    .where(eq(sponsorProfiles.userId, userId));
  const payments = await db
    .select({
      id: contributions.id,
      createdAt: contributions.createdAt,
      source: contributions.source,
      paymentStatus: contributions.paymentStatus,
      amountCents: contributions.amountCents,
    })
    .from(contributions)
    .where(
      and(
        eq(contributions.userId, userId),
        inArray(contributions.paymentStatus, ["settled", "refunded"]),
      ),
    )
    .orderBy(desc(contributions.createdAt));
  return {
    profile: {
      publicName: profile?.publicName ?? null,
      tagline: profile?.tagline ?? null,
      description: profile?.description ?? null,
      websiteUrl: profile?.websiteUrl ?? null,
      logoUrl: profile?.logoUrl ?? null,
    },
    payments,
  };
}

/**
 * The whole queue at a glance: tickets being worked on now and tickets
 * waiting for compute. Sponsor money is spent on them automatically.
 */
export async function queueActivity(
  db: Database,
): Promise<{ working: number; waiting: number }> {
  const [row] = await db
    .select({
      working: sql<number>`count(*) filter (where ${workUnits.status} = 'running')::int`,
      waiting: sql<number>`count(*) filter (where ${workUnits.status} = 'queued' and ${workUnits.authorized})::int`,
    })
    .from(workUnits);
  return { working: row?.working ?? 0, waiting: row?.waiting ?? 0 };
}
