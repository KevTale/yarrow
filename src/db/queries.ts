import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  notExists,
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
  projectRunConfigs,
  projectSecrets,
  projects,
  pullRequests,
  results,
  runActivityReads,
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
  // One entry per sponsor, the largest share first, as the card draws them.
  const share = sql<number>`sum(${runFundings.reservedCents} + ${runFundings.debitedCents})`;
  const rows = await db
    .select({
      name: sponsorProfiles.publicName,
      publicId: sponsorProfiles.publicId,
      websiteUrl: sponsorProfiles.websiteUrl,
    })
    .from(runFundings)
    .innerJoin(contributions, eq(contributions.id, runFundings.contributionId))
    .leftJoin(sponsorProfiles, eq(sponsorProfiles.userId, contributions.userId))
    .where(eq(runFundings.agentRunId, runId))
    .groupBy(
      contributions.userId,
      sponsorProfiles.publicName,
      sponsorProfiles.publicId,
      sponsorProfiles.websiteUrl,
    )
    .orderBy(desc(share), asc(sql`min(${contributions.createdAt})`));
  return rows.map((row) => ({
    name: row.name ?? null,
    publicId: row.publicId ?? null,
    website: Boolean(row.name && row.websiteUrl),
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
        inArray(contributions.source, ["stripe", "direct"]),
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
  ticketKey: workUnits.externalId,
  ticketUrl: workUnits.url,
  source: workUnits.source,
  projectId: projects.id,
  projectName: projects.name,
  repository: projects.repository,
  logoUrl: projects.logoUrl,
  visibility: projects.visibility,
};

interface Redactable {
  visibility: "public" | "listed" | "hidden";
  projectName: string;
  repository: string;
  logoUrl: string | null;
  ticketTitle: string;
  ticketKey: string;
  ticketUrl: string;
  pullRequestUrl: string | null;
}

/** What a non-member may see of a run, by project visibility. */
function redactRun<T extends Redactable>(row: T, member: boolean): T {
  if (member || row.visibility === "public") return row;
  return {
    ...row,
    ticketTitle: "A ticket",
    ticketKey: "",
    ticketUrl: "",
    pullRequestUrl: null,
    ...(row.visibility === "hidden"
      ? { projectName: "A private project", repository: "", logoUrl: null }
      : {}),
  };
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

/**
 * Who may see a run's screenshots and videos, in one query: everyone on a
 * public project, members only otherwise. Null when the run is unknown.
 */
export async function runEvidenceAccess(
  db: Database,
  runId: string,
  viewerUserId: string | null,
): Promise<{ visibility: string; allowed: boolean } | null> {
  const [row] = await db
    .select({
      visibility: projects.visibility,
      member: viewerUserId
        ? sql<boolean>`exists (select 1 from ${accountMembers} where ${accountMembers.accountId} = ${projects.accountId} and ${accountMembers.userId} = ${viewerUserId})`
        : sql<boolean>`false`,
    })
    .from(agentRuns)
    .innerJoin(workUnits, eq(workUnits.id, agentRuns.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .where(eq(agentRuns.id, runId));
  if (!row) return null;
  return {
    visibility: row.visibility,
    allowed: row.visibility === "public" || row.member,
  };
}

/** One run. Null when the viewer may not see it at all. */
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
      // Its maintainers can still ask for changes on it.
      pullRequestOpen: sql<boolean>`exists (select 1 from ${pullRequests} where ${pullRequests.workUnitId} = ${workUnits.id} and ${pullRequests.state} = 'open')`,
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
  const { pullRequestOpen, ...rest } = row;
  const redacted = redactRun(rest, member);
  return {
    ...redacted,
    member,
    pullRequestOpen: member && pullRequestOpen,
    instruction: detailed ? row.instruction : null,
    summary: detailed ? row.summary : null,
    evidence: detailed ? (row.evidence ?? []) : [],
    review: detailed ? (row.review as StoredReview | null) : null,
    artifacts: detailed ? ((row.artifacts ?? []) as StoredArtifact[]) : [],
    sponsors: await runSponsors(db, runId),
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
      session: agentRuns.implementerSession,
      readAt: runActivityReads.readAt,
      implementer: agentRuns.implementer,
    })
    .from(agentRuns)
    .innerJoin(workUnits, eq(workUnits.id, agentRuns.workUnitId))
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .leftJoin(results, eq(results.agentRunId, agentRuns.id))
    .leftJoin(runActivityReads, eq(runActivityReads.agentRunId, agentRuns.id))
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
    implementer: row.implementer,
    createdAt: row.createdAt.toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    outcome: row.outcome,
    abstentionReason: row.abstentionReason,
    summary: detailed ? row.summary : null,
    pullRequestUrl: detailed ? row.pullRequestUrl : null,
    detailed,
    /** A session the feed never read: read once, even after the run. */
    unread: row.session !== null && row.readAt === null,
    lines: detailed ? lines : lines.map(redactActivity),
  };
}
export type RunActivity = NonNullable<
  Awaited<ReturnType<typeof runActivityFor>>
>;

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

/**
 * Pull requests waiting for this builder, across their projects: the
 * header's badge. One with a change asked under way is Yarrow's turn.
 */
export async function reviewCount(
  db: Database,
  userId: string,
): Promise<number> {
  const [row] = await db
    .select({ waiting: count() })
    .from(workUnits)
    .innerJoin(projects, eq(projects.id, workUnits.projectId))
    .innerJoin(
      accountMembers,
      and(
        eq(accountMembers.accountId, projects.accountId),
        eq(accountMembers.userId, userId),
      ),
    )
    .where(
      and(
        eq(workUnits.status, "delivered"),
        notExists(
          db
            .select({ id: correctionRequests.id })
            .from(correctionRequests)
            .where(
              and(
                eq(correctionRequests.workUnitId, workUnits.id),
                eq(correctionRequests.status, "queued"),
              ),
            ),
        ),
        // A delivered ticket's running run is a change being made.
        notExists(
          db
            .select({ id: agentRuns.id })
            .from(agentRuns)
            .where(
              and(
                eq(agentRuns.workUnitId, workUnits.id),
                eq(agentRuns.status, "running"),
              ),
            ),
        ),
      ),
    );
  return row?.waiting ?? 0;
}
