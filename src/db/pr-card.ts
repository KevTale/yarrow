import { asc, desc, eq, sql } from "drizzle-orm";
import { shortSite, type PrCardSponsor } from "../core/pr-card";
import type { Database } from "./client";
import { readImage } from "./images";
import { contributions, runFundings, sponsorProfiles } from "./schema";

/** Bytes as base64, in chunks a Worker's `btoa` takes. */
function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * A logo the image proxy can show: uploaded logos read from the database
 * and inlined, data URLs kept, anything else left out (the initial shows).
 */
async function inlineLogo(
  db: Database,
  url: string | null,
): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:image/")) return url;
  const name = /^\/images\/([0-9a-f]{64}\.(?:webp|png|jpg))$/.exec(url)?.[1];
  if (!name) return null;
  const image = await readImage(db, name);
  return image
    ? `data:${image.contentType};base64,${base64(new Uint8Array(image.bytes))}`
    : null;
}

/**
 * Who paid for a run, the largest share first, as the pull request's card
 * shows them. Anonymous sponsors carry no profile.
 */
export async function runCardSponsors(
  db: Database,
  runId: string,
): Promise<PrCardSponsor[]> {
  const share = sql<number>`sum(${runFundings.reservedCents} + ${runFundings.debitedCents})`;
  const rows = await db
    .select({
      publicId: sponsorProfiles.publicId,
      name: sponsorProfiles.publicName,
      description: sponsorProfiles.description,
      websiteUrl: sponsorProfiles.websiteUrl,
      logoUrl: sponsorProfiles.logoUrl,
      cents: sql<number>`sum(${runFundings.reservedCents} + ${runFundings.debitedCents})::int`,
    })
    .from(runFundings)
    .innerJoin(contributions, eq(contributions.id, runFundings.contributionId))
    .leftJoin(sponsorProfiles, eq(sponsorProfiles.userId, contributions.userId))
    .where(eq(runFundings.agentRunId, runId))
    .groupBy(
      contributions.userId,
      sponsorProfiles.publicId,
      sponsorProfiles.publicName,
      sponsorProfiles.description,
      sponsorProfiles.websiteUrl,
      sponsorProfiles.logoUrl,
    )
    .orderBy(desc(share), asc(sql`min(${contributions.createdAt})`));
  return Promise.all(
    rows.map(async (row, i) => ({
      name: row.name,
      description: row.name ? row.description : null,
      site: row.name ? shortSite(row.websiteUrl) : null,
      // Only the first sponsor's logo is drawn.
      logo: row.name && i === 0 ? await inlineLogo(db, row.logoUrl) : null,
    })),
  );
}
