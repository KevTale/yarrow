import {
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import {
  runRequestSchema,
  type AbstentionReason,
  type RunRequest,
} from "../src/core/contracts";
import { describeFailure, isGithubRefusal } from "../src/core/failures";
import {
  defaultPipelineRoles,
  defaultReviewerEffort,
  INITIAL_RESERVATION_CENTS,
} from "../src/core/pipeline";
import { planDispatch, PER_ACCOUNT_CONCURRENCY } from "../src/core/queue";
import {
  blockingComments,
  type Review,
  type StoredReview,
} from "../src/core/review";
import { eq, sql } from "drizzle-orm";
import { connectDatabase, type Database } from "../src/db/client";
import { recordEvent } from "../src/db/events";
import { PostgresLedger } from "../src/db/ledger";
import { recordRunModels } from "../src/db/runs";
import { recordActivity } from "../src/db/activity";
import { agentRuns } from "../src/db/schema";
import { runGithubTasks } from "../src/server/github/tasks";
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
  /** Reasoning effort asked of the reviewer, from none to max. */
  OPENAI_REVIEW_EFFORT?: string;
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
    reviewerEffort: env.OPENAI_REVIEW_EFFORT ?? defaultReviewerEffort,
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
    readonly reason: AbstentionReason,
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
    // A line in the run's activity feed; `key` dedupes retried steps.
    const note = (
      db: Database,
      key: string,
      kind: "phase" | "review" | "outcome",
      detail: Record<string, unknown>,
    ) =>
      recordActivity(db, runId, [
        {
          externalId: key,
          at: new Date().toISOString(),
          actor: kind === "review" ? "reviewer" : "yarrow",
          kind,
          detail,
        },
      ]).catch((error: Error) => console.warn("activity:", error.message));
    const phase = (name: string) =>
      step.do(`phase:${name}`, () =>
        withDb(env, async (db) => {
          await new PostgresLedger(db).setPhase(runId, name);
          await note(db, `phase:${name}`, "phase", { phase: name });
        }),
      );

    let implementer: string | null = null;
    // The files the run changed, to explain a refused write.
    let paths: readonly string[] = [];
    // Reviewer sessions and their wall time, measured between durable steps.
    const reviewers: { id: string; seconds: number | null }[] = [];
    const now = (label: string) => step.do(label, async () => Date.now());
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
            pipeline(env, db).implementerState(implementerId, runId),
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
        const clarityStarted = await now("clarity:started");
        const clarityId = await step.do("clarity:start", () =>
          withDb(env, (db) =>
            pipeline(env, db).startClarity(run, snapshot.questions),
          ),
        );
        const clarity_ = { id: clarityId, seconds: null as number | null };
        reviewers.push(clarity_);
        const clarityState = await waitFor(step, "clarity", () =>
          withDb(env, (db) => pipeline(env, db).reviewerState(clarityId)),
        );
        clarity_.seconds = Math.round(
          ((await now("clarity:finished")) - clarityStarted) / 1000,
        );
        if (clarityState !== "done")
          throw new StopRun(
            "provider_error",
            "The clarity check did not finish.",
          );
        const clarity = await step.do("clarity:read", () =>
          withDb(env, (db) => pipeline(env, db).readClarity(clarityId)),
        );
        if (!clarity.clear) {
          // One list: both agents ask the same things in their own words.
          const questions = snapshot.questions.length
            ? snapshot.questions
            : clarity.questions;
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
            questions.map((question) => `- ${question}`).join("\n"),
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
        const started = await now(`review:${round}:started`);
        const reviewerId = await step.do(`review:${round}:start`, () =>
          withDb(env, (db) =>
            pipeline(env, db).startReview(run, implementerId, snapshot),
          ),
        );
        const reviewer = { id: reviewerId, seconds: null as number | null };
        reviewers.push(reviewer);
        const state = await waitFor(step, `review:${round}`, () =>
          withDb(env, (db) => pipeline(env, db).reviewerState(reviewerId)),
        );
        reviewer.seconds = Math.round(
          ((await now(`review:${round}:finished`)) - started) / 1000,
        );
        if (state !== "done")
          throw new StopRun("provider_error", "The review did not finish.");
        return step.do(`review:${round}:read`, () =>
          withDb(env, async (db) => {
            const read = await pipeline(env, db).readReview(reviewerId);
            const blocking = blockingComments(read).length;
            await note(db, `review:${round}`, "review", {
              text: read.summary,
              failed: blocking,
              passed: read.comments.length - blocking,
            });
            return read;
          }),
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
      paths = snapshot.paths;
      const delivered = await step.do(
        "deliver",
        { retries: { limit: 2, delay: "30 seconds", backoff: "exponential" } },
        () =>
          withDb(env, (db) =>
            pipeline(env, db).deliver(run, implementerId, snapshot, stored),
          ).catch((error: Error) => {
            // A refusal from GitHub stays a refusal: retrying only spends
            // the invocation's subrequests, and then the stop has none left.
            if (isGithubRefusal(error.message))
              throw new NonRetryableError(error.message);
            throw error;
          }),
      );
      await step.do("settle", () =>
        withDb(env, async (db) => {
          const runner = pipeline(env, db);
          await runner.syncActivity(runId);
          await note(db, "outcome", "outcome", {
            phase: "pull_request",
            url: delivered.url,
            text: snapshot.summary,
          });
          const ledger = new PostgresLedger(db);
          const { costCents: cost, models } = await runner.usage(
            implementerId,
            reviewers,
          );
          await recordRunModels(db, runId, models);
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
      const raw = (error as Error).message ?? "Run failed";
      const failure =
        error instanceof StopRun
          ? { reason: error.reason, summary: error.message }
          : describeFailure(raw, paths);
      const implementerId = implementer;
      const reviewerRuns = [...reviewers];
      // What must not be lost first, in as few requests as possible: the
      // real cost and the stop. A run that failed may have spent most of
      // its invocation's subrequests already.
      await step.do("abstain", () =>
        withDb(env, async (db) => {
          const ledger = new PostgresLedger(db);
          const usage = await pipeline(env, db)
            .usage(implementerId, reviewerRuns)
            .catch(() => ({ costCents: 0, models: [] }));
          const cost = usage.costCents;
          await recordRunModels(db, runId, usage.models);
          await topUp(ledger, db, runId, cost);
          if (failure.reason !== "ticket_unclear")
            await recordEvent(db, {
              type: "run.failed",
              agentRunId: runId,
              payload: { message: raw.slice(0, 500) },
            });
          await ledger.settle(runId, {
            outcome: "abstained",
            actualCostCents: cost,
            reason: failure.reason,
            summary: failure.summary.slice(0, 2000),
            evidence: [],
          });
        }),
      );
      // Then the extras, which never fail the run: the feed, the board.
      await step.do("abstain:after", () =>
        withDb(env, async (db) => {
          await pipeline(env, db)
            .syncActivity(runId)
            .catch(() => {});
          await note(db, "outcome", "outcome", {
            phase: "abstained",
            text: failure.summary.slice(0, 2000),
          });
          // The board follows the builder's choice for stopped tickets.
          await pipeline(env, db)
            .moveRunTicket(runId, "stopped")
            .catch(() => {});
        }).catch((error: Error) =>
          console.warn("abstain:after", error.message),
        ),
      );
      return { outcome: "abstained", reason: failure.reason };
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
      let instance: WorkflowInstance | null = null;
      try {
        instance = await env.WORKFLOW.get(stale.runId);
      } catch {
        instance = null;
      }
      if (instance) {
        log.push(
          ...(await reviveDeadRun(env, db, instance, stale.runId).catch(
            (error: Error) => [`revive ${stale.runId}: ${describe(error)}`],
          )),
        );
        continue;
      }
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
    return log;
  });
}

/**
 * A workflow that died without recording its stop leaves its run "running"
 * and the sponsor money reserved. It is stopped here, never restarted: a
 * restart would pay for the whole implementation again. Its real cost is
 * read from the implementer's session, saved on the run, and charged.
 */
async function reviveDeadRun(
  env: BrainEnv,
  db: Database,
  instance: WorkflowInstance,
  runId: string,
): Promise<string[]> {
  const { status, error } = await instance.status();
  if (status !== "errored" && status !== "terminated") return [];
  const [run] = await db
    .select({ session: agentRuns.implementerSession })
    .from(agentRuns)
    .where(eq(agentRuns.id, runId));
  const usage = await pipeline(env, db)
    .usage(run?.session ?? null, [])
    .catch(() => ({ costCents: 0, models: [] }));
  const raw = error?.message ?? `The workflow was ${status}.`;
  const failure = describeFailure(raw);
  const ledger = new PostgresLedger(db);
  await recordRunModels(db, runId, usage.models);
  await topUp(ledger, db, runId, usage.costCents);
  await recordEvent(db, {
    type: "run.failed",
    agentRunId: runId,
    payload: { message: raw.slice(0, 500) },
  });
  await ledger.settle(runId, {
    outcome: "abstained",
    actualCostCents: usage.costCents,
    reason: failure.reason,
    summary: failure.summary,
    evidence: [],
  });
  return [`abstained dead run ${runId}`];
}

/** Drizzle wraps driver errors ("Failed query: …"); the cause says why. */
function describe(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof Error
    ? `${String(error)}
cause: ${cause.message}`
    : String(error);
}

/** Postgres advisory lock keys: one pass of each at a time. */
const LOCK = { tasks: 7_310_001, dispatch: 7_310_002 } as const;

/**
 * Runs `work` only if no other pass holds `key`, on a connection of its own
 * (the work keeps its own connections). Null when another pass holds it.
 */
async function alone<T>(
  env: BrainEnv,
  key: number,
  work: () => Promise<T>,
): Promise<T | null> {
  if (!env.DATABASE_URL) return work();
  const lock = connectDatabase(env.DATABASE_URL);
  try {
    return await lock.db.transaction(async (tx) => {
      const [row] = await tx.execute<{ ok: boolean }>(
        sql`select pg_try_advisory_xact_lock(${key}) as ok`,
      );
      return row?.ok ? work() : null;
    });
  } finally {
    await lock.close();
  }
}

/**
 * The same pass, a few seconds later if another one holds the lock: a
 * ticket queued while a pass was already past its reading must not wait
 * for the next minute.
 */
async function soon<T>(
  env: BrainEnv,
  key: number,
  work: () => Promise<T>,
  tries = 4,
): Promise<T | null> {
  for (let i = 0; i < tries; i++) {
    const result = await alone(env, key, work);
    if (result !== null) return result;
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  return null;
}

/**
 * One pass: GitHub's labels first (labeling queues an issue through the
 * webhook, which kicks again), then the queue. Run every minute by the cron
 * and at once by the web Worker when a ticket is queued or money arrives.
 */
async function tick(env: BrainEnv, wait: boolean): Promise<void> {
  const run = wait ? soon : alone;
  if (env.DATABASE_URL && env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
    const credentials = {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY,
    };
    const log = await run(env, LOCK.tasks, () =>
      withDb(env, (db) => runGithubTasks(db, credentials)),
    ).catch((error) => [describe(error)]);
    if (log?.length) console.log("github tasks", log);
  }
  console.log(
    "dispatch",
    (await run(env, LOCK.dispatch, () => dispatch(env)).catch((error) => [
      describe(error),
    ])) ?? ["another pass is dispatching"],
  );
}

/**
 * Reached by the web Worker through a service binding, never over HTTP:
 * a ticket was queued or money arrived, so the pass runs now instead of
 * at the next minute. Returns at once; the pass goes on after.
 */
export class Brain extends WorkerEntrypoint<BrainEnv> {
  async kick(): Promise<void> {
    this.ctx.waitUntil(
      tick(this.env, true).catch((error) =>
        console.warn("kick", describe(error)),
      ),
    );
  }
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
        // The minute's pass is the safety net: a kick may be running.
        await tick(env, false);
        if (
          new Date(controller.scheduledTime).getUTCMinutes() % 5 === 0 &&
          env.DATABASE_URL
        )
          console.log(
            "tracker sync",
            await withDb(env, (db) =>
              syncTrackers(db, trackerSecretsFromEnv(env)),
            ).catch((error) => [describe(error)]),
          );
      })(),
    );
  },
} satisfies ExportedHandler<BrainEnv>;
