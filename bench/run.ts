/**
 * The bench: files scenarios' tickets on the bench apps' repositories,
 * waits for Yarrow dev to answer them, checks what came back (the proofs
 * first) and writes a report.
 *
 *   pnpm bench list
 *   pnpm bench setup                    # each app's repository, made once
 *   pnpm bench sync <app> [--private]   # bench/apps/<app> onto its main
 *   pnpm bench <scenario|app|all>... [--private] [--keep]
 *
 * Several scenarios run at once: each repository is cleaned and synced
 * once, then every ticket is filed and followed together. Runs as you,
 * through the GitHub CLI (`gh auth login`): it only touches the bench
 * repositories. Real models answer, so a scenario costs what a ticket
 * costs. Reports land in bench/reports/ (not committed).
 */
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  apps,
  scenarios,
  type BenchApp,
  type Scenario,
  type Shown,
} from "./scenarios";

const OWNER = process.env.BENCH_OWNER ?? "KevTale";
/** The dev GitHub App: a repository it is installed on becomes a project. */
const APP_SLUG = process.env.BENCH_APP_SLUG ?? "yarrow-run-dev";
const APPS = join(import.meta.dirname, "apps");
const REPORTS = join(import.meta.dirname, "reports");
const POLL_MS = 30_000;
// Five runs at a time per account: a ticket may wait for others first.
const TIMEOUT_MS = 150 * 60_000;
/** Never pushed: installs, builds, local settings. */
const LOCAL = new Set([
  "node_modules",
  ".env",
  ".env.local",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  ".next",
  "dist",
  "outbox",
  "next-env.d.ts",
]);

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));
const names = args.filter((arg) => !arg.startsWith("--"));
const command = names[0] ?? "list";

function gh(argv: string[], input?: string): string {
  return execFileSync("gh", argv, {
    encoding: "utf8",
    input,
    stdio: ["pipe", "pipe", "inherit"],
  });
}
const api = <T>(path: string): T => JSON.parse(gh(["api", path])) as T;
const git = (dir: string, ...argv: string[]) =>
  execFileSync("git", ["-c", "core.autocrlf=false", "-C", dir, ...argv], {
    encoding: "utf8",
  });
const elapsed = (start: number) =>
  `${Math.round((Date.now() - start) / 60_000)} min`;

function appNamed(name: string): BenchApp {
  const app = apps.find((candidate) => candidate.name === name);
  if (!app) throw new Error(`No app "${name}". pnpm bench list`);
  return app;
}

/** Tally also has a private twin, for what a private project shows. */
const repositoryOf = (app: BenchApp) =>
  `${OWNER}/${app.repository}${flags.has("--private") && app.name === "tally" ? "-private" : ""}`;

/** Each app's repository, made (private) with the label Yarrow answers to. */
function setup(): void {
  for (const app of apps) {
    const repo = repositoryOf(app);
    const exists = (() => {
      try {
        gh(["repo", "view", repo, "--json", "name"]);
        return true;
      } catch {
        return false;
      }
    })();
    if (!exists) {
      gh([
        "repo",
        "create",
        repo,
        "--private",
        "--description",
        `Yarrow's bench: ${app.about}`,
      ]);
      console.log(`${repo}: made`);
    }
    sync(app);
    try {
      gh(["label", "create", "yarrow", "-R", repo, "--color", "4b3fd8"]);
    } catch {
      // Already there.
    }
  }
  console.log(
    `\nYarrow dev answers a repository once its GitHub App is installed on it: https://github.com/apps/${APP_SLUG}/installations/new`,
  );
}

/** The repository's main becomes bench/apps/<app> as it is here. */
function sync(app: BenchApp): void {
  const repo = repositoryOf(app);
  const dir = mkdtempSync(join(tmpdir(), "yarrow-bench-"));
  gh(["repo", "clone", repo, dir, "--", "--quiet"]);
  for (const entry of readdirSync(dir))
    if (entry !== ".git") rmSync(join(dir, entry), { recursive: true });
  cpSync(join(APPS, app.name), dir, {
    recursive: true,
    filter: (path) => {
      const name = basename(path);
      return !LOCAL.has(name) && !name.endsWith(".egg-info");
    },
  });
  git(dir, "add", "-A");
  if (!git(dir, "status", "--porcelain").trim()) {
    console.log(`${repo}: main is already the bench app`);
  } else {
    git(
      dir,
      "commit",
      "--quiet",
      "-m",
      `${app.name}, as the bench starts from`,
    );
    git(dir, "branch", "-M", "main");
    git(dir, "push", "--quiet", "origin", "main");
    console.log(`${repo}: main reset to the bench app`);
  }
  rmSync(dir, { recursive: true, force: true });
}

/** Earlier scenarios' tickets and pull requests, closed. */
function clean(repo: string): void {
  for (const pull of api<{ number: number }[]>(
    `repos/${repo}/pulls?state=open&per_page=100`,
  ))
    gh(["pr", "close", String(pull.number), "-R", repo, "--delete-branch"]);
  for (const issue of api<{ number: number; pull_request?: unknown }[]>(
    `repos/${repo}/issues?state=open&per_page=100`,
  ))
    if (!issue.pull_request)
      gh([
        "issue",
        "close",
        String(issue.number),
        "-R",
        repo,
        "-r",
        "not planned",
      ]);
}

interface Pull {
  number: number;
  html_url: string;
  body: string | null;
  draft: boolean;
  head: { ref: string };
}

type Outcome =
  | { kind: "pull_request"; pull: Pull }
  | { kind: "abstained"; comment: string }
  | { kind: "timeout" };

async function waitFor(
  repo: string,
  issue: number,
  start: number,
  label: string,
): Promise<Outcome> {
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    // Found by the ticket it names, closing it or not (checked later).
    const pull = api<Pull[]>(`repos/${repo}/pulls?state=all&per_page=50`).find(
      (candidate) =>
        candidate.body?.includes(`Closes #${issue}`) ||
        candidate.body?.includes(`/${repo}/issues/${issue}`),
    );
    if (pull) return { kind: "pull_request", pull };
    const comment = api<{ body: string; user: { type: string } }[]>(
      `repos/${repo}/issues/${issue}/comments`,
    ).find((candidate) => candidate.user.type === "Bot");
    if (comment) return { kind: "abstained", comment: comment.body };
    if ((Date.now() - start) % (5 * 60_000) < POLL_MS)
      console.log(`  … ${label}: ${elapsed(start)}`);
  }
  return { kind: "timeout" };
}

interface Check {
  ok: boolean;
  what: string;
}

/** What the description shows: each proof's mark, and the film. */
export function shownIn(body: string): Set<Shown> {
  const shown = new Set<Shown>();
  for (const [, kind, phone] of body.matchAll(
    /<!-- yarrow:proof (\w+)( phone)? -->/g,
  )) {
    shown.add(kind as Shown);
    if (phone) shown.add("phone");
  }
  if (body.includes("## Presentation")) shown.add("film");
  return shown;
}

async function check(
  scenario: Scenario,
  repo: string,
  issue: number,
  outcome: Outcome,
  folder: string,
): Promise<Check[]> {
  const checks: Check[] = [
    {
      ok: outcome.kind === scenario.expect.outcome,
      what: `Outcome: ${outcome.kind} (expected ${scenario.expect.outcome})`,
    },
  ];
  if (outcome.kind !== "pull_request") return checks;
  const { pull } = outcome;
  const body = pull.body ?? "";
  checks.push(
    { ok: pull.draft, what: "Opened as a draft" },
    {
      ok: body.includes(`Closes #${issue}`),
      what: `Closes the ticket on merge (Closes #${issue})`,
    },
    { ok: body.includes("## What changed"), what: "Says what changed" },
    {
      // The reviewer tells it, in one neutral voice: no "I" in it.
      ok: !/(^|[.!?:;]\s+)I\s/.test(
        /## What changed\n\n([\s\S]*?)(\n## |$)/.exec(body)?.[1] ?? "",
      ),
      what: "What changed is told in one voice",
    },
  );
  const files = api<{ filename: string }[]>(
    `repos/${repo}/pulls/${pull.number}/files?per_page=100`,
  ).map((file) => file.filename);
  for (const prefix of scenario.expect.touches ?? [])
    checks.push({
      ok: files.some((file) => file.startsWith(prefix)),
      what: `Touches ${prefix} (${files.join(", ")})`,
    });

  // The proofs: what fits the ticket, and nothing that does not.
  const shown = shownIn(body);
  const list = [...shown].join(", ") || "nothing";
  for (const kind of scenario.expect.shows ?? [])
    checks.push({ ok: shown.has(kind), what: `Shows ${kind} (${list})` });
  const oneOf = scenario.expect.showsOneOf;
  if (oneOf)
    checks.push({
      ok: oneOf.some((kind) => shown.has(kind)),
      what: `Shows ${oneOf.join(" or ")} (${list})`,
    });
  for (const kind of scenario.expect.hides ?? [])
    checks.push({ ok: !shown.has(kind), what: `No ${kind}: noise here` });
  if (scenario.expect.notVerified)
    checks.push({
      ok: body.includes("## Not verified"),
      what: "Says what could not be verified",
    });

  const runUrl = body.match(/https:\/\/[^\s)/]+\/runs\/[0-9a-f-]{36}/)?.[0];
  // The proofs sit under What changed, after the summary (2026-10-29);
  // under their own heading before.
  const proof =
    (/## Proof\n\n([\s\S]*?)(\n## |$)/.exec(body) ??
      /## What changed\n\n([\s\S]*?)(\n## |$)/.exec(body))?.[1] ?? "";
  if (shown.has("app"))
    checks.push({
      ok: /\[Try it in the app\]\(https:\/\/[^)\s]+\/preview\/[^)\s]+\?path=%2F[^)\s]*\)/.test(
        proof,
      ),
      what: "Links the app at its page",
    });
  if (shown.has("document")) {
    const link = proof.match(
      /\]\((https:\/\/github\.com\/[^)\s]+\/blob\/[^)\s]+)\), as it reads on this branch/,
    )?.[1];
    // Read through the API: the repository may be private.
    const prefix = `https://github.com/${repo}/blob/${pull.head.ref.split("/").map(encodeURIComponent).join("/")}/`;
    const file = link?.startsWith(prefix)
      ? decodeURIComponent(link.slice(prefix.length))
      : null;
    let found = false;
    if (file)
      try {
        api(
          `repos/${repo}/contents/${file.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(pull.head.ref)}`,
        );
        found = true;
      } catch {
        found = false;
      }
    checks.push({
      ok: found,
      what: `Links the document on the branch (${file ?? link ?? "no link"})`,
    });
  }

  if (repo.endsWith("-private")) {
    checks.push({
      ok: !/!\[[^\]]*\]\(https:/.test(body),
      what: "No image in a private description",
    });
    return checks;
  }
  // A public project's screens show in the description, served; a
  // private one's are counted, seen in Yarrow.
  const image = [...proof.matchAll(/!\[[^\]]*\]\((https:[^)\s]+)\)/g)]
    .map((match) => match[1]!)
    .find((url) => !url.endsWith("-poster.jpg"));
  if ((shown.has("images") || shown.has("phone")) && !image)
    checks.push({
      ok: /\[\d+ images?\]\(https:[^)\s]+\/runs\/[0-9a-f-]{36}\), in Yarrow/.test(
        proof,
      ),
      what: "Its screens counted, seen in Yarrow",
    });
  else if (shown.has("images") || shown.has("phone")) {
    const response = await fetch(image!);
    const ok =
      response.ok &&
      (response.headers.get("content-type") ?? "").startsWith("image/");
    if (ok)
      writeFileSync(
        join(folder, basename(new URL(image!).pathname)),
        new Uint8Array(await response.arrayBuffer()),
      );
    checks.push({
      ok,
      what: `Its screens served (${response.status})`,
    });
  }
  if (shown.has("film") && runUrl)
    checks.push(...(await filmChecks(body, runUrl, folder)));
  return checks;
}

/** The film, when there is one: its still, every chapter filmed and voiced. */
async function filmChecks(
  body: string,
  runUrl: string,
  folder: string,
): Promise<Check[]> {
  const checks: Check[] = [];
  const poster = body.match(/\((https:[^)\s]+-poster\.jpg)\)/)?.[1];
  // A private project's film plays in Yarrow only, for its members.
  if (!poster)
    return [
      {
        ok: body.includes("[Watch it in Yarrow]"),
        what: "The film, linked to Yarrow",
      },
    ];
  {
    const response = await fetch(poster);
    const ok =
      response.ok && response.headers.get("content-type") === "image/jpeg";
    if (ok)
      writeFileSync(
        join(folder, "poster.jpg"),
        new Uint8Array(await response.arrayBuffer()),
      );
    checks.push({ ok, what: `The film's still served (${response.status})` });
  }
  const origin = new URL(runUrl).origin;
  const runId = runUrl.split("/").pop()!;
  // The run keeps its artifacts once the pull request is open: a few
  // seconds after the description shows.
  let file: string | undefined;
  for (let tries = 0; !file && tries < 12; tries++) {
    if (tries) await new Promise((resolve) => setTimeout(resolve, 10_000));
    const page = await (await fetch(runUrl)).text();
    file = page.match(/[0-9a-f]{8}-presentation\.json/)?.[0];
  }
  const timeline = file
    ? ((await (
        await fetch(`${origin}/evidence/runs/${runId}/${file}`)
      ).json()) as {
        voice: { provider: string } | null;
        chapters: {
          title: string;
          tab: string;
          before: boolean;
          desktop?: boolean;
          video: { key: string; width?: number } | null;
          audio: { key: string } | null;
        }[];
      })
    : null;
  if (!timeline) {
    checks.push({
      ok: false,
      what: "The film's timeline, from the run's page",
    });
    return checks;
  }
  writeFileSync(
    join(folder, "presentation.json"),
    JSON.stringify(timeline, null, 2),
  );
  const { chapters } = timeline;
  checks.push(
    {
      ok: chapters.length >= 2,
      what: `${chapters.length} chapters: ${chapters.map((chapter) => `${chapter.title} (${chapter.tab}${chapter.before ? ", before" : ""})`).join(", ")}`,
    },
    {
      ok: chapters.every((chapter) => chapter.video),
      what: "Every chapter filmed",
    },
    {
      ok: Boolean(timeline.voice) && chapters.every((chapter) => chapter.audio),
      what: `Voiced${timeline.voice ? ` by ${timeline.voice.provider}` : ": no"}`,
    },
    {
      ok: chapters.some((chapter) => chapter.tab === "app" && !chapter.before),
      what: "Shows the app as it is now",
    },
    {
      ok: chapters.at(-1)?.tab !== "ticket",
      what: "Ends on the change, not the ticket",
    },
  );
  return checks;
}

interface Filed {
  scenario: Scenario;
  repo: string;
  issue: { number: number; html_url: string };
  start: number;
}

async function follow(filed: Filed): Promise<boolean> {
  const { scenario, repo, issue, start } = filed;
  const folder = join(
    REPORTS,
    `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${scenario.name}${repo.endsWith("-private") ? "-private" : ""}`,
  );
  mkdirSync(folder, { recursive: true });
  const outcome = await waitFor(repo, issue.number, start, scenario.name);
  const checks = await check(scenario, repo, issue.number, outcome, folder);
  const runUrl =
    outcome.kind === "pull_request"
      ? // The run's page sits at the root, unlike its evidence.
        outcome.pull.body?.match(/https:\/\/[^\s)/]+\/runs\/[0-9a-f-]{36}/)?.[0]
      : undefined;
  const passed = checks.every((item) => item.ok);
  const report = [
    `# ${scenario.name}: ${passed ? "passed" : "FAILED"}`,
    "",
    scenario.about,
    "",
    `- Repository: ${repo}`,
    `- Ticket: ${issue.html_url}`,
    outcome.kind === "pull_request"
      ? `- Pull request: ${outcome.pull.html_url}`
      : null,
    runUrl ? `- Run: ${runUrl}` : null,
    `- Time: ${elapsed(start)}`,
    "",
    ...checks.map((item) => `- ${item.ok ? "✅" : "❌"} ${item.what}`),
    ...(outcome.kind === "abstained"
      ? ["", "Yarrow's comment:", "", outcome.comment]
      : []),
    ...(outcome.kind === "pull_request"
      ? ["", "---", "", outcome.pull.body ?? ""]
      : []),
  ]
    .filter((line) => line !== null)
    .join("\n");
  writeFileSync(join(folder, "report.md"), report);
  console.log(
    `\n${scenario.name} ${passed ? "passed" : "FAILED"} in ${elapsed(start)}${outcome.kind === "pull_request" ? `, ${outcome.pull.html_url}` : ""}\n${checks.map((item) => `  ${item.ok ? "✅" : "❌"} ${item.what}`).join("\n")}\n  Report: ${folder}`,
  );
  return passed;
}

/** The scenarios named: by name, by app, or all. */
function chosen(): Scenario[] {
  const picked = new Set<Scenario>();
  for (const name of names) {
    const matches =
      name === "all"
        ? scenarios
        : scenarios.filter(
            (scenario) => scenario.name === name || scenario.app === name,
          );
    if (matches.length === 0) {
      console.error(`No scenario or app "${name}". pnpm bench list`);
      process.exit(1);
    }
    for (const scenario of matches) picked.add(scenario);
  }
  return [...picked];
}

async function run(picked: Scenario[]): Promise<void> {
  const filed: Filed[] = [];
  for (const name of new Set(picked.map((scenario) => scenario.app))) {
    const app = appNamed(name);
    const repo = repositoryOf(app);
    if (!flags.has("--keep")) clean(repo);
    sync(app);
    for (const scenario of picked.filter((item) => item.app === name)) {
      const issue = JSON.parse(
        gh(
          ["api", `repos/${repo}/issues`, "--input", "-"],
          JSON.stringify({
            title: scenario.title,
            body: scenario.body,
            labels: ["yarrow"],
          }),
        ),
      ) as { number: number; html_url: string };
      console.log(`${scenario.name}: ${issue.html_url}`);
      filed.push({ scenario, repo, issue, start: Date.now() });
    }
  }
  console.log(`\nWaiting for Yarrow dev on ${filed.length} ticket(s)`);
  const results = await Promise.all(filed.map(follow));
  const failed = filed.filter((_, index) => !results[index]);
  console.log(
    `\n${filed.length - failed.length}/${filed.length} passed${failed.length ? `; failed: ${failed.map((item) => item.scenario.name).join(", ")}` : ""}`,
  );
  if (failed.length) process.exitCode = 1;
}

if (command === "list") {
  for (const app of apps) {
    console.log(`${app.name} (${OWNER}/${app.repository}): ${app.about}`);
    for (const scenario of scenarios.filter((item) => item.app === app.name))
      console.log(`  ${scenario.name.padEnd(12)} ${scenario.about}`);
  }
} else if (command === "setup") {
  setup();
} else if (command === "sync") {
  sync(appNamed(names[1] ?? "tally"));
} else {
  await run(chosen());
}
