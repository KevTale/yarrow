import { modelDisplayName, type PipelineRoles } from "./pipeline";

/** Funding sponsors of a run; `null` name means anonymous. */
export interface RunSponsor {
  name: string | null;
  /** Their row on the boards (anonymous sponsors rank too). */
  publicId?: string | null;
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** "Northwind, Mara and an anonymous sponsor". Anonymous sponsors are merged. */
export function sponsorNames(sponsors: readonly RunSponsor[]): string | null {
  const named = [
    ...new Set(sponsors.map((sponsor) => sponsor.name).filter(Boolean)),
  ] as string[];
  const anonymous = sponsors.filter((sponsor) => !sponsor.name).length;
  const parts = [...named];
  if (anonymous === 1) parts.push("an anonymous sponsor");
  if (anonymous > 1) parts.push(`${anonymous} anonymous sponsors`);
  return parts.length > 0 ? list(parts) : null;
}

const escapeHtml = (text: string) =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * The card image at the foot of the pull request, served by the app next
 * to the run page: who paid, drawn as their row on the boards, in the
 * colors opposite to the reader's GitHub theme (light on dark, dark on
 * light: GitHub picks the `<picture>` source). An image carries one link:
 * the sponsor's website (counted) when one named sponsor paid alone,
 * otherwise the run.
 */
export function sponsorCard(input: {
  sponsors: readonly RunSponsor[];
  runUrl: string;
}): string | null {
  const names = sponsorNames(input.sponsors);
  const match = /^(https?:\/\/[^/]+)\/runs\/([0-9a-f-]{36})$/.exec(
    input.runUrl,
  );
  if (!names || !match) return null;
  const [, origin, runId] = match;
  const only = input.sponsors.length === 1 ? input.sponsors[0] : null;
  const link =
    only?.name && only.publicId
      ? `${origin}/out/${only.publicId}`
      : input.runUrl;
  const src = `${origin}/pr-card/${runId}`;
  const alt = escapeHtml(`Sponsored by ${names}, powered by Yarrow`);
  return `<a href="${link}"><picture><source media="(prefers-color-scheme: dark)" srcset="${src}?theme=light"><img alt="${alt}" src="${src}?theme=dark"></picture></a>`;
}

/**
 * The PR body footer required by the brief: the models close the pull
 * request's own text, then a rule and the sponsors' card. Without a card
 * (no sponsor, or no run page), the sponsors are named in words.
 */
export function pullRequestFooter(input: {
  roles: PipelineRoles;
  sponsors: readonly RunSponsor[];
  runUrl: string;
}): string {
  const names = sponsorNames(input.sponsors);
  const models = `Implemented by ${modelDisplayName(input.roles.implementer)} · Reviewed by ${modelDisplayName(input.roles.reviewer)}`;
  const funding = names
    ? `Sponsored by ${names} via [Yarrow](${input.runUrl})`
    : `via [Yarrow](${input.runUrl})`;
  const card = sponsorCard(input);
  // A blank line before the rule: right under text, "---" makes a heading.
  return card
    ? [models, "", "---", "", card].join("\n")
    : ["---", models, funding].join("\n");
}

/** Commit trailer. Agents never add Signed-off-by: the owner certifies at merge. */
export function assistedByTrailer(roles: PipelineRoles): string {
  return `Assisted-by: ${modelDisplayName(roles.implementer)}, ${modelDisplayName(roles.reviewer)} (Yarrow)`;
}
