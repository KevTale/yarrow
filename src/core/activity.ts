/**
 * A run's activity feed: what the agents did, one line per action, read
 * from the provider's session events and from Yarrow's own steps. Pure:
 * the brain and the web both turn raw events into these lines.
 */

export type ActivityKind =
  | "read"
  | "search"
  | "edit"
  | "write"
  | "command"
  | "test"
  | "web"
  | "note"
  | "error"
  | "phase"
  | "review"
  | "outcome";

export interface ActivityLine {
  /** The provider event id, or a Yarrow step key: lines are deduped on it. */
  externalId: string;
  at: string;
  actor: "implementer" | "reviewer" | "yarrow";
  kind: ActivityKind;
  detail: ActivityDetail;
}

export interface ActivityDetail {
  path?: string;
  pattern?: string;
  command?: string;
  url?: string;
  text?: string;
  added?: number;
  removed?: number;
  lines?: number;
  /** Command and test outcome, once the tool result is in. */
  ok?: boolean;
  passed?: number;
  failed?: number;
  phase?: string;
  /** The tool call this result answers (merged into its line). */
  toolUseId?: string;
}

/** A Managed Agents session event, as listed by the API. */
export interface SessionEvent {
  id: string;
  type: string;
  processed_at: string | null;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  is_error?: boolean | null;
  content?: { type: string; text?: string }[];
  error?: { message?: string };
}

// The repository's checkout, and where the session keeps its outputs.
const REPO = /^\/workspace\/repo\/?|^\/mnt\/session\/outputs\//;
const relative = (path: unknown) =>
  typeof path === "string" ? path.replace(REPO, "") || "." : undefined;

/** A command as the agent means it: without the cd into the repository. */
export const shortCommand = (command: string) =>
  command
    .replace(/^cd \/workspace\/repo\s*(&&|;)\s*/, "")
    .replaceAll("/workspace/repo/", "");
const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
const lineCount = (text: unknown) =>
  typeof text === "string" && text.length > 0 ? text.split("\n").length : 0;
const testCommand =
  /\b(vitest|jest|pytest|mocha|playwright test|cargo test|go test|rspec|phpunit|(npm|pnpm|yarn|bun)( run)? test)\b/;

const text = (event: SessionEvent) =>
  (event.content ?? [])
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();

/**
 * One session event to at most one line. Tool results come back as a patch
 * for their tool call's line (ok, test counts), with `toolUseId` set.
 */
export function activityFromEvent(event: SessionEvent): ActivityLine | null {
  const base = {
    externalId: event.id,
    at: event.processed_at ?? new Date().toISOString(),
    actor: "implementer" as const,
  };
  if (event.type === "agent.tool_use") {
    const input = event.input ?? {};
    switch (event.name) {
      case "read":
        return { ...base, kind: "read", detail: { path: relative(input.file_path ?? input.path) } };
      case "glob":
      case "grep":
        return {
          ...base,
          kind: "search",
          detail: { pattern: clip(String(input.pattern ?? ""), 120) },
        };
      case "edit":
        return {
          ...base,
          kind: "edit",
          detail: {
            path: relative(input.file_path ?? input.path),
            added: lineCount(input.new_string),
            removed: lineCount(input.old_string),
          },
        };
      case "write":
        return {
          ...base,
          kind: "write",
          detail: {
            path: relative(input.file_path ?? input.path),
            lines: lineCount(input.content),
          },
        };
      case "bash": {
        const command = clip(shortCommand(String(input.command ?? "").trim()), 300);
        return {
          ...base,
          kind: testCommand.test(command) ? "test" : "command",
          detail: { command },
        };
      }
      case "web_fetch":
        return { ...base, kind: "web", detail: { url: clip(String(input.url ?? ""), 200) } };
      case "web_search":
        return { ...base, kind: "web", detail: { text: clip(String(input.query ?? ""), 200) } };
      default:
        return null;
    }
  }
  if (event.type === "agent.tool_result" && event.tool_use_id) {
    const output = text(event);
    // "12 passed" (Vitest, Jest, pytest), "# pass 12" (node:test, TAP).
    const count = (word: string) =>
      new RegExp(`(\\d+) (?:tests? )?${word}ed\\b|^\\s*[#ℹ]\\s*${word} (\\d+)`, "im")
        .exec(output)
        ?.slice(1)
        .find(Boolean);
    const passed = count("pass");
    const failed = count("fail");
    return {
      ...base,
      kind: "command",
      detail: {
        toolUseId: event.tool_use_id,
        ok: !event.is_error && !(failed && Number(failed) > 0),
        ...(passed ? { passed: Number(passed) } : {}),
        ...(failed ? { failed: Number(failed) } : {}),
      },
    };
  }
  if (event.type === "agent.message") {
    const note = text(event);
    // The final JSON report is read elsewhere; only prose is a note.
    if (!note || note.startsWith("{")) return null;
    return { ...base, kind: "note", detail: { text: clip(note, 600) } };
  }
  if (event.type === "session.error")
    return {
      ...base,
      kind: "error",
      detail: { text: clip(event.error?.message ?? "The session hit an error", 300) },
    };
  return null;
}

/** What a viewer who may not see the code gets: the kind, never the content. */
export function redactActivity(line: ActivityLine): ActivityLine {
  const { detail } = line;
  const kept: ActivityDetail = {};
  for (const key of ["added", "removed", "lines", "ok", "passed", "failed", "phase"] as const)
    if (detail[key] !== undefined) (kept as Record<string, unknown>)[key] = detail[key];
  // Notes, review summaries and outcomes may quote the code or the ticket.
  if (line.kind === "note") return { ...line, detail: {} };
  return { ...line, detail: kept };
}

/** The stages a run goes through, lit as its lines come in. */
export const stages = ["read", "write", "test", "review", "pr"] as const;
export type Stage = (typeof stages)[number];

export function reachedStages(
  lines: ActivityLine[],
  phase: string | null,
  status: string,
): Set<Stage> {
  const reached = new Set<Stage>();
  for (const line of lines) {
    if (line.kind === "read" || line.kind === "search") reached.add("read");
    if (line.kind === "edit" || line.kind === "write") reached.add("write");
    if (line.kind === "test") reached.add("test");
    if (line.kind === "review") reached.add("review");
  }
  if (phase && /review|fix/.test(phase)) reached.add("review");
  if (phase === "delivering" || status === "pull_request") reached.add("pr");
  return reached;
}

/** Consecutive reads (and searches) read as one line: "Read 14 files". */
export type ActivityGroup = ActivityLine & { count: number };

export function groupActivity(lines: ActivityLine[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const line of lines) {
    const last = groups.at(-1);
    if (
      last &&
      last.kind === line.kind &&
      (line.kind === "read" || line.kind === "search")
    ) {
      last.count += 1;
      last.detail = line.detail;
      last.at = line.at;
      continue;
    }
    groups.push({ ...line, count: 1 });
  }
  return groups;
}
