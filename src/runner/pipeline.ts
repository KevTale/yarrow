import { pullRequestFooter } from "../core/attribution";
import { PROD_APP_SLUG } from "../core/corrections";
import { type PipelineRoles, type RunModelUsage } from "../core/pipeline";
import {
  blockingComments,
  type Review,
  type StoredArtifact,
  type StoredReview,
} from "../core/review";
import type { Database } from "../db/client";
import { pullRequestSummaryNow } from "../db/pull-panel";
import { runSponsors } from "../db/queries";
import {
  runContext,
  saveRecipe,
  setAnthropicResources,
  type RunContext,
} from "../db/runs";
import type { AppRecipe } from "../core/contracts";
import {
  GitHubClient,
  GitHubError,
  installationToken,
  type AppCredentials,
  type Fetch,
  type TokenPermissions,
} from "../server/github/app";
import {
  branchName,
  commentOnIssue,
  commitChanges,
  openDraftPullRequest,
  updatePullRequestBody,
  splitRepository,
} from "../server/github/delivery";
import {
  accessTokenFor,
  trackerAdapter,
  type TrackerName,
  type TrackerSecrets,
} from "../server/trackers/index";
import { moveTrackerTicket } from "../server/trackers/flow";
import {
  sessionActivity,
  syncRunActivity,
  type ActivitySource,
} from "../db/activity";
import { agentRuns } from "../db/schema";
import { eq } from "drizzle-orm";
import type { MoveEvent } from "../core/tracker-moves";
import {
  listCostCents,
  SANDBOX_HOSTS,
  SANDBOX_PACKAGES,
  type ManagedAgentsClient,
} from "./anthropic";
import {
  usageCostCents,
  usageTokens,
  type AgentsClient,
  type TokenRates,
} from "./openai";
import {
  isMuseSession,
  MUSE_EFFORT,
  MUSE_MODEL,
  museCostCents,
  museSessionId,
  type MuseClient,
} from "./muse";
import {
  changesSchema,
  CLARITY_INSTRUCTIONS,
  clarifiedTask,
  clarityResultSchema,
  clarityTask,
  fixTask,
  IMPLEMENTER_SYSTEM,
  implementationResultSchema,
  implementationTask,
  parseJsonMessage,
  parseReview,
  REVIEWER_INSTRUCTIONS,
  reviewTask,
  STAGE_PROPOSED,
  toFileChanges,
  type ImplementationResult,
} from "./prompts";
import {
  newest,
  publishPresentation,
  RECORDER_MOUNT,
  RECORDER_PATH,
  type SessionFiles,
} from "./presentation";
import { RECORDER_SOURCE } from "./recorder/source";
import type { VoiceProvider } from "./voice/index";
import {
  commitMessage,
  correctionComment,
  pullRequestBlock,
  pullRequestBody,
  replaceBlock,
  pullRequestTitle,
} from "./pull-request";

/** Environments whose hosts this isolate already brought up to date. */
const setupChecked = new Set<string>();

/** The recorder, uploaded once per isolate and mounted in every session. */
let recorderFile: Promise<string> | null = null;

/** Where evidence files (screenshots, video) are stored. R2 in production. */
export interface EvidenceStore {
  put(
    key: string,
    data: Uint8Array,
    options: { httpMetadata: { contentType: string } },
  ): Promise<unknown>;
}

export interface PipelineDeps {
  db: Database;
  anthropic: ManagedAgentsClient;
  openai: AgentsClient;
  github: AppCredentials;
  trackers: TrackerSecrets;
  evidence?: EvidenceStore;
  /** Voices the presentations; subtitles only without one. */
  voice?: VoiceProvider | null;
  appUrl: string;
  roles: PipelineRoles;
  anthropicAgentId: string;
  defaultEnvironmentId: string;
  reviewerModel: string;
  /** Reasoning effort for the reviewer; the provider default when absent. */
  reviewerEffort?: string;
  reviewerRates: TokenRates;
  /** The GitHub App's slug, for the correction line of each PR. */
  appSlug?: string;
  fetcher?: Fetch;
  /**
   * Who implements the runs prepared from now on: Claude (the default), or
   * Meta, Muse Code running Muse Wonder in Yarrow's container. A run keeps
   * the implementer it started with.
   */
  implementer?: "claude" | "meta";
  /** The containers Muse Code works in; Meta implements nothing without them. */
  muse?: MuseClient | null;
  museModel?: string;
  museEffort?: string;
}

/** Small, serializable facts about the run, safe to keep in Workflow state. */
export interface PreparedRun {
  runId: string;
  kind: "implementation" | "correction";
  instruction: string | null;
  /** A correction: what the pull request does before it. */
  pullRequestSummary?: string | null;
  ticket: {
    title: string;
    body: string;
    url: string;
    source: string;
    number?: number;
  };
  repository: string;
  installationId: string;
  repositoryId: number;
  baseBranch: string;
  /** The branch the sandbox checks out: base for new work, the PR branch for corrections. */
  checkoutBranch: string;
  workBranch: string;
  environmentId: string;
  vaultIds: string[];
  runConfig: {
    setupCommand: string | null;
    seedCommand: string | null;
    startCommand: string | null;
    appPort: number | null;
    env: Record<string, string>;
    secretNames: string[];
  } | null;
  /** How an earlier run got the project's app running. */
  recipe: AppRecipe | null;
  projectId: string;
  visibility: "public" | "listed" | "hidden";
  /** Claude when absent (runs prepared before Meta could implement). */
  implementer?: "claude" | "meta";
}

export interface ImplementationSnapshot extends ImplementationResult {
  paths: string[];
}

export class RunPipeline {
  constructor(private readonly deps: PipelineDeps) {}

  private async token(
    run: Pick<PreparedRun, "installationId" | "repositoryId">,
    access: "read" | "ticket" | "write",
  ): Promise<string> {
    const ask = (permissions: TokenPermissions) =>
      installationToken(
        this.deps.github,
        run.installationId,
        { repositoryIds: [run.repositoryId], permissions },
        this.deps.fetcher,
      ).then(({ token }) => token);
    if (access === "read") return ask({ contents: "read" });
    // The brain's own reads: a private repository's issues need their own
    // permission (the sandbox's token never gets it).
    if (access === "ticket") return ask({ contents: "read", issues: "read" });
    const write: TokenPermissions = {
      contents: "write",
      pull_requests: "write",
      issues: "write",
    };
    // Workflows lets a run change `.github/workflows/`. An installation that
    // has not accepted it yet refuses the whole token (422): ask without it.
    return ask({ ...write, workflows: "write" }).catch((error) => {
      if (error instanceof GitHubError && error.status === 422)
        return ask(write);
      throw error;
    });
  }

  /** Reads the live ticket with its recent comments: a GitHub issue or a tracker ticket. */
  private async freshTicket(
    context: RunContext,
    readToken: string,
  ): Promise<PreparedRun["ticket"]> {
    const { workUnit } = context;
    // Yarrow's own copy, when the tracker cannot be read. A GitHub issue
    // keeps its number, so the pull request still closes it.
    const fallback = {
      title: workUnit.title,
      body: workUnit.body,
      url: workUnit.url,
      source: workUnit.source,
      ...(workUnit.source === "github"
        ? { number: Number(workUnit.externalId) }
        : {}),
    };
    try {
      if (workUnit.source === "github") {
        const { owner, repo } = splitRepository(context.project.repository);
        const client = new GitHubClient(readToken, this.deps.fetcher);
        const number = Number(workUnit.externalId);
        const issue = await client.request<{
          title: string;
          body: string | null;
          html_url: string;
        }>("GET", `/repos/${owner}/${repo}/issues/${number}`);
        const comments = await client.request<
          { user: { login: string }; body: string }[]
        >(
          "GET",
          `/repos/${owner}/${repo}/issues/${number}/comments?per_page=20`,
        );
        const thread = comments
          .filter((comment) => !comment.user.login.endsWith("[bot]"))
          .map((comment) => `@${comment.user.login}: ${comment.body}`)
          .join("\n\n");
        return {
          title: issue.title,
          body: [issue.body ?? "", thread && `Discussion:\n${thread}`]
            .filter(Boolean)
            .join("\n\n"),
          url: issue.html_url,
          source: "github",
          number,
        };
      }
      if (context.tracker) {
        const name = context.tracker.connection.tracker as TrackerName;
        const credentials = this.deps.trackers[name];
        if (!credentials) return fallback;
        const accessToken = await accessTokenFor(
          this.deps.db,
          context.tracker.connection,
          this.deps.trackers,
          this.deps.fetcher,
        );
        const ticket = await trackerAdapter(name, this.deps.fetcher).getTicket(
          { externalId: context.tracker.connection.externalId, accessToken },
          credentials,
          workUnit.externalId,
        );
        if (ticket)
          return {
            title: ticket.title,
            body: [
              ticket.body,
              ticket.discussion && `Discussion:\n${ticket.discussion}`,
            ]
              .filter(Boolean)
              .join("\n\n"),
            url: ticket.url,
            source: name,
          };
      }
    } catch {
      // The snapshot is good enough when the live read fails.
    }
    return fallback;
  }

  /** The project's sandbox environment, created when secrets need allowed hosts. */
  private async environmentFor(context: RunContext): Promise<string> {
    if (context.secrets.length === 0 && !context.runConfig?.startCommand)
      return this.withSetup(this.deps.defaultEnvironmentId);
    if (context.runConfig?.anthropicEnvironmentId)
      return this.withSetup(context.runConfig.anthropicEnvironmentId);
    const hosts = [
      ...new Set([
        ...SANDBOX_HOSTS,
        ...context.secrets.map((secret) => secret.allowedHost),
      ]),
    ];
    const environment = await this.deps.anthropic.createEnvironment({
      name: `yarrow-${context.project.id}`,
      allowedHosts: hosts,
    });
    await setAnthropicResources(this.deps.db, context.project.id, {
      environmentId: environment.id,
    });
    return environment.id;
  }

  /**
   * Environments created before a host joined SANDBOX_HOSTS (or a package
   * SANDBOX_PACKAGES) get it on their next run. A failure only warns: the
   * run starts with what it had.
   */
  private async withSetup(environmentId: string): Promise<string> {
    if (setupChecked.has(environmentId)) return environmentId;
    try {
      await this.deps.anthropic.ensureSetup(environmentId, {
        hosts: SANDBOX_HOSTS,
        apt: SANDBOX_PACKAGES,
      });
      setupChecked.add(environmentId);
    } catch (error) {
      console.warn("environment setup:", (error as Error).message);
    }
    return environmentId;
  }

  async prepare(runId: string): Promise<PreparedRun> {
    const context = await runContext(this.deps.db, runId);
    const { project, workUnit, run, pullRequest } = context;
    if (!project.githubInstallationId || !project.githubRepositoryId)
      throw new Error("The project is not linked to the GitHub App");
    const access = {
      installationId: project.githubInstallationId,
      repositoryId: Number(project.githubRepositoryId),
    };
    const readToken = await this.token(access, "ticket");
    const { owner, repo } = splitRepository(project.repository);
    const repository = await new GitHubClient(
      readToken,
      this.deps.fetcher,
    ).request<{
      default_branch: string;
    }>("GET", `/repos/${owner}/${repo}`);
    const ticket = await this.freshTicket(context, readToken);
    if (run.kind === "implementation" && context.tracker)
      await this.moveTicket(workUnit.id, "started");
    const workBranch =
      pullRequest?.branch ?? branchName(ticket.title, workUnit.id);
    // Meta's container has no vault yet: a project with secrets stays on
    // Claude.
    const meta =
      this.deps.implementer === "meta" &&
      Boolean(this.deps.muse) &&
      context.secrets.length === 0;
    // The run was reserved under the default implementer: it names Meta's
    // model now, before the container starts, so the table never shows
    // Claude at work on a Meta run.
    if (meta)
      await this.deps.db
        .update(agentRuns)
        .set({
          implementer: this.rolesFor({ implementer: "meta" }).implementer,
        })
        .where(eq(agentRuns.id, runId));
    return {
      runId,
      kind: run.kind,
      instruction: run.instruction,
      pullRequestSummary:
        run.kind === "correction"
          ? await pullRequestSummaryNow(this.deps.db, workUnit.id)
          : null,
      ticket,
      repository: project.repository,
      ...access,
      baseBranch: repository.default_branch,
      checkoutBranch:
        run.kind === "correction" && pullRequest
          ? pullRequest.branch
          : repository.default_branch,
      workBranch,
      implementer: meta ? "meta" : "claude",
      environmentId: meta ? "" : await this.environmentFor(context),
      vaultIds:
        !meta && context.runConfig?.anthropicVaultId
          ? [context.runConfig.anthropicVaultId]
          : [],
      runConfig: context.runConfig
        ? {
            setupCommand: context.runConfig.setupCommand,
            seedCommand: context.runConfig.seedCommand,
            startCommand: context.runConfig.startCommand,
            appPort: context.runConfig.appPort,
            env: context.runConfig.env,
            secretNames: context.secrets.map((secret) => secret.name),
          }
        : null,
      recipe: context.runConfig?.recipe ?? null,
      projectId: project.id,
      visibility: project.visibility,
    };
  }

  /** The recorder's file id; null when it cannot be uploaded (no presentation). */
  private async recorder(): Promise<string | null> {
    recorderFile ??= this.deps.anthropic
      .uploadFile(
        "present.mjs",
        new TextEncoder().encode(RECORDER_SOURCE),
        "text/javascript",
      )
      .then((file) => file.id);
    return recorderFile.catch((error: Error) => {
      console.warn("recorder upload:", error.message);
      recorderFile = null;
      return null;
    });
  }

  /** Who implements this run, as the commit and the pull request say it. */
  private rolesFor(run: Pick<PreparedRun, "implementer">): PipelineRoles {
    if (run.implementer !== "meta") return this.deps.roles;
    return {
      ...this.deps.roles,
      implementer: `${this.deps.museModel ?? MUSE_MODEL}:${this.deps.museEffort ?? MUSE_EFFORT}`,
    };
  }

  private muse(): MuseClient {
    if (!this.deps.muse)
      throw new Error("Meta session error: this brain has no Muse container");
    return this.deps.muse;
  }

  /** Muse Code in a container of its own, with Claude's rules and task. */
  private async startMuse(run: PreparedRun): Promise<string> {
    const sessionId = museSessionId(run.runId);
    const task = implementationTask({
      kind: run.kind,
      ticket: run.ticket,
      instruction: run.instruction,
      pullRequestSummary: run.pullRequestSummary,
      baseBranch: run.baseBranch,
      runConfig: run.runConfig,
      recipe: run.recipe,
      presentation: true,
    });
    await this.muse().start(sessionId, {
      repository: run.repository,
      branch: run.checkoutBranch,
      token: await this.token(run, "read"),
      model: this.deps.museModel ?? MUSE_MODEL,
      effort: this.deps.museEffort ?? MUSE_EFFORT,
      prompt: `${IMPLEMENTER_SYSTEM}\n\n${task}`,
      files: [{ path: RECORDER_PATH, content: RECORDER_SOURCE }],
    });
    await this.deps.db
      .update(agentRuns)
      .set({ implementerSession: sessionId })
      .where(eq(agentRuns.id, run.runId));
    return sessionId;
  }

  async startImplementation(run: PreparedRun): Promise<string> {
    if (run.implementer === "meta") return this.startMuse(run);
    const token = await this.token(run, "read");
    const create = async () => {
      const recorder = await this.recorder();
      return this.deps.anthropic.createSession({
        agentId: this.deps.anthropicAgentId,
        environmentId: run.environmentId,
        title: `${run.kind}: ${run.ticket.title}`,
        repository: {
          url: `https://github.com/${run.repository}`,
          token,
          branch: run.checkoutBranch,
        },
        vaultIds: run.vaultIds,
        files: recorder
          ? [{ fileId: recorder, mountPath: RECORDER_MOUNT }]
          : [],
        message: implementationTask({
          kind: run.kind,
          ticket: run.ticket,
          instruction: run.instruction,
          pullRequestSummary: run.pullRequestSummary,
          baseBranch: run.baseBranch,
          runConfig: run.runConfig,
          recipe: run.recipe,
          presentation: recorder !== null,
        }),
      });
    };
    // A recorder file gone from the workspace fails the create: once more
    // with a fresh upload.
    const session = await create().catch((error: Error) => {
      if (!recorderFile || !/file/i.test(error.message)) throw error;
      recorderFile = null;
      return create();
    });
    // Kept for the activity feed (corrections reuse the run row's latest).
    await this.deps.db
      .update(agentRuns)
      .set({ implementerSession: session.id })
      .where(eq(agentRuns.id, run.runId));
    return session.id;
  }

  /** The implementer session's actions, from Claude or from Muse's container. */
  private activitySource(): ActivitySource {
    const claude = sessionActivity(this.deps.anthropic);
    return {
      activity: (sessionId, after) =>
        isMuseSession(sessionId)
          ? this.muse().activity(sessionId, after)
          : claude.activity(sessionId, after),
    };
  }

  /** Brings the implementer session's new actions into the run's feed. */
  async syncActivity(runId: string): Promise<void> {
    await syncRunActivity(this.deps.db, this.activitySource(), runId, 0).catch(
      (error: Error) => console.warn("activity:", error.message),
    );
  }

  /**
   * "done" when the implementer session has finished its turn. Each check
   * also brings the session's new actions into the run's activity feed.
   */
  async implementerState(
    sessionId: string,
    runId?: string,
  ): Promise<"working" | "done" | "failed"> {
    if (runId) await this.syncActivity(runId);
    if (isMuseSession(sessionId))
      return (await this.muse().state(sessionId)).state;
    const session = await this.deps.anthropic.getSession(sessionId);
    if (session.status === "terminated") return "failed";
    return session.status === "idle" ? "done" : "working";
  }

  /** Why the implementer session ended, in the provider's words. */
  async implementerError(sessionId: string): Promise<string | null> {
    if (isMuseSession(sessionId))
      return (await this.muse().state(sessionId)).error;
    return this.deps.anthropic.lastError(sessionId);
  }

  /** The implementer session's outputs, wherever it ran. */
  private files(sessionId: string): SessionFiles {
    if (!isMuseSession(sessionId)) return this.deps.anthropic;
    const muse = this.muse();
    return {
      listFiles: () => muse.listFiles(sessionId),
      download: (fileId) => muse.download(sessionId, fileId),
    };
  }

  /** The newest output with this name (result.json, a screenshot). */
  private async readOutput(
    sessionId: string,
    name: string,
  ): Promise<Uint8Array | null> {
    if (!isMuseSession(sessionId))
      return this.deps.anthropic.readOutput(sessionId, name);
    const files = this.files(sessionId);
    const file = newest(await files.listFiles(sessionId), name);
    return file ? files.download(file.id) : null;
  }

  /** Stops Muse's container once the run is over (Claude's sessions end alone). */
  async releaseImplementer(sessionId: string | null): Promise<void> {
    if (sessionId && isMuseSession(sessionId))
      await this.muse().release(sessionId);
  }

  /**
   * The implementer's result.json and the paths it changed. A recipe in it
   * becomes the project's: the next run starts the app without searching.
   */
  async readImplementation(
    sessionId: string,
    projectId?: string,
  ): Promise<ImplementationSnapshot> {
    const raw = await this.readOutput(sessionId, "result.json");
    if (!raw) throw new Error("The implementer wrote no result.json");
    const result = implementationResultSchema.parse(
      JSON.parse(new TextDecoder().decode(raw)),
    );
    if (projectId && result.recipe)
      await saveRecipe(this.deps.db, projectId, result.recipe);
    const changes = await this.changes(sessionId);
    return { ...result, paths: changes.map((file) => file.path) };
  }

  private async changes(sessionId: string) {
    const raw = await this.readOutput(sessionId, "changes.json");
    if (!raw) return [];
    return toFileChanges(
      changesSchema.parse(JSON.parse(new TextDecoder().decode(raw))),
    );
  }

  async sendToImplementer(sessionId: string, text: string): Promise<void> {
    if (isMuseSession(sessionId)) await this.muse().send(sessionId, text);
    else await this.deps.anthropic.sendMessage(sessionId, text);
  }

  clarifiedMessage(reading: string): string {
    return clarifiedTask(reading);
  }

  fixMessage(review: Review): string {
    return fixTask(review);
  }

  async startClarity(run: PreparedRun, questions: string[]): Promise<string> {
    const session = await this.deps.openai.createSession({
      model: this.deps.reviewerModel,
      effort: this.deps.reviewerEffort,
      instructions: CLARITY_INSTRUCTIONS,
      task: clarityTask(run.ticket, questions),
    });
    return session.id;
  }

  /** `earlier` is the first review, on the second look after a fix round. */
  async startReview(
    run: PreparedRun,
    implementerSessionId: string,
    snapshot: ImplementationSnapshot,
    earlier?: Review,
  ): Promise<string> {
    const files = await this.changes(implementerSessionId);
    const bundle = {
      files: files.map((file) => ({
        path: file.path,
        content: file.content,
        mode: file.mode,
      })),
    };
    const { owner, repo } = splitRepository(run.repository);
    const session = await this.deps.openai.createSession({
      model: this.deps.reviewerModel,
      effort: this.deps.reviewerEffort,
      instructions: REVIEWER_INSTRUCTIONS,
      task: reviewTask({
        ticket: run.ticket,
        implementerSummary: snapshot.summary,
        criteria: snapshot.criteria,
        verification: snapshot.verification,
        notVerified: snapshot.not_verified,
        risks: snapshot.risks,
        earlier,
        pullRequestSummary:
          run.kind === "correction" ? snapshot.pr_summary : null,
      }),
      repository: {
        owner,
        repo,
        branch: run.checkoutBranch,
        token: await this.token(run, "read"),
      },
      files: [
        {
          path: "/workspace/proposed.json",
          data: btoa(
            String.fromCharCode(
              ...new TextEncoder().encode(JSON.stringify(bundle)),
            ),
          ),
        },
      ],
      setupCommands: [STAGE_PROPOSED],
    });
    return session.id;
  }

  async reviewerState(
    sessionId: string,
  ): Promise<"working" | "done" | "failed"> {
    const session = await this.deps.openai.getSession(sessionId);
    if (session.status === "failed") return "failed";
    return session.status === "idle" ? "done" : "working";
  }

  async readReview(sessionId: string): Promise<Review> {
    return parseReview(await this.deps.openai.finalText(sessionId));
  }

  async readClarity(sessionId: string) {
    return parseJsonMessage(
      clarityResultSchema,
      await this.deps.openai.finalText(sessionId),
    );
  }

  /** List-price cost of every provider session of the run, in cents. */
  async cost(
    implementerSessionId: string | null,
    reviewerSessionIds: string[],
  ): Promise<number> {
    const { costCents } = await this.usage(
      implementerSessionId,
      reviewerSessionIds.map((id) => ({ id, seconds: null })),
    );
    return costCents;
  }

  /**
   * What each model did: Anthropic reports the implementer's model, effort,
   * tokens, compute time and exact cost; OpenAI reports the reviewer's tokens,
   * so its cost is tokens × list price and its time is measured by the brain.
   */
  async usage(
    implementerSessionId: string | null,
    reviewers: { id: string; seconds: number | null }[],
  ): Promise<{ costCents: number; models: RunModelUsage[] }> {
    const models: RunModelUsage[] = [];
    if (implementerSessionId && isMuseSession(implementerSessionId))
      models.push(await this.museUsage(implementerSessionId));
    else if (implementerSessionId) {
      const session =
        await this.deps.anthropic.getSession(implementerSessionId);
      const usage = session.usage ?? {};
      const created =
        (usage.cache_creation?.ephemeral_1h_input_tokens ?? 0) +
        (usage.cache_creation?.ephemeral_5m_input_tokens ?? 0);
      const cached = usage.cache_read_input_tokens ?? 0;
      const effort = session.agent?.model?.effort;
      const [defaultModel, defaultEffort] =
        this.deps.roles.implementer.split(":");
      const tokens = usage.input_tokens !== undefined;
      models.push({
        role: "implementer",
        model: session.agent?.model?.id ?? defaultModel!,
        effort:
          (typeof effort === "string" ? effort : effort?.type) ??
          defaultEffort ??
          null,
        sessions: 1,
        seconds:
          usage.active_seconds === undefined
            ? null
            : Math.round(usage.active_seconds),
        secondsExact: usage.active_seconds !== undefined,
        inputTokens: tokens
          ? (usage.input_tokens ?? 0) + cached + created
          : null,
        cachedInputTokens: tokens ? cached : null,
        outputTokens: tokens ? (usage.output_tokens ?? 0) : null,
        costCents: listCostCents(session),
        costExact: true,
      });
    }
    if (reviewers.length > 0) {
      let costCents = 0;
      let seconds: number | null = 0;
      const totals = { input: 0, cached: 0, output: 0 };
      for (const reviewer of reviewers) {
        const usages = await this.deps.openai.usage(reviewer.id);
        costCents += usageCostCents(usages, this.deps.reviewerRates);
        const tokens = usageTokens(usages);
        totals.input += tokens.input;
        totals.cached += tokens.cached;
        totals.output += tokens.output;
        seconds =
          seconds === null || reviewer.seconds === null
            ? null
            : seconds + reviewer.seconds;
      }
      models.push({
        role: "reviewer",
        model: this.deps.reviewerModel,
        effort: this.deps.reviewerEffort ?? null,
        sessions: reviewers.length,
        seconds,
        secondsExact: false,
        inputTokens: totals.input,
        cachedInputTokens: totals.cached,
        outputTokens: totals.output,
        costCents,
        costExact: false,
      });
    }
    return {
      costCents: models.reduce((sum, model) => sum + model.costCents, 0),
      models,
    };
  }

  /**
   * Muse Code reports no cost: its tokens, counted by the Worker that relays
   * them to Meta, at list price, and the container's time.
   */
  private async museUsage(sessionId: string): Promise<RunModelUsage> {
    const usage = await this.muse().usage(sessionId);
    const totals = Object.values(usage.models);
    const sum = (key: "input" | "cached" | "output") =>
      totals.reduce((total, tokens) => total + tokens[key], 0);
    return {
      role: "implementer",
      model: usage.model || (this.deps.museModel ?? MUSE_MODEL),
      effort: usage.effort || null,
      sessions: 1,
      seconds: Math.round(usage.agentSeconds),
      secondsExact: true,
      inputTokens: sum("input"),
      cachedInputTokens: sum("cached"),
      outputTokens: sum("output"),
      costCents: museCostCents(usage),
      costExact: false,
    };
  }

  private runUrl(runId: string): string {
    return `${this.deps.appUrl}/runs/${runId}`;
  }

  /** Copies evidence to R2, served by /evidence to those who may see the run. */
  private async storeEvidence(
    run: PreparedRun,
    implementerSessionId: string,
    snapshot: ImplementationSnapshot,
  ): Promise<StoredArtifact[]> {
    if (!this.deps.evidence) return [];
    const stored: StoredArtifact[] = [];
    for (const artifact of snapshot.artifacts.slice(0, 10)) {
      const name = artifact.file.split("/").at(-1)!;
      const data = await this.readOutput(implementerSessionId, name);
      if (!data) continue;
      const contentType =
        artifact.kind === "video"
          ? name.endsWith(".mp4")
            ? "video/mp4"
            : "video/webm"
          : name.endsWith(".jpg") || name.endsWith(".jpeg")
            ? "image/jpeg"
            : "image/png";
      const key = `runs/${run.runId}/${crypto.randomUUID().slice(0, 8)}-${name}`;
      await this.deps.evidence.put(key, data, {
        httpMetadata: { contentType },
      });
      stored.push({
        kind: artifact.kind,
        key,
        label: artifact.label || name,
        contentType,
      });
    }
    return stored;
  }

  /**
   * The implementer's recorded presentation, voiced and stored, with who
   * wrote and reviewed it said at the end. Null when it recorded none.
   */
  async presentation(
    run: PreparedRun,
    implementerSessionId: string,
  ): Promise<StoredArtifact | null> {
    if (!this.deps.evidence) return null;
    return publishPresentation(
      {
        files: this.files(implementerSessionId),
        evidence: this.deps.evidence,
        voice: this.deps.voice ?? null,
      },
      {
        runId: run.runId,
        sessionId: implementerSessionId,
      },
    );
  }

  /**
   * Commits the change, opens (or updates) the draft PR, publishes the final
   * review and notifies the ticket. Returns what the ledger records.
   */
  async deliver(
    run: PreparedRun,
    implementerSessionId: string,
    snapshot: ImplementationSnapshot,
    review: StoredReview | null,
    presentation: StoredArtifact | null = null,
  ): Promise<{
    url: string;
    number: number;
    branch: string;
    artifacts: StoredArtifact[];
  }> {
    const files = await this.changes(implementerSessionId);
    if (files.length === 0) throw new Error("The implementer changed no file");
    const writeToken = await this.token(run, "write");
    const client = new GitHubClient(writeToken, this.deps.fetcher);
    const repository = splitRepository(run.repository);
    const sponsors = await runSponsors(this.deps.db, run.runId);
    const screenshots = await this.storeEvidence(
      run,
      implementerSessionId,
      snapshot,
    );
    const artifacts = presentation
      ? [presentation, ...screenshots]
      : screenshots;
    // A public project's screenshots show in the description; a private
    // one's stay in Yarrow, for its builders (decided 2026-10-16). The
    // presentation plays on the run's page: its still links there.
    const shown = run.visibility === "public";
    const evidenceLinks = shown
      ? screenshots.map((artifact) => ({
          kind: artifact.kind as "screenshot" | "video",
          label: artifact.label,
          url: `${this.deps.appUrl}/evidence/${artifact.key}`,
        }))
      : [];
    const evidenceInYarrow = shown
      ? null
      : { count: screenshots.length, url: this.runUrl(run.runId) };
    const presented = presentation && {
      title: presentation.label,
      url: this.runUrl(run.runId),
      poster:
        shown && presentation.poster
          ? `${this.deps.appUrl}/evidence/${presentation.poster}`
          : null,
    };
    await commitChanges(client, repository, {
      baseBranch: run.baseBranch,
      branch: run.workBranch,
      files,
      message: commitMessage({
        title: run.ticket.title,
        summary: snapshot.summary,
        ticketUrl: run.ticket.url,
        roles: this.rolesFor(run),
        correction: run.instruction,
      }),
    });
    const context = await runContext(this.deps.db, run.runId);
    let pull: { number: number; url: string };
    if (context.pullRequest) {
      pull = {
        number: context.pullRequest.number,
        url: context.pullRequest.url,
      };
      await commentOnIssue(
        client,
        repository,
        pull.number,
        correctionComment({
          instruction: run.instruction ?? "",
          summary: snapshot.summary,
          review,
          footer: pullRequestFooter({
            roles: this.rolesFor(run),
            sponsors,
            runUrl: this.runUrl(run.runId),
          }),
        }),
      );
      // The description says what the pull request does now; anything a
      // person wrote outside Yarrow's part stays.
      const now = review?.changed ?? snapshot.pr_summary;
      if (now) {
        const current = await client.request<{ body: string | null }>(
          "GET",
          `/repos/${repository.owner}/${repository.repo}/pulls/${pull.number}`,
        );
        const body = replaceBlock(
          current.body ?? "",
          pullRequestBlock({
            ticket: run.ticket,
            summary: now,
            criteria: snapshot.criteria,
            verification: snapshot.verification,
            notVerified: snapshot.not_verified,
            risks: snapshot.risks,
            spotted: snapshot.spotted,
            review,
            evidence: evidenceLinks,
            evidenceInYarrow,
            presentation: presented,
          }),
        );
        if (body)
          await updatePullRequestBody(client, repository, pull.number, body);
      }
    } else {
      pull = await openDraftPullRequest(client, repository, {
        head: run.workBranch,
        base: run.baseBranch,
        title: pullRequestTitle({ ticket: run.ticket }),
        body: pullRequestBody({
          ticket: run.ticket,
          // The reviewer tells the pull request; the implementer's words
          // stand in when there was no review.
          summary: review?.changed ?? snapshot.summary,
          criteria: snapshot.criteria,
          verification: snapshot.verification,
          notVerified: snapshot.not_verified,
          risks: snapshot.risks,
          spotted: snapshot.spotted,
          review,
          evidence: evidenceLinks,
          evidenceInYarrow,
          presentation: presented,
          roles: this.rolesFor(run),
          sponsors,
          runUrl: this.runUrl(run.runId),
          appSlug: this.deps.appSlug ?? PROD_APP_SLUG,
        }),
      });
    }
    if (run.ticket.source !== "github" && run.kind === "implementation") {
      await this.commentOnTicket(
        run,
        `Yarrow opened a draft pull request for this ticket: ${pull.url}`,
      ).catch(() => undefined);
      const { workUnit } = await runContext(this.deps.db, run.runId);
      await this.moveTicket(workUnit.id, "pullRequest");
    }
    return {
      url: pull.url,
      number: pull.number,
      branch: run.workBranch,
      artifacts,
    };
  }

  /** Moves the tracker ticket on its board, as the builder chose. Never fails the run. */
  async moveTicket(workUnitId: string, event: MoveEvent): Promise<void> {
    await moveTrackerTicket(
      this.deps.db,
      { secrets: this.deps.trackers, fetcher: this.deps.fetcher },
      workUnitId,
      event,
    ).catch((error: Error) => console.warn(`move ${event}:`, error.message));
  }

  /** Moves the run's tracker ticket, if it has one. */
  async moveRunTicket(runId: string, event: MoveEvent): Promise<void> {
    const { workUnit, tracker } = await runContext(this.deps.db, runId);
    if (tracker) await this.moveTicket(workUnit.id, event);
  }

  /** Comments on the GitHub issue or the tracker ticket. */
  async commentOnTicket(run: PreparedRun, body: string): Promise<void> {
    const context = await runContext(this.deps.db, run.runId);
    if (context.workUnit.source === "github") {
      const client = new GitHubClient(
        await this.token(run, "write"),
        this.deps.fetcher,
      );
      await commentOnIssue(
        client,
        splitRepository(run.repository),
        Number(context.workUnit.externalId),
        body,
      );
      return;
    }
    if (!context.tracker) return;
    const name = context.tracker.connection.tracker as TrackerName;
    const credentials = this.deps.trackers[name];
    if (!credentials) return;
    const accessToken = await accessTokenFor(
      this.deps.db,
      context.tracker.connection,
      this.deps.trackers,
      this.deps.fetcher,
    );
    await trackerAdapter(name, this.deps.fetcher).comment(
      { externalId: context.tracker.connection.externalId, accessToken },
      credentials,
      context.workUnit.externalId,
      body,
    );
  }

  unclearComment(
    questions: string[],
    run?: Pick<PreparedRun, "implementer">,
  ): string {
    const implementer = run?.implementer === "meta" ? "Meta" : "Claude";
    return [
      `**Yarrow needs a few details before working on this ticket.** Both the implementer (${implementer}) and the reviewer (OpenAI) found it ambiguous:`,
      "",
      ...questions.map((question) => `- ${question}`),
      "",
      "Edit the ticket with the answers: it goes back in the queue automatically.",
    ].join("\n");
  }

  /** Whether the review requires the fix round. */
  needsFix(review: Review): boolean {
    return blockingComments(review).length > 0;
  }
}
