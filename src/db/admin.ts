import { and, desc, eq, sql } from "drizzle-orm";
import { dailyFundingSchema, type DailyFundingInput } from "../core/forms";
import { startOfUtcDay } from "./boards";
import type { Database } from "./client";
import { fundDaily } from "./contributions";
import { recordEvent } from "./events";
import { resolveLogo } from "./images";
import { contributions, dailyFundings, sponsorProfiles } from "./schema";

export type { DailyFundingInput };

export type DailyFundingRow = {
  userId: string;
  publicId: string;
  name: string | null;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  amountCents: number;
  paused: boolean;
  creditedCents: number;
  spentCents: number;
  creditedToday: boolean;
};

export async function listDailyFundings(
  db: Database,
  now = new Date(),
): Promise<DailyFundingRow[]> {
  const direct = and(
    eq(contributions.userId, dailyFundings.userId),
    eq(contributions.source, "direct"),
  );
  const rows = await db
    .select({
      userId: dailyFundings.userId,
      publicId: sponsorProfiles.publicId,
      name: sponsorProfiles.publicName,
      description: sponsorProfiles.description,
      websiteUrl: sponsorProfiles.websiteUrl,
      logoUrl: sponsorProfiles.logoUrl,
      amountCents: dailyFundings.amountCents,
      pausedAt: dailyFundings.pausedAt,
      creditedCents: sql<number>`(select coalesce(sum(${contributions.creditCents}), 0)::int from ${contributions} where ${direct})`,
      spentCents: sql<number>`(select coalesce(sum(${contributions.debitedCents}), 0)::int from ${contributions} where ${direct})`,
      creditedToday: sql<boolean>`exists (select 1 from ${contributions} where ${direct} and ${contributions.createdAt} >= ${startOfUtcDay(now).toISOString()}::timestamptz)`,
    })
    .from(dailyFundings)
    .innerJoin(
      sponsorProfiles,
      eq(sponsorProfiles.userId, dailyFundings.userId),
    )
    .orderBy(desc(dailyFundings.createdAt));
  return rows.map(({ pausedAt, ...row }) => ({
    ...row,
    paused: pausedAt !== null,
  }));
}

/**
 * Creates the sponsor row (no account behind it: the userId is the row's
 * own) and its daily funding, then credits today at once.
 */
export async function createDailyFunding(
  db: Database,
  input: DailyFundingInput,
): Promise<string> {
  const { profile, amountCents } = dailyFundingSchema.parse(input);
  const logoUrl = await resolveLogo(db, profile.logo);
  const userId = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(sponsorProfiles).values({
      userId,
      publicName: profile.publicName,
      description: profile.description,
      websiteUrl: profile.websiteUrl,
      logoUrl: logoUrl ?? null,
    });
    await tx.insert(dailyFundings).values({ userId, amountCents });
    await recordEvent(tx, {
      type: "admin.daily_funding_saved",
      userId,
      payload: { amountCents, created: true },
    });
  });
  await fundDaily(db);
  return userId;
}

/** Today's credit stays as it was: a new amount applies from tomorrow. */
export async function updateDailyFunding(
  db: Database,
  userId: string,
  input: DailyFundingInput,
): Promise<void> {
  const { profile, amountCents } = dailyFundingSchema.parse(input);
  const logoUrl = await resolveLogo(db, profile.logo);
  await db.transaction(async (tx) => {
    const [funding] = await tx
      .update(dailyFundings)
      .set({ amountCents })
      .where(eq(dailyFundings.userId, userId))
      .returning({ userId: dailyFundings.userId });
    if (!funding) throw new Error("No daily funding for this sponsor.");
    await tx
      .update(sponsorProfiles)
      .set({
        publicName: profile.publicName,
        description: profile.description,
        websiteUrl: profile.websiteUrl,
        ...(logoUrl === undefined ? {} : { logoUrl }),
        updatedAt: new Date(),
      })
      .where(eq(sponsorProfiles.userId, userId));
    await recordEvent(tx, {
      type: "admin.daily_funding_saved",
      userId,
      payload: { amountCents },
    });
  });
}

/** Resuming the same day credits nothing more: a day is credited once. */
export async function pauseDailyFunding(
  db: Database,
  userId: string,
  paused: boolean,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(dailyFundings)
      .set({ pausedAt: paused ? new Date() : null })
      .where(eq(dailyFundings.userId, userId));
    await recordEvent(tx, {
      type: "admin.daily_funding_saved",
      userId,
      payload: { paused },
    });
  });
  if (!paused) await fundDaily(db);
}
