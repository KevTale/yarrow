import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { runRequestSchema, type RunRequest } from "../src/core/contracts";
import {
  defaultPipelineRoles,
  INITIAL_RESERVATION_CENTS,
} from "../src/core/pipeline";
import { planDispatch, PER_ACCOUNT_CONCURRENCY } from "../src/core/queue";
import {
  blockingComments,
  type Review,
  type StoredReview,
} from "../src/core/review";
import { eq } from "drizzle-orm";
import { connectDatabase, type Database } from "../src/db/client";
import { recordEvent } from "../src/db/events";
import { PostgresLedger } from "../src/db/ledger";
import { agentRuns } from "../src/db/schema";
import {
  correctionInstruction,
  loadDispatch,
  staleRunningRuns,
} from "../src/db/queue";
import {
  syncTrackers,
  trackerSecretsFromEnv,
} from "../src/server/trackers/index";
import { ManagedAgentsClient } from "../src/runner/anthropic";
import { AgentsClient, defaultReviewerRates } from "../src/runner/openai";
import {
  RunPipeline,
  type EvidenceStore,
  type ImplementationSnapshot,
} from "../src/runner/pipeline";

export interface BrainEnv {
  WORKFLOW: Workflow<RunRequest>;
  /** Optional until R2 is enabled on the account. */
  EVIDENCE?: R2Bucket;
  APP_URL: string;
  DATABASE_URL?: string;
  ANTHROPIC_API_KEY?: string;
  /** Created once by scripts/bootstrap-anthropic.ts. */
  ANTHROPIC_AGENT_ID?: string;
  ANTHROPIC_ENVIRONMENT_ID?: string;
  OPENAI_API_KEY?: string;
  OPENAI_REVIEW_MODEL?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  LINEAR_CLIENT_ID?: string;
  LINEAR_CLIENT_SECRET?: string;
  JIRA_CLIENT_ID?: string;
  JIRA_CLIENT_SECRET?: string;
  TRELLO_API_KEY?: string;
  TRELLO_API_SECRET?: string;
  /** "off" pauses dispatch (kill switch) without stopping running runs. */
  DISPATCH?: string;
}

async function withDb<T>(
  env: BrainEnv,
  work: (db: Database) => Promise<T>,
): Promise<T> {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  const connection = connectDatabase(env.DATABASE_URL);
  try {
    return await work(connection.db);
  } finally {
    await connection.close();
  }
}

function missingConfig(env: BrainEnv): string[] {
  return (
    [
      "DATABASE_URL",
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AGENT_ID",
      "ANTHROPIC_ENVIRONMENT_ID",
      "OPENAI_API_KEY",
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
    ] as const
  ).filter((key) => !env[key]);
}

function pipeline(env: BrainEnv, db: Database): RunPipeline {
  return new RunPipeline({
    db,
    anthropic: new ManagedAgentsClient(env.ANTHROPIC_API_KEY!),
    openai: new AgentsClient(env.OPENAI_API_KEY!),
    github: {
      appId: env.GITHUB_APP_ID!,
      privateKey: env.GITHUB_APP_PRIVATE_KEY!,
    },
    trackers: trackerSecretsFromEnv(env),
    evidence: env.EVIDENCE as unknown as EvidenceStore | undefined,
    appUrl: env.APP_URL,
    roles: defaultPipelineRoles,
    anthropicAgentId: env.ANTHROPIC_AGENT_ID!,
    defaultEnvironmentId: env.ANTHROPIC_ENVIRONMENT_ID!,
    reviewerModel: env.OPENAI_REVIEW_MODEL ?? "gpt-6-astra",
    reviewerRates: defaultReviewerRates,
  });
}

type SessionState = "working" | "done" | "failed";

/**
 * Durable polling of a provider session. Sleeps grow from 20 s to 5 min so
 * long runs stay well inside the Workflow step budget. There is no business
 * cap on duration; the bound only protects the Workflow itself.
 */
async function waitFor(
  step: WorkflowStep,
  label: string,
  check: () => Promise<SessionState>,
): Promise<SessionState | "timeout"> {
  for (let i = 0; i < 120; i++) {
    await step.sleep(
      `${label}:sleep:${i}`,
      i < 6 ? "20 seconds" : i < 40 ? "1 minute" : "5 minutes",
    );
    const state = await step.do(
      `${label}:poll:${i}`,
      { retries: { limit: 5, delay: "10 seconds", backoff: "exponential" } },
      check,
    );
    if (state !== "working") return state;
  }
  return "timeout";
}

class StopRun extends Error {
  constructor(
    readonly reason: "ticket_unclear" | "provider_error" | "other",
    message: string,
  ) {
    super(message);
  }
}

export class AgentWorkWorkflow extends WorkflowEntrypoint<
  BrainEnv,
  RunRequest
> {
  async run(event: WorkflowEvent<RunRequest>, step: WorkflowStep) {
    const request = runRequestSchema.parse(event.payload);
    const env = this.env;
    const { runId } = request;
    const missing = missingConfig(env);
    if (missing.length > 0)
      throw new Error(`Missing configuration: ${missing.join(", ")}`);

    // Reservation is normally done by the dispatcher; this keeps manual triggers safe.
    await step.do("reserve", () =>
      withDb(env, (db) => new PostgresLedger(db).reserve(request)),
    );
    const phase = (name: string) =>
      step.do(`phase:${name}`, () =>
        withDb(env, (db) => new PostgresLedger(db).setPhase(runId, name)),
      );

    let implementer: string | null = null;
    const reviewers: string[] = [];
    try {
      const run = await step.do("prepare", () =>
        withDb(env, (db) => pipeline(env, db).prepare(runId)),
      );

      await phase("implementing");
      implementer = await step.do(
        "implementer:start",
        { retries: { limit: 1, delay: "30 seconds", backoff: "constant" } },
        () => withDb(env, (db) => pipeline(env, db).startImplementation(run)),
      );
      const implementerId = implementer;
      const implementerDone = (label: string) =>
        waitFor(step, label, () =>
          withDb(env, (db) =>
            pipeline(env, db).implementerState(implementerId),
          ),
        );
      const readImplementation = (label: string) =>
        step.do(label, () =>
          withDb(env, (db) =>
            pipeline(env, db).readImplementation(implementerId),
          ),
        );

      if ((await implementerDone("implementer:first")) !== "done")
        throw new StopRun(
          "provider_error",
          "The implementer session did not finish.",
        );
      let snapshot: ImplementationSnapshot =
        await readImplementation("implementer:read:1");

      // Unclear ticket: a second opinion from the reviewer before giving up.
      if (snapshot.status === "unclear") {
        await phase("checking clarity");
        const clarityId = await step.do("clarity:start", () =>
          withDb(env, (db) =>
            pipeline(env, db).startClarity(run, snapshot.questions),
          ),
        );
        reviewers.push(clarityId);
        if (
          (await waitFor(step, "clarity", () =>
            withDb(env, (db) => pipeline(env, db).reviewerState(clarityId)),
          )) !== "done"
        )
          throw new StopRun(
            "provider_error",
            "The clarity check did not finish.",
          );
        const clarity = await step.do("clarity:read", () =>
          withDb(env, (db) => pipeline(env, db).readClarity(clarityId)),
        );
        if (!clarity.clear) {
          const questions = [
            ...new Set([...snapshot.questions, ...clarity.questions]),
          ];
          await step.do("clarity:comment", () =>
            withDb(env, (db) => {
              const runner = pipeline(env, db);
              return runner.commentOnTicket(
                run,
                runner.unclearComment(questions),
              );
            }),
          );
          throw new StopRun(
            "ticket_unclear",
            `Implementer and reviewer both found the ticket unclear: ${questions.join(" ")}`,
          );
        }
        await phase("implementing");
        await step.do("implementer:clarified", () =>
          withDb(env, (db) => {
            const runner = pipeline(env, db);
            return runner.sendToImplementer(
              implementerId,
              runner.clarifiedMessage(clarity.reading),
            );
          }),
        );
        if ((await implementerDone("implementer:clarified")) !== "done")
          throw new StopRun(
            "provider_error",
            "The implementer session did not finish.",
          );
        snapshot = await readImplementation("implementer:read:2");
      }
      if (snapshot.status !== "done" || snapshot.paths.length === 0)
        throw new StopRun(
          snapshot.status === "unclear" ? "ticket_unclear" : "other",
          snapshot.summary || "The implementer could not produce a change.",
        );

      // Review by the other lab, then at most one fix round on blocking comments.
      const review = async (round: number): Promise<Review> => {
        await phase(round === 1 ? "reviewing" : "re-reviewing");
        const reviewerId = await step.do(`review:${round}:start`, () =>
          withDb(env, (db) =>
            pipeline(env, db).startReview(run, implementerId, snapshot),
          ),
        );
        reviewers.push(reviewerId);
        if (
          (await waitFor(step, `review:${round}`, () =>
            withDb(env, (db) => pipeline(env, db).reviewerState(reviewerId)),
          )) !== "done"
        )
          throw new StopRun("provider_error", "The review did not finish.");
        return step.do(`review:${round}:read`, () =>
          withDb(env, (db) => pipeline(env, db).readReview(reviewerId)),
        );
      };
      let finalReview = await review(1);
      let rounds = 1;
      if (blockingComments(finalReview).length > 0) {
        await phase("fixing");
        const firstReview = finalReview;
        await step.do("implementer:fix", () =>
          withDb(env, (db) => {
            const runner = pipeline(env, db);
            return runner.sendToImplementer(
              implementerId,
              runner.fixMessage(firstReview),
            );
          }),
        );
        if ((await implementerDone("implementer:fix")) !== "done")
          throw new StopRun("provider_error", "The fix round did not finish.");
        snapshot = await readImplementation("implementer:read:fix");
        finalReview = await review(2);
        rounds = 2;
      }
      const stored: StoredReview = {
        ...finalReview,
        reviewer: defaultPipelineRoles.reviewer,
        rounds,
      };

      await phase("delivering");
      const delivered = await step.do(
        "deliver",
        { retries: { limit: 2, delay: "30 seconds", backoff: "exponential" } },
        () =>
          withDb(env, (db) =>
            pipeline(env, db).deliver(run, implementerId, snapshot, stored),
          ),
      );
      await step.do("settle", () =>
        withDb(env, async (db) => {
          const runner = pipeline(env, db);
          const ledger = new PostgresLedger(db);
          const cost = await runner.cost(implementerId, reviewers);
          await topUp(ledger, db, runId, cost);
          await ledger.settle(runId, {
            outcome: "pull_request",
            actualCostCents: cost,
            pullRequestUrl: delivered.url,
            pullRequestNumber: delivered.number,
            branch: delivered.branch,
            summary: snapshot.summary || "Pull request delivered.",
            evidence: snapshot.verification.length
              ? snapshot.verification
              : ["Reviewed by the other lab before delivery"],
            review: stored,
            artifacts: delivered.artifacts,
          });
        }),
      );
      return { outcome: "pull_request", url: delivered.url };
    } catch (error) {
      const stop =
        error instanceof StopRun
          ? error
          : new StopRun(
              "provider_error",
              (error as Error).message ?? "Run failed",
            );
      const implementerId = implementer;
      const reviewerIds = [...reviewers];
      await step.do("abstain", () =>
        withDb(env, async (db) => {
          const ledger = new PostgresLedger(db);
          const cost = await pipeline(env, db)
            .cost(implementerId, reviewerIds)
            .catch(() => 0);
          await topUp(ledger, db, runId, cost);
          if (stop.reason === "provider_error")
            await recordEvent(db, {
              type: "run.failed",
              agentRunId: runId,
              payload: { message: stop.message.slice(0, 500) },
            });
          await ledger.settle(runId, {
            outcome: "abstained",
            actualCostCents: cost,
            reason: stop.reason,
            summary: stop.message.slice(0, 2000),
            evidence: [],
          });
        }),
      );
      return { outcome: "abstained", reason: stop.reason };
    }
  }
}

/** Moves more sponsor money onto the run when it cost more than reserved. */
async function topUp(
  ledger: PostgresLedger,
  db: Database,
  runId: string,
  cost: number,
): Promise<void> {
  const [run] = await db
    .select({ reserved: agentRuns.reservedCents, status: agentRuns.status })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));
  if (run && run.status === "running" && cost > run.reserved)
    await ledger.reserveMore(runId, cost - run.reserved, 1);
}

/** Starts as many queued runs as money and fairness allow. */
async function dispatch(env: BrainEnv): Promise<string[]> {
  if (env.DISPATCH === "off") return ["dispatch paused"];
  const missing = missingConfig(env);
  if (missing.length > 0)
    return [`dispatch disabled, missing: ${missing.join(", ")}`];
  return withDb(env, async (db) => {
    const log: string[] = [];
    const ledger = new PostgresLedger(db);
    const { candidates, state } = await loadDispatch(db, {
      perAccountLimit: PER_ACCOUNT_CONCURRENCY,
      globalLimit: 20,
    });
    for (const item of planDispatch(candidates, state)) {
      const runId = crypto.randomUUID();
      const request: RunRequest =
        item.kind === "implementation"
          ? {
              runId,
              workUnitId: item.workUnitId,
              kind: "implementation",
              budgetCents: INITIAL_RESERVATION_CENTS,
            }
          : {
              runId,
              workUnitId: item.workUnitId,
              kind: "correction",
              instruction: await correctionInstruction(db, item.id),
              correctionRequestId: item.id,
              budgetCents: INITIAL_RESERVATION_CENTS,
            };
      try {
        await ledger.reserve(request);
      } catch (error) {
        log.push(
          `${item.kind} ${item.workUnitId}: ${(error as Error).message}`,
        );
        continue;
      }
      await env.WORKFLOW.create({ id: runId, params: request });
      log.push(`started ${item.kind} ${runId}`);
    }
    // A reservation without a workflow (crash between the two): start it now.
    for (const stale of await staleRunningRuns(
      db,
      new Date(Date.now() - 10 * 60_000),
    )) {
      try {
        await env.WORKFLOW.get(stale.runId);
      } catch {
        await env.WORKFLOW.create({
          id: stale.runId,
          params: {
            runId: stale.runId,
            workUnitId: stale.workUnitId,
            kind: stale.kind,
            budgetCents: stale.reservedCents || INITIAL_RESERVATION_CENTS,
            ...(stale.kind === "correction"
              ? {
                  instruction: stale.instruction ?? "",
                  correctionRequestId: stale.correctionRequestId ?? undefined,
                }
              : {}),
          } as RunRequest,
        });
        log.push(`recovered ${stale.runId}`);
      }
    }
    return log;
  });
}

export default {
  fetch() {
    return Response.json({ service: "yarrow-brain", status: "ok" });
  },
  async scheduled(
    controller: ScheduledController,
    env: BrainEnv,
    ctx: ExecutionContext,
  ) {
    ctx.waitUntil(
      (async () => {
        console.log(
          "dispatch",
          await dispatch(env).catch((error) => [String(error)]),
        );
        if (
          new Date(controller.scheduledTime).getUTCMinutes() % 5 === 0 &&
          env.DATABASE_URL
        )
          console.log(
            "tracker sync",
            await withDb(env, (db) =>
              syncTrackers(db, trackerSecretsFromEnv(env)),
            ).catch((error) => [String(error)]),
          );
      })(),
    );
  },
} satisfies ExportedHandler<BrainEnv>;
