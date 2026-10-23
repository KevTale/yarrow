import { pullRequestFooter } from "../core/attribution";
import { modelDisplayName, type PipelineRoles } from "../core/pipeline";
import {
  blockingComments,
  inlineCommentBody,
  reviewBody,
  type Review,
  type StoredArtifact,
  type StoredReview,
} from "../core/review";
import type { Database } from "../db/client";
import { runSponsors } from "../db/queries";
import { runContext, setAnthropicResources, type RunContext } from "../db/runs";
import {
  GitHubClient,
  installationToken,
  type AppCredentials,
  type Fetch,
} from "../server/github/app";
import {
  branchName,
  commentOnIssue,
  commitChanges,
  openDraftPullRequest,
  publishReview,
  splitRepository,
} from "../server/github/delivery";
import {
  accessTokenFor,
  trackerAdapter,
  type TrackerName,
  type TrackerSecrets,
} from "../server/trackers/index";
import { listCostCents, type ManagedAgentsClient } from "./anthropic";
import { usageCostCents, type AgentsClient, type TokenRates } from "./openai";
import {
  changesSchema,
  CLARITY_INSTRUCTIONS,
  clarifiedTask,
  clarityResultSchema,
  clarityTask,
  fixTask,
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
  commitMessage,
  correctionComment,
  pullRequestBody,
  pullRequestTitle,
} from "./pull-request";

/** Hosts the implementer sandbox may reach besides package registries. */
const PLAYWRIGHT_HOSTS = [
  "cdn.playwright.dev",
  "playwright.download.prss.microsoft.com",
  "playwright.azureedge.net",
];

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
  appUrl: string;
  roles: PipelineRoles;
  anthropicAgentId: string;
  defaultEnvironmentId: string;
  reviewerModel: string;
  reviewerRates: TokenRates;
  fetcher?: Fetch;
}

/** Small, serializable facts about the run, safe to keep in Workflow state. */
export interface PreparedRun {
  runId: string;
  kind: "implementation" | "correction";
  instruction: string | null;
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
  visibility: "public" | "listed" | "hidden";
}

export interface ImplementationSnapshot extends ImplementationResult {
  paths: string[];
}

export class RunPipeline {
  constructor(private readonly deps: PipelineDeps) {}

  private async token(
    run: Pick<PreparedRun, "installationId" | "repositoryId">,
    access: "read" | "write",
  ): Promise<string> {
    const { token } = await installationToken(
      this.deps.github,
      run.installationId,
      access === "read"
        ? {
            repositoryIds: [run.repositoryId],
            permissions: { contents: "read" },
          }
        : {
            repositoryIds: [run.repositoryId],
            permissions: {
              contents: "write",
              pull_requests: "write",
              issues: "write",
            },
          },
      this.deps.fetcher,
    );
    return token;
  }

  /** Reads the live ticket: GitHub issue with recent comments, or tracker ticket. */
  private async freshTicket(
    context: RunContext,
    readToken: string,
  ): Promise<PreparedRun["ticket"]> {
    const { workUnit } = context;
    const fallback = {
      title: workUnit.title,
      body: workUnit.body,
      url: workUnit.url,
      source: workUnit.source,
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
            body: ticket.body,
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
      return this.deps.defaultEnvironmentId;
    if (context.runConfig?.anthropicEnvironmentId)
      return context.runConfig.anthropicEnvironmentId;
    const hosts = [
      ...new Set([
        ...PLAYWRIGHT_HOSTS,
        ...context.secrets.map((secret) => secret.allowedHost),
      ]),
    ];
    const environment = await this.deps.anthropic.createEnvironment({
      name: `agent-commons-${context.project.id}`,
      allowedHosts: hosts,
    });
    await setAnthropicResources(this.deps.db, context.project.id, {
      environmentId: environment.id,
    });
    return environment.id;
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
    const readToken = await this.token(access, "read");
    const { owner, repo } = splitRepository(project.repository);
    const repository = await new GitHubClient(
      readToken,
      this.deps.fetcher,
    ).request<{
      default_branch: string;
    }>("GET", `/repos/${owner}/${repo}`);
    const ticket = await this.freshTicket(context, readToken);
    const workBranch =
      pullRequest?.branch ?? branchName(ticket.title, workUnit.id);
    return {
      runId,
      kind: run.kind,
      instruction: run.instruction,
      ticket,
      repository: project.repository,
      ...access,
      baseBranch: repository.default_branch,
      checkoutBranch:
        run.kind === "correction" && pullRequest
          ? pullRequest.branch
          : repository.default_branch,
      workBranch,
      environmentId: await this.environmentFor(context),
      vaultIds: context.runConfig?.anthropicVaultId
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
      visibility: project.visibility,
    };
  }

  async startImplementation(run: PreparedRun): Promise<string> {
    const session = await this.deps.anthropic.createSession({
      agentId: this.deps.anthropicAgentId,
      environmentId: run.environmentId,
      title: `${run.kind}: ${run.ticket.title}`,
      repository: {
        url: `https://github.com/${run.repository}`,
        token: await this.token(run, "read"),
        branch: run.checkoutBranch,
      },
      vaultIds: run.vaultIds,
      message: implementationTask({
        kind: run.kind,
        ticket: run.ticket,
        instruction: run.instruction,
        runConfig: run.runConfig,
      }),
    });
    return session.id;
  }

  /** "done" when the implementer session has finished its turn. */
  async implementerState(
    sessionId: string,
  ): Promise<"working" | "done" | "failed"> {
    const session = await this.deps.anthropic.getSession(sessionId);
    if (session.status === "terminated") return "failed";
    return session.status === "idle" ? "done" : "working";
  }

  async readImplementation(sessionId: string): Promise<ImplementationSnapshot> {
    const raw = await this.deps.anthropic.readOutput(sessionId, "result.json");
    if (!raw) throw new Error("The implementer wrote no result.json");
    const result = implementationResultSchema.parse(
      JSON.parse(new TextDecoder().decode(raw)),
    );
    const changes = await this.changes(sessionId);
    return { ...result, paths: changes.map((file) => file.path) };
  }

  private async changes(sessionId: string) {
    const raw = await this.deps.anthropic.readOutput(sessionId, "changes.json");
    if (!raw) return [];
    return toFileChanges(
      changesSchema.parse(JSON.parse(new TextDecoder().decode(raw))),
    );
  }

  async sendToImplementer(sessionId: string, text: string): Promise<void> {
    await this.deps.anthropic.sendMessage(sessionId, text);
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
      instructions: CLARITY_INSTRUCTIONS,
      task: clarityTask(run.ticket, questions),
    });
    return session.id;
  }

  async startReview(
    run: PreparedRun,
    implementerSessionId: string,
    snapshot: ImplementationSnapshot,
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
      instructions: REVIEWER_INSTRUCTIONS,
      task: reviewTask({
        ticket: run.ticket,
        implementerSummary: snapshot.summary,
        verification: snapshot.verification,
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
    let cents = 0;
    if (implementerSessionId)
      cents += listCostCents(
        await this.deps.anthropic.getSession(implementerSessionId),
      );
    for (const id of reviewerSessionIds)
      cents += usageCostCents(
        await this.deps.openai.usage(id),
        this.deps.reviewerRates,
      );
    return cents;
  }

  private runUrl(runId: string): string {
    return `${this.deps.appUrl}/runs/${runId}`;
  }

  /** Copies evidence to R2. Hidden projects only link to the authenticated run page. */
  private async storeEvidence(
    run: PreparedRun,
    implementerSessionId: string,
    snapshot: ImplementationSnapshot,
  ): Promise<StoredArtifact[]> {
    if (!this.deps.evidence) return [];
    const stored: StoredArtifact[] = [];
    for (const artifact of snapshot.artifacts.slice(0, 10)) {
      const name = artifact.file.split("/").at(-1)!;
      const data = await this.deps.anthropic.readOutput(
        implementerSessionId,
        name,
      );
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
   * Commits the change, opens (or updates) the draft PR, publishes the final
   * review and notifies the ticket. Returns what the ledger records.
   */
  async deliver(
    run: PreparedRun,
    implementerSessionId: string,
    snapshot: ImplementationSnapshot,
    review: StoredReview | null,
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
    const artifacts = await this.storeEvidence(
      run,
      implementerSessionId,
      snapshot,
    );
    const evidenceLinks = artifacts.map((artifact) => ({
      kind: artifact.kind,
      label: artifact.label,
      url:
        run.visibility === "hidden"
          ? this.runUrl(run.runId)
          : `${this.deps.appUrl}/evidence/${artifact.key}`,
    }));
    const sha = await commitChanges(client, repository, {
      baseBranch: run.baseBranch,
      branch: run.workBranch,
      files,
      message: commitMessage({
        title: run.ticket.title,
        summary: snapshot.summary,
        ticketUrl: run.ticket.url,
        roles: this.deps.roles,
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
          footer: pullRequestFooter({
            roles: this.deps.roles,
            sponsors,
            runUrl: this.runUrl(run.runId),
          }),
        }),
      );
    } else {
      pull = await openDraftPullRequest(client, repository, {
        head: run.workBranch,
        base: run.baseBranch,
        title: pullRequestTitle({ ticket: run.ticket }),
        body: pullRequestBody({
          ticket: run.ticket,
          summary: snapshot.summary,
          verification: snapshot.verification,
          risks: snapshot.risks,
          review,
          evidence: evidenceLinks,
          roles: this.deps.roles,
          sponsors,
          runUrl: this.runUrl(run.runId),
        }),
      });
    }
    if (review)
      await publishReview(client, repository, {
        number: pull.number,
        commitSha: sha,
        body: reviewBody(review, modelDisplayName(review.reviewer)),
        comments: review.comments
          .filter((comment) => comment.path && comment.line)
          .map((comment) => ({
            path: comment.path!,
            line: comment.line!,
            body: inlineCommentBody(comment),
          })),
      });
    if (run.ticket.source !== "github" && run.kind === "implementation")
      await this.commentOnTicket(
        run,
        `Agent Commons opened a draft pull request for this ticket: ${pull.url}`,
      ).catch(() => undefined);
    return {
      url: pull.url,
      number: pull.number,
      branch: run.workBranch,
      artifacts,
    };
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

  unclearComment(questions: string[]): string {
    return [
      "**Agent Commons needs a few details before working on this ticket.** Both the implementer (Claude) and the reviewer (OpenAI) found it ambiguous:",
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
