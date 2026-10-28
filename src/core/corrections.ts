/**
 * A maintainer asks for a change on a Yarrow pull request by starting a
 * comment with the GitHub App's mention: `@yarrow-run` in prod,
 * `@yarrow-run-dev` in dev (the app's slug).
 */
export const PROD_APP_SLUG = "yarrow-run";

export const mention = (slug: string) => `@${slug}`;

/**
 * Matches the mention at the start of a comment, and only this app's:
 * `@yarrow-run-dev` is not `@yarrow-run` followed by "-dev".
 */
export function mentionPattern(slug: string): RegExp {
  const name = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\s*@${name}(?![\\w-])[:,]?\\s*`, "i");
}

/** The line every pull request carries, so maintainers know they can ask. */
export const correctionHint = (slug: string) =>
  `Need a change? Comment \`${mention(slug)}\` followed by what to change, and Yarrow adds a commit to this pull request.`;
