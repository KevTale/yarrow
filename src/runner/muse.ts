import {
  activityFromMuseEvent,
  type ActivityLine,
  type MuseEvent,
} from "../core/activity";
import type { SessionFile } from "./anthropic";
import { usageCostCents, type TokenRates } from "./openai";

/**
 * The Meta implementer. Meta hosts models, not agents: Muse Code, Meta's
 * coding agent, runs Muse Wonder in a container of Yarrow's own
 * (workers/muse.ts), and the Meta key never enters it. What is here has no
 * I/O: the command line, the prices, the meter, the feed.
 */

/** Implementer sessions run by Muse Code; any other is a Claude session. */
const MUSE_SESSION = "muse_";
export const isMuseSession = (id: string) => id.startsWith(MUSE_SESSION);
/** One container per run, named after it. */
export const museSessionId = (runId: string) => `${MUSE_SESSION}${runId}`;

export const MUSE_MODEL = "muse-wonder-1.0";
export const MUSE_EFFORT = "high";

/**
 * Muse Code calls Meta here, in plain HTTP: the Worker that intercepts the
 * container's traffic sends it on over HTTPS with the key.
 */
export const META_HOST = "api.meta.ai";
const META_RELAY = `http://${META_HOST}/v1`;

/**
 * Meta's list prices in cents per million tokens (dev.meta.ai, 2026-10-26).
 * Muse Code asks Spark for small side tasks (reminders) as it works.
 */
const museRates: Record<string, TokenRates> = {
  "muse-wonder-1.0": {
    inputCentsPerMTok: 400,
    cachedInputCentsPerMTok: 20,
    outputCentsPerMTok: 2_000,
    sandboxCentsPerSession: 0,
  },
  "muse-spark-1.3": {
    inputCentsPerMTok: 125,
    cachedInputCentsPerMTok: 15,
    outputCentsPerMTok: 425,
    sandboxCentsPerSession: 0,
  },
};

/**
 * The platform names a machine after its id, 64 characters, one more than
 * Python takes: http.server and what is built on it crash at once. A short
 * name needs DNS to resolve, which the machines do not have; localhost does
 * not. Failing leaves the machine as it was, the rest of it unharmed.
 */
export const MACHINE_NAME = "hostname localhost";

/** The container's instance type: 2 vCPU, 8 GiB, 16 GB of disk. */
export const MUSE_INSTANCE = "standard-3";

/**
 * What that container costs a second, in cents, its CPU counted busy
 * throughout (developers.cloudflare.com/containers/pricing, 2026-10-26:
 * $0.0000025 per GiB-second, $0.000020 per vCPU-second, $0.00000007 per
 * GB-second of disk).
 */
const CONTAINER_CENTS_PER_SECOND =
  (8 * 0.000_002_5 + 2 * 0.000_02 + 16 * 0.000_000_07) * 100;

/** One model call's tokens, as Meta reports them when the answer completes. */
export interface MetaCall {
  model: string;
  input: number;
  cached: number;
  output: number;
}

export interface MuseUsage {
  model: string;
  effort: string;
  /** Tokens per model over the session's calls. */
  models: Record<string, Omit<MetaCall, "model"> & { calls: number }>;
  /** How long the agent worked, over its turns. */
  agentSeconds: number;
  /** How long the container ran. */
  containerSeconds: number;
}

/**
 * The usage of each completed answer in a Meta response body: a stream's
 * `response.completed` event, or a whole answer's `usage`. Input counts the
 * cached tokens, output the reasoning ones.
 */
export function metaUsage(body: string): MetaCall[] {
  const answers: { model?: string; usage?: Record<string, unknown> }[] = [];
  if (body.trimStart().startsWith("{")) {
    try {
      answers.push(JSON.parse(body));
    } catch {
      // Not an answer.
    }
  } else
    for (const line of body.split("\n")) {
      if (!line.startsWith("data:") || !line.includes("response.completed"))
        continue;
      try {
        const event = JSON.parse(line.slice(5));
        if (event.type === "response.completed") answers.push(event.response);
      } catch {
        // A line cut short: nothing to count.
      }
    }
  return answers.flatMap((answer) => {
    const usage = answer?.usage as
      | {
          input_tokens?: number;
          output_tokens?: number;
          input_tokens_details?: { cached_tokens?: number };
        }
      | undefined;
    if (!usage || typeof answer.model !== "string") return [];
    return [
      {
        model: answer.model,
        input: usage.input_tokens ?? 0,
        cached: usage.input_tokens_details?.cached_tokens ?? 0,
        output: usage.output_tokens ?? 0,
      },
    ];
  });
}

/** Adds calls to a session's totals. */
export function addCalls(
  models: MuseUsage["models"],
  calls: MetaCall[],
): MuseUsage["models"] {
  const next = { ...models };
  for (const { model, ...tokens } of calls) {
    const total = next[model] ?? { input: 0, cached: 0, output: 0, calls: 0 };
    next[model] = {
      input: total.input + tokens.input,
      cached: total.cached + tokens.cached,
      output: total.output + tokens.output,
      calls: total.calls + 1,
    };
  }
  return next;
}

/**
 * List-price cost of a session: each model's tokens at its rates (a model
 * not listed at Wonder's), and the container's time.
 */
export function museCostCents(usage: MuseUsage): number {
  let cents = Math.ceil(usage.containerSeconds * CONTAINER_CENTS_PER_SECOND);
  for (const [model, tokens] of Object.entries(usage.models))
    cents += usageCostCents(
      [
        {
          input_tokens: tokens.input,
          output_tokens: tokens.output,
          input_tokens_details: { cached_tokens: tokens.cached },
        },
      ],
      museRates[model] ?? museRates[MUSE_MODEL]!,
    );
  return cents;
}

/** One turn of Muse Code: headless, its events as JSON lines. */
export function museCommand(input: {
  model: string;
  effort: string;
  /** Muse's own session id: the same one resumes the conversation. */
  session: string;
  promptFile: string;
}): string[] {
  return [
    "muse",
    "exec",
    "--json",
    "--model",
    input.model,
    "--reasoning-effort",
    input.effort,
    // Never share a project's code with Meta's contributor program.
    "--contributor-mode",
    "off",
    // The container is the sandbox: approvals would wait for nobody.
    "--yolo",
    "--disable-web-tools",
    "--disable-request-user-input",
    "--base-url",
    META_RELAY,
    "--session-id",
    input.session,
    "--prompt-file",
    input.promptFile,
  ];
}

/**
 * The feed lines of one turn's log, where each event follows the time, in
 * milliseconds, it came out. Only the events that make a line are parsed:
 * a log carries every file the agent read.
 */
export function museActivity(log: string, turn: number): ActivityLine[] {
  const lines: ActivityLine[] = [];
  for (const row of log.split("\n")) {
    if (
      !row.includes('"payload_type":"tool.result"') &&
      !row.includes('"payload_type":"run.terminal.')
    )
      continue;
    const space = row.indexOf(" ");
    const at = Number(row.slice(0, space));
    let event: MuseEvent;
    try {
      event = JSON.parse(row.slice(space + 1));
    } catch {
      continue;
    }
    const line = activityFromMuseEvent(
      event,
      new Date(Number.isFinite(at) ? at : Date.now()).toISOString(),
      turn,
    );
    if (line) lines.push(line);
  }
  return lines;
}

/** Why a turn failed, in Muse's words, from its log. */
export function museFailure(log: string): string | null {
  let reason: string | null = null;
  for (const row of log.split("\n")) {
    if (!row.includes('"payload_type":"run.terminal.failed"')) continue;
    try {
      const event = JSON.parse(row.slice(row.indexOf(" ") + 1)) as MuseEvent;
      reason = event.payload?.reason || event.payload?.text || reason;
    } catch {
      // Cut short.
    }
  }
  return reason;
}

/**
 * Hosts the container may reach: the package registries (Claude's sandbox
 * allows them on its own) and what every implementer sandbox reaches
 * (SANDBOX_HOSTS). Meta and GitHub are handled apart, with their keys.
 */
export const PACKAGE_HOSTS = [
  "registry.npmjs.org",
  "registry.yarnpkg.com",
  "registry.npmmirror.com",
  "bun.sh",
  "pypi.org",
  "files.pythonhosted.org",
  "deb.debian.org",
  "security.debian.org",
  // The image's PostgreSQL 16 comes from there: apt-get update reads it too.
  "apt.postgresql.org",
  "crates.io",
  "index.crates.io",
  "static.crates.io",
  "static.rust-lang.org",
  "sh.rustup.rs",
  "rubygems.org",
  "index.rubygems.org",
  "repo.maven.apache.org",
  "repo1.maven.org",
  "plugins.gradle.org",
  "services.gradle.org",
  "repo.packagist.org",
  "packagist.org",
  "codeload.github.com",
  "pkg.go.dev",
  "golang.org",
];

/** The container's work, as the pipeline drives it (workers/muse.ts). */
export interface MuseStart {
  /** owner/name on GitHub. */
  repository: string;
  branch: string;
  /** A read-only token: the Worker adds it to GitHub requests, never the container. */
  token: string;
  model: string;
  effort: string;
  /** The first turn: Yarrow's implementer rules, then the task. */
  prompt: string;
  /** Written before the agent starts (the recorder). */
  files: { path: string; content: string }[];
}

export interface MuseState {
  state: "working" | "done" | "failed";
  error: string | null;
}

export interface MuseClient {
  /** Starts the container and the first turn. Again on the same run: nothing new. */
  start(sessionId: string, spec: MuseStart): Promise<void>;
  /** The next turn of the same conversation. */
  send(sessionId: string, prompt: string): Promise<void>;
  state(sessionId: string): Promise<MuseState>;
  /** The files under the session's outputs, oldest first; an id is a path. */
  listFiles(sessionId: string): Promise<SessionFile[]>;
  download(sessionId: string, fileId: string): Promise<Uint8Array>;
  /** The feed lines of the turns still under way at `after` (ISO), or of all. */
  activity(sessionId: string, after: string | null): Promise<ActivityLine[]>;
  usage(sessionId: string): Promise<MuseUsage>;
  /** Stops the container; what it cost stays readable. */
  release(sessionId: string): Promise<void>;
}
