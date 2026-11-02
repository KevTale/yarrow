import {
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import { NonRetryableError } from "cloudflare:workflows";
import {
  runRequestSchema,
  type AbstentionReason,
  type RunRequest,
} from "../src/core/contracts";
import {
  describeFailure,
  isGithubRefusal,
  outOfCredit,
  type Provider,
} from "../src/core/failures";
import {
  defaultPipelineRoles,
  defaultReviewerEffort,
  INITIAL_RESERVATION_CENTS,
} from "../src/core/pipeline";
import { planDispatch, PER_ACCOUNT_CONCURRENCY } from "../src/core/queue";
import { presentationSchema } from "../src/core/presentation";
import {
  blockingComments,
  reviewedCriteria,
  type Review,
  type StoredReview,
} from "../src/core/review";
import { eq, sql } from "drizzle-orm";
import type { FundingStart } from "../src/core/daily-funding";
import {
  askedToday,
  askQuestion,
  chatContext,
  failAnswer,
  pullContext,
  saveSpokenTurn,
  ticketForChat,
  ticketsForChat,
  saveAnswer,
} from "../src/db/chat";
import { connectDatabase, type Database } from "../src/db/client";
import {
  computeSummary,
  createDailyFunding,
  listDailyFundings,
  pauseDailyFunding,
  updateDailyFunding,
  type DailyFundingInput,
} from "../src/db/admin";
import { expireDailyCredit, fundDaily } from "../src/db/contributions";
import { recordEvent } from "../src/db/events";
import { PostgresLedger } from "../src/db/ledger";
import { activePauses, clearPause, pauseProvider } from "../src/db/pauses";
import { recordRunModels } from "../src/db/runs";
import { recordActivity } from "../src/db/activity";
import { agentRuns } from "../src/db/schema";
import {
  pullRequestAction,
  requestCorrection,
  type ActionResult,
  type PullRequestAction,
} from "../src/server/github/pull-actions";
import {
  createIssue,
  type NewIssueResult,
} from "../src/server/github/new-issue";
import {
  answerIssue,
  closePullRequest,
  closeTicket,
} from "../src/server/github/ticket-actions";
import { lazyRepoReader, repoReader } from "../src/server/github/repo-reads";
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
import { ensureJiraWebhooks } from "../src/server/trackers/jira-webhooks";
import { ManagedAgentsClient } from "../src/runner/anthropic";
import { isMuseSession, MUSE_EFFORT, MUSE_MODEL } from "../src/runner/muse";
import {
  answerQuestion,
  chatContextText,
  type ChatAnswer,
} from "../src/runner/chat";
import {
  completion,
  conversationSoFar,
  memberSpoke,
  memberWords,
  stageNote,
  TALK_SILENCE_MS,
  talkFiller,
  talkGrantOf,
  talkMessages,
  talkRequestSchema,
  talkTurn,
  type TalkContext,
} from "../src/runner/talk";
import {
  conversationToken,
  readTalkGrant,
  sameKey,
  signTalkGrant,
  talkKey,
} from "../src/runner/voice/agent";
import { AgentsClient, defaultReviewerRates } from "../src/runner/openai";
import {
  RunPipeline,
  type EvidenceStore,
  type ImplementationSnapshot,
} from "../src/runner/pipeline";
import { voiceProvider } from "../src/runner/voice/index";
import { sendOutOfCreditAlert } from "./alerts";
import { museClient, type MuseSandbox } from "./muse";
import type { Stage } from "./stage";
import {
  restartSteps,
  stageAddress,
  stagePlan,
  stageSignIn,
  type StageCue,
  type StageCueResult,
  type StageSpec,
  type StageStatus,
} from "../src/core/stage";
import { CHAT_DAILY_QUESTIONS, chatCostCents } from "../src/core/chat";
import { stageContext } from "../src/db/stage";
import { installationToken } from "../src/server/github/app";
import { RECORDER_SOURCE } from "../src/runner/recorder/source";

export { MuseOutbound, MuseSandbox } from "./muse";
export { Stage } from "./stage";

export interface BrainEnv {
  WORKFLOW: Workflow<RunRequest>;
  /** One answer in a pull request's conversation per instance. */
  CHAT: Workflow<ChatRequest>;
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
  /** The app maintainers mention on a PR: yarrow-run, yarrow-run-dev. */
  GITHUB_APP_SLUG?: string;
  TOKEN_ENCRYPTION_KEY?: string;
  LINEAR_CLIENT_ID?: string;
  LINEAR_CLIENT_SECRET?: string;
  JIRA_CLIENT_ID?: string;
  JIRA_CLIENT_SECRET?: string;
  TRELLO_API_KEY?: string;
  TRELLO_API_SECRET?: string;
  /** "off" pauses dispatch (kill switch) without stopping running runs. */
  DISPATCH?: string;
  /** Where the out-of-credit alert goes; optional, like RESEND_API_KEY. */
  ALERT_EMAIL?: string;
  RESEND_API_KEY?: string;
  /** Linked from the alert. */
  ADMIN_URL?: string;
  /** Who voices the presentations (src/runner/voice): "elevenlabs" when absent. */
  VOICE_PROVIDER?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_VOICE_ID?: string;
  ELEVENLABS_MODEL?: string;
  /**
   * Who implements new runs: "meta" (Muse Code running Muse Wonder in a
   * MUSE container) or "claude", the default. Back to Claude: remove it.
   */
  IMPLEMENTER?: string;
  /** Muse Code's containers (workers/muse.ts); absent on this machine. */
  MUSE?: DurableObjectNamespace<MuseSandbox>;
  META_API_KEY?: string;
  META_MODEL?: string;
  META_EFFORT?: string;
  /** Pull requests' stages (workers/stage.ts); dev only for now. */
  STAGE?: DurableObjectNamespace<Stage>;
  /**
   * The live review's call (src/runner/talk.ts): the ElevenLabs agent made by
   * scripts/voice-agent.ts, and the secret its passes and its key to the
   * brain come from. Both put by that script, dev only for now.
   */
  ELEVENLABS_AGENT_ID?: string;
  VOICE_SECRET?: string;
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
    voice: voiceProvider(env),
    appUrl: env.APP_URL,
    roles: defaultPipelineRoles,
    anthropicAgentId: env.ANTHROPIC_AGENT_ID!,
    defaultEnvironmentId: env.ANTHROPIC_ENVIRONMENT_ID!,
    reviewerModel: env.OPENAI_REVIEW_MODEL ?? "gpt-6-astra",
    reviewerEffort: env.OPENAI_REVIEW_EFFORT ?? defaultReviewerEffort,
    reviewerRates: defaultReviewerRates,
    appSlug: env.GITHUB_APP_SLUG,
    implementer: env.IMPLEMENTER === "meta" ? "meta" : "claude",
    muse: env.MUSE && env.META_API_KEY ? museClient(env.MUSE) : null,
    museModel: env.META_MODEL ?? MUSE_MODEL,
    museEffort: env.META_EFFORT ?? MUSE_EFFORT,
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
    // Muse's container stops once the run is settled; Claude's session ends alone.
    const release = (sessionId: string | null) =>
      step.do("implementer:release", () =>
        withDb(env, (db) =>
          pipeline(env, db).releaseImplementer(sessionId),
        ).catch((error: Error) => console.warn("release", error.message)),
      );
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
        () =>
          withDb(env, async (db) => {
            const id = await pipeline(env, db).startImplementation(run);
            // Anthropic took work: any pause for want of credit is over.
            if (!isMuseSession(id)) await clearPause(db, "anthropic");
            return id;
          }),
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
            pipeline(env, db).readImplementation(implementerId, run.projectId),
          ),
        );

      // A session that ended on an error says why (no credit left, say).
      const implementerStopped = async (
        label: string,
        state: string,
        fallback: string,
      ): Promise<Error> => {
        const error =
          state === "failed"
            ? await step.do(`${label}:error`, () =>
                withDb(env, (db) =>
                  pipeline(env, db).implementerError(implementerId),
                ).catch(() => null),
              )
            : null;
        const provider = isMuseSession(implementerId) ? "Meta" : "Anthropic";
        return error
          ? new Error(`${provider} session error: ${error}`)
          : new StopRun("provider_error", fallback);
      };
      const implementerFirst = await implementerDone("implementer:first");
      if (implementerFirst !== "done")
        throw await implementerStopped(
          "implementer:first",
          implementerFirst,
          "The implementer session did not finish.",
        );
      let snapshot: ImplementationSnapshot =
        await readImplementation("implementer:read:1");

      // Unclear ticket: a second opinion from the reviewer before giving up.
      if (snapshot.status === "unclear") {
        await phase("checking clarity");
        const clarityStarted = await now("clarity:started");
        const clarityId = await step.do("clarity:start", () =>
          withDb(env, async (db) => {
            const id = await pipeline(env, db).startClarity(
              run,
              snapshot.questions,
            );
            await clearPause(db, "openai");
            return id;
          }),
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
                runner.unclearComment(questions, run),
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
        const implementerClarified = await implementerDone(
          "implementer:clarified",
        );
        if (implementerClarified !== "done")
          throw await implementerStopped(
            "implementer:clarified",
            implementerClarified,
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
      const review = async (
        round: number,
        earlier?: Review,
      ): Promise<Review> => {
        await phase(round === 1 ? "reviewing" : "re-reviewing");
        const started = await now(`review:${round}:started`);
        const reviewerId = await step.do(`review:${round}:start`, () =>
          withDb(env, async (db) => {
            const id = await pipeline(env, db).startReview(
              run,
              implementerId,
              snapshot,
              earlier,
            );
            await clearPause(db, "openai");
            return id;
          }),
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
        const implementerFixed = await implementerDone("implementer:fix");
        if (implementerFixed !== "done")
          throw await implementerStopped(
            "implementer:fix",
            implementerFixed,
            "The fix round did not finish.",
          );
        snapshot = await readImplementation("implementer:read:fix");
        finalReview = await review(2, firstReview);
        rounds = 2;
      }
      snapshot = {
        ...snapshot,
        criteria: reviewedCriteria(snapshot.criteria, finalReview),
      };
      const stored: StoredReview = {
        ...finalReview,
        reviewer: defaultPipelineRoles.reviewer,
        rounds,
      };

      await phase("delivering");
      paths = snapshot.paths;
      // Its own step: a delivery retried does not voice it twice. A
      // presentation that fails never holds the pull request back.
      const presentation = await step.do("present", () =>
        withDb(env, (db) =>
          pipeline(env, db).presentation(run, implementerId),
        ).catch((error: Error) => {
          console.warn("presentation:", error.message);
          return null;
        }),
      );
      const delivered = await step.do(
        "deliver",
        { retries: { limit: 2, delay: "30 seconds", backoff: "exponential" } },
        () =>
          withDb(env, (db) =>
            pipeline(env, db).deliver(
              run,
              implementerId,
              snapshot,
              stored,
              presentation,
            ),
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
            details: {
              ask: run.kind === "implementation" ? snapshot.ask : undefined,
              pullRequestSummary:
                run.kind === "correction" ? snapshot.pr_summary : undefined,
              criteria: snapshot.criteria,
              notVerified: snapshot.not_verified,
              risks: snapshot.risks,
              spotted: snapshot.spotted,
            },
          });
        }),
      );
      await release(implementerId);
      // The stage of this version, booted once in the background, so the
      // first viewer starts from its snapshot. Never holds the run back.
      if (env.STAGE)
        await step.do("stage", async () => {
          try {
            const spec = await stageSpec(env, request.workUnitId);
            if (typeof spec === "string") console.warn("stage:", spec);
            else await env.STAGE!.getByName(request.workUnitId).prepare(spec);
          } catch (error) {
            console.warn("stage:", describe(error));
          }
        });
      return { outcome: "pull_request", url: delivered.url };
    } catch (error) {
      const raw = (error as Error).message ?? "Run failed";
      const failure =
        error instanceof StopRun
          ? { reason: error.reason, summary: error.message }
          : describeFailure(raw, paths);
      const implementerId = implementer;
      const reviewerRuns = [...reviewers];
      const unpaid =
        failure.reason === "provider_out_of_credit" ? outOfCredit(raw) : null;
      // What must not be lost first, in as few requests as possible: the
      // real cost and the stop. A run that failed may have spent most of
      // its invocation's subrequests already.
      const newPause = await step.do("abstain", () =>
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
          // The ticket went back to the queue; dispatch waits for credit.
          return unpaid ? pauseProvider(db, unpaid, raw) : false;
        }),
      );
      if (unpaid && newPause)
        await step.do("abstain:alert", () =>
          sendOutOfCreditAlert(env, unpaid, raw).catch((error: Error) =>
            console.warn("alert", error.message),
          ),
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
          // The board follows the builder's choice for stopped tickets; a
          // ticket back in the queue has not stopped.
          if (!unpaid)
            await pipeline(env, db)
              .moveRunTicket(runId, "stopped")
              .catch(() => {});
        }).catch((error: Error) =>
          console.warn("abstain:after", error.message),
        ),
      );
      await release(implementerId);
      return { outcome: "abstained", reason: failure.reason };
    }
  }
}

/** Moves more sponsor money onto the run when it cost more than reserved. */
interface ChatRequest {
  answerId: string;
  /** Asked beside this work unit's stage: the agent may act on it. */
  stage?: string;
}

/**
 * One answer in a pull request's conversation: the agent reads what it needs
 * (the pull request, the code, the tickets) and writes it. A workflow, since
 * reading can outlast a request.
 */
export class ChatWorkflow extends WorkflowEntrypoint<BrainEnv, ChatRequest> {
  async run(event: WorkflowEvent<ChatRequest>, step: WorkflowStep) {
    const { answerId, stage } = event.payload;
    const env = this.env;
    let answer: ChatAnswer;
    try {
      answer = await step.do(
        "answer",
        { retries: { limit: 1, delay: "5 seconds" }, timeout: "5 minutes" },
        () => answerChat(env, answerId, stage),
      );
    } catch (error) {
      console.warn("chat", describe(error));
      await step.do("fail", () =>
        withDb(env, (db) => failAnswer(db, answerId)),
      );
      return;
    }
    await step.do("save", () =>
      withDb(env, (db) => saveAnswer(db, answerId, answer)),
    );
  }
}

async function answerChat(
  env: BrainEnv,
  answerId: string,
  stageOf?: string,
): Promise<ChatAnswer> {
  if (!env.ANTHROPIC_API_KEY)
    throw new NonRetryableError("ANTHROPIC_API_KEY is not configured");
  return withDb(env, async (db) => {
    const context = await chatContext(db, answerId);
    if (!context) throw new NonRetryableError("No such question");
    const { project } = context;
    const film = context.panel?.screens.find(
      (screen) => screen.kind === "presentation",
    );
    // The stage only while it is up: a question never wakes it.
    const hands = stageOf && env.STAGE ? env.STAGE.getByName(stageOf) : null;
    const [presentation, reader, state] = await Promise.all([
      film && env.EVIDENCE
        ? env.EVIDENCE.get(film.key)
            .then(async (object) =>
              object ? presentationSchema.safeParse(await object.json()) : null,
            )
            .then((parsed) => (parsed?.success ? parsed.data : null))
            .catch(() => null)
        : null,
      env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY
        ? repoReader(
            {
              appId: env.GITHUB_APP_ID,
              privateKey: env.GITHUB_APP_PRIVATE_KEY,
            },
            project,
          ).catch(() => null)
        : null,
      hands
        ? hands
            .present({ action: "state" })
            .then((result) => (result.ok ? result : null))
            .catch(() => null)
        : null,
    ]);
    return answerQuestion({
      client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
      context,
      presentation,
      sources: {
        reader,
        tickets: () => ticketsForChat(db, project.id),
        ticket: (key) => ticketForChat(db, project.id, key),
      },
      stage:
        hands && state
          ? {
              state: state.state ?? null,
              hands: (hand) => hands.present(hand),
            }
          : null,
    });
  });
}

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
    // A provider out of credit: nothing new starts until it is retried or
    // resumed; the queue keeps its order.
    const paused = await activePauses(db);
    for (const pause of paused)
      log.push(
        `dispatch paused: ${pause.provider} out of credit until ${pause.until.toISOString()}`,
      );
    let plan: ReturnType<typeof planDispatch> = [];
    if (paused.length === 0) {
      const { candidates, state } = await loadDispatch(db, {
        perAccountLimit: PER_ACCOUNT_CONCURRENCY,
        globalLimit: 20,
      });
      plan = planDispatch(candidates, state);
    }
    for (const item of plan) {
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
  const runner = pipeline(env, db);
  const usage = await runner
    .usage(run?.session ?? null, [])
    .catch(() => ({ costCents: 0, models: [] }));
  await runner
    .releaseImplementer(run?.session ?? null)
    .catch((error: Error) => console.warn("release", error.message));
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
  const unpaid =
    failure.reason === "provider_out_of_credit" ? outOfCredit(raw) : null;
  if (unpaid && (await pauseProvider(db, unpaid, raw)))
    await sendOutOfCreditAlert(env, unpaid, raw).catch((error: Error) =>
      console.warn("alert", error.message),
    );
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

  private credentials() {
    const { GITHUB_APP_ID: appId, GITHUB_APP_PRIVATE_KEY: privateKey } =
      this.env;
    return appId && privateKey ? { appId, privateKey } : null;
  }

  /**
   * Ready for review or Merge, from the builder's dashboard. The web Worker
   * has checked the viewer is a member of the ticket's project.
   */
  pullRequestAction(input: {
    workUnitId: string;
    action: PullRequestAction;
  }): Promise<ActionResult> {
    const credentials = this.credentials();
    if (!credentials)
      return Promise.resolve({ ok: false, error: "GitHub is not configured." });
    return withDb(this.env, (db) => pullRequestAction(db, credentials, input));
  }

  /** A ticket written on the dashboard: an issue, started now if queued. */
  async createIssue(input: {
    projectId: string;
    title: string;
    body: string;
    queue: boolean;
  }): Promise<NewIssueResult> {
    const credentials = this.credentials();
    if (!credentials) return { ok: false, error: "GitHub is not configured." };
    const result = await withDb(this.env, (db) =>
      createIssue(db, credentials, input),
    );
    if (result.ok && input.queue)
      this.ctx.waitUntil(
        tick(this.env, true).catch((error) =>
          console.warn("new issue", describe(error)),
        ),
      );
    return result;
  }

  /** The agents' questions answered on a GitHub issue: queued again, now. */
  async answerTicket(input: {
    projectId: string;
    key: string;
    answer: string;
    login: string;
  }): Promise<ActionResult> {
    const credentials = this.credentials();
    if (!credentials) return { ok: false, error: "GitHub is not configured." };
    const result = await withDb(this.env, (db) =>
      answerIssue(db, credentials, input),
    );
    if (result.ok)
      this.ctx.waitUntil(
        tick(this.env, true).catch((error) =>
          console.warn("answer", describe(error)),
        ),
      );
    return result;
  }

  /**
   * A ticket closed from the dashboard: the issue on GitHub (a Jira ticket
   * is moved by the web Worker), its open pull request, Yarrow's copy.
   */
  closeTicket(input: {
    projectId: string;
    key: string;
    source: "github" | "jira";
  }): Promise<ActionResult> {
    const credentials = this.credentials();
    if (!credentials)
      return Promise.resolve({ ok: false, error: "GitHub is not configured." });
    return withDb(this.env, (db) => closeTicket(db, credentials, input));
  }

  /** A ticket's pull request closed from the dashboard; the ticket stays. */
  closePullRequest(input: { workUnitId: string }): Promise<ActionResult> {
    const credentials = this.credentials();
    if (!credentials)
      return Promise.resolve({ ok: false, error: "GitHub is not configured." });
    return withDb(this.env, (db) => closePullRequest(db, credentials, input));
  }

  /** A change asked from the dashboard: on the PR, queued, started now. */
  async requestCorrection(
    input: Parameters<typeof requestCorrection>[2],
  ): Promise<ActionResult> {
    const credentials = this.credentials();
    if (!credentials) return { ok: false, error: "GitHub is not configured." };
    const result = await withDb(this.env, (db) =>
      requestCorrection(db, credentials, input),
    );
    if (result.ok)
      this.ctx.waitUntil(
        tick(this.env, true).catch((error) =>
          console.warn("correction", describe(error)),
        ),
      );
    return result;
  }

  /** A question in a pull request's conversation: answered in the background. */
  async askChat(input: {
    workUnitId: string;
    userId: string;
    text: string;
    /** Asked beside the pull request's stage. */
    stage?: boolean;
  }): Promise<ActionResult> {
    const asked = await withDb(this.env, (db) => askQuestion(db, input));
    if (!asked.ok)
      return {
        ok: false,
        error:
          asked.reason === "busy"
            ? "One question at a time."
            : "That's all the questions for today.",
      };
    try {
      await this.env.CHAT.create({
        id: asked.answerId,
        params: {
          answerId: asked.answerId,
          ...(input.stage ? { stage: input.workUnitId } : {}),
        },
      });
    } catch (error) {
      await withDb(this.env, (db) => failAnswer(db, asked.answerId));
      console.warn("chat", describe(error));
      return { ok: false, error: "The agent cannot answer right now." };
    }
    return { ok: true };
  }

  /**
   * A pull request's stage, its app live (workers/stage.ts). The web Worker
   * has checked the viewer is a member of the ticket's project. `fresh`
   * forgets the snapshot: the next boot runs the whole recipe again;
   * `live` opens it only if its presentation can be played on it (the
   * dashboard's panel: else the film plays, and no machine is worth it).
   */
  async stage(input: {
    workUnitId: string;
    action: "open" | "status" | "close";
    fresh?: boolean;
    live?: boolean;
  }): Promise<StageStatus> {
    const off = (error: string): StageStatus => ({
      phase: "failed",
      warm: false,
      events: [],
      error,
      live: false,
    });
    if (!this.env.STAGE) return off("No stage on this environment.");
    const stage = this.env.STAGE.getByName(input.workUnitId);
    if (input.action === "status") return stage.status();
    if (input.action === "close") {
      await stage.close();
      return stage.status();
    }
    const spec = await stageSpec(this.env, input.workUnitId);
    if (typeof spec === "string") return off(spec);
    if (input.live && !spec.script) return stage.status();
    return stage.open(spec, input.fresh);
  }

  /** The page's cue to the stage's presenter: the opening, or a chapter. */
  async stageCue(input: {
    workUnitId: string;
    cue: StageCue;
  }): Promise<StageCueResult> {
    if (!this.env.STAGE)
      return { ok: false, problems: ["No stage on this environment."] };
    return this.env.STAGE.getByName(input.workUnitId).present(input.cue);
  }

  /**
   * A live call about the pull request, for a member of its project: the
   * token the page starts it with, and the pass it carries to each turn.
   * What the agent knows of the pull request is gathered now, once.
   */
  async talkCall(input: {
    workUnitId: string;
    userId: string;
    language: string;
  }): Promise<
    | { ok: true; conversationToken: string; grant: string }
    | { ok: false; reason: string }
  > {
    const { env } = this;
    if (
      !env.STAGE ||
      !env.ELEVENLABS_API_KEY ||
      !env.ELEVENLABS_AGENT_ID ||
      !env.VOICE_SECRET ||
      !env.ANTHROPIC_API_KEY
    )
      return { ok: false, reason: "No live call on this environment." };
    const stage = env.STAGE.getByName(input.workUnitId);
    // Each turn of the call counts as a question of the day, as if written.
    const asked = await withDb(env, (db) => askedToday(db, input.userId));
    if (asked >= CHAT_DAILY_QUESTIONS)
      return { ok: false, reason: "That's all the questions for today." };
    const [context, token, grant] = await Promise.all([
      talkContext(env, input.workUnitId),
      conversationToken(env.ELEVENLABS_API_KEY, env.ELEVENLABS_AGENT_ID),
      signTalkGrant(env.VOICE_SECRET, input),
    ]);
    if (!context)
      return { ok: false, reason: "This ticket has no pull request." };
    await stage.setTalk(context);
    return { ok: true, conversationToken: token, grant };
  }

  /**
   * The stage's screen: the page's WebSocket, forwarded by the web Worker.
   * And the live call's turns: ElevenLabs asking for the agent's words.
   */
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/voice/llm"))
      return talkRoute(this.env, this.ctx, request);
    const match = /^\/stage\/([0-9a-f-]{36})$/.exec(pathname);
    if (!match || !this.env.STAGE)
      return new Response("Not found\n", { status: 404 });
    return this.env.STAGE.getByName(match[1]!).fetch(request);
  }
}

/** What the call's agent knows of the pull request: the written chat's context. */
async function talkContext(
  env: BrainEnv,
  workUnitId: string,
): Promise<TalkContext | null> {
  const context = await withDb(env, (db) => pullContext(db, workUnitId));
  if (!context) return null;
  const film = context.panel?.screens.find(
    (screen) => screen.kind === "presentation",
  );
  const { GITHUB_APP_ID: appId, GITHUB_APP_PRIVATE_KEY: privateKey } = env;
  const pull = context.pullRequest;
  const [presentation, diff] = await Promise.all([
    film && env.EVIDENCE
      ? env.EVIDENCE.get(film.key)
          .then(async (object) =>
            object ? presentationSchema.safeParse(await object.json()) : null,
          )
          .then((parsed) => (parsed?.success ? parsed.data : null))
          .catch(() => null)
      : null,
    appId && privateKey && pull
      ? repoReader({ appId, privateKey }, context.project)
          .then((reader) => reader?.pullDiff(pull.number) ?? null)
          .catch(() => null)
      : null,
  ]);
  return {
    text: `${chatContextText(context, { presentation, diff })}\n\n${conversationSoFar(context.history)}`,
    project: context.project,
    pullRequest: pull,
    voice: (presentation?.chapters ?? [])
      .map((chapter) => chapter.say)
      .join(" "),
  };
}

/**
 * One turn of a live call: ElevenLabs' chat completion request (the
 * member's words so far), answered as a stream of the agent's words.
 * ElevenLabs holds the key; the page's pass names the pull request.
 */
async function talkRoute(
  env: BrainEnv,
  ctx: ExecutionContext,
  request: Request,
): Promise<Response> {
  const started = Date.now();
  const missing = () => new Response("Not found\n", { status: 404 });
  if (request.method !== "POST") return missing();
  const { VOICE_SECRET: secret, ANTHROPIC_API_KEY: apiKey, STAGE } = env;
  if (!secret || !apiKey || !STAGE) return missing();
  const refused = () => new Response("Unauthorized\n", { status: 401 });
  if (!sameKey(request.headers.get("authorization"), await talkKey(secret)))
    return refused();
  const parsed = talkRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return new Response("Bad request\n", { status: 400 });
  const pass = talkGrantOf(parsed.data);
  const grant = pass ? await readTalkGrant(secret, pass) : null;
  if (!grant) return refused();
  const stage = STAGE.getByName(grant.workUnitId);
  const id = crypto.randomUUID().slice(0, 12);
  const headers = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  };
  // Not the member's turn (after the page's tool, or on its own): nothing to say.
  if (!memberSpoke(parsed.data))
    return new Response(completion.end(id), { headers });
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let said = Date.now();
  let fillers = 0;
  const write = (text: string) =>
    writer.write(encoder.encode(text)).catch(() => {});
  const say = (text: string) => {
    said = Date.now();
    return write(completion.words(id, text));
  };
  // While the agent works on the stage in silence, a few words keep the call.
  const silence = setInterval(() => {
    if (Date.now() - said >= TALK_SILENCE_MS)
      void say(talkFiller(grant.language, fillers++));
  }, 500);
  const turn = (async () => {
    try {
      const [kept, state] = await Promise.all([
        stage.talk(),
        stage
          .present({ action: "state" })
          .then((result) => result.state ?? null)
          .catch(() => null),
      ]);
      const context = kept ?? (await talkContext(env, grant.workUnitId));
      if (!context) throw new Error("no pull request");
      // Only the presentation's voice was heard, through the speakers: not
      // the member's turn.
      const messages = talkMessages(parsed.data.messages, context.voice);
      if (messages.at(-1)?.role !== "user") {
        await write(completion.end(id));
        return;
      }
      const { GITHUB_APP_ID: appId, GITHUB_APP_PRIVATE_KEY: privateKey } = env;
      const projectId = context.project.id;
      const answer = await talkTurn({
        client: new Anthropic({ apiKey }),
        context,
        messages,
        state,
        started,
        sources: {
          reader:
            appId && privateKey
              ? lazyRepoReader(() =>
                  repoReader({ appId, privateKey }, context.project),
                )
              : null,
          tickets: () => withDb(env, (db) => ticketsForChat(db, projectId)),
          ticket: (key) =>
            withDb(env, (db) => ticketForChat(db, projectId, key)),
        },
        stage: (hand) => stage.present(hand),
        say: (text) => void say(text),
      });
      // In the conversation's thread before the turn ends: the page reads
      // it back as soon as the voice is done.
      if (answer.words || answer.change)
        await withDb(env, (db) =>
          saveSpokenTurn(
            db,
            {
              workUnitId: grant.workUnitId,
              userId: grant.userId,
              said: memberWords(messages),
              words: answer.words,
              change: answer.change,
              usage: answer.usage,
            },
            new Date(started),
          ),
        ).catch((error) => console.warn("talk:save", describe(error)));
      await write(
        answer.resume
          ? completion.resume(id) + completion.done
          : completion.end(id),
      );
      console.log("talk", {
        workUnitId: grant.workUnitId,
        stage: stageNote(state),
        firstWordMs: answer.firstWordMs,
        ms: Date.now() - started,
        resume: answer.resume,
        fillers,
        steps: answer.steps.map((step) => `${step.what} ${step.ms}`).join(", "),
        cents: Number(chatCostCents(answer.usage).toFixed(3)),
        usage: answer.usage,
      });
    } catch (error) {
      console.warn("talk", describe(error));
      await write(
        completion.words(
          id,
          grant.language.startsWith("fr")
            ? "Désolé, je n'ai pas pu répondre. Tu peux répéter ?"
            : "Sorry, I couldn't answer that. Could you say it again?",
        ) + completion.end(id),
      );
    } finally {
      clearInterval(silence);
      await writer.close().catch(() => {});
    }
  })();
  ctx.waitUntil(turn);
  return new Response(readable, { headers });
}

/**
 * What a pull request's stage boots from: its branch, the recipe (and the
 * app as it was), its presentation to play live. A sentence when it has none.
 */
async function stageSpec(
  env: BrainEnv,
  workUnitId: string,
): Promise<StageSpec | string> {
  const { GITHUB_APP_ID: appId, GITHUB_APP_PRIVATE_KEY: privateKey } = env;
  if (!appId || !privateKey) return "GitHub is not configured.";
  const context = await withDb(env, (db) => stageContext(db, workUnitId));
  if (!context) return "This ticket has no pull request.";
  const { recipe } = context;
  if (!recipe) return "Yarrow has not run this project's app yet.";
  if (!context.githubInstallationId || !context.githubRepositoryId)
    return "The GitHub App is not installed on this repository.";
  const [{ token }, timeline] = await Promise.all([
    installationToken({ appId, privateKey }, context.githubInstallationId, {
      repositoryIds: [Number(context.githubRepositoryId)],
      permissions: { contents: "read" },
    }),
    context.presentation && env.EVIDENCE
      ? env.EVIDENCE.get(context.presentation)
          .then(async (object) =>
            object ? presentationSchema.safeParse(await object.json()) : null,
          )
          .then((parsed) => (parsed?.success ? parsed.data : null))
          .catch(() => null)
      : null,
  ]);
  return {
    repository: context.repository,
    branch: context.branch,
    token,
    steps: recipe.steps,
    restart: restartSteps(recipe.steps),
    ...stageAddress(recipe.url),
    signIn: stageSignIn(recipe.signIn),
    base: context.base,
    before: recipe.before
      ? {
          ...recipe.before,
          restart: restartSteps(recipe.before.steps, { locks: false }),
        }
      : null,
    script: stagePlan(timeline, Boolean(recipe.before)),
    recorder: RECORDER_SOURCE,
  };
}

/**
 * The admin Worker's only way to the database, through a service binding
 * (never over HTTP): it holds no secret, the brain does the writes.
 */
export class Admin extends WorkerEntrypoint<BrainEnv> {
  dailyFundings() {
    return withDb(this.env, (db) => listDailyFundings(db));
  }
  createDailyFunding(input: DailyFundingInput, start: FundingStart) {
    return withDb(this.env, (db) => createDailyFunding(db, input, start));
  }
  updateDailyFunding(userId: string, input: DailyFundingInput) {
    return withDb(this.env, (db) => updateDailyFunding(db, userId, input));
  }
  pauseDailyFunding(userId: string, paused: boolean) {
    return withDb(this.env, (db) => pauseDailyFunding(db, userId, paused));
  }
  compute() {
    return withDb(this.env, (db) => computeSummary(db));
  }
  /** Topped up: dispatch goes on at once instead of at the next retry. */
  async resumeProvider(provider: Provider): Promise<void> {
    await withDb(this.env, (db) => clearPause(db, provider));
    this.ctx.waitUntil(
      tick(this.env, true).catch((error) =>
        console.warn("resume", describe(error)),
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
        const minute = new Date(controller.scheduledTime).getUTCMinutes();
        const fiveMinutes = minute % 5 === 0;
        // Yesterday's unspent daily credit out, today's in as its minute
        // comes, before the pass that can spend it.
        if (env.DATABASE_URL) {
          const daily = await withDb(env, async (db) => ({
            expired: await expireDailyCredit(db),
            credited: await fundDaily(db),
          })).catch((error) => ({ error: describe(error) }));
          if (
            "error" in daily ||
            daily.expired > 0 ||
            daily.credited.length > 0
          )
            console.log("daily fundings", daily);
        }
        // The minute's pass is the safety net: a kick may be running.
        await tick(env, false);
        if (fiveMinutes && env.DATABASE_URL)
          console.log(
            "tracker sync",
            await withDb(env, (db) =>
              syncTrackers(db, trackerSecretsFromEnv(env)),
            ).catch((error) => [describe(error)]),
          );
        // Once an hour: Jira's webhooks follow their projects and stay alive.
        if (minute === 30 && env.DATABASE_URL)
          console.log(
            "jira webhooks",
            await withDb(env, (db) =>
              ensureJiraWebhooks(db, {
                secrets: trackerSecretsFromEnv(env),
                appUrl: env.APP_URL,
              }),
            ).catch((error) => [describe(error)]),
          );
      })(),
    );
  },
} satisfies ExportedHandler<BrainEnv>;
