import {
  assistedByTrailer,
  pullRequestFooter,
  type RunSponsor,
} from "../core/attribution";
import type { Criterion } from "../core/contracts";
import { correctionHint } from "../core/corrections";
import { criterionMarkdown } from "../core/pull-notes";
import { modelDisplayName, type PipelineRoles } from "../core/pipeline";
import {
  blockingComments,
  type ReviewComment,
  type StoredReview,
} from "../core/review";

/**
 * The review where the owner reads it, in the pull request: the reviewer's
 * words when it wrote them apart (before it told What changed), what is
 * still to fix when the fix round was not enough, then at most three
 * suggestions (nits are noise). Empty when there is nothing left to say.
 */
export function reviewSection(review: StoredReview): string {
  const line = (comment: ReviewComment) =>
    `- ${comment.path ? `\`${comment.path}${comment.line ? `:${comment.line}` : ""}\`: ` : ""}${comment.body}`;
  const blocking = blockingComments(review).map(line);
  const suggestions = review.comments
    .filter((comment) => comment.severity === "suggestion")
    .slice(0, 3)
    .map(line);
  const lines = [
    ...(review.changed ? [] : ["", review.summary]),
    ...(blocking.length ? ["", "**Still to fix**", "", ...blocking] : []),
    ...(suggestions.length ? ["", ...suggestions] : []),
  ];
  if (lines.length === 0) return "";
  return [`## Review by ${modelDisplayName(review.reviewer)}`, ...lines].join(
    "\n",
  );
}

export interface PullRequestInput {
  ticket: { title: string; url: string; source: string; number?: number };
  summary: string;
  /** What the ticket asks, ticked; none before acceptance criteria. */
  criteria?: Criterion[];
  verification: string[];
  notVerified: string[];
  /** What the owner must act on: usually none. */
  risks: string[];
  /** Problems outside the ticket, left alone. */
  spotted: string[];
  review: StoredReview | null;
  /** Shown in the description: public projects only. */
  evidence: { label: string; url: string; kind: "screenshot" | "video" }[];
  /** A private project's evidence: counted, and seen in Yarrow by its builders. */
  evidenceInYarrow?: { count: number; url: string } | null;
  /** Played on the run's page; a public project's still shows here. */
  presentation?: { title: string; url: string; poster: string | null } | null;
  /** What proves it, rendered (src/core/proofs.ts), under What changed; or empty. */
  proof?: string;
  roles: PipelineRoles;
  sponsors: RunSponsor[];
  runUrl: string;
  /** The GitHub App's slug, mentioned to ask for a change. */
  appSlug: string;
}

/** Strips tracker keys like "ENG-12 " from the PR title. */
function cleanTitle(title: string): string {
  return title.replace(/^[A-Z][A-Z0-9]+-\d+\s+/, "").slice(0, 120);
}

/**
 * Jira and Linear keep their key ("APP-42 Fix…"): each links the pull
 * request to its ticket by it.
 */
export function pullRequestTitle(
  input: Pick<PullRequestInput, "ticket">,
): string {
  return input.ticket.source === "jira" || input.ticket.source === "linear"
    ? input.ticket.title.slice(0, 120)
    : cleanTitle(input.ticket.title);
}

/**
 * Yarrow's own part of the description, between these marks: a correction
 * rewrites it, and what anyone wrote outside them stays.
 */
export const BLOCK_START = "<!-- yarrow:summary -->";
export const BLOCK_END = "<!-- /yarrow:summary -->";

const bullets = (lines: string[]) =>
  lines.map((line) => `- ${line}`).join("\n");

/** What the pull request does now: Yarrow's part of the description. */
export function pullRequestBlock(
  input: Omit<PullRequestInput, "roles" | "sponsors" | "runUrl" | "appSlug">,
): string {
  const sections: string[] = [];
  sections.push(
    input.ticket.source === "github" && input.ticket.number
      ? `Closes #${input.ticket.number}`
      : `Ticket: ${input.ticket.url}`,
  );
  // The summary, then what proves it right under it, the film first: one
  // section read top to bottom (decided 2026-10-29).
  const changed = [`## What changed\n\n${input.summary || "See the diff."}`];
  const presentation = input.presentation;
  if (presentation)
    changed.push(
      `<!-- yarrow:proof film -->\n${
        presentation.poster
          ? `[![${presentation.title.replace(/[[\]]/g, "")}](${presentation.poster})](${presentation.url})\n\n`
          : ""
      }[Watch it in Yarrow](${presentation.url})`,
    );
  if (input.proof) changed.push(input.proof);
  sections.push(changed.join("\n\n"));
  if (input.evidence.length > 0)
    sections.push(
      `## Screenshots\n\n${input.evidence
        .map((item) =>
          item.kind === "video"
            ? `[Video: ${item.label}](${item.url})`
            : `**${item.label}**\n\n![${item.label}](${item.url})`,
        )
        .join("\n\n")}`,
    );
  const criteria = input.criteria ?? [];
  if (criteria.length > 0)
    sections.push(
      `## Acceptance criteria\n\n${criteria.map(criterionMarkdown).join("\n")}`,
    );
  const shots = input.evidenceInYarrow;
  const verified = [
    ...input.verification.map((line) => `- ${line}`),
    ...(shots && shots.count > 0
      ? [
          `- [${shots.count} screenshot${shots.count === 1 ? "" : "s"}](${shots.url}), in Yarrow`,
        ]
      : []),
  ];
  sections.push(
    `## How it was verified\n\n${verified.join("\n") || "- No automated verification was reported."}`,
  );
  if (input.notVerified.length > 0)
    sections.push(`## Not verified\n\n${bullets(input.notVerified)}`);
  const reviewed = input.review && reviewSection(input.review);
  if (reviewed) sections.push(reviewed);
  if (input.risks.length > 0)
    sections.push(`## Before merging\n\n${bullets(input.risks)}`);
  if (input.spotted.length > 0)
    sections.push(
      `## Spotted outside this ticket\n\n${bullets(input.spotted)}`,
    );
  return [BLOCK_START, ...sections, BLOCK_END].join("\n\n");
}

/** A PR body readable in two minutes: what, why, how verified, review, risks. */
export function pullRequestBody(input: PullRequestInput): string {
  const sections = [pullRequestBlock(input)];
  sections.push(correctionHint(input.appSlug));
  sections.push(
    pullRequestFooter({
      roles: input.roles,
      sponsors: input.sponsors,
      runUrl: input.runUrl,
    }),
  );
  return sections.join("\n\n");
}

/**
 * The description with Yarrow's part rewritten. Before the marks existed,
 * Yarrow's part ran to the line that asks for a change, or to the footer.
 * Null when neither is found: the description is someone else's now.
 */
export function replaceBlock(body: string, block: string): string | null {
  const text = body.replace(/\r\n/g, "\n");
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start !== -1 && end > start)
    return text.slice(0, start) + block + text.slice(end + BLOCK_END.length);
  const boundary = /\n(?:Need a change\?|Implemented by )/.exec(text);
  if (!boundary) return null;
  return `${block}\n\n${text.slice(boundary.index + 1)}`;
}

export function commitMessage(input: {
  title: string;
  summary: string;
  ticketUrl: string;
  roles: PipelineRoles;
  correction?: string | null;
}): string {
  const subject = input.correction
    ? `Correction: ${input.correction.split("\n")[0]!.slice(0, 60)}`
    : cleanTitle(input.title).slice(0, 72);
  return [
    subject,
    "",
    input.summary.slice(0, 2000),
    "",
    `Refs: ${input.ticketUrl}`,
    "",
    assistedByTrailer(input.roles),
  ].join("\n");
}

export function correctionComment(input: {
  instruction: string;
  summary: string;
  review: StoredReview | null;
  footer: string;
}): string {
  const reviewed = input.review && reviewSection(input.review);
  return [
    `**Correction applied** for: _${input.instruction.slice(0, 300)}_`,
    "",
    input.summary,
    ...(reviewed ? ["", reviewed] : []),
    "",
    input.footer,
  ].join("\n");
}
