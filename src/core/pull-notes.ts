/**
 * How a pull request's notes read for a product manager and a developer at
 * once. The agents write each note in everyday words first, then, after
 * " — ", where it comes from for a developer; a check reads "what it shows:
 * the check itself". Notes written before (one technical line) still read.
 */

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

/** A label is a few words, not a command: "Reload keeps the filter". */
const LABEL_MAX = 60;

/** What a check shows, in everyday words, or null when it has no label. */
export function checkLabel(line: string): string | null {
  const at = line.indexOf(": ");
  if (at <= 0 || at > LABEL_MAX) return null;
  const label = line.slice(0, at).trim();
  return /[→`/=]/.test(label) ? null : label;
}

/** The folded line over the checks: their labels when all have one. */
export function checksLine(lines: string[]): string {
  const labels = lines.map(checkLabel);
  if (labels.every((label): label is string => label !== null))
    return labels.join(" · ");
  return lines.length === 1
    ? "1 check passed"
    : `${lines.length} checks passed`;
}

/** A ticket drafted from what the agents noticed outside theirs. */
export function spottedTicket(
  line: string,
  by: string,
  pullRequestUrl: string | null,
): { title: string; body: string } {
  const { plain } = splitNote(line);
  const title =
    plain.length > TITLE_MAX
      ? `${plain.slice(0, TITLE_MAX - 1).trimEnd()}…`
      : plain.replace(/\.$/, "");
  const where = pullRequestUrl ? ` while working on ${pullRequestUrl}` : "";
  return { title, body: `${line}\n\nNoticed by ${by}${where}.` };
}
