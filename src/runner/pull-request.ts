import {
  assistedByTrailer,
  pullRequestFooter,
  type RunSponsor,
} from "../core/attribution";
import { modelDisplayName, type PipelineRoles } from "../core/pipeline";
import type { StoredReview } from "../core/review";

export interface PullRequestInput {
  ticket: { title: string; url: string; source: string; number?: number };
  summary: string;
  verification: string[];
  risks: string[];
  review: StoredReview | null;
  evidence: { label: string; url: string; kind: "screenshot" | "video" }[];
  roles: PipelineRoles;
  sponsors: RunSponsor[];
  runUrl: string;
}

/** Strips tracker keys like "ENG-12 " from the PR title. */
function cleanTitle(title: string): string {
  return title.replace(/^[A-Z][A-Z0-9]+-\d+\s+/, "").slice(0, 120);
}

/** Jira keeps its key ("APP-42 Fix…"): Jira links the pull request by it. */
export function pullRequestTitle(
  input: Pick<PullRequestInput, "ticket">,
): string {
  return input.ticket.source === "jira"
    ? input.ticket.title.slice(0, 120)
    : cleanTitle(input.ticket.title);
}

/** A PR body readable in two minutes: what, why, how verified, review, risks. */
export function pullRequestBody(input: PullRequestInput): string {
  const sections: string[] = [];
  sections.push(
    input.ticket.source === "github" && input.ticket.number
      ? `Closes #${input.ticket.number}`
      : `Ticket: ${input.ticket.url}`,
  );
  sections.push(`## What changed\n\n${input.summary || "See the diff."}`);
  const verified = [
    ...input.verification.map((line) => `- ${line}`),
    ...input.evidence.map(
      (item) =>
        `- ${item.kind === "video" ? "Video" : "Screenshot"}: [${item.label}](${item.url})`,
    ),
  ];
  sections.push(
    `## How it was verified\n\n${verified.join("\n") || "- No automated verification was reported."}`,
  );
  if (input.review)
    sections.push(
      `## Review\n\nReviewed by ${modelDisplayName(input.review.reviewer)}${input.review.rounds > 1 ? " after one fix round" : ""}: ${input.review.summary}`,
    );
  if (input.risks.length > 0)
    sections.push(
      `## Risks\n\n${input.risks.map((risk) => `- ${risk}`).join("\n")}`,
    );
  sections.push(
    pullRequestFooter({
      roles: input.roles,
      sponsors: input.sponsors,
      runUrl: input.runUrl,
    }),
  );
  return sections.join("\n\n");
}

export function commitMessage(input: {
  title: string;
  summary: string;
  ticketUrl: string;
  roles: PipelineRoles;
  correction?: string | null;
}): string {
  const subject = input.correction
    ? `Address review: ${input.correction.split("\n")[0]!.slice(0, 60)}`
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
  footer: string;
}): string {
  return [
    `**Correction applied** for: _${input.instruction.slice(0, 300)}_`,
    "",
    input.summary,
    "",
    input.footer,
  ].join("\n");
}
