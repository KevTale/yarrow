import { env } from "cloudflare:workers";

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
  LINEAR_WEBHOOK_SECRET?: string;
  JIRA_CLIENT_ID?: string;
  JIRA_CLIENT_SECRET?: string;
  TRELLO_API_KEY?: string;
  TRELLO_API_SECRET?: string;
  /** 32 random bytes, base64. Encrypts tracker OAuth tokens at rest. */
  TOKEN_ENCRYPTION_KEY?: string;
  /** Writes owners' test secrets to Managed Agents vaults (never to our DB). */
  ANTHROPIC_API_KEY?: string;
  /** R2 bucket with run evidence (screenshots, video). Optional. */
  EVIDENCE?: R2Bucket;
}

export function appEnv(): AppEnv {
  return env as unknown as AppEnv;
}

export class NotConfiguredError extends Error {
  constructor(readonly feature: string) {
    super(`${feature} is not configured on this deployment yet.`);
  }
}
