/**
 * A pull request's stage: its app running live on Yarrow's desktop, in a
 * container of ours, its screen in the page (workers/stage.ts). The first
 * boot runs the project's recipe from a fresh checkout and keeps a snapshot
 * of the machine's files; the next ones start from it and only bring the
 * services and the app back. No I/O here.
 */

import type { LiveAction, LiveChapter, Presentation } from "./presentation";

/** How the seeded user signs in, for the stage's browser. */
export interface StageSignIn {
  path: string;
  /** CSS selectors (Playwright's) and what to type in them, in order. */
  fields: Record<string, string>;
  /** Clicked to send; absent, Enter in the last field. */
  submit?: string;
}

export interface StageSpec {
  /** owner/name on GitHub. */
  repository: string;
  branch: string;
  /** A read-only token: the Worker adds it to GitHub requests, never the container. */
  token: string;
  /** The recipe's steps, from a fresh checkout to the app answering. */
  steps: string[];
  /** What brings the app back on a machine where the steps already ran. */
  restart: string[];
  /** Where the app answers (origin), and the page opened first. */
  url: string;
  path: string;
  signIn: StageSignIn | null;
  /** The branch the pull request goes into: the app as it was comes from it. */
  base: string;
  /** The app as it was, beside it, when the recipe tells how. */
  before: { steps: string[]; restart: string[]; url: string } | null;
  /** The presentation, played live when asked (null: it cannot be). */
  script: StagePlan | null;
  /** The recorder (present.mjs), which brings the desktop up. */
  recorder: string;
}

/** The presentation as the stage plays it: the plan's apps and chapters. */
export interface StagePlan {
  apps: { after: string; before: string | null };
  chapters: (LiveChapter & { title: string; tab: "app" | "terminal" })[];
}

/**
 * The presentation, if the stage can play all of it live: every chapter
 * on the desktop (no ticket, phone or given output), the app as it was
 * running when a chapter shows it.
 */
export function stagePlan(
  timeline: Presentation | null,
  before: boolean,
): StagePlan | null {
  const after = timeline?.apps?.after;
  if (!timeline || !after) return null;
  const chapters: StagePlan["chapters"] = [];
  for (const chapter of timeline.chapters) {
    const { live, tab, title } = chapter;
    if (!live || tab === "ticket") return null;
    if (tab === "app" && live.app === "before" && !before) return null;
    chapters.push({ ...live, title, tab });
  }
  return {
    apps: { after, before: before ? (timeline.apps?.before ?? null) : null },
    chapters,
  };
}

export type StagePhase = "off" | "booting" | "ready" | "failed";

export interface StageEvent {
  /** Milliseconds since the stage was asked for. */
  ms: number;
  label: string;
}

export interface StageStatus {
  phase: StagePhase;
  /** Started from the snapshot of an earlier boot. */
  warm: boolean;
  events: StageEvent[];
  error: string | null;
  /** Its presentation can be played on it. */
  live: boolean;
}

/**
 * What the page asks the presenter: the opening, a chapter over its voice,
 * to hold it while the member talks and go on after, or to end it there
 * (the agent leads the rest, src/runner/talk.ts).
 */
export type StageCue =
  | { action: "set" }
  | { action: "chapter"; index: number; voiceMs: number }
  | { action: "pause" }
  // `restore`: what the talk changed in the app put back first.
  | { action: "resume"; restore?: boolean }
  | { action: "stop" };

/**
 * What the agent the member talks to does there (src/runner/talk.ts):
 * reads where the presentation stands and the screen, acts on it.
 */
export type StageHand =
  | { action: "state" }
  | { action: "look" }
  | { action: "act"; actions: LiveAction[] }
  | { action: "window"; window: "after" | "before" | "terminal" }
  | { action: "run"; command: string; cwd?: string }
  // While held: each window the talk changed (src/runner/stage-restore.ts).
  | { action: "changes" }
  // The recipe's sign-in, on the window in front.
  | { action: "sign-in" }
  // A chapter's gestures, without its voice: the agent says it its own way.
  // `ms`: as long as the agent's words over it; `turn`: the member's turn
  // it answers, a later one stops it.
  | { action: "point"; index: number; ms?: number; turn?: string }
  // The member spoke: the presentation ends there, the agent leads.
  | { action: "stop"; turn?: string };

/** A window as the presentation left it when held, and as it is now. */
export interface StageChange {
  window: "after" | "before";
  then: { url: string; screen: string };
  now: { url: string; screen: string };
}

export interface StageCueResult {
  ok: boolean;
  problems: string[];
  /** What the presenter said while it played it. */
  notes?: string[];
  /** The screen as text, after the agent's move. */
  screen?: string;
  state?: StageState;
  changes?: StageChange[];
}

/** Where the presentation stands on the stage. */
export interface StageState {
  chapter: { index: number; title: string } | null;
  /** Held while the member talks. */
  held: boolean;
  chapters: number;
  /** The recorded presentation ended: the agent leads the rest. */
  over?: boolean;
  /** The chapters shown in full, by the presentation or the agent. */
  shown?: number[];
  /** The chapter the talk cut, if one was playing. */
  cut?: number | null;
}

/** A recipe step that leaves something running: a database, a server. */
const LONG_LIVED =
  /\b(pg_ctl\b.*\bstart|pg_ctlcluster\b.*\bstart|service\s+\S+\s+start|redis-server|mongod|mysqld|setsid|nohup|docker\s+compose\s+up)\b|&\s*$/;

/**
 * The steps that start what a snapshot cannot keep (processes), after the
 * locks the last boot left behind. A step that only moves (`cd`) is kept
 * for the steps after it. `locks: false` for the steps run once the first
 * ones are up (the app as it was): PostgreSQL shuts down within a minute
 * when its live lock file is gone.
 */
export function restartSteps(
  steps: string[],
  { locks = true }: { locks?: boolean } = {},
): string[] {
  const kept = steps.filter(
    (step) => LONG_LIVED.test(step) || /^\s*cd\s+\S+\s*$/.test(step),
  );
  return locks ? [STALE_LOCKS, ...kept] : kept;
}

/** PostgreSQL's pid and socket locks, X's: from processes that are gone. */
export const STALE_LOCKS =
  "find /tmp /var/run/postgresql /var/lib/postgresql -maxdepth 5 \\( -name postmaster.pid -o -name '.s.PGSQL.*' -o -name '.X*-lock' \\) -delete 2>/dev/null; true";

/** An email, then "/", "," or ":" and/or the word password, then the password. */
const EMAIL =
  /([\w.+-]+@[\w-]+(?:\.[\w-]+)+)(?:\s*[/,:]\s*(?:password\s*:?\s*)?|\s+(?:and\s+)?password\s*:?\s*)([^\s,;)]+)/i;
const LOGIN_PATH = /(\/[\w-]*(?:log-?in|sign-?in)[\w/-]*)/i;

/**
 * The sign-in a recipe tells in words ("demo@x.dev / demo1234 at /login"),
 * as fields to fill: the first email or user field, the first password.
 */
export function stageSignIn(words: string | null): StageSignIn | null {
  const found = words ? EMAIL.exec(words) : null;
  if (!found) return null;
  return {
    path: LOGIN_PATH.exec(words!)?.[1] ?? "/login",
    fields: {
      'input[type="email"], input[name*="email" i], input[name*="user" i], input[name="login"] >> nth=0':
        found[1]!,
      'input[type="password"] >> nth=0': found[2]!.replace(/[.:'"]+$/, ""),
    },
  };
}

/** The recipe's URL as the stage opens it: where the app answers, and its page. */
export function stageAddress(url: string): { url: string; path: string } {
  const parsed = new URL(url);
  return {
    url: parsed.origin,
    path: `${parsed.pathname}${parsed.search}`,
  };
}

const quote = (text: string) => `'${text.replaceAll("'", `'\\''`)}'`;

/**
 * A shell script that runs the steps one after the other in one shell (a
 * `cd` or a variable carries to the next, as in the agent's terminal),
 * marks each in the log with the time, then waits for the app to answer.
 */
export function stageScript(input: {
  log: string;
  output: string;
  /** The checkout, where the steps start. */
  dir: string;
  steps: string[];
  url: string;
  /** Cloned into `dir` first: a fresh boot. */
  clone?: { repository: string; branch: string };
  /**
   * Then the app as it was, from `dir`, a worktree of where the branch
   * left `base` (made once): it failing leaves the app up.
   */
  before?: { dir: string; base: string; steps: string[]; url: string };
}): string {
  const lines = [
    `mark() { printf '%s %s\\n' "$(date +%s%3N)" "$1" >> ${quote(input.log)}; }`,
    `exec >> ${quote(input.output)} 2>&1 < /dev/null`,
  ];
  if (input.clone) {
    const { repository, branch } = input.clone;
    lines.push(
      `mark "clone"`,
      `git clone --filter=blob:none --branch ${quote(branch)} -- ${quote(`https://github.com/${repository}.git`)} ${quote(input.dir)} || { mark "failed clone"; exit 1; }`,
    );
  }
  lines.push(`cd ${quote(input.dir)}`);
  input.steps.forEach((step, i) => {
    lines.push(
      `mark "step ${i + 1}"`,
      step,
      `code=$?; [ $code -eq 0 ] || { mark "failed step ${i + 1} ($code)"; exit 1; }`,
    );
  });
  lines.push(
    `answers() { for i in $(seq 1 240); do curl -s -o /dev/null --max-time 2 "$1" && return 0; sleep 0.5; done; return 1; }`,
    `mark "waiting for the app"`,
    `answers ${quote(input.url)} || { mark "failed: the app never answered"; exit 1; }`,
    `mark "app up"`,
  );
  const before = input.before;
  if (before) {
    const repo = quote(input.dir);
    const dir = quote(before.dir);
    const base = quote(`origin/${before.base}`);
    lines.push(
      `mark "before"`,
      "(",
      `  [ -d ${dir} ] || git -C ${repo} worktree add --detach ${dir} "$(git -C ${repo} merge-base HEAD ${base} || echo ${base})" || { mark "before failed: worktree"; exit 1; }`,
      `  cd ${dir}`,
      ...before.steps.flatMap((step, i) => [
        `  mark "before step ${i + 1}"`,
        `  ${step}`,
        `  code=$?; [ $code -eq 0 ] || { mark "before failed: step ${i + 1} ($code)"; exit 1; }`,
      ]),
      `  answers ${quote(before.url)} || { mark "before failed: it never answered"; exit 1; }`,
      `  mark "before up"`,
      ")",
    );
  }
  lines.push(`mark "served"`, "exit 0");
  return `${lines.join("\n")}\n`;
}

/** The log's lines, oldest first: "1730000000000 step 3". */
export function stageLog(text: string): { at: number; label: string }[] {
  return text
    .split("\n")
    .map((line) => /^(\d{13}) (.+)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => ({ at: Number(match[1]), label: match[2]! }));
}
