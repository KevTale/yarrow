import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Database } from "./client";
import type { RunSponsor } from "../core/attribution";
import {
  bareTitle,
  phaseStatus,
  runModelsView,
  ticketIdentity,
  type TicketModel,
} from "../core/tickets";
import { projectLogo } from "../core/logos";
import { pullRequestCost } from "../core/pricing";
import { runSponsors } from "./queries";
import {
  agentRuns,
  contributions,
  events,
  projects,
  pullRequests,
  results,
  runFundings,
  runModels,
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
  /** Null for an anonymous sponsor: ranked, never named. */
  name: string | null;
  tagline: string | null;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  foundingSponsor: boolean;
  paidCents: number;
  /** Of the credit those payments bought, what runs have used. */
  creditCents: number;
  spentCents: number;
  clicks: number;
  /** All time: tickets worked on, their pull requests, those merged. */
  tickets: number;
  pullRequests: number;
  merged: number;
};

/**
 * Sponsors ranked by money paid (what the card was charged, VAT included:
 * what the sponsor sees) on settled Stripe payments and direct credit,
 * for today or all time. Paying moves a sponsor up at once. Promo credit
 * and refunds never count; anonymous sponsors rank without their profile.
 */
export async function sponsorBoard(
  db: Database,
  period: BoardPeriod,
  now = new Date(),
): Promise<SponsorRow[]> {
  const paid = sql<number>`sum(${contributions.amountCents})::int`;
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
      creditCents: sql<number>`sum(${contributions.creditCents})::int`,
      spentCents: sql<number>`sum(${contributions.debitedCents})::int`,
    })
    .from(contributions)
    .innerJoin(
      sponsorProfiles,
      eq(sponsorProfiles.userId, contributions.userId),
    )
    .where(
      and(
        inArray(contributions.source, ["stripe", "direct"]),
        eq(contributions.paymentStatus, "settled"),
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
        tickets: sql<number>`count(distinct ${agentRuns.workUnitId})::int`,
        pullRequests: sql<number>`(count(distinct ${agentRuns.workUnitId}) filter (where ${results.outcome} = 'pull_request'))::int`,
        merged: sql<number>`(count(distinct ${pullRequests.id}) filter (where ${pullRequests.state} = 'merged'))::int`,
      })
      .from(runFundings)
      .innerJoin(
        contributions,
        eq(contributions.id, runFundings.contributionId),
      )
      .innerJoin(agentRuns, eq(agentRuns.id, runFundings.agentRunId))
      .leftJoin(results, eq(results.agentRunId, agentRuns.id))
      .leftJoin(pullRequests, eq(pullRequests.workUnitId, agentRuns.workUnitId))
      .where(inArray(contributions.userId, userIds))
      .groupBy(contributions.userId),
  ]);
  const clicksBy = new Map(clicks.map((row) => [row.userId, row.clicks]));
  const fundedBy = new Map(funded.map((row) => [row.userId, row]));
  return rows.map(({ userId, name, ...row }) => ({
    ...row,
    name,
    ...(name
      ? {}
      : { tagline: null, description: null, websiteUrl: null, logoUrl: null }),
    clicks: clicksBy.get(userId) ?? 0,
    tickets: fundedBy.get(userId)?.tickets ?? 0,
    pullRequests: fundedBy.get(userId)?.pullRequests ?? 0,
    merged: fundedBy.get(userId)?.merged ?? 0,
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
        .select({
          id: agentRuns.id,
          implementer: agentRuns.implementer,
          reviewer: agentRuns.reviewer,
        })
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
        models: run
          ? runModelsView(
              await db
                .select()
                .from(runModels)
                .where(eq(runModels.agentRunId, run.id)),
              run,
              "merged",
            )
          : [],
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
      today: sql<number>`count(*) filter (where ${pullRequests.closedAt} >= ${startOfUtcDay(now).toISOString()}::timestamptz)::int`,
      all: sql<number>`count(*)::int`,
    })
    .from(pullRequests)
    .innerJoin(workUnits, eq(workUnits.id, pullRequests.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(and(listed, eq(pullRequests.state, "merged")));
  return { today: row?.today ?? 0, all: row?.all ?? 0 };
}

/**
 * What a pull request cost over the last 90 days, every project counted:
 * the compute the providers reported on every run (writing, reviewing,
 * abstentions and corrections included) over the pull requests measured
 * runs opened, merged or not. Prices move with the models, hence the window.
 */
export async function pullRequestCostCents(db: Database, now = new Date()) {
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const [spent] = await db
    .select({ cents: sql<number>`coalesce(sum(${runModels.costCents}), 0)::int` })
    .from(runModels)
    .where(gte(runModels.createdAt, since));
  const [opened] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pullRequests)
    .where(
      and(
        gte(pullRequests.openedAt, since),
        sql`exists (select 1 from ${agentRuns} join ${runModels} on ${runModels.agentRunId} = ${agentRuns.id} where ${agentRuns.workUnitId} = ${pullRequests.workUnitId})`,
      ),
    );
  return pullRequestCost(spent?.cents ?? 0, opened?.count ?? 0);
}

export type LiveStatus =
  | "writing"
  | "reviewing"
  | "delivering"
  | "pull_request"
  | "merged";

export interface LiveRow {
  key: string;
  status: LiveStatus;
  /** Null on a listed project: its tickets stay private. */
  title: string | null;
  /** owner/name, on public and listed projects alike. */
  project: string;
  /** Uploaded, or the GitHub owner's avatar on public projects. */
  logoUrl: string | null;
  /** owner/name when the repository can be opened (public projects). */
  repository: string | null;
  /** "#42" or "APP-42" (public projects only). */
  issueRef: string | null;
  issueUrl: string | null;
  /** The pull request, once opened (public projects only). */
  prNumber: number | null;
  prUrl: string | null;
  /** When the run started, the PR opened or merged. */
  at: string;
  sponsors: RunSponsor[];
  models: TicketModel[];
}

/**
 * Today's work as it happens, on public and listed projects: tickets being
 * worked on now first, then pull requests opened or merged since midnight
 * UTC, newest first. Listed projects show their repository's name, never
 * their tickets.
 */
export function liveToday(
  db: Database,
  now = new Date(),
  limit = 40,
): Promise<LiveRow[]> {
  return liveFeed(db, startOfUtcDay(now), limit);
}

/** The latest work whatever the day: the landing's ticket cards. */
export function liveRecent(db: Database, limit = 12): Promise<LiveRow[]> {
  return liveFeed(db, null, limit);
}

/**
 * What the platform did so far: tickets at work now, merged PRs today
 * (since midnight UTC, as the boards' Today) and ever.
 */
export async function platformTotals(db: Database, now = new Date()) {
  const [running] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(agentRuns)
    .innerJoin(workUnits, eq(workUnits.id, agentRuns.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(and(eq(agentRuns.status, "running"), listed));
  const [merged] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pullRequests)
    .innerJoin(workUnits, eq(workUnits.id, pullRequests.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(and(eq(pullRequests.state, "merged"), listed));
  const [today] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pullRequests)
    .innerJoin(workUnits, eq(workUnits.id, pullRequests.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(
      and(
        eq(pullRequests.state, "merged"),
        gte(pullRequests.closedAt, startOfUtcDay(now)),
        listed,
      ),
    );
  return {
    inProgress: running?.count ?? 0,
    merged: merged?.count ?? 0,
    mergedToday: today?.count ?? 0,
  };
}

async function liveFeed(
  db: Database,
  since: Date | null,
  limit: number,
): Promise<LiveRow[]> {
  const running = await db
    .select({
      runId: agentRuns.id,
      phase: agentRuns.phase,
      implementer: agentRuns.implementer,
      reviewer: agentRuns.reviewer,
      createdAt: agentRuns.createdAt,
      title: workUnits.title,
      issue: workUnits.externalId,
      source: workUnits.source,
      issueUrl: workUnits.url,
      projectLogo: projects.logoUrl,
      visibility: projects.visibility,
      repository: projects.repository,
    })
    .from(agentRuns)
    .innerJoin(workUnits, eq(workUnits.id, agentRuns.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(and(eq(agentRuns.status, "running"), listed))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);
  const pulls = await db
    .select({
      workUnitId: pullRequests.workUnitId,
      number: pullRequests.number,
      url: pullRequests.url,
      state: pullRequests.state,
      openedAt: pullRequests.openedAt,
      closedAt: pullRequests.closedAt,
      title: workUnits.title,
      issue: workUnits.externalId,
      source: workUnits.source,
      issueUrl: workUnits.url,
      projectLogo: projects.logoUrl,
      visibility: projects.visibility,
      repository: projects.repository,
    })
    .from(pullRequests)
    .innerJoin(workUnits, eq(workUnits.id, pullRequests.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(
      and(
        listed,
        ne(pullRequests.state, "closed"),
        since
          ? or(
              gte(pullRequests.openedAt, since),
              gte(pullRequests.closedAt, since),
            )
          : undefined,
      ),
    )
    .orderBy(
      desc(sql`coalesce(${pullRequests.closedAt}, ${pullRequests.openedAt})`),
    )
    .limit(limit);

  const open = (visibility: string) => visibility === "public";
  const live: LiveRow[] = await Promise.all(
    running.map(async (run) => {
      const status = phaseStatus(run.phase);
      return {
        key: run.runId,
        status,
        title: open(run.visibility) ? bareTitle(run.title, run.issue) : null,
        project: run.repository,
        logoUrl: projectLogo(
          run.projectLogo,
          open(run.visibility) ? run.repository : null,
        ),
        repository: open(run.visibility) ? run.repository : null,
        issueRef: open(run.visibility)
          ? ticketIdentity(run.source, run.issue).ref
          : null,
        issueUrl: open(run.visibility) ? run.issueUrl : null,
        prNumber: null,
        prUrl: null,
        at: run.createdAt.toISOString(),
        sponsors: await runSponsors(db, run.runId),
        models: runModelsView([], run, status),
      };
    }),
  );
  const shipped: LiveRow[] = await Promise.all(
    pulls.map(async (pull) => {
      const status: LiveStatus =
        pull.state === "merged" ? "merged" : "pull_request";
      const [run] = await db
        .select({
          id: agentRuns.id,
          implementer: agentRuns.implementer,
          reviewer: agentRuns.reviewer,
        })
        .from(agentRuns)
        .innerJoin(results, eq(results.agentRunId, agentRuns.id))
        .where(
          and(
            eq(agentRuns.workUnitId, pull.workUnitId),
            eq(results.outcome, "pull_request"),
          ),
        )
        .orderBy(desc(agentRuns.createdAt))
        .limit(1);
      const isPublic = open(pull.visibility);
      return {
        // The run's key, kept from the row at work: the landing's card
        // changes in place instead of being replaced.
        key: run?.id ?? pull.url,
        status,
        title: isPublic ? bareTitle(pull.title, pull.issue) : null,
        project: pull.repository,
        logoUrl: projectLogo(
          pull.projectLogo,
          isPublic ? pull.repository : null,
        ),
        repository: isPublic ? pull.repository : null,
        issueRef: isPublic ? ticketIdentity(pull.source, pull.issue).ref : null,
        issueUrl: isPublic ? pull.issueUrl : null,
        prNumber: isPublic ? pull.number : null,
        prUrl: isPublic ? pull.url : null,
        at: (pull.closedAt ?? pull.openedAt).toISOString(),
        sponsors: run ? await runSponsors(db, run.id) : [],
        models: run
          ? runModelsView(
              await db
                .select()
                .from(runModels)
                .where(eq(runModels.agentRunId, run.id)),
              run,
              status,
            )
          : [],
      };
    }),
  );
  return [...live, ...shipped].slice(0, limit);
}

