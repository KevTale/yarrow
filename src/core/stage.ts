/**
 * A pull request's stage: its app running live on Yarrow's desktop, in a
 * container of ours, its screen in the page (workers/stage.ts). The first
 * boot runs the project's recipe from a fresh checkout and keeps a snapshot
 * of the machine's files; the next ones start from it and only bring the
 * services and the app back. No I/O here.
 */

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
  /** The recorder (present.mjs), which brings the desktop up. */
  recorder: string;
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
}

/** A recipe step that leaves something running: a database, a server. */
const LONG_LIVED =
  /\b(pg_ctl\b.*\bstart|pg_ctlcluster\b.*\bstart|service\s+\S+\s+start|redis-server|mongod|mysqld|setsid|nohup|docker\s+compose\s+up)\b|&\s*$/;

/**
 * The steps that start what a snapshot cannot keep (processes), after the
 * locks the last boot left behind. A step that only moves (`cd`) is kept
 * for the steps after it.
 */
export function restartSteps(steps: string[]): string[] {
  const kept = steps.filter(
    (step) => LONG_LIVED.test(step) || /^\s*cd\s+\S+\s*$/.test(step),
  );
  return [STALE_LOCKS, ...kept];
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
    `mark "waiting for the app"`,
    `for i in $(seq 1 240); do curl -s -o /dev/null --max-time 2 ${quote(input.url)} && { mark "app up"; exit 0; }; sleep 0.5; done`,
    `mark "failed: the app never answered"`,
    "exit 1",
  );
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
