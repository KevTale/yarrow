import {
  WorkerEntrypoint,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
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
  metaRoles,
  reviewerFor,
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
  answerBody,
  askedToday,
  askQuestion,
  chatContext,
  ticketOfAnswer,
  failAnswer,
  pullContext,
  saveSpokenTurn,
  ticketForChat,
  ticketsForChat,
  saveAnswer,
} from "../src/db/chat";
import { connectDatabase, type Database } from "../src/db/client";
import {
  draftProject,
  draftTurnsToday,
  openDraft,
  saveDraftTurn,
  type DraftRef,
} from "../src/db/ticket-drafts";
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
  startAgain,
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
import { isClaudeSession, ManagedAgentsClient } from "../src/runner/anthropic";
import { isMuseSession, MUSE_EFFORT, MUSE_MODEL } from "../src/runner/muse";
import {
  answerQuestion,
  chatContextText,
  hasVideo,
  listTickets,
  type ChatAnswer,
  spottedLines,
} from "../src/runner/chat";
import { ticketTurn } from "../src/runner/ticket-agent";
import { restoreStage } from "../src/runner/stage-restore";
import {
  completion,
  conversationSoFar,
  DEFAULT_TALK_MODEL,
  memberSpoke,
  memberWords,
  stageNote,
  TALK_SILENCE_MS,
  talkBenchSchema,
  talkBrainOf,
  talkFiller,
  talkGrantOf,
  talkMessages,
  talkRequestSchema,
  talkTurn,
  type TalkContext,
  type TalkRequest,
} from "../src/runner/talk";
import {
  isTalkModel,
  TALK_MODELS,
  type TalkModelName,
} from "../src/runner/talk-models";
import {
  conversationToken,
  transcriptionToken,
  readDraftGrant,
  readTalkGrant,
  sameKey,
  signTalkGrant,
  talkKey,
  type DraftGrant,
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
  ENTER_PATH,
  PREVIEW_HEADER,
  previewHost,
  previewUnit,
} from "../src/core/preview";
import {
  restartSteps,
  servingSteps,
  SLIP,
  stageAddress,
  stagePlan,
  INSTALL_STEP,
  stageSignIn,
  type StageCue,
  type StageCueResult,
  type StageSpec,
  type StageStatus,
} from "../src/core/stage";
import {
  addUsage,
  CHAT_DAILY_QUESTIONS,
  chatCostCents,
  spokenAnswer,
} from "../src/core/chat";
import { BODY_MAX, TITLE_MAX, type DraftText } from "../src/core/new-ticket";
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
   * Their previews' hosts: the work unit's id, then this ("-dev.yarrow.page"),
   * routed to this Worker (src/core/preview.ts). Absent: no preview.
   */
  PREVIEW_SUFFIX?: string;
  /**
   * The live review's call (src/runner/talk.ts): the ElevenLabs agent made by
   * scripts/voice-agent.ts, and the secret its passes and its key to the
   * brain come from. Both put by that script, dev only for now.
   */
  ELEVENLABS_AGENT_ID?: string;
  VOICE_SECRET?: string;
  /** Who answers on the call (src/runner/talk-models.ts); Opus by default. */
  TALK_MODEL?: string;
  /** "on": the screen comes with the member's words, no look first. */
  TALK_SCREEN?: string;
  /** "on" (dev only): the bench's turns may choose both (scripts/talk-bench.ts). */
  TALK_BENCH?: string;
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

/** The ledger of runs: it names Meta's roles while Meta implements. */
const ledgerOf = (env: BrainEnv, db: Database) =>
  new PostgresLedger(
    db,
    defaultPipelineRoles,
    env.IMPLEMENTER === "meta" && env.MUSE && env.META_API_KEY
      ? metaRoles(env.META_MODEL ?? MUSE_MODEL, env.META_EFFORT ?? MUSE_EFFORT)
      : null,
  );

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

/** Who talks for Yarrow: chat, call, new ticket. Muse only with Meta's key. */
function talkModelOf(env: BrainEnv): TalkModelName {
  const model = isTalkModel(env.TALK_MODEL)
    ? env.TALK_MODEL
    : DEFAULT_TALK_MODEL;
  return TALK_MODELS[model].provider === "meta" && !env.META_API_KEY
    ? DEFAULT_TALK_MODEL
    : model;
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
      withDb(env, (db) => ledgerOf(env, db).reserve(request)),
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
            await clearPause(db, isClaudeSession(id) ? "anthropic" : "openai");
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
        reviewer: reviewerFor(run.implementer),
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
              proofs: delivered.proofs,
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
    const { restart } = answer;
    if (restart)
      await step.do("start again", () =>
        startTicketAgain(env, answerId, restart.note),
      );
  }
}

/** The agent starts a stopped ticket again, on the member's word. */
async function startTicketAgain(
  env: BrainEnv,
  answerId: string,
  note: string | null,
): Promise<void> {
  if (!env.GITHUB_APP_ID || !env.GITHUB_APP_PRIVATE_KEY) return;
  const credentials = {
    appId: env.GITHUB_APP_ID,
    privateKey: env.GITHUB_APP_PRIVATE_KEY,
  };
  const result = await withDb(env, async (db) => {
    const ticket = await ticketOfAnswer(db, answerId);
    return ticket
      ? startAgain(
          db,
          credentials,
          { secrets: trackerSecretsFromEnv(env) },
          { ...ticket, note },
        )
      : null;
  });
  if (result?.ok)
    await tick(env, true).catch((error) =>
      console.warn("start again", describe(error)),
    );
  else if (result) console.warn("start again", result.error);
}

/** How long the page gets to go to the app, before the agent's first move. */
const SHOW_MS = 1500;
/** How long a question waits for a stage the page woke, and for its wake. */
const STAGE_WAIT_MS = 25_000;
const STAGE_WOKEN_MS = 5_000;

/** Up, or past waiting: a question beside a demo wakes its stage (the page). */
async function stageUp(stage: {
  status(): Promise<{ phase: string }>;
}): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < STAGE_WAIT_MS) {
    const { phase } = await stage.status();
    if (phase === "ready" || phase === "failed") return;
    if (phase === "off" && Date.now() - started > STAGE_WOKEN_MS) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
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
    const hands = stageOf && env.STAGE ? env.STAGE.getByName(stageOf) : null;
    if (hands) await stageUp(hands);
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
    const model = talkModelOf(env);
    return answerQuestion({
      client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
      muse:
        TALK_MODELS[model].provider === "meta"
          ? { model, key: env.META_API_KEY! }
          : null,
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
              show: async () => {
                await hands.present({ action: "showing" });
                await new Promise((resolve) => setTimeout(resolve, SHOW_MS));
              },
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
    const ledger = ledgerOf(env, db);
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

  /**
   * A ticket closed from the dashboard: the issue on GitHub (a tracker ticket
   * is moved by the web Worker), its open pull request, Yarrow's copy.
   */
  closeTicket(input: {
    projectId: string;
    key: string;
    source: "github" | "jira" | "linear";
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

  /** A question in a ticket's conversation: answered in the background. */
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
      signedIn: null,
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

  /**
   * A pull request's preview (src/core/preview.ts) for a member the web
   * Worker has checked: its stage asked up, and the address that signs
   * the visit in, once.
   */
  async preview(input: {
    workUnitId: string;
    /** The app's page to open, checked by the stage. */
    path?: string | null;
  }): Promise<{ url: string } | { error: string }> {
    const suffix = this.env.PREVIEW_SUFFIX;
    if (!this.env.STAGE || !suffix)
      return { error: "No preview on this environment." };
    const spec = await stageSpec(this.env, input.workUnitId);
    if (typeof spec === "string") return { error: spec };
    if (!spec.url)
      return { error: "Yarrow has not run this project's app yet." };
    const stage = this.env.STAGE.getByName(input.workUnitId);
    await stage.open(spec);
    const code = await stage.enter();
    return {
      url: `https://${previewHost(input.workUnitId, suffix)}${ENTER_PATH}?code=${code}${input.path ? `&to=${encodeURIComponent(input.path)}` : ""}`,
    };
  }

  /**
   * The page's cue to the stage's presenter: the opening, a chapter, held
   * or on again. On again after a talk, what the talk changed in the app
   * is put back first (src/runner/stage-restore.ts), so the voice goes on
   * about the screen it left; Yarrow pays for it, as for the talk.
   */
  async stageCue(input: {
    workUnitId: string;
    cue: StageCue;
  }): Promise<StageCueResult> {
    const { env } = this;
    if (!env.STAGE)
      return { ok: false, problems: ["No stage on this environment."] };
    const stage = env.STAGE.getByName(input.workUnitId);
    if (input.cue.action !== "resume" || !input.cue.restore)
      return stage.present(input.cue);
    const found = await stage.present({ action: "changes" });
    const problems = [...found.problems];
    if (found.changes?.length && env.ANTHROPIC_API_KEY) {
      const started = Date.now();
      const restored = await restoreStage({
        client: new Anthropic({ apiKey: env.ANTHROPIC_API_KEY }),
        changes: found.changes,
        stage: (hand) => stage.present(hand),
      }).catch((error: Error) => ({
        problems: [`putting the stage back: ${error.message.slice(0, 200)}`],
        usage: null,
        steps: [],
      }));
      problems.push(...restored.problems);
      console.log(
        "stage put back",
        JSON.stringify({
          workUnitId: input.workUnitId,
          windows: found.changes.map((change) => change.window),
          ms: Date.now() - started,
          steps: restored.steps,
          usage: restored.usage,
        }),
      );
    }
    const resumed = await stage.present({ action: "resume" });
    return { ...resumed, problems: [...problems, ...resumed.problems] };
  }

  /**
   * A live call about the pull request, for a member of its project: the
   * token the page starts it with, and the pass it carries to each turn.
   * What the agent knows of the pull request is gathered now, once. Over
   * the stage, or by voice alone when it is not up: the stage keeps the
   * call's context either way.
   */
  async answerVoice(input: {
    workUnitId: string;
    messageId: string;
  }): Promise<{ audio: string; contentType: string } | null> {
    const voice = voiceProvider(this.env);
    if (!voice) return null;
    const body = await withDb(this.env, (db) => answerBody(db, input));
    const text = spokenAnswer(body ?? "");
    if (!text) return null;
    // The model reads the language from the text.
    const speech = await voice.speak({ text, language: "" });
    let audio = "";
    for (let at = 0; at < speech.audio.length; at += 0x8000)
      audio += String.fromCharCode(...speech.audio.subarray(at, at + 0x8000));
    return { audio: btoa(audio), contentType: speech.contentType };
  }

  async talkCall(input: {
    workUnitId: string;
    userId: string;
    language: string;
    stage: boolean;
  }): Promise<
    | {
        ok: true;
        conversationToken: string;
        grant: string;
        transcriptionToken: string | null;
      }
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
    const [context, token, grant, words] = await Promise.all([
      talkContext(env, input.workUnitId),
      conversationToken(env.ELEVENLABS_API_KEY, env.ELEVENLABS_AGENT_ID),
      signTalkGrant(env.VOICE_SECRET, input),
      // Their words as they say them; the call goes on without.
      transcriptionToken(env.ELEVENLABS_API_KEY).catch((error) => {
        console.warn("talk:transcription", describe(error));
        return null;
      }),
    ]);
    if (!context)
      return { ok: false, reason: "This ticket has no pull request." };
    await stage.setTalk(context);
    return {
      ok: true,
      conversationToken: token,
      grant,
      transcriptionToken: words,
    };
  }

  /** A call with the agent that writes a ticket: no stage, no pull request. */
  async ticketCall(input: {
    draftId: string;
    projectId: string;
    userId: string;
    language: string;
  }): Promise<
    | { ok: true; conversationToken: string; grant: string }
    | { ok: false; reason: string }
  > {
    const { env } = this;
    if (
      !env.ELEVENLABS_API_KEY ||
      !env.ELEVENLABS_AGENT_ID ||
      !env.VOICE_SECRET ||
      !env.ANTHROPIC_API_KEY
    )
      return { ok: false, reason: "No live call on this environment." };
    const asked = await withDb(env, (db) => turnsToday(db, input.userId));
    if (asked >= CHAT_DAILY_QUESTIONS)
      return { ok: false, reason: "That's all the questions for today." };
    const [token, grant] = await Promise.all([
      conversationToken(env.ELEVENLABS_API_KEY, env.ELEVENLABS_AGENT_ID),
      signTalkGrant(env.VOICE_SECRET, input),
    ]);
    return { ok: true, conversationToken: token, grant };
  }

  /**
   * The stage's screen: the page's WebSocket, forwarded by the web Worker.
   * The live call's turns: ElevenLabs asking for the agent's words. And a
   * written turn of the agent that writes a ticket.
   */
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/voice/llm"))
      return talkRoute(this.env, this.ctx, request);
    if (pathname === "/ticket-agent")
      return ticketWritten(this.env, this.ctx, request);
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
    video: hasVideo(context.panel),
    project: context.project,
    pullRequest: pull,
    spotted: spottedLines(context.panel),
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
  let started = Date.now();
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
  const drafting = pass ? await readDraftGrant(secret, pass) : null;
  if (drafting) return ticketTalk(env, ctx, request, parsed.data, drafting);
  const grant = pass ? await readTalkGrant(secret, pass) : null;
  if (!grant) return refused();
  const stage = STAGE.getByName(grant.workUnitId);
  const trying = env.TALK_BENCH === "on";
  const bench = trying
    ? talkBenchSchema.safeParse(parsed.data.yarrow_bench).data
    : undefined;
  if (bench?.open) {
    const spec = await stageSpec(env, grant.workUnitId);
    if (typeof spec === "string") return Response.json({ error: spec });
    const status = await stage.open(spec, bench.open === "fresh");
    const code = status.phase === "ready" ? await stage.enter() : null;
    return Response.json({
      ...status,
      preview:
        code &&
        env.PREVIEW_SUFFIX &&
        `https://${previewHost(grant.workUnitId, env.PREVIEW_SUFFIX)}${ENTER_PATH}?code=${code}`,
    });
  }
  // On dev, the page may ask for another brain, to try each by voice.
  const asked = trying ? talkBrainOf(parsed.data) : {};
  const model = bench?.model ?? asked.model ?? talkModelOf(env);
  const screenFirst =
    bench?.screen ?? asked.screen ?? env.TALK_SCREEN !== "off";
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
  // ElevenLabs drops a turn's stream when the member speaks on (its
  // speculative turn), and asks again: the dropped turn no longer acts on
  // the stage, nor is it kept.
  let dropped = false;
  const drop = () => {
    dropped = true;
  };
  const write = (text: string) =>
    writer.write(encoder.encode(text)).catch(drop);
  writer.closed.catch(drop);
  request.signal.addEventListener("abort", drop);
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
      if (bench?.reset) {
        await stage.present({ action: "window", window: "after" });
        await stage.present({
          action: "act",
          actions: [{ do: "goto", path: bench.reset }],
        });
        // The bench's page is no member's wait.
        started = Date.now();
      }
      const looked = Date.now();
      // By voice alone: no live app to stop or look at. A stage coming from
      // its snapshot is there in seconds; on a first boot, minutes away, a
      // gesture would show nothing.
      const { phase, warm } = await stage.status();
      const onStage =
        Boolean(bench) ||
        (grant.stage && (phase === "ready" || (phase === "booting" && warm)));
      const [kept, state, screen] = await Promise.all([
        stage.talk(),
        // They spoke: a presentation playing live ends there.
        onStage
          ? stage
              .present({ action: "stop" })
              .then((result) => result.state ?? null)
              .catch(() => null)
          : null,
        screenFirst && onStage
          ? stage
              .present({ action: "look" })
              .then((result) => (result.ok ? (result.screen ?? null) : null))
              .catch(() => null)
          : null,
      ]);
      const screenMs = screenFirst ? Date.now() - looked : null;
      const context = kept ?? (await talkContext(env, grant.workUnitId));
      if (!context) throw new Error("no pull request");
      // A noise heard as a turn, no word in it: not the member's turn.
      const messages = talkMessages(parsed.data.messages);
      if (messages.at(-1)?.role !== "user") {
        await write(completion.skip(id) + completion.done);
        return;
      }
      const said = memberWords(messages);
      const turnNumber = await stage.nextTurn();
      const replaced = async () =>
        dropped || (await stage.lastTurn()) !== turnNumber;
      const { GITHUB_APP_ID: appId, GITHUB_APP_PRIVATE_KEY: privateKey } = env;
      const projectId = context.project.id;
      const answer = await talkTurn({
        client: new Anthropic({ apiKey }),
        meta: env.META_API_KEY,
        model,
        context,
        messages,
        state,
        screen,
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
        stage: onStage
          ? async (hand) => {
              // The call may have opened before the stage was up.
              await stageUp(stage);
              if (await replaced()) throw new Error("turn dropped");
              return stage.present(hand);
            }
          : null,
        say: (text) => void say(text),
      });
      // No voice to time them on the bench: what is left of its gestures
      // now, the last of them still on its way.
      if (bench) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        await stage.present({ action: "beat", n: null }).catch(() => null);
      }
      // In the conversation's thread before the turn ends: the page reads
      // it back as soon as the voice is done. The bench's turns stay out.
      const body = [answer.words, answer.written].filter(Boolean).join("\n\n");
      const keeps =
        !bench &&
        (body || answer.change || answer.ticket) &&
        !(await replaced());
      if (keeps)
        await withDb(env, (db) =>
          saveSpokenTurn(
            db,
            {
              workUnitId: grant.workUnitId,
              userId: grant.userId,
              said: said.startsWith(SLIP) ? null : said,
              words: body,
              change: answer.change,
              ticket: answer.ticket,
              usage: answer.usage,
            },
            new Date(started),
          ),
        ).catch((error) => console.warn("talk:save", describe(error)));
      const ms = Date.now() - started;
      // The bench reads what the turn did, and the screen it left, as a
      // comment of the stream.
      if (bench) {
        const after = await stage.present({ action: "look" }).catch(() => null);
        await write(
          `: yarrow ${JSON.stringify({
            model,
            screenMs,
            firstWordMs: answer.firstWordMs,
            ms,
            steps: answer.steps,
            usage: answer.usage,
            cents: chatCostCents(answer.usage),
            words: answer.words,
            change: answer.change,
            ticket: answer.ticket,
            resume: answer.resume,
            screen: after?.screen?.slice(0, 6000) ?? null,
          })}\n\n`,
        );
      }
      await write(
        answer.resume
          ? completion.resume(id, answer.resume.chapter) + completion.done
          : completion.end(id),
      );
      console.log("talk", {
        workUnitId: grant.workUnitId,
        model,
        stage: stageNote(state),
        screenMs,
        firstWordMs: answer.firstWordMs,
        ms,
        fillers,
        dropped,
        resume: answer.resume,
        steps: answer.steps.map((step) => `${step.what} ${step.ms}`).join(", "),
        cents: Number(chatCostCents(answer.usage).toFixed(3)),
        usage: answer.usage,
      });
    } catch (error) {
      console.warn("talk", describe(error));
      if (bench)
        await write(`: yarrow-error ${JSON.stringify(describe(error))}\n\n`);
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

/** Questions and ticket turns one person took today, Yarrow paying for both. */
const turnsToday = async (db: Database, userId: string) =>
  (await askedToday(db, userId)) + (await draftTurnsToday(db, userId));

/**
 * One turn of the agent that writes a ticket, written or said: the form as
 * the page sent it (a call's is in the draft already), the thread from the
 * draft, so that a conversation goes on from one to the other.
 */
async function ticketAgentTurn(
  env: BrainEnv,
  input: {
    draft: DraftRef;
    said: string;
    form?: DraftText;
    voice: boolean;
    started: number;
  },
  out: {
    say: (text: string) => void;
    /** The form changed, in the draft already. */
    onWrite?: (text: DraftText) => void;
    /** ElevenLabs asks again: this turn no longer counts. */
    dropped?: () => Promise<boolean>;
  },
): Promise<void> {
  const { ANTHROPIC_API_KEY: apiKey } = env;
  const { GITHUB_APP_ID: appId, GITHUB_APP_PRIVATE_KEY: privateKey } = env;
  if (!apiKey) throw new Error("no Anthropic key");
  const { draft } = input;
  const { row, project, asked } = await withDb(env, async (db) => ({
    row: await openDraft(db, draft, input.form),
    project: await draftProject(db, draft.projectId),
    asked: await turnsToday(db, draft.userId),
  }));
  if (!row || !project) throw new Error("no such draft");
  if (asked >= CHAT_DAILY_QUESTIONS) {
    out.say("That's all the questions for today.");
    return;
  }
  const sources = {
    reader:
      appId && privateKey
        ? lazyRepoReader(() => repoReader({ appId, privateKey }, project))
        : null,
    tickets: () => withDb(env, (db) => ticketsForChat(db, project.id)),
    ticket: (key: string) =>
      withDb(env, (db) => ticketForChat(db, project.id, key)),
  };
  const answer = await ticketTurn({
    client: new Anthropic({ apiKey }),
    meta: env.META_API_KEY,
    model: talkModelOf(env),
    project,
    tickets: await listTickets(sources),
    form: row,
    history: row.thread,
    said: input.said,
    voice: input.voice,
    sources,
    started: input.started,
    say: out.say,
    onWrite: async (text) => {
      if (await out.dropped?.()) throw new Error("turn dropped");
      await withDb(env, (db) => openDraft(db, draft, text));
      out.onWrite?.(text);
    },
  });
  if (await out.dropped?.()) return;
  await withDb(env, (db) =>
    saveDraftTurn(db, draft, {
      said: input.said,
      words: answer.words,
      usage: row.usage ? addUsage(row.usage, answer.usage) : answer.usage,
    }),
  );
  console.log("ticket-agent", {
    draftId: draft.id,
    voice: input.voice,
    firstWordMs: answer.firstWordMs,
    ms: Date.now() - input.started,
    steps: answer.steps.map((step) => `${step.what} ${step.ms}`).join(", "),
    cents: Number(chatCostCents(answer.usage).toFixed(3)),
  });
}

const ticketWrittenSchema = z.object({
  draftId: z.uuid(),
  projectId: z.uuid(),
  userId: z.uuid(),
  text: z.string().min(1).max(4000),
  title: z.string().max(TITLE_MAX),
  body: z.string().max(BODY_MAX),
});

/**
 * A written turn: one JSON event a line, the page following as it comes.
 * The web Worker checked the member: only it reaches this entrypoint.
 */
async function ticketWritten(
  env: BrainEnv,
  ctx: ExecutionContext,
  request: Request,
): Promise<Response> {
  const parsed = ticketWrittenSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) return new Response("Bad request\n", { status: 400 });
  const { draftId, projectId, userId, text, title, body } = parsed.data;
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (event: object) =>
    writer.write(encoder.encode(`${JSON.stringify(event)}\n`)).catch(() => {});
  ctx.waitUntil(
    ticketAgentTurn(
      env,
      {
        draft: { id: draftId, projectId, userId },
        said: text,
        form: { title, body },
        voice: false,
        started: Date.now(),
      },
      {
        say: (words) => void send({ words }),
        onWrite: (ticket) => void send({ ticket }),
      },
    )
      .catch(async (error) => {
        console.warn("ticket-agent", describe(error));
        await send({ failed: true });
      })
      .finally(() => writer.close().catch(() => {})),
  );
  return new Response(readable, {
    headers: {
      "content-type": "application/x-ndjson",
      "cache-control": "no-cache, no-transform",
    },
  });
}

/** A turn of a call that writes a ticket, as ElevenLabs asks for it. */
function ticketTalk(
  env: BrainEnv,
  ctx: ExecutionContext,
  request: Request,
  data: TalkRequest,
  grant: DraftGrant,
): Response {
  const started = Date.now();
  const id = crypto.randomUUID().slice(0, 12);
  const headers = {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
  };
  if (!memberSpoke(data)) return new Response(completion.end(id), { headers });
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  // ElevenLabs drops a turn's stream when the member speaks on, and asks
  // again: the dropped turn is not kept. Nor one it asked again without
  // hanging up (`nextTurn`), counted on a stage that never boots.
  let dropped = false;
  const drop = () => {
    dropped = true;
  };
  const write = (text: string) =>
    writer.write(encoder.encode(text)).catch(drop);
  writer.closed.catch(drop);
  request.signal.addEventListener("abort", drop);
  const turns = env.STAGE?.getByName(`draft-${grant.draftId}`);
  const turnNumber = turns?.nextTurn();
  const replaced = async () =>
    dropped || (await turns?.lastTurn()) !== (await turnNumber);
  const said = memberWords(talkMessages(data.messages));
  let last = Date.now();
  let fillers = 0;
  const say = (text: string) => {
    last = Date.now();
    void write(completion.words(id, text));
  };
  // While it reads the code in silence, a few words keep the call.
  const silence = setInterval(() => {
    if (Date.now() - last >= TALK_SILENCE_MS)
      say(talkFiller(grant.language, fillers++));
  }, 500);
  ctx.waitUntil(
    (async () => {
      try {
        await ticketAgentTurn(
          env,
          {
            draft: {
              id: grant.draftId,
              projectId: grant.projectId,
              userId: grant.userId,
            },
            said,
            voice: true,
            started,
          },
          { say, dropped: replaced },
        );
        await write(completion.end(id));
      } catch (error) {
        console.warn("ticket-agent", describe(error));
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
    })(),
  );
  return new Response(readable, { headers });
}

/**
 * What a pull request's stage boots from: its branch, the recipe (and the
 * app as it was) when Yarrow ran its app, its presentation to play live. A
 * sentence when it has none.
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
  const steps = recipe ? servingSteps(recipe.steps) : [INSTALL_STEP];
  const before = recipe?.before && {
    ...recipe.before,
    steps: servingSteps(recipe.before.steps),
  };
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
    steps,
    restart: restartSteps(steps),
    ...(recipe ? stageAddress(recipe.url) : { url: null, path: "/" }),
    signIn: stageSignIn(recipe?.signIn ?? null),
    base: context.base,
    before: before
      ? { ...before, restart: restartSteps(before.steps, { locks: false }) }
      : null,
    script: stagePlan(timeline, Boolean(recipe?.before), Boolean(recipe)),
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
  /** A pull request's preview, on its own host; anything else, the health check. */
  fetch(request, env) {
    const unit =
      env.STAGE && env.PREVIEW_SUFFIX
        ? previewUnit(new URL(request.url).hostname, env.PREVIEW_SUFFIX)
        : null;
    if (!unit) return Response.json({ service: "yarrow-brain", status: "ok" });
    const forwarded = new Request(request);
    forwarded.headers.set(PREVIEW_HEADER, env.APP_URL);
    return env.STAGE!.getByName(unit).fetch(forwarded);
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
