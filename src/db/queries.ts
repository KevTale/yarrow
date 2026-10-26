import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  sql,
} from "drizzle-orm";
import type { RunSponsor } from "../core/attribution";
import { redactActivity } from "../core/activity";
import { runActivityLines } from "./activity";
import type { StoredArtifact, StoredReview } from "../core/review";
import type { Database } from "./client";
import {
  accountMembers,
  agentRuns,
  contributions,
  correctionRequests,
  events,
  projectRunConfigs,
  projectSecrets,
  projects,
  pullRequests,
  results,
  runFundings,
  sponsorProfiles,
  trackerBoards,
  trackerConnections,
  workUnits,
} from "./schema";

const visible = inArray(projects.visibility, ["public", "listed"]);

/** Sponsors who funded a run, oldest money first. `null` name is anonymous. */
export async function runSponsors(
  db: Database,
  runId: string,
): Promise<RunSponsor[]> {
  const rows = await db
    .select({
      name: sponsorProfiles.publicName,
      publicId: sponsorProfiles.publicId,
    })
    .from(runFundings)
    .innerJoin(contributions, eq(contributions.id, runFundings.contributionId))
    .leftJoin(sponsorProfiles, eq(sponsorProfiles.userId, contributions.userId))
    .where(eq(runFundings.agentRunId, runId))
    .orderBy(asc(contributions.createdAt));
  return rows.map((row) => ({
    name: row.name ?? null,
    publicId: row.publicId ?? null,
  }));
}

export async function homeStats(db: Database) {
  const [consumed] = await db
    .select({
      cents: sql<number>`coalesce(sum(${contributions.debitedCents}), 0)::int`,
      sponsors: sql<number>`count(distinct ${contributions.userId})::int`,
    })
    .from(contributions)
    .where(
      and(
        eq(contributions.source, "stripe"),
        eq(contributions.paymentStatus, "settled"),
      ),
    );
  const [prs] = await db
    .select({
      delivered: count(),
      merged: sql<number>`count(*) filter (where ${pullRequests.state} = 'merged')::int`,
    })
    .from(pullRequests);
  const [projectCount] = await db
    .select({ value: count() })
    .from(projects)
    .where(isNull(projects.suspendedAt));
  return {
    consumedCents: consumed?.cents ?? 0,
    sponsors: consumed?.sponsors ?? 0,
    deliveredPullRequests: prs?.delivered ?? 0,
    mergedPullRequests: prs?.merged ?? 0,
    projects: projectCount?.value ?? 0,
  };
}

/** Public and Listed projects. Hidden projects never appear here. */
export async function showcase(db: Database) {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      description: projects.description,
      productUrl: projects.productUrl,
      visibility: projects.visibility,
      categories: projects.categories,
      stacks: projects.stacks,
      repository: projects.repository,
      shipped: sql<number>`count(distinct ${pullRequests.id})::int`,
      merged: sql<number>`count(distinct ${pullRequests.id}) filter (where ${pullRequests.state} = 'merged')::int`,
      queued: sql<number>`count(distinct ${workUnits.id}) filter (where ${workUnits.status} = 'queued' and ${workUnits.authorized})::int`,
    })
    .from(projects)
    .leftJoin(workUnits, eq(workUnits.projectId, projects.id))
    .leftJoin(pullRequests, eq(pullRequests.workUnitId, workUnits.id))
    .where(and(visible, isNull(projects.suspendedAt)))
    .groupBy(projects.id)
    .orderBy(
      desc(sql`count(distinct ${pullRequests.id})`),
      asc(projects.createdAt),
    );
  return rows.map((row) => ({
    ...row,
    // Listed projects show the product, never the code.
    repository: row.visibility === "public" ? row.repository : null,
  }));
}

/** Projects a sponsor can pick in their filters, plus how many are hidden. */
export async function selectableProjects(db: Database) {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      visibility: projects.visibility,
      categories: projects.categories,
      stacks: projects.stacks,
    })
    .from(projects)
    .where(and(visible, isNull(projects.suspendedAt)))
    .orderBy(asc(projects.name));
  const [hidden] = await db
    .select({ value: count() })
    .from(projects)
    .where(
      and(eq(projects.visibility, "hidden"), isNull(projects.suspendedAt)),
    );
  return { projects: rows, hiddenCount: hidden?.value ?? 0 };
}

const runColumns = {
  runId: agentRuns.id,
  kind: agentRuns.kind,
  status: agentRuns.status,
  phase: agentRuns.phase,
  implementer: agentRuns.implementer,
  reviewer: agentRuns.reviewer,
  costCents: sql<number>`(${agentRuns.debitedCents} + ${agentRuns.uncoveredCents})::int`,
  createdAt: agentRuns.createdAt,
  finishedAt: agentRuns.finishedAt,
  outcome: results.outcome,
  abstentionReason: results.abstentionReason,
  pullRequestUrl: results.pullRequestUrl,
  workUnitId: workUnits.id,
  ticketTitle: workUnits.title,
  ticketUrl: workUnits.url,
  source: workUnits.source,
  projectId: projects.id,
  projectName: projects.name,
  visibility: projects.visibility,
};

interface Redactable {
  visibility: "public" | "listed" | "hidden";
  projectName: string;
  ticketTitle: string;
  ticketUrl: string;
  pullRequestUrl: string | null;
}

/** What a non-member may see of a run, by project visibility. */
function redactRun<T extends Redactable>(row: T, member: boolean): T {
  if (member || row.visibility === "public") return row;
  return {
    ...row,
    ticketTitle: "A ticket",
    ticketUrl: "",
    pullRequestUrl: null,
    ...(row.visibility === "hidden"
      ? { projectName: "A private project" }
      : {}),
  };
}

/** Recent runs across Public and Listed projects. */
export async function workFeed(db: Database, limit = 50) {
  const rows = await db
    .select(runColumns)
    .from(agentRuns)
    .innerJoin(workUnits, eq(workUnits.id, agentRuns.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .leftJoin(results, eq(results.agentRunId, agentRuns.id))
    .where(and(visible, isNull(projects.suspendedAt)))
    .orderBy(desc(agentRuns.createdAt))
    .limit(limit);
  return Promise.all(
    rows.map(async (row) => ({
      ...redactRun(row, false),
      sponsors: await runSponsors(db, row.runId),
    })),
  );
}

async function isMember(
  db: Database,
  userId: string | null,
  accountId: string,
): Promise<boolean> {
  if (!userId) return false;
  const [row] = await db
    .select({ userId: accountMembers.userId })
    .from(accountMembers)
    .where(
      and(
        eq(accountMembers.accountId, accountId),
        eq(accountMembers.userId, userId),
      ),
    );
  return Boolean(row);
}

/** One run with its timeline. Null when the viewer may not see it at all. */
export async function runDetail(
  db: Database,
  runId: string,
  viewerUserId: string | null,
) {
  const [row] = await db
    .select({
      ...runColumns,
      accountId: projects.accountId,
      reservedCents: agentRuns.reservedCents,
      uncoveredCents: agentRuns.uncoveredCents,
      instruction: agentRuns.instruction,
      summary: results.summary,
      evidence: results.evidence,
      review: results.review,
      artifacts: results.artifacts,
    })
    .from(agentRuns)
    .innerJoin(workUnits, eq(workUnits.id, agentRuns.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .leftJoin(results, eq(results.agentRunId, agentRuns.id))
    .where(eq(agentRuns.id, runId));
  if (!row) return null;
  const member = await isMember(db, viewerUserId, row.accountId);
  if (row.visibility === "hidden" && !member) return null;
  const timeline = await db
    .select({
      type: events.type,
      at: events.createdAt,
    })
    .from(events)
    .where(eq(events.agentRunId, runId))
    .orderBy(asc(events.createdAt));
  const detailed = member || row.visibility === "public";
  const redacted = redactRun(row, member);
  return {
    ...redacted,
    member,
    instruction: detailed ? row.instruction : null,
    summary: detailed ? row.summary : null,
    evidence: detailed ? (row.evidence ?? []) : [],
    review: detailed ? (row.review as StoredReview | null) : null,
    artifacts: detailed ? ((row.artifacts ?? []) as StoredArtifact[]) : [],
    sponsors: await runSponsors(db, runId),
    timeline,
  };
}

/**
 * A run's activity feed for one viewer: every line in full for the
 * project's members and public projects, the kinds and counts only for
 * everyone else on listed projects. Hidden projects stay invisible.
 */
export async function runActivityFor(
  db: Database,
  runId: string,
  viewerUserId: string | null,
) {
  const [row] = await db
    .select({
      status: agentRuns.status,
      phase: agentRuns.phase,
      createdAt: agentRuns.createdAt,
      finishedAt: agentRuns.finishedAt,
      outcome: results.outcome,
      abstentionReason: results.abstentionReason,
      summary: results.summary,
      pullRequestUrl: results.pullRequestUrl,
      visibility: projects.visibility,
      accountId: projects.accountId,
    })
    .from(agentRuns)
    .innerJoin(workUnits, eq(workUnits.id, agentRuns.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .leftJoin(results, eq(results.agentRunId, agentRuns.id))
    .where(eq(agentRuns.id, runId));
  if (!row) return null;
  const member = await isMember(db, viewerUserId, row.accountId);
  if (row.visibility === "hidden" && !member) return null;
  const detailed = member || row.visibility === "public";
  const lines = await runActivityLines(db, runId);
  return {
    runId,
    status: row.status,
    phase: row.phase,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    outcome: row.outcome,
    abstentionReason: row.abstentionReason,
    summary: detailed ? row.summary : null,
    pullRequestUrl: detailed ? row.pullRequestUrl : null,
    detailed,
    lines: detailed ? lines : lines.map(redactActivity),
  };
}
export type RunActivity = NonNullable<Awaited<ReturnType<typeof runActivityFor>>>;

export async function sponsorDashboard(db: Database, userId: string) {
  const rows = await db
    .select({
      id: contributions.id,
      createdAt: contributions.createdAt,
      source: contributions.source,
      paymentStatus: contributions.paymentStatus,
      amountCents: contributions.amountCents,
      taxCents: contributions.taxCents,
      feeCents: contributions.feeCents,
      marginCents: contributions.marginCents,
      creditCents: contributions.creditCents,
      reservedCents: contributions.reservedCents,
      debitedCents: contributions.debitedCents,
    })
    .from(contributions)
    .where(eq(contributions.userId, userId))
    .orderBy(desc(contributions.createdAt));
  const settled = rows.filter((row) => row.paymentStatus === "settled");
  const totals = {
    paidCents: settled.reduce((sum, row) => sum + row.amountCents, 0),
    creditCents: settled.reduce((sum, row) => sum + row.creditCents, 0),
    consumedCents: settled.reduce((sum, row) => sum + row.debitedCents, 0),
    reservedCents: settled.reduce((sum, row) => sum + row.reservedCents, 0),
  };
  const funded = await db
    .select({
      ...runColumns,
      fundedCents: sql<number>`sum(${runFundings.debitedCents})::int`,
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
    .limit(50);
  return {
    contributions: rows,
    totals,
    fundedRuns: funded.map((row) => redactRun(row, false)),
  };
}

/** The owner side: every project of the viewer's accounts and its pipeline. */
export async function ownerDashboard(db: Database, userId: string) {
  const owned = await db
    .select({
      id: projects.id,
      name: projects.name,
      repository: projects.repository,
      visibility: projects.visibility,
      logoUrl: projects.logoUrl,
      linked: sql<boolean>`${projects.githubInstallationId} is not null`,
      suspended: sql<boolean>`${projects.suspendedAt} is not null`,
      queued: sql<number>`count(distinct ${workUnits.id}) filter (where ${workUnits.status} = 'queued' and ${workUnits.authorized})::int`,
      running: sql<number>`count(distinct ${workUnits.id}) filter (where ${workUnits.status} = 'running')::int`,
      delivered: sql<number>`count(distinct ${workUnits.id}) filter (where ${workUnits.status} = 'delivered')::int`,
      abstained: sql<number>`count(distinct ${workUnits.id}) filter (where ${workUnits.status} = 'abstained')::int`,
      merged: sql<number>`count(distinct ${pullRequests.id}) filter (where ${pullRequests.state} = 'merged')::int`,
    })
    .from(projects)
    .innerJoin(
      accountMembers,
      and(
        eq(accountMembers.accountId, projects.accountId),
        eq(accountMembers.userId, userId),
      ),
    )
    .leftJoin(workUnits, eq(workUnits.projectId, projects.id))
    .leftJoin(pullRequests, eq(pullRequests.workUnitId, workUnits.id))
    .groupBy(projects.id)
    .orderBy(asc(projects.createdAt));
  return { projects: owned };
}

/** Everything the owner settings page needs. Caller checks membership first. */
export async function projectForOwner(db: Database, projectId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return null;
  const [runConfig] = await db
    .select()
    .from(projectRunConfigs)
    .where(eq(projectRunConfigs.projectId, projectId));
  const secrets = await db
    .select({
      name: projectSecrets.name,
      allowedHost: projectSecrets.allowedHost,
    })
    .from(projectSecrets)
    .where(eq(projectSecrets.projectId, projectId))
    .orderBy(asc(projectSecrets.name));
  const boards = await db
    .select({
      id: trackerBoards.id,
      name: trackerBoards.name,
      key: trackerBoards.externalBoardId,
      tracker: trackerConnections.tracker,
      connectionId: trackerConnections.id,
      connection: trackerConnections.name,
    })
    .from(trackerBoards)
    .innerJoin(
      trackerConnections,
      eq(trackerConnections.id, trackerBoards.connectionId),
    )
    .where(eq(trackerBoards.projectId, projectId));
  const tickets = await db
    .select({
      id: workUnits.id,
      title: workUnits.title,
      url: workUnits.url,
      source: workUnits.source,
      status: workUnits.status,
      authorized: workUnits.authorized,
      queuedAt: workUnits.queuedAt,
      pullRequestUrl: pullRequests.url,
      pullRequestState: pullRequests.state,
      pendingCorrections: sql<number>`(select count(*) from ${correctionRequests} where ${correctionRequests.workUnitId} = ${workUnits.id} and ${correctionRequests.status} = 'queued')::int`,
      lastRunId: sql<
        string | null
      >`(select ${agentRuns.id} from ${agentRuns} where ${agentRuns.workUnitId} = ${workUnits.id} order by ${agentRuns.createdAt} desc limit 1)`,
    })
    .from(workUnits)
    .leftJoin(pullRequests, eq(pullRequests.workUnitId, workUnits.id))
    .where(
      and(eq(workUnits.projectId, projectId), ne(workUnits.status, "closed")),
    )
    .orderBy(desc(workUnits.queuedAt))
    .limit(200);
  return {
    project,
    runConfig: runConfig ?? null,
    secrets,
    boards,
    tickets,
  };
}
