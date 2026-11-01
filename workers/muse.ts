import { Files, SandboxFileError } from "@cloudflare/sandbox";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import type { ActivityLine } from "../src/core/activity";
import { SANDBOX_HOSTS, type SessionFile } from "../src/runner/anthropic";
import {
  addCalls,
  META_HOST,
  metaUsage,
  museActivity,
  museCommand,
  museFailure,
  MUSE_INSTANCE,
  PACKAGE_HOSTS,
  type MetaCall,
  type MuseClient,
  type MuseStart,
  type MuseState,
  type MuseUsage,
} from "../src/runner/muse";

/**
 * The Meta implementer's machine: one container per run, where Muse Code
 * works on the repository like Claude does in its Managed Agents sandbox
 * (same paths, same rules, same outputs). The container has no Internet of
 * its own: every request goes through MuseOutbound, which adds the Meta key
 * and the GitHub token and lets through only the hosts a build needs.
 */

export interface MuseEnv {
  MUSE: DurableObjectNamespace<MuseSandbox>;
  META_API_KEY?: string;
}

const REPO = "/workspace/repo";
const OUTPUTS = "/mnt/session/outputs";
/** Each turn's prompt, log, pid and exit, apart from the repository and the outputs. */
const TASK = "/var/yarrow";
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
/** Between turns (the review), the container waits this long for the next. */
const IDLE_MS = 90 * 60_000;
/** Requests keep a container awake, a running process does not: a check a minute. */
const CHECK_MS = 60_000;

/** exec gets none of the image's environment: every command gets this. */
const BASE_ENV = {
  HOME: "/root",
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  LANG: "C.UTF-8",
  // HTTPS goes through the Worker, which signs with Cloudflare's authority.
  NODE_EXTRA_CA_CERTS: CA,
  GIT_SSL_CAINFO: CA,
  CURL_CA_BUNDLE: CA,
  SSL_CERT_FILE: CA,
  REQUESTS_CA_BUNDLE: CA,
  PIP_CERT: CA,
  // The image's Chromium (muse/Dockerfile), where Claude's sandbox keeps its own.
  PLAYWRIGHT_BROWSERS_PATH: "/opt/pw-browsers",
};

const MUSE_ENV = {
  MUSE_NO_AUTO_UPDATE: "1",
  // Muse Code wants a key to start; the Worker puts the real one on the way.
  META_API_KEY: "yarrow-relay",
};

/**
 * One turn in the background, so the agent outlives the request that
 * started it: its events go to a file, each after the time it came out, and
 * its exit code with the time it ended.
 */
const TURN_SCRIPT = `n=$1; shift
set -o pipefail
"$@" < /dev/null 2> ${TASK}/stderr-$n | while IFS= read -r line || [ -n "$line" ]; do
  t=\${EPOCHREALTIME//[.,]/}; printf '%s %s\\n' "\${t:0:13}" "$line"
done > ${TASK}/events-$n.log
code=$?
t=\${EPOCHREALTIME//[.,]/}
printf '%s %s\\n' "$code" "\${t:0:13}" > ${TASK}/exit-$n.tmp && mv ${TASK}/exit-$n.tmp ${TASK}/exit-$n`;

interface Spec {
  /** Muse Code's session: the same id resumes the conversation. */
  session: string;
  model: string;
  effort: string;
}

interface OutboundProps {
  sandbox: string;
  token: string;
}

type MuseExports = {
  MuseOutbound(options: { props: OutboundProps }): Fetcher;
};

export class MuseSandbox extends DurableObject<MuseEnv> {
  readonly #container: Container;
  readonly #files: Files;

  constructor(ctx: DurableObjectState, env: MuseEnv) {
    super(ctx, env);
    if (!ctx.container) throw new Error("MuseSandbox has no container");
    this.#container = ctx.container;
    this.#files = new Files(this.#container);
    // Each instance sets its own timeout: it is not inherited.
    if (this.#container.running)
      void ctx.blockConcurrencyWhile(() =>
        this.#container.setInactivityTimeout(IDLE_MS),
      );
  }

  get #kv() {
    return this.ctx.storage.kv;
  }

  async start(spec: MuseStart): Promise<void> {
    // A retried start finds its first turn under way.
    if (this.#kv.get("turn") !== undefined && this.#container.running) return;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    if (this.#container.running) await this.#container.destroy();
    this.#kv.put<Spec>("spec", {
      session: crypto.randomUUID(),
      model: spec.model,
      effort: spec.effort,
    });
    this.#container.start({
      image: this.#container.images.muse!,
      instance: MUSE_INSTANCE,
      enableInternet: false,
      labels: { yarrow: "implementer" },
    });
    this.#kv.put("startedAt", Date.now());
    // The token lives in the Worker's props, never in the container.
    const outbound = (this.ctx.exports as unknown as MuseExports).MuseOutbound({
      props: { sandbox: this.ctx.id.toString(), token: spec.token },
    });
    // Intercepts last for this container run.
    await this.#container.interceptAllOutboundHttp(outbound);
    await this.#container.interceptOutboundHttps("*", outbound);
    await this.#container.setInactivityTimeout(IDLE_MS);
    // Tools that ignore the variables above trust the system's store.
    await this.#must(
      [
        "/bin/sh",
        "-c",
        `cp ${CA} /usr/local/share/ca-certificates/cloudflare-containers.crt && update-ca-certificates >/dev/null`,
      ],
      "/",
    );
    // Blobs come on demand: the history is there, the download stays small.
    await this.#must(
      [
        "git",
        "clone",
        "--filter=blob:none",
        "--branch",
        spec.branch,
        "--",
        `https://github.com/${spec.repository}.git`,
        REPO,
      ],
      "/",
    );
    await this.#files.mkdir(OUTPUTS, { recursive: true });
    await this.#files.mkdir(TASK, { recursive: true });
    for (const file of spec.files) {
      await this.#files.mkdir(file.path.slice(0, file.path.lastIndexOf("/")), {
        recursive: true,
      });
      await this.#files.writeFile(file.path, file.content);
    }
    await this.#turn(spec.prompt);
  }

  async send(prompt: string): Promise<void> {
    // A retried send finds its turn under way.
    if (this.#kv.get("prompt") === prompt) return;
    if (!this.#container.running)
      throw new Error("The Meta sandbox stopped: its conversation is gone");
    if ((await this.state()).state === "working")
      throw new Error("The Meta implementer is still working");
    await this.#turn(prompt);
  }

  async state(): Promise<MuseState> {
    const turn = this.#kv.get<number>("turn");
    if (turn === undefined)
      return { state: "failed", error: "The Meta implementer never started" };
    if (!this.#container.running)
      return {
        state: "failed",
        error: "The Meta sandbox stopped before the implementer finished",
      };
    let exit = await this.#text(`${TASK}/exit-${turn}`);
    if (exit === undefined) {
      const pid = await this.#text(`${TASK}/pid-${turn}`);
      // kill is a shell builtin; slim images have no kill binary.
      const alive =
        pid !== undefined &&
        (
          await this.#run(
            ["/bin/sh", "-c", 'kill -0 "$1"', "probe", pid.trim()],
            "/",
          )
        ).exitCode === 0;
      if (alive) return { state: "working", error: null };
      // The turn can end between the two reads: its exit comes first.
      exit = await this.#text(`${TASK}/exit-${turn}`);
      if (exit === undefined)
        return { state: "failed", error: "Muse Code stopped without a word" };
    }
    const [code, ended] = exit.trim().split(" ").map(Number);
    if (this.#kv.get(`ended-${turn}`) === undefined)
      this.#kv.put(`ended-${turn}`, ended || Date.now());
    const failure = museFailure(
      (await this.#text(`${TASK}/events-${turn}.log`)) ?? "",
    );
    if (code === 0 && !failure) return { state: "done", error: null };
    const stderr = ((await this.#text(`${TASK}/stderr-${turn}`)) ?? "")
      .split("\n")
      .filter((line) => line.trim() && !line.startsWith("muse: workspace"))
      .slice(-5)
      .join("\n");
    return {
      state: "failed",
      error: failure ?? (stderr || `Muse Code exited with ${code}`),
    };
  }

  /** The outputs, oldest first, each named by its path under the outputs. */
  async listFiles(): Promise<SessionFile[]> {
    if (!this.#container.running) return [];
    const { stdout } = await this.#run(
      ["find", OUTPUTS, "-type", "f", "-printf", "%T@ %s %P\\n"],
      "/",
    );
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((row) => {
        const [time, size, ...name] = row.split(" ");
        const filename = name.join(" ");
        return {
          time: Number(time),
          file: {
            id: `${OUTPUTS}/${filename}`,
            filename,
            size_bytes: Number(size),
          },
        };
      })
      .sort((a, b) => a.time - b.time)
      .map(({ file }) => file);
  }

  async download(path: string): Promise<Uint8Array> {
    if (!path.startsWith(`${OUTPUTS}/`) || path.includes("/../"))
      throw new Error(`Not an output: ${path}`);
    const file = await this.#files.readFile(path);
    return new Uint8Array(await file.arrayBuffer());
  }

  async activity(after: string | null): Promise<ActivityLine[]> {
    if (!this.#container.running) return [];
    const since = after ? Date.parse(after) : 0;
    const lines: ActivityLine[] = [];
    const turns = this.#kv.get<number>("turn") ?? 0;
    for (let turn = 1; turn <= turns; turn++) {
      // A turn over before `after` has nothing new.
      if ((this.#kv.get<number>(`ended-${turn}`) ?? Infinity) < since) continue;
      const log = await this.#text(`${TASK}/events-${turn}.log`);
      if (log) lines.push(...museActivity(log, turn));
    }
    return lines;
  }

  usage(): MuseUsage {
    const spec = this.#kv.get<Spec>("spec");
    const stopped = this.#kv.get<number>("releasedAt") ?? Date.now();
    const started = this.#kv.get<number>("startedAt");
    let agentMs = 0;
    const turns = this.#kv.get<number>("turn") ?? 0;
    for (let turn = 1; turn <= turns; turn++) {
      const from = this.#kv.get<number>(`started-${turn}`);
      if (from === undefined) continue;
      agentMs += (this.#kv.get<number>(`ended-${turn}`) ?? stopped) - from;
    }
    return {
      model: spec?.model ?? "",
      effort: spec?.effort ?? "",
      models: this.#kv.get<MuseUsage["models"]>("usage") ?? {},
      agentSeconds: Math.max(0, agentMs / 1000),
      containerSeconds:
        started === undefined ? 0 : Math.max(0, (stopped - started) / 1000),
    };
  }

  /** Meta's answers, counted by MuseOutbound as they complete. */
  addUsage(calls: MetaCall[]): void {
    this.#kv.put(
      "usage",
      addCalls(this.#kv.get<MuseUsage["models"]>("usage") ?? {}, calls),
    );
  }

  async release(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    if (this.#kv.get("releasedAt") === undefined)
      this.#kv.put("releasedAt", Date.now());
    if (this.#container.running) await this.#container.destroy();
  }

  async alarm(): Promise<void> {
    if (!this.#container.running) return;
    if ((await this.state()).state === "working")
      await this.ctx.storage.setAlarm(Date.now() + CHECK_MS);
  }

  async #turn(prompt: string): Promise<void> {
    const spec = this.#kv.get<Spec>("spec")!;
    const turn = (this.#kv.get<number>("turn") ?? 0) + 1;
    const promptFile = `${TASK}/prompt-${turn}.md`;
    await this.#files.writeFile(promptFile, prompt);
    const task = await this.#container.exec(
      [
        "/bin/bash",
        "-c",
        TURN_SCRIPT,
        "turn",
        String(turn),
        ...museCommand({ ...spec, promptFile }),
      ],
      {
        cwd: REPO,
        env: { ...BASE_ENV, ...MUSE_ENV },
        stdout: "ignore",
        stderr: "ignore",
      },
    );
    await this.#files.writeFile(`${TASK}/pid-${turn}`, String(task.pid));
    this.#kv.put(`started-${turn}`, Date.now());
    this.#kv.put("turn", turn);
    this.#kv.put("prompt", prompt);
    await this.ctx.storage.setAlarm(Date.now() + CHECK_MS);
  }

  async #text(path: string): Promise<string | undefined> {
    try {
      return await (await this.#files.readFile(path)).text();
    } catch (cause) {
      if (SandboxFileError.is(cause) && cause.code === "ENOENT")
        return undefined;
      throw cause;
    }
  }

  async #run(command: string[], cwd: string) {
    const process = await this.#container.exec(command, {
      cwd,
      env: BASE_ENV,
    });
    const output = await process.output();
    const decoder = new TextDecoder();
    return {
      exitCode: output.exitCode,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  }

  async #must(command: string[], cwd: string): Promise<void> {
    const result = await this.#run(command, cwd);
    if (result.exitCode !== 0)
      throw new Error(
        `${command[0]} failed (${result.exitCode}): ${result.stderr.slice(-500)}`,
      );
  }
}

const ALLOWED_HOSTS = new Set([...SANDBOX_HOSTS, ...PACKAGE_HOSTS]);

const refuse = (text: string, status = 403) =>
  new Response(`${text}\n`, { status });

/**
 * Every request the container makes, plain or HTTPS. Meta's get the key
 * and are metered; GitHub's get the run's read-only token; the hosts a
 * build needs pass as they are; the rest is refused.
 */
export class MuseOutbound extends WorkerEntrypoint<MuseEnv, OutboundProps> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.hostname === META_HOST) return this.#meta(request, url);
    if (!ALLOWED_HOSTS.has(url.hostname))
      return refuse(`${url.hostname} is not reachable from this sandbox`);
    if (url.hostname !== "github.com") return fetch(request);
    // A token added to plain HTTP would cross the Internet in the clear.
    if (url.protocol !== "https:")
      return refuse("github.com is reachable only over HTTPS");
    const headers = new Headers(request.headers);
    headers.set(
      "authorization",
      `Basic ${btoa(`x-access-token:${this.ctx.props.token}`)}`,
    );
    return fetch(new Request(request, { headers }));
  }

  async #meta(request: Request, url: URL): Promise<Response> {
    const key = this.env.META_API_KEY;
    if (!key) return refuse("Meta is not configured here", 503);
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${key}`);
    const answer = await fetch(
      `https://${META_HOST}${url.pathname}${url.search}`,
      { method: request.method, headers, body: request.body },
    );
    if (request.method !== "POST" || !answer.body) return answer;
    // Each answer's tokens reach the run's meter once it completes.
    const [mine, theirs] = answer.body.tee();
    this.ctx.waitUntil(
      this.#meter(mine).catch((error: Error) =>
        console.warn("meta meter:", error.message),
      ),
    );
    return new Response(theirs, answer);
  }

  async #meter(body: ReadableStream): Promise<void> {
    const calls = metaUsage(await new Response(body).text());
    if (calls.length === 0) return;
    const { MUSE } = this.env;
    await MUSE.get(MUSE.idFromString(this.ctx.props.sandbox)).addUsage(calls);
  }
}

/** The pipeline's handle on the containers: one per session, named after it. */
export function museClient(
  namespace: DurableObjectNamespace<MuseSandbox>,
): MuseClient {
  const sandbox = (sessionId: string) => namespace.getByName(sessionId);
  return {
    start: (id, spec) => sandbox(id).start(spec),
    send: (id, prompt) => sandbox(id).send(prompt),
    state: (id) => sandbox(id).state(),
    listFiles: (id) => sandbox(id).listFiles(),
    download: (id, fileId) => sandbox(id).download(fileId),
    activity: (id, after) => sandbox(id).activity(after),
    usage: (id) => sandbox(id).usage(),
    release: (id) => sandbox(id).release(),
  };
}
