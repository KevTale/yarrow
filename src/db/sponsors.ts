import { eq } from "drizzle-orm";
import type { SponsorFilters } from "../core/forms";
import type { Database } from "./client";
import { recordEvent } from "./events";
import { sponsorProfiles, sponsorProjectSelections } from "./schema";

export const defaultSponsorFilters: SponsorFilters = {
  publicName: null,
  mode: "all_except",
  includeHidden: false,
  excludedCategories: [],
  requiredStacks: [],
  selectedProjectIds: [],
};

export async function getSponsorFilters(
  db: Database,
  userId: string,
): Promise<SponsorFilters & { foundingSponsor: boolean }> {
  const [profile] = await db
    .select()
    .from(sponsorProfiles)
    .where(eq(sponsorProfiles.userId, userId));
  if (!profile) return { ...defaultSponsorFilters, foundingSponsor: false };
  const selections = await db
    .select({ projectId: sponsorProjectSelections.projectId })
    .from(sponsorProjectSelections)
    .where(eq(sponsorProjectSelections.userId, userId));
  return {
    publicName: profile.publicName,
    mode: profile.mode,
    includeHidden: profile.includeHidden,
    excludedCategories:
      profile.excludedCategories as SponsorFilters["excludedCategories"],
    requiredStacks: profile.requiredStacks,
    selectedProjectIds: selections.map((row) => row.projectId),
    foundingSponsor: profile.foundingSponsor,
  };
}

/** Selections mean "excluded" in all_except mode and "funded" in only mode. */
export async function saveSponsorFilters(
  db: Database,
  userId: string,
  filters: SponsorFilters,
): Promise<void> {
  await db.transaction(async (tx) => {
    const values = {
      publicName: filters.publicName,
      mode: filters.mode,
      includeHidden: filters.includeHidden,
      excludedCategories: filters.excludedCategories,
      requiredStacks: [...new Set(filters.requiredStacks)],
      updatedAt: new Date(),
    };
    await tx
      .insert(sponsorProfiles)
      .values({ userId, ...values })
      .onConflictDoUpdate({ target: sponsorProfiles.userId, set: values });
    await tx
      .delete(sponsorProjectSelections)
      .where(eq(sponsorProjectSelections.userId, userId));
    const selected = [...new Set(filters.selectedProjectIds)];
    if (selected.length > 0)
      await tx
        .insert(sponsorProjectSelections)
        .values(selected.map((projectId) => ({ userId, projectId })));
    await recordEvent(tx, {
      type: "sponsor.filters_updated",
      userId,
      payload: {
        mode: filters.mode,
        includeHidden: filters.includeHidden,
        selected: selected.length,
        excludedCategories: filters.excludedCategories,
        requiredStacks: filters.requiredStacks,
      },
    });
  });
}

/** Display name and founding flag, kept separate from the filters. */
export async function ensureSponsorProfile(
  db: Database,
  userId: string,
  publicName: string | null,
): Promise<void> {
  await db
    .insert(sponsorProfiles)
    .values({ userId, publicName })
    .onConflictDoNothing();
}
