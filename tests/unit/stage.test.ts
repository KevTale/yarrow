import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  restartSteps,
  stageAddress,
  stageLog,
  stageScript,
  stageSignIn,
  STALE_LOCKS,
} from "../../src/core/stage";

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
  it("restarts only what keeps running, after the stale locks", () => {
    expect(restartSteps(BENCH)).toEqual([STALE_LOCKS, BENCH[2], BENCH[6]]);
    expect(
      restartSteps(["cd web", "pnpm install", "nohup pnpm start &"]),
    ).toEqual([STALE_LOCKS, "cd web", "nohup pnpm start &"]);
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

  it("reads the log's marks and skips the rest", () => {
    expect(
      stageLog("1730000000000 step 1\nnoise\n1730000000500 app up\n"),
    ).toEqual([
      { at: 1730000000000, label: "step 1" },
      { at: 1730000000500, label: "app up" },
    ]);
  });
});
