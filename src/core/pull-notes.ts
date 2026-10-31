/**
 * How a pull request's notes read for a product manager and a developer at
 * once. The agents write each note in everyday words first, then, after
 * " — ", where it comes from for a developer; what the ticket asks comes
 * as acceptance criteria, ticked with how each was shown. Notes written
 * before (one technical line) still read.
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

/** How a criterion was shown, as its tag reads: "in the app". */
export function proofLabel(proof: Criterion["proof"]): string {
  switch (proof) {
    case "app":
      return "in the app";
    case "test":
      return "by a test";
    case "request":
      return "by a request";
    default:
      return "";
  }
}

/** A criterion in the pull request's description, ticked as in Yarrow. */
export function criterionMarkdown(item: Criterion): string {
  const mark =
    item.status === "met" ? "✅" : item.status === "unmet" ? "❌" : "⬜";
  const how =
    item.status === "met"
      ? proofLabel(item.proof)
      : item.status === "unmet"
        ? `not met${item.note ? `: ${item.note}` : ""}`
        : `not checked${item.note ? `: ${item.note}` : ""}`;
  return `- ${mark} ${item.criterion}${how ? ` _(${how})_` : ""}`;
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
