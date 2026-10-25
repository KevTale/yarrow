import { modelDisplayName } from "./pipeline";

/** Where a ticket stands, from the builder's point of view. */
export type TicketStatus =
  | "none"
  | "queued"
  | "writing"
  | "reviewing"
  | "delivering"
  | "pull_request"
  | "merged"
  | "pr_closed"
  | "abstained";

/** One model's part in a run. Stats are null until the run is settled. */
export interface TicketModel {
  role: "implementer" | "reviewer";
  name: string;
  effort: string | null;
  active: boolean;
  seconds: number | null;
  secondsExact: boolean;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costCents: number | null;
  costExact: boolean;
}

export interface TicketRow {
  number: number;
  title: string;
  url: string;
  status: TicketStatus;
  /** Waiting for the brain to add or remove the label on GitHub. */
  pending: boolean;
  pullRequest: { number: number; url: string } | null;
  reason: string | null;
  models: TicketModel[];
  updatedAt: string;
}

/** An open issue, read live from GitHub (never stored). */
export interface OpenIssue {
  number: number;
  title: string;
  url: string;
  updatedAt: string;
}

/** In Yarrow: queued, worked on, or shipped. */
export const inYarrow = (row: TicketRow) => row.status !== "none";

/** Statuses a builder can still act on (queue, retry, remove). */
export const queueable = (row: TicketRow) =>
  row.status === "none" || row.status === "abstained";
export const removable = (row: TicketRow) => row.status === "queued";

/** Still moving: worth refreshing the table for. */
export const moving = (row: TicketRow) =>
  row.pending ||
  ["queued", "writing", "reviewing", "delivering"].includes(row.status);

/**
 * The table: Yarrow's tickets, plus the open issues Yarrow has not touched.
 * Most recently updated first.
 */
export function mergeTickets(
  rows: TicketRow[],
  issues: OpenIssue[] | null,
): TicketRow[] {
  const merged = rows.map((row) => ({ ...row }));
  const known = new Map(merged.map((row) => [row.number, row]));
  for (const issue of issues ?? []) {
    const row = known.get(issue.number);
    if (row) {
      // GitHub has the current title.
      row.title = issue.title;
      row.url ||= issue.url;
      if (issue.updatedAt > row.updatedAt) row.updatedAt = issue.updatedAt;
      continue;
    }
    merged.push({
      number: issue.number,
      title: issue.title,
      url: issue.url,
      status: "none",
      pending: false,
      pullRequest: null,
      reason: null,
      models: [],
      updatedAt: issue.updatedAt,
    });
  }
  return merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** "claude-opus-5-5:high" → Claude Opus 5.5 at high effort, no stats yet. */
export function plannedModel(
  role: "implementer" | "reviewer",
  id: string,
  active: boolean,
): TicketModel {
  const [model, effort] = id.split(":");
  return {
    role,
    name: modelDisplayName(model!),
    effort: effort ?? null,
    active,
    seconds: null,
    secondsExact: false,
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    costCents: null,
    costExact: false,
  };
}

/** Run phases, as the brain sets them, to what the table shows. */
export function phaseStatus(
  phase: string | null,
): "writing" | "reviewing" | "delivering" {
  if (phase === "delivering") return "delivering";
  if (
    phase === "reviewing" ||
    phase === "re-reviewing" ||
    phase === "checking clarity"
  )
    return "reviewing";
  return "writing";
}

/** "1 min 12 s", "28 s". */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return rest ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/** "182k", "6.4k", "950". */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 10_000) return `${Math.round(tokens / 1_000)}k`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return String(tokens);
}
