import { and, asc, eq } from "drizzle-orm";
import type { ResultDetails } from "../core/contracts";
import { modelDisplayName } from "../core/pipeline";
import {
  blockingComments,
  type StoredArtifact,
  type StoredReview,
} from "../core/review";
import { phaseStatus, type PaidBy } from "../core/tickets";
import type { Database } from "./client";
import {
  agentRuns,
  correctionRequests,
  pullRequests,
  results,
  runModels,
  workUnits,
} from "./schema";
import { sponsorsByUnit } from "./tickets";

/** One model's part across every run of the ticket, corrections included. */
export interface PanelModel {
  role: "implementer" | "reviewer";
  name: string;
  seconds: number | null;
  secondsExact: boolean;
  costCents: number;
  costExact: boolean;
}

export interface PanelCorrection {
  instruction: string;
  requestedBy: string;
  askedAt: string;
  status: "queued" | "working" | "done" | "stopped";
  summary: string | null;
  /** Its own review's verdict; null before it is reviewed. */
  approved: boolean | null;
}

/** The pull request as it stands, after the corrections delivered so far. */
export interface PullRequestNow {
  summary: string;
  verification: string[];
  notVerified: string[];
  risks: string[];
  spotted: string[];
  /** Delivered before these were apart: the description's Risks stand in. */
  legacy: boolean;
}

interface DeliveredRun {
  kind: "implementation" | "correction";
  outcome: "pull_request" | "abstained" | null;
  summary: string | null;
  evidence: string[] | null;
  details: ResultDetails | null;
}

/**
 * The implementation sets what the pull request does; each correction that
 * rewrote the whole summary replaces it. One without leaves it as it was.
 */
export function pullRequestNow(runs: DeliveredRun[]): PullRequestNow | null {
  let now: PullRequestNow | null = null;
  for (const run of runs) {
    if (run.outcome !== "pull_request" || !run.summary) continue;
    const summary =
      run.kind === "implementation"
        ? run.summary
        : run.details?.pullRequestSummary;
    if (!summary || (run.kind === "correction" && !now)) continue;
    now = {
      summary,
      verification: run.evidence ?? [],
      notVerified: run.details?.notVerified ?? [],
      risks: run.details?.risks ?? [],
      spotted: run.details?.spotted ?? [],
      legacy: !run.details,
    };
  }
  return now;
}

/** What a correction is told the pull request does before it starts. */
export async function pullRequestSummaryNow(
  db: Database,
  workUnitId: string,
): Promise<string | null> {
  const runs = await db
    .select({
      kind: agentRuns.kind,
      outcome: results.outcome,
      summary: results.summary,
      evidence: results.evidence,
      details: results.details,
    })
    .from(agentRuns)
    .innerJoin(results, eq(results.agentRunId, agentRuns.id))
    .where(eq(agentRuns.workUnitId, workUnitId))
    .orderBy(asc(agentRuns.createdAt));
  return pullRequestNow(runs)?.summary ?? null;
}

/** The ticket's pull request number, null before one is opened. */
export async function pullNumber(
  db: Database,
  projectId: string,
  key: string,
): Promise<number | null> {
  const [row] = await db
    .select({ number: pullRequests.number })
    .from(pullRequests)
    .innerJoin(workUnits, eq(workUnits.id, pullRequests.workUnitId))
    .where(
      and(eq(workUnits.projectId, projectId), eq(workUnits.externalId, key)),
    );
  return row?.number ?? null;
}

/**
 * What the builder reads when a ticket's row opens: what the implementer
 * did and checked, the review, the corrections asked since, the models and
 * what they cost, who paid. GitHub's side (draft, diff size, risks) is read
 * live by the server function.
 */
export interface PanelData {
  workUnitId: string;
  /** The run that opened the pull request: its public page is shared. */
  runId: string | null;
  pullRequest: {
    number: number;
    url: string;
    state: "open" | "merged" | "closed";
  } | null;
  implementation: ({ by: string } & PullRequestNow) | null;
  review: {
    by: string;
    summary: string;
    approved: boolean;
    suggestions: { path: string | null; line: number | null; body: string }[];
  } | null;
  corrections: PanelCorrection[];
  /** A run at work now: what it does, as the table words it. */
  working: "writing" | "reviewing" | "delivering" | null;
  models: PanelModel[];
  totalCents: number;
  /** Every run's own duration added up, in seconds; null while one works. */
  totalSeconds: number | null;
  paidBy: PaidBy[];
  /** The latest delivered run's screenshots and videos, served by /evidence. */
  screens: StoredArtifact[];
}

export async function pullPanel(
  db: Database,
  projectId: string,
  key: string,
): Promise<PanelData | null> {
  const [unit] = await db
    .select()
    .from(workUnits)
    .where(
      and(eq(workUnits.projectId, projectId), eq(workUnits.externalId, key)),
    );
  if (!unit) return null;
  // Independent reads, sent together on the one connection.
  const [runs, [pull], requests, recorded, paidBy] = await Promise.all([
    db
      .select({
        id: agentRuns.id,
        kind: agentRuns.kind,
        status: agentRuns.status,
        phase: agentRuns.phase,
        implementer: agentRuns.implementer,
        reviewer: agentRuns.reviewer,
        createdAt: agentRuns.createdAt,
        finishedAt: agentRuns.finishedAt,
        outcome: results.outcome,
        summary: results.summary,
        evidence: results.evidence,
        review: results.review,
        details: results.details,
        artifacts: results.artifacts,
      })
      .from(agentRuns)
      .leftJoin(results, eq(results.agentRunId, agentRuns.id))
      .where(eq(agentRuns.workUnitId, unit.id))
      .orderBy(asc(agentRuns.createdAt)),
    db.select().from(pullRequests).where(eq(pullRequests.workUnitId, unit.id)),
    db
      .select()
      .from(correctionRequests)
      .where(eq(correctionRequests.workUnitId, unit.id))
      .orderBy(asc(correctionRequests.queuedAt)),
    db
      .select({
        role: runModels.role,
        model: runModels.model,
        seconds: runModels.seconds,
        secondsExact: runModels.secondsExact,
        costCents: runModels.costCents,
        costExact: runModels.costExact,
      })
      .from(runModels)
      .innerJoin(agentRuns, eq(agentRuns.id, runModels.agentRunId))
      .where(eq(agentRuns.workUnitId, unit.id)),
    sponsorsByUnit(db, [unit.id]),
  ]);

  const delivered = runs.find(
    (run) => run.kind === "implementation" && run.outcome === "pull_request",
  );
  const reviewed = [...runs]
    .reverse()
    .find((run) => run.outcome === "pull_request" && run.review);
  const review = reviewed?.review as StoredReview | null | undefined;

  const models = (["implementer", "reviewer"] as const).flatMap((role) => {
    const rows = recorded.filter((row) => row.role === role);
    if (rows.length === 0) return [];
    const timed = rows.filter((row) => row.seconds !== null);
    return [
      {
        role,
        name: modelDisplayName(rows[0]!.model),
        seconds: timed.length
          ? timed.reduce((sum, row) => sum + row.seconds!, 0)
          : null,
        secondsExact: rows.every((row) => row.secondsExact),
        costCents: rows.reduce((sum, row) => sum + row.costCents, 0),
        costExact: rows.every((row) => row.costExact),
      },
    ];
  });

  const running = runs.find((run) => run.status === "running");
  const now = pullRequestNow(runs);
  return {
    workUnitId: unit.id,
    runId: delivered?.id ?? null,
    pullRequest: pull
      ? { number: pull.number, url: pull.url, state: pull.state }
      : null,
    implementation:
      delivered && now
        ? {
            by: modelDisplayName(delivered.implementer.split(":")[0]!),
            ...now,
          }
        : null,
    review: review
      ? {
          by: modelDisplayName(review.reviewer),
          summary: review.summary,
          approved: blockingComments(review).length === 0,
          suggestions: review.comments
            .filter((comment) => comment.severity === "suggestion")
            .slice(0, 3)
            .map((comment) => ({
              path: comment.path ?? null,
              line: comment.line ?? null,
              body: comment.body,
            })),
        }
      : null,
    corrections: requests
      .filter((request) => request.status !== "cancelled")
      .map((request) => {
        const run = runs.find(
          (candidate) => candidate.id === request.agentRunId,
        );
        const own = run?.review as StoredReview | null | undefined;
        return {
          instruction: request.instruction,
          requestedBy: request.requestedBy,
          askedAt: new Date(request.queuedAt).toISOString(),
          approved: own ? blockingComments(own).length === 0 : null,
          status: !run
            ? "queued"
            : run.status === "running"
              ? "working"
              : run.outcome === "pull_request"
                ? "done"
                : "stopped",
          summary: run?.summary ?? null,
        };
      }),
    working: running ? phaseStatus(running.phase) : null,
    models,
    totalCents: models.reduce((sum, model) => sum + model.costCents, 0),
    totalSeconds: running
      ? null
      : runs.reduce(
          (sum, run) =>
            run.finishedAt
              ? sum +
                Math.round(
                  (new Date(run.finishedAt).getTime() -
                    new Date(run.createdAt).getTime()) /
                    1000,
                )
              : sum,
          0,
        ) || null,
    paidBy: paidBy.get(unit.id) ?? [],
    screens:
      ([...runs]
        .reverse()
        .find(
          (run) => run.outcome === "pull_request" && run.artifacts?.length,
        )?.artifacts as StoredArtifact[] | undefined) ?? [],
  };
}
