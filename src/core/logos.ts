/**
 * A project's logo: the one its builder uploaded, else the GitHub owner's
 * avatar. Pass a null repository where the project must stay anonymous.
 */
export function projectLogo(
  logoUrl: string | null,
  repository: string | null,
): string | null {
  if (logoUrl) return logoUrl;
  const owner = repository?.split("/")[0];
  return owner ? `https://github.com/${owner}.png?size=96` : null;
}
