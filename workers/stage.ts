import { Files, SandboxFileError } from "@cloudflare/sandbox";
import { DurableObject } from "cloudflare:workers";
import {
  stageLog,
  stageScript,
  type StageCue,
  type StageCueResult,
  type StageEvent,
  type StageHand,
  type StageSpec,
  type StageStatus,
} from "../src/core/stage";
import { MUSE_INSTANCE } from "../src/runner/muse";
import { RECORDER_PATH } from "../src/runner/presentation";
import type { TalkContext } from "../src/runner/talk";

/**
 * A pull request's stage (src/core/stage.ts): one container per work unit,
 * the app of its branch running on the recorder's desktop, the screen
 * served over VNC behind websockify, which the page's WebSocket reaches here. The first boot
 * clones and runs the recipe, then keeps a snapshot of the files; the next
 * ones start from it and run only the restart steps. Like the Meta
 * implementer's machine, it has no Internet of its own (MuseOutbound).
 */

export interface StageEnv {
  STAGE: DurableObjectNamespace<Stage>;
}

const REPO = "/workspace/repo";
/** The app as it was: a worktree of the base branch. */
const BEFORE = "/tmp/before";
const TASK = "/var/yarrow";
const BOOT_LOG = `${TASK}/stage-marks.log`;
const BOOT_OUTPUT = `${TASK}/stage-boot.log`;
const DESKTOP_LOG = `${TASK}/stage-desktop.log`;
const DESKTOP_EXIT = `${TASK}/stage-desktop.exit`;
const READY = `${TASK}/stage-ready.json`;
const CA = "/etc/cloudflare/certs/cloudflare-containers-ca.crt";
/** The screen, as a WebSocket (websockify in front of x11vnc). */
const SCREEN = 6080;
/** The recorder's presenter, which plays the presentation live. */
const PRESENTER = 7070;
/** Nobody watching for this long: the stage sleeps (its snapshot stays). */
const IDLE_MS = 15 * 60_000;
/** While booting, the machine is looked at this often. */
const TICK_MS = 1_000;

/** The same environment as the Meta implementer's commands (workers/muse.ts). */
const BASE_ENV = {
  HOME: "/root",
  PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
  LANG: "C.UTF-8",
  NODE_EXTRA_CA_CERTS: CA,
  GIT_SSL_CAINFO: CA,
  CURL_CA_BUNDLE: CA,
  SSL_CERT_FILE: CA,
  REQUESTS_CA_BUNDLE: CA,
  PIP_CERT: CA,
  PLAYWRIGHT_BROWSERS_PATH: "/opt/pw-browsers",
};

type Step = "starting" | "boot" | "desktop" | "ready" | "failed";

interface Saved {
  /** Date.now() when the stage was asked for. */
  asked: number;
  step: Step;
  warm: boolean;
  events: StageEvent[];
  error: string | null;
  /** Brought up only to keep its snapshot, then put to sleep. */
  prepare?: boolean;
}

type OutboundExports = {
  MuseOutbound(options: { props: { sandbox: string; token: string } }): Fetcher;
};

export class Stage extends DurableObject<StageEnv> {
  readonly #container: Container;
  readonly #files: Files;
  #busy: Promise<void> | null = null;

  constructor(ctx: DurableObjectState, env: StageEnv) {
    super(ctx, env);
    if (!ctx.container) throw new Error("Stage has no container");
    this.#container = ctx.container;
    this.#files = new Files(this.#container);
    if (this.#container.running)
      void ctx.blockConcurrencyWhile(() =>
        this.#container.setInactivityTimeout(IDLE_MS),
      );
  }

  get #kv() {
    return this.ctx.storage.kv;
  }

  /**
   * Brings the stage up; already up or coming, nothing new. Answers at
   * once: the machine comes up in the background (the alarm).
   */
  async open(spec: StageSpec, fresh = false): Promise<StageStatus> {
    const saved = this.#kv.get<Saved>("saved");
    if (!fresh && this.#container.running && saved && saved.step !== "failed") {
      // Being prepared: someone is watching now, it stays up.
      if (saved.prepare) this.#save({ ...saved, prepare: false });
      return this.status();
    }
    await this.ctx.storage.deleteAlarm();
    if (this.#container.running) await this.#container.destroy();
    if (fresh) this.#kv.delete("snapshot");
    this.#kv.put("spec", spec);
    await this.#start(Date.now());
    return this.status();
  }

  /**
   * A new version of the pull request: a fresh boot in the background,
   * kept as the snapshot the next viewer starts from, then asleep.
   */
  async prepare(spec: StageSpec): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    if (this.#container.running) await this.#container.destroy();
    this.#kv.delete("snapshot");
    this.#kv.put("spec", spec);
    await this.#start(Date.now(), true);
  }

  async #start(asked: number, prepare = false): Promise<void> {
    const snapshot = this.#kv.get<ContainerSnapshot>("snapshot");
    this.#save({
      asked,
      step: "starting",
      warm: Boolean(snapshot),
      events: [],
      error: null,
      prepare,
    });
    this.#mark(snapshot ? "start from the snapshot" : "start from the image");
    const common = {
      instance: MUSE_INSTANCE,
      enableInternet: false,
      labels: { yarrow: "stage" },
    } as const;
    this.#container.start(
      snapshot
        ? { ...common, containerSnapshot: { id: snapshot.id } }
        : { ...common, image: this.#container.images.stage! },
    );
    // The rest waits for the machine: the alarm does it.
    await this.ctx.storage.setAlarm(Date.now());
  }

  /** The machine answers: the recipe (or its restart) runs in the background. */
  async #boot(saved: Saved): Promise<void> {
    const spec = this.#kv.get<StageSpec>("spec")!;
    try {
      // Nothing leaves the machine before these: the boot starts after.
      const outbound = (
        this.ctx.exports as unknown as OutboundExports
      ).MuseOutbound({
        props: { sandbox: this.ctx.id.toString(), token: spec.token },
      });
      await this.#container.interceptAllOutboundHttp(outbound);
      await this.#container.interceptOutboundHttps("*", outbound);
      await this.#container.setInactivityTimeout(IDLE_MS);
      await this.#must([
        "/bin/sh",
        "-c",
        `cp ${CA} /usr/local/share/ca-certificates/cloudflare-containers.crt && update-ca-certificates >/dev/null && mkdir -p ${TASK} && rm -f ${BOOT_LOG} ${READY} ${DESKTOP_EXIT}`,
      ]);
    } catch (error) {
      if (!saved.warm) throw error;
      // A snapshot of an older image does not start: a fresh boot instead.
      this.#kv.delete("snapshot");
      if (this.#container.running) await this.#container.destroy();
      await this.#start(saved.asked, saved.prepare);
      return;
    }
    this.#save({ ...saved, step: "boot" });
    this.#mark("machine up");
    const script = stageScript({
      log: BOOT_LOG,
      output: BOOT_OUTPUT,
      dir: REPO,
      steps: saved.warm ? spec.restart : spec.steps,
      url: `${spec.url}${spec.path}`,
      clone: saved.warm
        ? undefined
        : { repository: spec.repository, branch: spec.branch },
      before: spec.before
        ? {
            dir: BEFORE,
            base: spec.base,
            steps: saved.warm ? spec.before.restart : spec.before.steps,
            url: spec.before.url,
          }
        : undefined,
    });
    await this.#files.writeFile(`${TASK}/stage-boot.sh`, script);
    await this.#background(`bash ${TASK}/stage-boot.sh`);
  }

  /** Where the stage stands; never waits for the machine. */
  async status(): Promise<StageStatus> {
    void this.#advance().catch(() => {});
    const saved = this.#kv.get<Saved>("saved");
    const live = Boolean(this.#kv.get<StageSpec>("spec")?.script);
    if (!saved)
      return { phase: "off", warm: false, events: [], error: null, live };
    const phase =
      saved.step === "failed"
        ? "failed"
        : saved.step === "ready"
          ? this.#container.running
            ? "ready"
            : "off"
          : this.#container.running || saved.step === "starting"
            ? "booting"
            : "failed";
    return {
      phase,
      warm: saved.warm,
      events: saved.events,
      error:
        phase === "failed" && !saved.error
          ? "The stage's machine stopped."
          : saved.error,
      live,
    };
  }

  /**
   * What the agent the member talks to knows of the pull request, kept for
   * the call (src/runner/talk.ts): each turn reads it instead of the database,
   * GitHub and the presentation again.
   */
  setTalk(context: TalkContext): void {
    this.#kv.put("talk", context);
  }

  talk(): TalkContext | null {
    return this.#kv.get<TalkContext>("talk") ?? null;
  }

  /** The page's cue to the presenter, or the agent's move; answered once done. */
  async present(cue: StageCue | StageHand): Promise<StageCueResult> {
    if (
      !this.#container.running ||
      this.#kv.get<Saved>("saved")?.step !== "ready"
    )
      return { ok: false, problems: ["The stage is not up."] };
    const response = await this.#container.getTcpPort(PRESENTER).fetch(
      new Request(`http://stage/${cue.action}`, {
        method: "POST",
        body: JSON.stringify(cue),
      }),
    );
    if (!response.ok)
      return {
        ok: false,
        problems: [`The presenter answered ${response.status}.`],
      };
    return response.json<StageCueResult>();
  }

  async close(): Promise<void> {
    await this.ctx.storage.deleteAlarm();
    if (this.#container.running) await this.#container.destroy();
    this.#kv.delete("saved");
  }

  async alarm(): Promise<void> {
    try {
      await this.#advance();
    } catch (error) {
      const saved = this.#kv.get<Saved>("saved");
      if (saved)
        this.#save({
          ...saved,
          step: "failed",
          error: (error as Error).message,
        });
    }
    const step = this.#kv.get<Saved>("saved")?.step;
    if (step === "starting" || step === "boot" || step === "desktop")
      await this.ctx.storage.setAlarm(Date.now() + TICK_MS);
  }

  /** The page's viewer: its WebSocket, to the screen's VNC over websockify. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("A WebSocket only\n", { status: 426 });
    if (
      !this.#container.running ||
      this.#kv.get<Saved>("saved")?.step !== "ready"
    )
      return new Response("The stage is not up\n", { status: 409 });
    // websockify in the machine speaks WebSocket: the upgrade goes through as it is.
    // Plain HTTP: the machine's port speaks no TLS.
    const { pathname } = new URL(request.url);
    return this.#container
      .getTcpPort(SCREEN)
      .fetch(new Request(`http://stage${pathname}`, request));
  }

  /** One look at the machine, one move at a time. */
  async #advance(): Promise<void> {
    if (this.#busy) return this.#busy;
    this.#busy = this.#step().finally(() => {
      this.#busy = null;
    });
    return this.#busy;
  }

  async #step(): Promise<void> {
    const saved = this.#kv.get<Saved>("saved");
    if (!saved) return;
    if (saved.step === "starting") return this.#boot(saved);
    if (!this.#container.running) return;
    if (saved.step === "boot") {
      const marks = stageLog((await this.#text(BOOT_LOG)) ?? "");
      const known = new Set(saved.events.map((event) => event.label));
      for (const mark of marks)
        if (!known.has(mark.label))
          saved.events.push({ ms: mark.at - saved.asked, label: mark.label });
      const failed = marks.find((mark) => mark.label.startsWith("failed"));
      if (failed) {
        const output = ((await this.#text(BOOT_OUTPUT)) ?? "")
          .trim()
          .split("\n")
          .slice(-8)
          .join("\n");
        this.#save({
          ...saved,
          step: "failed",
          error: `${failed.label}\n${output}`,
        });
        return;
      }
      if (!marks.some((mark) => mark.label === "served")) {
        this.#save(saved);
        return;
      }
      if (saved.prepare) {
        this.#save(saved);
        await this.#keep();
        this.#save({ ...this.#kv.get<Saved>("saved")!, step: "ready" });
        await this.#container.destroy();
        return;
      }
      const spec = this.#kv.get<StageSpec>("spec")!;
      await this.#files.mkdir(
        RECORDER_PATH.slice(0, RECORDER_PATH.lastIndexOf("/")),
        {
          recursive: true,
        },
      );
      await this.#files.writeFile(RECORDER_PATH, spec.recorder);
      await this.#files.writeFile(
        `${TASK}/stage.json`,
        JSON.stringify({
          url: spec.url,
          path: spec.path,
          signIn: spec.signIn,
          script: spec.script,
          ready: READY,
        }),
      );
      // The stage never ends on its own: an exit code is a failure.
      await this.#background(
        `cd ${REPO} && node ${RECORDER_PATH} ${TASK}/stage.json --stage >> ${DESKTOP_LOG} 2>&1; echo $? > ${DESKTOP_EXIT}`,
      );
      this.#save({ ...saved, step: "desktop" });
      this.#mark("desktop starting");
      // The files as they are now, for the next boot, while the desktop starts.
      if (!saved.warm && !this.#kv.get("snapshot")) void this.#keep();
      return;
    }
    if (saved.step === "desktop") {
      if ((await this.#text(READY)) !== undefined) {
        this.#mark("ready");
        this.#save({ ...this.#kv.get<Saved>("saved")!, step: "ready" });
        return;
      }
      if ((await this.#text(DESKTOP_EXIT)) !== undefined) {
        const output = (await this.#text(DESKTOP_LOG)) ?? "";
        this.#save({
          ...this.#kv.get<Saved>("saved")!,
          step: "failed",
          error: output.trim().split("\n").slice(-8).join("\n"),
        });
      }
    }
  }

  async #keep(): Promise<void> {
    this.#mark("snapshot");
    try {
      const snapshot = await this.#container.snapshotContainer({
        name: `stage-${this.ctx.id.toString().slice(0, 12)}`,
      });
      this.#kv.put("snapshot", snapshot);
      this.#mark(`snapshot kept (${Math.round(snapshot.size / 1e6)} MB)`);
    } catch (error) {
      this.#mark(`snapshot failed: ${(error as Error).message}`);
    }
  }

  #save(saved: Saved): void {
    this.#kv.put("saved", saved);
  }

  #mark(label: string): void {
    const saved = this.#kv.get<Saved>("saved");
    if (!saved) return;
    saved.events.push({ ms: Date.now() - saved.asked, label });
    this.#save(saved);
  }

  async #background(command: string): Promise<void> {
    await this.#container.exec(["/bin/bash", "-c", command], {
      cwd: "/",
      env: BASE_ENV,
      stdout: "ignore",
      stderr: "ignore",
    });
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

  async #must(command: string[]): Promise<void> {
    const process = await this.#container.exec(command, {
      cwd: "/",
      env: BASE_ENV,
    });
    const output = await process.output();
    if (output.exitCode !== 0)
      throw new Error(
        `${command[0]} failed (${output.exitCode}): ${new TextDecoder()
          .decode(output.stderr)
          .slice(-500)}`,
      );
  }
}
