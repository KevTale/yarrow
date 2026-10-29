/**
 * One-time setup of the Claude Managed Agents resources used by the brain.
 *
 *   pnpm bootstrap:anthropic   # reads ANTHROPIC_API_KEY from the shell or .env
 *
 * Prints ANTHROPIC_AGENT_ID and ANTHROPIC_ENVIRONMENT_ID to store as brain
 * secrets. Run it again after changing the implementer prompt: it creates a
 * new agent, and the brain uses whichever ID you configure.
 */
import { existsSync } from "node:fs";
import { ManagedAgentsClient, SANDBOX_HOSTS } from "../src/runner/anthropic";
import { IMPLEMENTER_SYSTEM } from "../src/runner/prompts";

// A key already in the shell wins (set-secrets.ps1 passes the target's key).
if (!process.env.ANTHROPIC_API_KEY && existsSync(".env"))
  process.loadEnvFile(".env");
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY (a platform Console API key).");
  process.exit(1);
}
const client = new ManagedAgentsClient(apiKey);
const agent = await client.createAgent({
  name: "Yarrow implementer",
  model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  effort: process.env.ANTHROPIC_EFFORT ?? "high",
  system: IMPLEMENTER_SYSTEM,
});
const environment = await client.createEnvironment({
  name: "yarrow-default",
  allowedHosts: SANDBOX_HOSTS,
});
console.log(`ANTHROPIC_AGENT_ID=${agent.id}`);
console.log(`ANTHROPIC_ENVIRONMENT_ID=${environment.id}`);
console.log(
  "\nStore both in the brain:\n  pnpm exec wrangler secret put ANTHROPIC_AGENT_ID --config workers/wrangler.jsonc --env dev|production\n  pnpm exec wrangler secret put ANTHROPIC_ENVIRONMENT_ID --config workers/wrangler.jsonc --env dev|production",
);
