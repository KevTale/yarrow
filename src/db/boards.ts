import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import type { Database } from "./client";
import { runSponsors } from "./queries";
import {
  agentRuns,
  contributions,
  events,
  projects,
  pullRequests,
  results,
  runFundings,
  sponsorProfiles,
  workUnits,
} from "./schema";

export type BoardPeriod = "today" | "all";

/** Midnight UTC today: the "Today" boards reset there. */
export function startOfUtcDay(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export type SponsorRow = {
  publicId: string;
  name: string;
  tagline: string | null;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  foundingSponsor: boolean;
  paidCents: number;
  clicks: number;
  pullRequests: number;
};

/**
 * Sponsors ranked by money paid (excluding VAT) on settled Stripe payments,
 * for today or all time. Paying moves a sponsor up at once. Promo credit,
 * refunds and anonymous sponsors never appear.
 */
export async function sponsorBoard(
  db: Database,
  period: BoardPeriod,
  now = new Date(),
): Promise<SponsorRow[]> {
  const paid = sql<number>`sum(${contributions.amountCents} - ${contributions.taxCents})::int`;
  const rows = await db
    .select({
      userId: sponsorProfiles.userId,
      publicId: sponsorProfiles.publicId,
      name: sponsorProfiles.publicName,
      tagline: sponsorProfiles.tagline,
      description: sponsorProfiles.description,
      websiteUrl: sponsorProfiles.websiteUrl,
      logoUrl: sponsorProfiles.logoUrl,
      foundingSponsor: sponsorProfiles.foundingSponsor,
      paidCents: paid,
    })
    .from(contributions)
    .innerJoin(
      sponsorProfiles,
      eq(sponsorProfiles.userId, contributions.userId),
    )
    .where(
      and(
        eq(contributions.source, "stripe"),
        eq(contributions.paymentStatus, "settled"),
        sql`${sponsorProfiles.publicName} is not null`,
        period === "today"
          ? gte(contributions.createdAt, startOfUtcDay(now))
          : undefined,
      ),
    )
    .groupBy(sponsorProfiles.userId)
    .orderBy(desc(paid), sponsorProfiles.publicName)
    .limit(500);
  if (rows.length === 0) return [];
  const userIds = rows.map((row) => row.userId);
  const [clicks, funded] = await Promise.all([
    db
      .select({ userId: events.userId, clicks: sql<number>`count(*)::int` })
      .from(events)
      .where(
        and(
          eq(events.type, "sponsor.clicked"),
          inArray(events.userId, userIds),
        ),
      )
      .groupBy(events.userId),
    db
      .select({
        userId: contributions.userId,
        pullRequests: sql<number>`count(distinct ${agentRuns.workUnitId})::int`,
      })
      .from(runFundings)
      .innerJoin(
        contributions,
        eq(contributions.id, runFundings.contributionId),
      )
      .innerJoin(agentRuns, eq(agentRuns.id, runFundings.agentRunId))
      .innerJoin(results, eq(results.agentRunId, agentRuns.id))
      .where(
        and(
          eq(results.outcome, "pull_request"),
          inArray(contributions.userId, userIds),
        ),
      )
      .groupBy(contributions.userId),
  ]);
  const clicksBy = new Map(clicks.map((row) => [row.userId, row.clicks]));
  const fundedBy = new Map(funded.map((row) => [row.userId, row.pullRequests]));
  return rows.map(({ userId, name, ...row }) => ({
    ...row,
    name: name!,
    clicks: clicksBy.get(userId) ?? 0,
    pullRequests: fundedBy.get(userId) ?? 0,
  }));
}

/** Records a click on a sponsor link and returns where to send the visitor. */
export async function recordSponsorClick(
  db: Database,
  publicId: string,
): Promise<string | null> {
  const [profile] = await db
    .select({
      userId: sponsorProfiles.userId,
      websiteUrl: sponsorProfiles.websiteUrl,
    })
    .from(sponsorProfiles)
    .where(eq(sponsorProfiles.publicId, publicId));
  if (!profile?.websiteUrl) return null;
  await db
    .insert(events)
    .values({ type: "sponsor.clicked", userId: profile.userId });
  return profile.websiteUrl;
}

const listed = and(
  inArray(projects.visibility, ["public", "listed"]),
  isNull(projects.suspendedAt),
);

/**
 * Pull requests merged since midnight UTC, newest first. Only public
 * projects show their pull requests; listed ones only count.
 */
export async function mergedToday(db: Database, now = new Date(), limit = 50) {
  const rows = await db
    .select({
      title: workUnits.title,
      repository: projects.repository,
      number: pullRequests.number,
      url: pullRequests.url,
      mergedAt: pullRequests.closedAt,
      workUnitId: workUnits.id,
    })
    .from(pullRequests)
    .innerJoin(workUnits, eq(workUnits.id, pullRequests.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(
      and(
        eq(pullRequests.state, "merged"),
        gte(pullRequests.closedAt, startOfUtcDay(now)),
        eq(projects.visibility, "public"),
        isNull(projects.suspendedAt),
      ),
    )
    .orderBy(desc(pullRequests.closedAt))
    .limit(limit);
  return Promise.all(
    rows.map(async ({ workUnitId, ...row }) => {
      const [run] = await db
        .select({ id: agentRuns.id })
        .from(agentRuns)
        .innerJoin(results, eq(results.agentRunId, agentRuns.id))
        .where(
          and(
            eq(agentRuns.workUnitId, workUnitId),
            eq(results.outcome, "pull_request"),
          ),
        )
        .orderBy(desc(agentRuns.createdAt))
        .limit(1);
      return {
        ...row,
        sponsors: run ? await runSponsors(db, run.id) : [],
      };
    }),
  );
}

/** Projects ranked by merged pull requests. Listed projects hide their code. */
export async function projectBoard(db: Database) {
  const merged = sql<number>`count(${pullRequests.id})::int`;
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      visibility: projects.visibility,
      repository: projects.repository,
      merged,
    })
    .from(projects)
    .innerJoin(workUnits, eq(workUnits.projectId, projects.id))
    .innerJoin(pullRequests, eq(pullRequests.workUnitId, workUnits.id))
    .where(and(listed, eq(pullRequests.state, "merged")))
    .groupBy(projects.id)
    .orderBy(desc(merged), projects.name)
    .limit(200);
  return rows.map(({ visibility, repository, ...row }) => ({
    ...row,
    repository: visibility === "public" ? repository : null,
  }));
}

/** Merged pull requests today and in total, on public and listed projects. */
export async function mergedTotals(db: Database, now = new Date()) {
  const [row] = await db
    .select({
      today: sql<number>`count(*) filter (where ${pullRequests.closedAt} >= ${startOfUtcDay(now)})::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(pullRequests)
    .innerJoin(workUnits, eq(workUnits.id, pullRequests.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(and(listed, eq(pullRequests.state, "merged")));
  return { today: row?.today ?? 0, all: row?.all ?? 0 };
}
