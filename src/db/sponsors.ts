import { and, eq, or } from "drizzle-orm";
import type { SponsorFilters } from "../core/forms";
import type { Database } from "./client";
import { recordEvent } from "./events";
import {
  contributions,
  events,
  sponsorProfiles,
  sponsorProjectSelections,
} from "./schema";

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

export type SponsorProfileInput = {
  publicName: string | null;
  tagline: string | null;
  description: string | null;
  websiteUrl: string | null;
  /** Undefined keeps the current logo. */
  logoUrl?: string | null;
};

export async function getSponsorProfile(
  db: Database,
  userId: string,
): Promise<(SponsorProfileInput & { foundingSponsor: boolean }) | null> {
  const [profile] = await db
    .select({
      publicName: sponsorProfiles.publicName,
      tagline: sponsorProfiles.tagline,
      description: sponsorProfiles.description,
      websiteUrl: sponsorProfiles.websiteUrl,
      logoUrl: sponsorProfiles.logoUrl,
      foundingSponsor: sponsorProfiles.foundingSponsor,
    })
    .from(sponsorProfiles)
    .where(eq(sponsorProfiles.userId, userId));
  return profile ?? null;
}

/**
 * What a sponsor shows on the boards. Guests are sponsors who pay without an
 * account: their userId is a placeholder until they sign in (see
 * claimGuestSponsorships).
 */
export async function saveSponsorProfile(
  db: Database,
  userId: string,
  profile: SponsorProfileInput,
  options: { guest?: boolean } = {},
): Promise<void> {
  const values = { ...profile, updatedAt: new Date() };
  await db
    .insert(sponsorProfiles)
    .values({ userId, guest: options.guest ?? false, ...values })
    .onConflictDoUpdate({ target: sponsorProfiles.userId, set: values });
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();

/**
 * Stores the email Stripe collected for a guest's payment. A guest who already
 * paid with that email keeps one board row: the new payment joins it and the
 * latest profile wins. Returns true the first time a guest payment gets its
 * email (webhook retries return false), when a sign-in link is due.
 */
export async function recordGuestEmail(
  db: Database,
  stripeCheckoutId: string,
  email: string,
): Promise<boolean> {
  const address = normalizeEmail(email);
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ profile: sponsorProfiles })
      .from(contributions)
      .innerJoin(
        sponsorProfiles,
        eq(sponsorProfiles.userId, contributions.userId),
      )
      .where(eq(contributions.stripeCheckoutId, stripeCheckoutId))
      .for("update");
    const profile = row?.profile;
    if (!profile?.guest || profile.email) return false;
    const [earlier] = await tx
      .select({ userId: sponsorProfiles.userId })
      .from(sponsorProfiles)
      .where(
        and(
          eq(sponsorProfiles.guest, true),
          eq(sponsorProfiles.email, address),
        ),
      )
      .for("update");
    if (!earlier) {
      await tx
        .update(sponsorProfiles)
        .set({ email: address, updatedAt: new Date() })
        .where(eq(sponsorProfiles.userId, profile.userId));
      return true;
    }
    await tx
      .update(contributions)
      .set({ userId: earlier.userId })
      .where(eq(contributions.userId, profile.userId));
    await tx
      .update(events)
      .set({ userId: earlier.userId })
      .where(eq(events.userId, profile.userId));
    await tx
      .delete(sponsorProfiles)
      .where(eq(sponsorProfiles.userId, profile.userId));
    await tx
      .update(sponsorProfiles)
      .set({
        publicName: profile.publicName,
        tagline: profile.tagline,
        description: profile.description,
        websiteUrl: profile.websiteUrl,
        logoUrl: profile.logoUrl,
        updatedAt: new Date(),
      })
      .where(eq(sponsorProfiles.userId, earlier.userId));
    return true;
  });
}

/**
 * On sign-in: moves guest payments (contributions, clicks, profile) to the
 * signed-in user, in one transaction. A guest is matched by the verified
 * email Stripe collected, or by this browser's guest cookie (the payer
 * themself). A user who already has a profile keeps it whole: a payment
 * made with their email by someone else never renames them.
 */
export async function claimGuestSponsorships(
  db: Database,
  userId: string,
  by: { email?: string | null; guestId?: string | null },
): Promise<number> {
  const matches = [
    by.email ? eq(sponsorProfiles.email, normalizeEmail(by.email)) : undefined,
    by.guestId ? eq(sponsorProfiles.userId, by.guestId) : undefined,
  ].filter((match) => match !== undefined);
  if (matches.length === 0) return 0;
  return db.transaction(async (tx) => {
    const guests = await tx
      .select()
      .from(sponsorProfiles)
      .where(and(eq(sponsorProfiles.guest, true), or(...matches)))
      .for("update");
    if (guests.length === 0) return 0;
    let [own] = await tx
      .select()
      .from(sponsorProfiles)
      .where(eq(sponsorProfiles.userId, userId))
      .for("update");
    for (const guest of guests) {
      await tx
        .update(contributions)
        .set({ userId })
        .where(eq(contributions.userId, guest.userId));
      await tx
        .update(events)
        .set({ userId })
        .where(eq(events.userId, guest.userId));
      if (!own) {
        // The guest profile becomes the user's, public id (and clicks) included.
        [own] = await tx
          .update(sponsorProfiles)
          .set({ userId, guest: false, updatedAt: new Date() })
          .where(eq(sponsorProfiles.userId, guest.userId))
          .returning();
        continue;
      }
      await tx
        .delete(sponsorProfiles)
        .where(eq(sponsorProfiles.userId, guest.userId));
    }
    await recordEvent(tx, {
      type: "sponsor.guest_claimed",
      userId,
      payload: { profiles: guests.length },
    });
    return guests.length;
  });
}

/** A guest sponsor still waiting to be claimed (the guest cookie's target). */
export async function isGuestSponsor(
  db: Database,
  guestId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ guest: sponsorProfiles.guest })
    .from(sponsorProfiles)
    .where(eq(sponsorProfiles.userId, guestId));
  return row?.guest === true;
}

/** Who is looking at the boards: their row's id, and the card they last saved. */
export async function boardViewer(db: Database, userId: string) {
  const [profile] = await db
    .select({
      publicId: sponsorProfiles.publicId,
      publicName: sponsorProfiles.publicName,
      tagline: sponsorProfiles.tagline,
      description: sponsorProfiles.description,
      websiteUrl: sponsorProfiles.websiteUrl,
      logoUrl: sponsorProfiles.logoUrl,
      foundingSponsor: sponsorProfiles.foundingSponsor,
    })
    .from(sponsorProfiles)
    .where(eq(sponsorProfiles.userId, userId));
  return profile ?? null;
}
export type BoardViewer = NonNullable<Awaited<ReturnType<typeof boardViewer>>>;
