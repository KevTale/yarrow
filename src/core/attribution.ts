import { modelDisplayName, type PipelineRoles } from "./pipeline";

/** Funding sponsors of a run; `null` name means anonymous. */
export interface RunSponsor {
  name: string | null;
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

/** The PR body footer required by the brief. */
export function pullRequestFooter(input: {
  roles: PipelineRoles;
  sponsors: readonly RunSponsor[];
  runUrl: string;
}): string {
  const names = sponsorNames(input.sponsors);
  const models = `Implemented by ${modelDisplayName(input.roles.implementer)} · Reviewed by ${modelDisplayName(input.roles.reviewer)}`;
  const funding = names
    ? `Sponsored by ${names} via [Agent Commons](${input.runUrl})`
    : `via [Agent Commons](${input.runUrl})`;
  return ["---", models, funding].join("\n");
}

/** Commit trailer. Agents never add Signed-off-by: the owner certifies at merge. */
export function assistedByTrailer(roles: PipelineRoles): string {
  return `Assisted-by: ${modelDisplayName(roles.implementer)}, ${modelDisplayName(roles.reviewer)} (Agent Commons)`;
}
