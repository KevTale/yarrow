import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import type {
  Presentation,
  PresentationChapter,
} from "../../src/core/presentation";
import {
  restartSteps,
  stageAddress,
  stageLog,
  stagePlan,
  stageScript,
  stageSignIn,
  STALE_LOCKS,
} from "../../src/core/stage";
import { stageNote } from "../../src/runner/stage-tools";

const bash = promisify(execFile);

// The bench app's recipe, as its implementer wrote it on dev (2026-10-27).
const BENCH = [
  "mkdir -p /tmp/pg && chown postgres:postgres /tmp/pg",
  'su postgres -c "/usr/lib/postgresql/16/bin/initdb -D /tmp/pg/data -U postgres --auth=trust"',
  "su postgres -c \"/usr/lib/postgresql/16/bin/pg_ctl -D /tmp/pg/data -l /tmp/pg/log -o '-k /tmp/pg -p 5432' start\"",
  "/usr/lib/postgresql/16/bin/createdb -h localhost -U postgres tally",
  "cd /workspace/repo && cp .env.example .env && npm install",
  "npm run db:migrate && npm run db:seed",
  "setsid -f npm start </dev/null >>/tmp/app.log 2>&1",
];

describe("the stage", () => {
  it("tells the agent it cannot act while the member has control", () => {
    const state = { chapter: null, held: false, chapters: 2, film: 1 };
    expect(stageNote(state)).toContain("The video is paused in chapter 2");
    expect(stageNote({ ...state, control: true })).toContain(
      "The member has taken control",
    );
  });

  it("restarts only what keeps running, after the stale locks", () => {
    expect(restartSteps(BENCH)).toEqual([STALE_LOCKS, BENCH[2], BENCH[6]]);
    expect(
      restartSteps(["cd web", "pnpm install", "nohup pnpm start &"]),
    ).toEqual([STALE_LOCKS, "cd web", "nohup pnpm start &"]);
  });

  it("brings the app as it was back without touching the live locks", () => {
    // As the bench's implementer wrote it on dev (2026-10-28). The locks
    // cleared again once PostgreSQL ran: it shut down a minute later.
    const before = [
      "ln -s /workspace/repo/node_modules /tmp/before/node_modules",
      "cp /workspace/repo/.env /tmp/before/.env",
      "cd /tmp/before && PORT=3001 setsid -f npm start </dev/null >>/tmp/before.log 2>&1",
    ];
    expect(restartSteps(before, { locks: false })).toEqual([before[2]]);
  });

  it("reads the seeded user's sign-in from the recipe's words", () => {
    const signIn = stageSignIn(
      "Seeded demo user demo@tally.dev / demo1234: POST the /login form and save the session cookie",
    );
    expect(signIn?.path).toBe("/login");
    expect(Object.values(signIn!.fields)).toEqual([
      "demo@tally.dev",
      "demo1234",
    ]);
    expect(
      stageSignIn("Log in at /sign-in as admin@x.io, password: hunter2."),
    ).toMatchObject({
      path: "/sign-in",
    });
    expect(
      Object.values(stageSignIn("admin@x.io, password: hunter2.")!.fields)[1],
    ).toBe("hunter2");
    expect(stageSignIn("No sign-in")).toBeNull();
    expect(stageSignIn(null)).toBeNull();
  });

  it("opens the recipe's page on the app's origin", () => {
    expect(stageAddress("http://localhost:3000/settings?tab=a")).toEqual({
      url: "http://localhost:3000",
      path: "/settings?tab=a",
    });
  });

  it("runs the steps in one shell, marking each, then waits for the app", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stage-"));
    const log = path.join(dir, "marks.log");
    const output = path.join(dir, "out.log");
    const script = stageScript({
      log,
      output,
      dir,
      // The second step needs the first's variable and directory.
      steps: [
        "mkdir sub && cd sub && export SEEN=yes",
        'echo "$SEEN $(basename "$PWD")" > ../seen',
        "false",
      ],
      url: "http://127.0.0.1:9/",
    });
    writeFileSync(path.join(dir, "boot.sh"), script);
    let code = 0;
    try {
      execFileSync("bash", [path.join(dir, "boot.sh")]);
    } catch (error) {
      code = (error as { status: number }).status;
    }
    expect(code).toBe(1);
    expect(readFileSync(path.join(dir, "seen"), "utf8").trim()).toBe("yes sub");
    expect(
      stageLog(readFileSync(log, "utf8")).map((mark) => mark.label),
    ).toEqual(["step 1", "step 2", "step 3", "failed step 3 (1)"]);
  });

  it("clones the branch first on a fresh boot", () => {
    const script = stageScript({
      log: "/l",
      output: "/o",
      dir: "/workspace/repo",
      steps: ["true"],
      url: "http://localhost:3000/",
      clone: { repository: "o/r", branch: "yarrow/it's" },
    });
    expect(script).toContain(
      "git clone --filter=blob:none --branch 'yarrow/it'\\''s' -- 'https://github.com/o/r.git' '/workspace/repo'",
    );
    expect(script.indexOf("git clone")).toBeLessThan(
      script.indexOf("cd '/workspace/repo'"),
    );
  });

  it("brings the app as it was up beside it, from where the branch left main", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "stage-"));
    const repo = path.join(dir, "repo");
    const git = (...args: string[]) =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    git("config", "user.email", "t@t.dev");
    git("config", "user.name", "t");
    writeFileSync(path.join(repo, "app.txt"), "as it was\n");
    git("add", ".");
    git("commit", "-qm", "main");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-qb", "yarrow/change");
    writeFileSync(path.join(repo, "app.txt"), "as it is\n");
    git("commit", "-qam", "change");
    const server = createServer((_, response) => response.end("ok"));
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const boot = async (steps: string[]) => {
      const log = path.join(dir, `marks-${steps.length}.log`);
      writeFileSync(
        path.join(dir, "boot.sh"),
        stageScript({
          log,
          output: path.join(dir, "out.log"),
          dir: repo,
          steps: ["true"],
          url,
          before: { dir: path.join(dir, "before"), base: "main", steps, url },
        }),
      );
      await bash("bash", [path.join(dir, "boot.sh")]);
      return stageLog(readFileSync(log, "utf8")).map((mark) => mark.label);
    };
    try {
      expect(await boot(["cp app.txt ../seen"])).toEqual([
        "step 1",
        "waiting for the app",
        "app up",
        "before",
        "before step 1",
        "before up",
        "served",
      ]);
      expect(readFileSync(path.join(dir, "seen"), "utf8").trim()).toBe(
        "as it was",
      );
      // It failing leaves the app up: the stage is served all the same.
      expect(await boot(["true", "false"])).toEqual([
        "step 1",
        "waiting for the app",
        "app up",
        "before",
        "before step 1",
        "before step 2",
        "before failed: step 2 (1)",
        "served",
      ]);
    } finally {
      server.close();
    }
    // git and bash take their time on a busy machine.
  }, 30_000);

  it("reads the log's marks and skips the rest", () => {
    expect(
      stageLog("1730000000000 step 1\nnoise\n1730000000500 app up\n"),
    ).toEqual([
      { at: 1730000000000, label: "step 1" },
      { at: 1730000000500, label: "app up" },
    ]);
  });
});

describe("the presentation on the stage", () => {
  const chapter = (
    title: string,
    tab: PresentationChapter["tab"],
    live: PresentationChapter["live"],
  ): PresentationChapter => ({
    title,
    tab,
    url: null,
    page: null,
    before: false,
    beforeMs: 0,
    desktop: true,
    say: "So I click Doing.",
    video: null,
    audio: null,
    cues: [],
    marks: [],
    urls: [],
    live,
  });
  const app = (which: "before" | "after", path: string | null) => ({
    app: which,
    path,
    actions: [{ do: "click" as const, target: "text=Doing" }],
    command: null,
    cwd: null,
    before: which === "before",
    document: null,
  });
  const timeline = (chapters: PresentationChapter[]): Presentation => ({
    version: 1,
    title: "Filters",
    language: "en",
    voice: null,
    ticket: { source: "github", title: "Filters", url: "" },
    poster: null,
    apps: { before: "http://localhost:3001", after: "http://localhost:3000" },
    chapters,
  });
  const film = timeline([
    chapter("Before", "app", app("before", "/")),
    chapter("Filters", "app", app("after", "/")),
    chapter("Tests", "terminal", {
      ...app("after", "/"),
      actions: [],
      command: "npm test",
    }),
  ]);

  it("plays every chapter as planned, the app as it was beside it", () => {
    expect(stagePlan(film, true)).toMatchObject({
      apps: { before: "http://localhost:3001", after: "http://localhost:3000" },
      chapters: [
        { title: "Before", tab: "app", app: "before", path: "/" },
        { title: "Filters", tab: "app", app: "after" },
        { title: "Tests", tab: "terminal", command: "npm test" },
      ],
    });
  });

  it("leaves the stage as it was for a chapter it cannot play live", () => {
    // The app as it was does not run on the stage.
    expect(stagePlan(film, false)?.chapters).toMatchObject([
      { title: "Before", tab: null },
      { title: "Filters", tab: "app" },
      { title: "Tests", tab: "terminal" },
    ]);
    // A ticket, then terminals only: the recipe's app is the stage's.
    const terminals = stagePlan(
      {
        ...timeline([
          chapter("The ask", "ticket", null),
          chapter("Tests", "terminal", {
            ...app("after", null),
            actions: [],
            command: "npm test",
          }),
        ]),
        apps: { before: null, after: null },
      },
      true,
    );
    expect(terminals).toMatchObject({
      apps: { after: null, before: null },
      chapters: [
        { title: "The ask", tab: null },
        { title: "Tests", tab: "terminal", command: "npm test" },
      ],
    });
  });

  it("plays none of it when no chapter can be played live", () => {
    // A presentation recorded before the plan was kept.
    expect(
      stagePlan(timeline([chapter("The ask", "ticket", null)]), true),
    ).toBeNull();
    expect(stagePlan(null, true)).toBeNull();
    // Without the app as it was, a film that never shows it still plays.
    expect(
      stagePlan(timeline([chapter("Filters", "app", app("after", "/"))]), false)
        ?.apps.before,
    ).toBeNull();
  });
});
