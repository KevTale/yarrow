import {
  defaultReviewerEffort,
  modelDisplayName,
  modelShortName,
} from "./pipeline";

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

/** A ticket at work: the model doing it, and what it does. */
export interface WorkLabel {
  /** "Claude Opus", or null when no model is named (delivering). */
  model: string | null;
  /** "is writing", "is reviewing", "Opening the PR". */
  text: string;
}

/**
 * "Claude Opus is writing", "GPT Astra is reviewing", "Opening the PR":
 * the same words everywhere a ticket at work shows. Null once it is done.
 */
export function workLabel(
  status: string,
  models: TicketModel[],
): WorkLabel | null {
  if (status === "delivering") return { model: null, text: "Opening the PR" };
  if (status !== "writing" && status !== "reviewing") return null;
  const role = status === "writing" ? "implementer" : "reviewer";
  const model = models.find((candidate) => candidate.role === role);
  const verb = status === "writing" ? "writing" : "reviewing";
  return model
    ? { model: modelShortName(model.name), text: `is ${verb}` }
    : { model: null, text: verb[0]!.toUpperCase() + verb.slice(1) };
}

/** The label as one string, for a plain cell. */
export function workText(status: string, models: TicketModel[]): string | null {
  const label = workLabel(status, models);
  return label ? [label.model, label.text].filter(Boolean).join(" ") : null;
}

/** Where a ticket lives. The code always lives on GitHub. */
export type TicketSourceId = "github" | "linear" | "jira" | "trello";

/** The parts every row of the builder's table shares, Yarrow's or not. */
interface TicketIdentity {
  /** Unique in a project: "42" for a GitHub issue, "APP-42" for Jira. */
  key: string;
  source: TicketSourceId;
  /** How people name it: "#42", "APP-42", a Trello card's "#42". */
  ref: string;
  /** For the order: the issue number, or the number in the key. */
  number: number;
  title: string;
  url: string;
  /** When the ticket was written: the tracker's date, else Yarrow's first sight. */
  createdAt: string;
  updatedAt: string;
  /** Who wrote it, as the open tickets read live say. */
  author?: string | null;
}

/** A sponsor whose money went into a ticket's runs. Null name: anonymous. */
export interface PaidBy {
  name: string | null;
  /** For /out/<publicId>: the click is counted, then the website opens. */
  publicId: string | null;
  description: string | null;
  logoUrl: string | null;
  websiteUrl: string | null;
}

export interface TicketRow extends TicketIdentity {
  /** The change in one line, by the reviewer: the row's title once it has one. */
  headline: string | null;
  status: TicketStatus;
  /** Every sponsor of the ticket's runs, the largest share first. */
  paidBy: PaidBy[];
  /** The latest run, whose activity opens from the status. */
  runId: string | null;
  /** Waiting for the label to be added or removed on GitHub. */
  pending: boolean;
  pullRequest: { number: number; url: string } | null;
  /**
   * A change asked on its pull request, waiting its turn or at work: the
   * pull request is Yarrow's again until its commit lands.
   */
  change: "queued" | "writing" | "reviewing" | "delivering" | null;
  /** Why the agents stopped ("ticket_unclear"), when abstained. */
  reason: string | null;
  /** The agents' own words then: what they found, their questions. */
  summary: string | null;
  models: TicketModel[];
}

/** A pull request waiting for its builder, from any of their projects. */
export type ReviewRow = TicketRow & {
  project: { id: string; name: string; logoUrl: string | null };
};

/** An open ticket, read live from GitHub or Jira (never stored). */
export type OpenIssue = TicketIdentity;

/**
 * "42" on GitHub, "APP-42" in Jira, "AbCd1234-42" on Trello, which shows "#42":
 * the row's key, ref and number.
 */
export function ticketIdentity(
  source: TicketSourceId,
  externalId: string,
): Pick<TicketIdentity, "key" | "source" | "ref" | "number"> {
  const number = Number(/\d+$/.exec(externalId)?.[0] ?? 0);
  return {
    key: externalId,
    source,
    ref:
      source === "github"
        ? `#${externalId}`
        : source === "trello"
          ? `#${number}`
          : externalId,
    number,
  };
}

/** Tracker titles are stored with their key in front ("APP-42 Fix…"). */
export const bareTitle = (title: string, key: string) =>
  title.startsWith(`${key} `) ? title.slice(key.length + 1) : title;

/** In Yarrow: queued, worked on, or shipped. */
export const inYarrow = (row: TicketRow) => row.status !== "none";

/** Rows the batch bar acts on: add to the queue, or remove from it. */
export const queueable = (row: TicketRow) => row.status === "none";
export const removable = (row: TicketRow) => row.status === "queued";
export const selectable = (row: TicketRow) => queueable(row) || removable(row);

/** Its pull request waits for its builder: no change asked is under way. */
export const toReview = (row: TicketRow) =>
  row.status === "pull_request" && row.change === null;

/** Its pull request was merged or closed: nothing left to do here. */
export const done = (row: TicketRow) =>
  row.status === "merged" || row.status === "pr_closed";

/** The dashboard's groups: each ticket is in exactly one. */
export type TicketStage = "review" | "progress" | "todo" | "stopped" | "done";

/** The group a ticket stands in, from its state alone, opened or not. */
export function ticketStage(row: TicketRow): TicketStage {
  if (toReview(row)) return "review";
  if (!inYarrow(row)) return "todo";
  // Abandoned by the agents: the builder's turn (edit, then retry).
  if (row.status === "abstained") return "stopped";
  if (done(row)) return "done";
  // Queued, at work, or a pull request with a change under way.
  return "progress";
}

/** Still moving: worth refreshing the table for. */
export const moving = (row: TicketRow) =>
  row.pending ||
  row.change !== null ||
  ["queued", "writing", "reviewing", "delivering"].includes(row.status);

const sourceOrder: TicketSourceId[] = ["github", "jira", "linear", "trello"];

/**
 * The table: Yarrow's tickets, plus the open tickets Yarrow has not
 * touched. GitHub issues first, then each tracker; newest first in each.
 */
export function mergeTickets(
  rows: TicketRow[],
  issues: OpenIssue[] | null,
): TicketRow[] {
  const merged = rows.map((row) => ({ ...row }));
  const known = new Map(merged.map((row) => [row.key, row]));
  for (const issue of issues ?? []) {
    const row = known.get(issue.key);
    if (row) {
      // The tracker has the current title.
      row.title = issue.title;
      row.url ||= issue.url;
      row.createdAt = issue.createdAt;
      row.author = issue.author;
      if (issue.updatedAt > row.updatedAt) row.updatedAt = issue.updatedAt;
      continue;
    }
    merged.push({
      ...issue,
      status: "none",
      headline: null,
      paidBy: [],
      runId: null,
      pending: false,
      pullRequest: null,
      change: null,
      reason: null,
      summary: null,
      models: [],
    });
  }
  // A row never moves when its status changes.
  return merged.sort(
    (a, b) =>
      sourceOrder.indexOf(a.source) - sourceOrder.indexOf(b.source) ||
      b.number - a.number,
  );
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
    effort: effort ?? (role === "reviewer" ? defaultReviewerEffort : null),
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

/** What the brain recorded for one model (a run_models row). */
export interface RecordedModel {
  role: "implementer" | "reviewer";
  model: string;
  effort: string | null;
  seconds: number | null;
  secondsExact: boolean;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costCents: number;
  costExact: boolean;
}

/**
 * The models of a run: what was recorded once it settled, otherwise the
 * configured ones, the one at work highlighted (the reviewer only once the
 * implementer is done).
 */
export function runModelsView(
  recorded: RecordedModel[],
  planned: { implementer: string; reviewer: string },
  status: TicketStatus,
): TicketModel[] {
  if (recorded.length > 0)
    return [...recorded]
      .sort((a, b) => a.role.localeCompare(b.role))
      .map((model) => ({
        role: model.role,
        name: modelDisplayName(model.model),
        effort: model.effort,
        active: false,
        seconds: model.seconds,
        secondsExact: model.secondsExact,
        inputTokens: model.inputTokens,
        cachedInputTokens: model.cachedInputTokens,
        outputTokens: model.outputTokens,
        costCents: model.costCents,
        costExact: model.costExact,
      }));
  const writing = status === "writing";
  return [
    plannedModel("implementer", planned.implementer, writing),
    ...(writing
      ? []
      : [plannedModel("reviewer", planned.reviewer, status === "reviewing")]),
  ];
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
