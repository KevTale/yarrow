/**
 * How a pull request's notes read for a product manager and a developer at
 * once. The agents write each note in everyday words first, then, after
 * " — ", where it comes from for a developer; what the ticket asks comes
 * as acceptance criteria, ticked. Notes written before (one technical
 * line) still read.
 */

import type { Criterion } from "./contracts";
import { TITLE_MAX } from "./new-ticket";

/** A note's everyday words, and its technical pointer when it has one. */
export function splitNote(line: string): { plain: string; detail: string } {
  const at = line.indexOf(" — ");
  if (at <= 0) return { plain: line.trim(), detail: "" };
  return {
    plain: line.slice(0, at).trim(),
    detail: line.slice(at + 3).trim(),
  };
}

/**
 * A criterion in the pull request's description, ticked as in Yarrow: how
 * a met one was shown is the agents' business (decided 2026-10-23), why
 * one is not met or not checked is the owner's.
 */
export function criterionMarkdown(item: Criterion): string {
  const mark =
    item.status === "met" ? "✅" : item.status === "unmet" ? "❌" : "⬜";
  const why =
    item.status === "met"
      ? ""
      : item.status === "unmet"
        ? `not met${item.note ? `: ${item.note}` : ""}`
        : `not checked${item.note ? `: ${item.note}` : ""}`;
  return `- ${mark} ${item.criterion}${why ? ` _(${why})_` : ""}`;
}

/**
 * What the agent tells the owner beside the pull request, each in everyday
 * words: what is still wrong, what must be done, what could not be checked.
 * None means all is well, and the agent says so (decided 2026-10-30): the
 * summary no longer carries any of it.
 */
export function agentNotes(input: {
  blocking: { body: string }[];
  criteria: Criterion[];
  risks: string[];
  notVerified: string[];
  /** GitHub's check passed: it shows what the agent could not see from here. */
  checked?: boolean;
}): string[] {
  const missing = (status: Criterion["status"], words: string) =>
    input.criteria
      .filter((item) => item.status === status)
      .map(
        (item) =>
          `${words}: ${item.criterion}${item.note ? ` (${item.note})` : ""}`,
      );
  const lines = [
    ...input.blocking.map((comment) => comment.body),
    ...missing("unmet", "Not met"),
    ...input.risks,
    ...input.notVerified,
    ...(input.checked ? [] : missing("unchecked", "Not checked")),
  ].map((line) => splitNote(line).plain);
  return [...new Set(lines)];
}

/** A suggestion's first sentence, the title of the ticket made from it. */
function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return (end === -1 ? text : text.slice(0, end)).trim();
}

/** A ticket drafted from what the agents noticed outside theirs. */
export function spottedTicket(
  line: string,
  by: string,
  pullRequestUrl: string | null,
): { title: string; body: string } {
  const sentence = firstSentence(splitNote(line).plain);
  const title =
    sentence.length > TITLE_MAX
      ? `${sentence.slice(0, TITLE_MAX - 1).trimEnd()}…`
      : sentence;
  const where = pullRequestUrl ? ` while working on ${pullRequestUrl}` : "";
  return { title, body: `${line}\n\nNoticed by ${by}${where}.` };
}
