/**
 * The bench: files a scenario's ticket on a bench repository, waits for
 * Yarrow dev to answer it, checks what came back and writes a report.
 *
 *   pnpm bench <scenario> [--private] [--keep]
 *   pnpm bench sync [--private]     # bench/app onto the repository's main
 *   pnpm bench list
 *
 * Runs as you, through the GitHub CLI (`gh auth login`): it only touches the
 * bench repositories. Real models answer, so a scenario costs what a
 * ticket costs. Reports land in bench/reports/ (not committed).
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
import { scenarios, type Scenario } from "./scenarios";

const OWNER = process.env.BENCH_OWNER ?? "KevTale";
const APP = join(import.meta.dirname, "app");
const REPORTS = join(import.meta.dirname, "reports");
const POLL_MS = 30_000;
const TIMEOUT_MS = 60 * 60_000;

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith("--")) ?? "list";
const repo = `${OWNER}/yarrow-bench-app${args.includes("--private") ? "-private" : ""}`;

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

/** The repository's main becomes bench/app as it is here. */
function sync(): void {
  const dir = mkdtempSync(join(tmpdir(), "yarrow-bench-"));
  gh(["repo", "clone", repo, dir, "--", "--quiet"]);
  for (const entry of readdirSync(dir))
    if (entry !== ".git") rmSync(join(dir, entry), { recursive: true });
  cpSync(APP, dir, {
    recursive: true,
    filter: (path) => !["node_modules", ".env"].includes(basename(path)),
  });
  git(dir, "add", "-A");
  if (!git(dir, "status", "--porcelain").trim()) {
    console.log(`${repo}: main is already the bench app`);
  } else {
    git(dir, "commit", "--quiet", "-m", "Tally, as the bench starts from");
    git(dir, "branch", "-M", "main");
    git(dir, "push", "--quiet", "origin", "main");
    console.log(`${repo}: main reset to the bench app`);
  }
  rmSync(dir, { recursive: true, force: true });
}

/** Earlier scenarios' tickets and pull requests, closed. */
function clean(): void {
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
}

type Outcome =
  | { kind: "pull_request"; pull: Pull }
  | { kind: "abstained"; comment: string }
  | { kind: "timeout" };

async function waitFor(issue: number, start: number): Promise<Outcome> {
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    const pull = api<Pull[]>(`repos/${repo}/pulls?state=all&per_page=30`).find(
      (candidate) => candidate.body?.includes(`Closes #${issue}`),
    );
    if (pull) return { kind: "pull_request", pull };
    const comment = api<{ body: string; user: { type: string } }[]>(
      `repos/${repo}/issues/${issue}/comments`,
    ).find((candidate) => candidate.user.type === "Bot");
    if (comment) return { kind: "abstained", comment: comment.body };
    console.log(`  … ${elapsed(start)}`);
  }
  return { kind: "timeout" };
}

interface Check {
  ok: boolean;
  what: string;
}

async function check(
  scenario: Scenario,
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
    { ok: body.includes("## What changed"), what: "Says what changed" },
    { ok: body.includes("## Review by"), what: "Carries the review" },
  );
  const files = api<{ filename: string }[]>(
    `repos/${repo}/pulls/${pull.number}/files?per_page=100`,
  ).map((file) => file.filename);
  for (const prefix of scenario.expect.touches ?? [])
    checks.push({
      ok: files.some((file) => file.startsWith(prefix)),
      what: `Touches ${prefix} (${files.join(", ")})`,
    });

  const images = [...body.matchAll(/!\[([^\]]*)\]\((https:[^)\s]+)\)/g)];
  const counted = body.match(/\[(\d+) screenshots?\]\(([^)]+)\), in Yarrow/);
  const isPrivate = repo.endsWith("-private");
  if (scenario.expect.screenshots === "some") {
    if (isPrivate) {
      checks.push(
        { ok: images.length === 0, what: "No image in a private description" },
        {
          ok: Boolean(counted),
          what: `Counts them, in Yarrow: ${counted?.[1] ?? "no"}`,
        },
      );
    } else {
      checks.push({
        ok: images.length > 0 && images.length <= 4,
        what: `${images.length} screenshot(s) in the description`,
      });
      for (const [index, [, label, url]] of images.entries()) {
        const response = await fetch(url!);
        const type = response.headers.get("content-type") ?? "";
        const ok = response.ok && type.startsWith("image/");
        if (ok)
          writeFileSync(
            join(folder, `${index + 1}.png`),
            new Uint8Array(await response.arrayBuffer()),
          );
        checks.push({
          ok,
          what: `Image "${label}" served (${response.status} ${type})`,
        });
      }
    }
  }
  if (scenario.expect.screenshots === "none")
    checks.push({
      ok: images.length === 0 && !counted,
      what: "No screenshot, as the change shows nothing",
    });
  return checks;
}

async function run(scenario: Scenario): Promise<void> {
  const start = Date.now();
  const folder = join(
    REPORTS,
    `${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${scenario.name}${repo.endsWith("-private") ? "-private" : ""}`,
  );
  mkdirSync(folder, { recursive: true });
  console.log(`${scenario.name} on ${repo}: ${scenario.about}`);
  if (!args.includes("--keep")) clean();
  sync();
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
  console.log(`  ticket ${issue.html_url}, waiting for Yarrow dev`);

  const outcome = await waitFor(issue.number, start);
  const checks = await check(scenario, outcome, folder);
  const runUrl =
    outcome.kind === "pull_request"
      ? outcome.pull.body?.match(/https:\/\/[^\s)]+\/runs\/[0-9a-f-]{36}/)?.[0]
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
    `\n${checks.map((item) => `${item.ok ? "✅" : "❌"} ${item.what}`).join("\n")}\n\n${passed ? "Passed" : "FAILED"} in ${elapsed(start)}. Report: ${folder}`,
  );
  if (!passed) process.exitCode = 1;
}

if (command === "list") {
  for (const scenario of scenarios)
    console.log(`${scenario.name.padEnd(12)} ${scenario.about}`);
} else if (command === "sync") {
  sync();
} else {
  const scenario = scenarios.find((candidate) => candidate.name === command);
  if (!scenario) {
    console.error(`No scenario "${command}". pnpm bench list`);
    process.exit(1);
  }
  await run(scenario);
}
