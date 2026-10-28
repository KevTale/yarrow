import { and, asc, eq, inArray } from "drizzle-orm";
import { modelDisplayName } from "../core/pipeline";
import { blockingComments, type StoredReview } from "../core/review";
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
  status: "queued" | "working" | "done" | "stopped";
  summary: string | null;
}

/**
 * What the builder reads when a ticket's row opens: what the implementer
 * did and checked, the review, the corrections asked since, the models and
 * what they cost, who paid. GitHub's side (draft, diff size, risks) is read
 * live by the server function.
 */
export interface PanelData {
  workUnitId: string;
  pullRequest: {
    number: number;
    url: string;
    state: "open" | "merged" | "closed";
  } | null;
  implementation: { by: string; summary: string; evidence: string[] } | null;
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
  const runs = await db
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
    })
    .from(agentRuns)
    .leftJoin(results, eq(results.agentRunId, agentRuns.id))
    .where(eq(agentRuns.workUnitId, unit.id))
    .orderBy(asc(agentRuns.createdAt));
  const [pull] = await db
    .select()
    .from(pullRequests)
    .where(eq(pullRequests.workUnitId, unit.id));
  const requests = await db
    .select()
    .from(correctionRequests)
    .where(eq(correctionRequests.workUnitId, unit.id))
    .orderBy(asc(correctionRequests.queuedAt));
  const recorded = runs.length
    ? await db
        .select()
        .from(runModels)
        .where(
          inArray(
            runModels.agentRunId,
            runs.map((run) => run.id),
          ),
        )
    : [];

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
  return {
    workUnitId: unit.id,
    pullRequest: pull
      ? { number: pull.number, url: pull.url, state: pull.state }
      : null,
    implementation: delivered?.summary
      ? {
          by: modelDisplayName(delivered.implementer.split(":")[0]!),
          summary: delivered.summary,
          evidence: delivered.evidence ?? [],
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
        return {
          instruction: request.instruction,
          requestedBy: request.requestedBy,
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
    paidBy: (await sponsorsByUnit(db, [unit.id])).get(unit.id) ?? [],
  };
}
