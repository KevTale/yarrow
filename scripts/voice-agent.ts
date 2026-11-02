/**
 * The live review's ElevenLabs agent for Yarrow dev (src/runner/voice/agent.ts):
 *
 *   pnpm voice:agent
 *
 * Makes, or brings up to date, in the workspace of ELEVENLABS_API_KEY
 * (the environment, else video/.env), only what is Yarrow's, found by its
 * name: the secret holding the brain's key, the page's resume tool, the
 * agent. Nothing else of the workspace is read or touched. A new
 * VOICE_SECRET each time: the dev brain gets it with the agent's id, as
 * secrets (a deploy keeps them). Needs CLOUDFLARE_API_TOKEN, as any
 * wrangler command outside an interactive login.
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import {
  RESUME_TOOL,
  talkAgentConfig,
  talkKey,
} from "../src/runner/voice/agent";

const API = "https://api.elevenlabs.io/v1";
const AGENT = "Yarrow live review (dev)";
const SECRET = "yarrow-live-review-dev";
const LLM_URL = "https://dev.yarrow.run/voice/llm";

function apiKey(): string {
  if (process.env.ELEVENLABS_API_KEY) return process.env.ELEVENLABS_API_KEY;
  const file = "video/.env";
  const line = existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .find((row) => row.startsWith("ELEVENLABS_API_KEY="))
    : undefined;
  const key = line?.slice("ELEVENLABS_API_KEY=".length).trim();
  if (!key)
    throw new Error("ELEVENLABS_API_KEY: in the environment or video/.env");
  return key;
}

const key = apiKey();

async function eleven<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();
  if (!response.ok)
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${response.status} ${text.slice(0, 600)}`,
    );
  return (text ? JSON.parse(text) : {}) as T;
}

function putSecret(name: string, value: string) {
  execFileSync(
    "pnpm",
    [
      "exec",
      "wrangler",
      "secret",
      "put",
      name,
      "--config",
      "workers/wrangler.jsonc",
      "--env",
      "dev",
    ],
    { input: value, stdio: ["pipe", "inherit", "inherit"], shell: true },
  );
}

const voiceSecret = randomBytes(32).toString("base64url");
const llmKey = await talkKey(voiceSecret);

// The brain's key, as ElevenLabs keeps it.
const { secrets } = await eleven<{
  secrets: { secret_id: string; name: string }[];
}>("/convai/secrets");
let secretId = secrets.find((secret) => secret.name === SECRET)?.secret_id;
if (secretId)
  await eleven(`/convai/secrets/${secretId}`, {
    method: "PATCH",
    body: { type: "update", name: SECRET, value: llmKey },
  });
else
  secretId = (
    await eleven<{ secret_id: string }>("/convai/secrets", {
      method: "POST",
      body: { type: "new", name: SECRET, value: llmKey },
    })
  ).secret_id;

// The page's tool: the presentation goes on.
const { tools } = await eleven<{
  tools: { id: string; tool_config: { name: string; type: string } }[];
}>("/convai/tools");
let toolId = tools.find(
  (tool) =>
    tool.tool_config.type === "client" &&
    tool.tool_config.name === RESUME_TOOL.name,
)?.id;
if (toolId)
  await eleven(`/convai/tools/${toolId}`, {
    method: "PATCH",
    body: { tool_config: RESUME_TOOL },
  });
else
  toolId = (
    await eleven<{ id: string }>("/convai/tools", {
      method: "POST",
      body: { tool_config: RESUME_TOOL },
    })
  ).id;

// The agent, by its exact name.
const { agents } = await eleven<{
  agents: { agent_id: string; name: string }[];
}>(`/convai/agents?search=${encodeURIComponent(AGENT)}&page_size=100`);
const config = talkAgentConfig({
  name: AGENT,
  llmUrl: LLM_URL,
  secretId,
  toolId,
});
let agentId = agents.find((agent) => agent.name === AGENT)?.agent_id;
if (agentId)
  await eleven(`/convai/agents/${agentId}`, { method: "PATCH", body: config });
else
  agentId = (
    await eleven<{ agent_id: string }>("/convai/agents/create", {
      method: "POST",
      body: config,
    })
  ).agent_id;

putSecret("VOICE_SECRET", voiceSecret);
putSecret("ELEVENLABS_AGENT_ID", agentId);
console.log(`Yarrow dev: live review agent ${agentId}, its LLM ${LLM_URL}.`);
