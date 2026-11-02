import { env } from "cloudflare:workers";
import type { ActionResult, PullRequestAction } from "./github/pull-actions";
import type { NewIssueResult } from "./github/new-issue";
import type { StageCue, StageCueResult, StageStatus } from "../core/stage";

/**
 * The shop Worker's configuration. Public values come from wrangler.jsonc
 * `vars`; secrets from `wrangler secret put` (and .dev.vars locally).
 * Every integration is optional: a missing secret disables that feature
 * with an explicit message instead of crashing the app.
 */
export interface AppEnv {
  APP_URL: string;
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  GITHUB_APP_SLUG: string;
  DATABASE_URL?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  /** "on" once Stripe Tax is configured in the Stripe dashboard. */
  STRIPE_TAX?: string;
  GITHUB_APP_ID?: string;
  GITHUB_APP_PRIVATE_KEY?: string;
  GITHUB_APP_WEBHOOK_SECRET?: string;
  LINEAR_CLIENT_ID?: string;
  LINEAR_CLIENT_SECRET?: string;
  JIRA_CLIENT_ID?: string;
  JIRA_CLIENT_SECRET?: string;
  TRELLO_API_KEY?: string;
  TRELLO_API_SECRET?: string;
  /** 32 random bytes, base64. Encrypts tracker OAuth tokens at rest. */
  TOKEN_ENCRYPTION_KEY?: string;
  /** Writes owners' test secrets to Managed Agents vaults (never to our DB). */
  ANTHROPIC_API_KEY?: string;
  /** Sends Yarrow's own emails (thanks after a payment). Optional. */
  RESEND_API_KEY?: string;
  /** Sender of Yarrow's emails, e.g. "Yarrow <no-reply@yarrow.run>". */
  EMAIL_FROM?: string;
  /** Supabase secret key: sign-in links inside Yarrow's emails. Optional. */
  SUPABASE_SECRET_KEY?: string;
  /** R2 bucket with run evidence (screenshots, video). Optional. */
  EVIDENCE?: R2Bucket;
  /** The brain's private entrypoint (service binding). Absent locally. */
  BRAIN?: {
    kick(): Promise<void>;
    /** The only GitHub writes the dashboard asks for, done by the brain. */
    pullRequestAction(input: {
      workUnitId: string;
      action: PullRequestAction;
    }): Promise<ActionResult>;
    requestCorrection(
      input: { workUnitId: string; login: string } & (
        { instruction: string } | { chatMessageId: string }
      ),
    ): Promise<ActionResult>;
    /** A question in the pull request's conversation, answered in the background. */
    askChat(input: {
      workUnitId: string;
      userId: string;
      text: string;
      stage?: boolean;
    }): Promise<ActionResult>;
    createIssue(input: {
      projectId: string;
      title: string;
      body: string;
      queue: boolean;
    }): Promise<NewIssueResult>;
    answerTicket(input: {
      projectId: string;
      key: string;
      answer: string;
      login: string;
    }): Promise<ActionResult>;
    closeTicket(input: {
      projectId: string;
      key: string;
      source: "github" | "jira";
    }): Promise<ActionResult>;
    closePullRequest(input: { workUnitId: string }): Promise<ActionResult>;
    /** A pull request's stage, its app live (workers/stage.ts). */
    stage(input: {
      workUnitId: string;
      action: "open" | "status" | "close";
      fresh?: boolean;
    }): Promise<StageStatus>;
    /** The presentation, played live on the stage a cue at a time. */
    stageCue(input: {
      workUnitId: string;
      cue: StageCue;
    }): Promise<StageCueResult>;
    /** A live call about the pull request, by voice (src/runner/talk.ts). */
    talkCall(input: {
      workUnitId: string;
      userId: string;
      language: string;
    }): Promise<
      | { ok: true; conversationToken: string; grant: string }
      | { ok: false; reason: string }
    >;
    /**
     * The stage's screen: a WebSocket to /stage/<workUnitId>. And the live
     * call's turns, ElevenLabs' requests to /voice/llm.
     */
    fetch(request: Request): Promise<Response>;
  };
}

export function appEnv(): AppEnv {
  return env as unknown as AppEnv;
}

export class NotConfiguredError extends Error {
  constructor(readonly feature: string) {
    super(`${feature} is not configured on this deployment yet.`);
  }
}
