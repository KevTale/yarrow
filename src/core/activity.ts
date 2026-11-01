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

/** "12 passed" (Vitest, Jest, pytest), "# pass 12" (node:test, TAP). */
function testCounts(output: string): { passed?: number; failed?: number } {
  const count = (word: string) =>
    new RegExp(
      `(\\d+) (?:tests? )?${word}ed\\b|^\\s*[#ℹ]\\s*${word} (\\d+)`,
      "im",
    )
      .exec(output)
      ?.slice(1)
      .find(Boolean);
  const passed = count("pass");
  const failed = count("fail");
  return {
    ...(passed ? { passed: Number(passed) } : {}),
    ...(failed ? { failed: Number(failed) } : {}),
  };
}

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
        return {
          ...base,
          kind: "read",
          detail: { path: relative(input.file_path ?? input.path) },
        };
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
        const command = clip(
          shortCommand(String(input.command ?? "").trim()),
          300,
        );
        return {
          ...base,
          kind: testCommand.test(command) ? "test" : "command",
          detail: { command },
        };
      }
      case "web_fetch":
        return {
          ...base,
          kind: "web",
          detail: { url: clip(String(input.url ?? ""), 200) },
        };
      case "web_search":
        return {
          ...base,
          kind: "web",
          detail: { text: clip(String(input.query ?? ""), 200) },
        };
      default:
        return null;
    }
  }
  if (event.type === "agent.tool_result" && event.tool_use_id) {
    const counts = testCounts(text(event));
    return {
      ...base,
      kind: "command",
      detail: {
        toolUseId: event.tool_use_id,
        ok: !event.is_error && !(counts.failed && counts.failed > 0),
        ...counts,
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
      detail: {
        text: clip(event.error?.message ?? "The session hit an error", 300),
      },
    };
  return null;
}

/** A Muse Code event, one line of `muse exec --json`. */
export interface MuseEvent {
  payload_type: string;
  sequence?: number;
  payload?: {
    call_id?: string;
    correlation_facts?: { tool_name?: string; outcome?: string };
    edit_facts?: { path?: string; added?: number; removed?: number };
    text?: string | null;
    reason?: string | null;
  };
}

/**
 * One Muse Code event to at most one line. Muse reports a tool once, done,
 * so its line has its outcome at once. `turn` tells the session's turns
 * apart: each one numbers its events from 1 again.
 */
export function activityFromMuseEvent(
  event: MuseEvent,
  at: string,
  turn: number,
): ActivityLine | null {
  const payload = event.payload ?? {};
  const base = {
    externalId: payload.call_id ?? `muse:${turn}:${event.sequence ?? 0}`,
    at,
    actor: "implementer" as const,
  };
  if (event.payload_type === "tool.result") {
    const tool = payload.correlation_facts?.tool_name;
    const ok = payload.correlation_facts?.outcome === "success";
    if (tool === "read_file") {
      // "Read text file `src/views.js`.", then the content.
      const path = /^Read (?:\w+ )?file `([^`]+)`/.exec(
        payload.text ?? "",
      )?.[1];
      return ok && path
        ? { ...base, kind: "read", detail: { path: relative(path) } }
        : null;
    }
    if (tool === "edit_file" || tool === "write_file") {
      const facts = payload.edit_facts;
      if (!ok || !facts?.path) return null;
      return tool === "write_file"
        ? {
            ...base,
            kind: "write",
            detail: { path: relative(facts.path), lines: facts.added ?? 0 },
          }
        : {
            ...base,
            kind: "edit",
            detail: {
              path: relative(facts.path),
              added: facts.added ?? 0,
              removed: facts.removed ?? 0,
            },
          };
    }
    if (tool === "bash") {
      // The result is JSON: the command, its exit code and its output.
      let result: { command?: unknown; exit_code?: unknown; output?: unknown };
      try {
        result = JSON.parse(payload.text ?? "");
      } catch {
        return null;
      }
      const command = clip(
        shortCommand(String(result.command ?? "").trim()),
        300,
      );
      if (!command) return null;
      const counts = testCounts(String(result.output ?? ""));
      return {
        ...base,
        kind: testCommand.test(command) ? "test" : "command",
        detail: {
          command,
          ok: result.exit_code === 0 && !(counts.failed && counts.failed > 0),
          ...counts,
        },
      };
    }
    return null;
  }
  if (event.payload_type === "run.terminal.completed") {
    const note = (payload.text ?? "").trim();
    // The final JSON report is read elsewhere; only prose is a note.
    if (!note || note.startsWith("{")) return null;
    return { ...base, kind: "note", detail: { text: clip(note, 600) } };
  }
  if (event.payload_type === "run.terminal.failed")
    return {
      ...base,
      kind: "error",
      detail: {
        text: clip(
          payload.reason || payload.text || "The run hit an error",
          300,
        ),
      },
    };
  return null;
}

/** What a viewer who may not see the code gets: the kind, never the content. */
export function redactActivity(line: ActivityLine): ActivityLine {
  const { detail } = line;
  const kept: ActivityDetail = {};
  for (const key of [
    "added",
    "removed",
    "lines",
    "ok",
    "passed",
    "failed",
    "phase",
  ] as const)
    if (detail[key] !== undefined)
      (kept as Record<string, unknown>)[key] = detail[key];
  // Notes, review summaries and outcomes may quote the code or the ticket.
  if (line.kind === "note") return { ...line, detail: {} };
  return { ...line, detail: kept };
}

/**
 * What the implementer is at, told from what it does: it reads the code
 * until its first change to the repository, writes the change until it
 * turns to its presentation. Its steps only go forward: an agent goes back
 * and forth between the code and its tests, and the feed would flicker.
 */
const sections = ["reading", "writing", "presenting"] as const;
type Section = (typeof sections)[number];

// The session's own files, named as the repository's once made relative.
const OUTPUTS = /^(result|changes)\.json$/;

function sectionOf(line: ActivityLine): Section | null {
  const path = line.detail.path ?? "";
  if (/(^|\/)presentation(\.json$|\/)|poster/.test(path)) return "presenting";
  if (
    (line.kind === "edit" || line.kind === "write") &&
    !path.startsWith("/") &&
    !OUTPUTS.test(path)
  )
    return "writing";
  return null;
}

/** The implementer's work under the step it is at, a line naming each. */
function withSections(lines: ActivityLine[]): ActivityLine[] {
  const shown: ActivityLine[] = [];
  let at = -1;
  for (const line of lines) {
    if (line.actor === "yarrow") at = -1;
    if (line.kind === "phase" && line.detail.phase === "implementing") {
      at = 0;
      shown.push({ ...line, detail: { phase: "reading" } });
      continue;
    }
    const section = at === -1 ? null : sectionOf(line);
    if (section && sections.indexOf(section) > at) {
      at = sections.indexOf(section);
      shown.push({
        externalId: `${line.externalId}:${section}`,
        at: line.at,
        actor: "yarrow",
        kind: "phase",
        detail: { phase: section },
      });
    }
    shown.push(line);
  }
  return shown;
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

/**
 * The feed a person reads: what the agents did, not how, under the step
 * each was at. Shell commands stay out (tests stay in), and so does the
 * message that ends each of the implementer's turns: it is the run's
 * summary, shown on its own.
 */
export function storyLines(lines: ActivityLine[]): ActivityLine[] {
  const story = lines.filter((line, i) => {
    if (line.kind === "command") return false;
    if (line.kind !== "note" || line.actor !== "implementer") return true;
    const next = lines.slice(i + 1).find((later) => later.kind !== "command");
    return !next || next.actor === "implementer";
  });
  return withSections(story);
}

/** Yarrow's steps, the review and the outcome: the run at a glance. */
export const milestone = (line: ActivityLine) => line.actor !== "implementer";
