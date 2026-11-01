import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  fundingMinute,
  startsTomorrow,
  type FundingStart,
} from "../core/daily-funding";
import type { ComputeProvider } from "../core/failures";
import { dailyFundingSchema, type DailyFundingInput } from "../core/forms";
import { startOfUtcDay } from "./boards";
import type { Database } from "./client";
import { fundDaily, fundToday } from "./contributions";
import { recordEvent } from "./events";
import { resolveLogo } from "./images";
import { listPauses, type ProviderPause } from "./pauses";
import {
  agentRuns,
  contributions,
  dailyFundings,
  runModels,
  sponsorProfiles,
} from "./schema";

export type { DailyFundingInput };

export type DailyFundingRow = {
  userId: string;
  publicId: string;
  name: string | null;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  amountCents: number;
  /** UTC minutes between which the day's credit lands. */
  windowStart: number;
  windowEnd: number;
  /** The minute the next credit lands, drawn in the window. */
  landsAt: number;
  /** Scheduled after today's minute went by: the first credit is tomorrow's. */
  landsTomorrow: boolean;
  paused: boolean;
  /** What was put in, every day; unspent credit expires, so this is not a balance. */
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
      windowStart: dailyFundings.windowStart,
      windowEnd: dailyFundings.windowEnd,
      pausedAt: dailyFundings.pausedAt,
      createdAt: dailyFundings.createdAt,
      creditedCents: sql<number>`(select coalesce(sum(${contributions.amountCents}), 0)::int from ${contributions} where ${direct})`,
      spentCents: sql<number>`(select coalesce(sum(${contributions.debitedCents}), 0)::int from ${contributions} where ${direct})`,
      creditedToday: sql<boolean>`exists (select 1 from ${contributions} where ${direct} and ${contributions.createdAt} >= ${startOfUtcDay(now).toISOString()}::timestamptz)`,
    })
    .from(dailyFundings)
    .innerJoin(
      sponsorProfiles,
      eq(sponsorProfiles.userId, dailyFundings.userId),
    )
    .orderBy(desc(dailyFundings.createdAt));
  const today = startOfUtcDay(now);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const draw = (
    userId: string,
    day: Date,
    window: { start: number; end: number },
  ) => fundingMinute(userId, day.toISOString().slice(0, 10), window);
  return rows.map(({ pausedAt, createdAt, ...row }) => {
    const window = { start: row.windowStart, end: row.windowEnd };
    const landsTomorrow =
      !row.creditedToday &&
      startsTomorrow(new Date(createdAt), now, draw(row.userId, today, window));
    return {
      ...row,
      landsAt: draw(row.userId, landsTomorrow ? tomorrow : today, window),
      landsTomorrow,
      paused: pausedAt !== null,
    };
  });
}

/**
 * Creates the sponsor row (no account behind it: the userId is the row's
 * own) and its daily funding. "now" credits today at once, whatever the
 * window; "scheduled" leaves it to the cron, at today's minute if it is
 * still to come, tomorrow's otherwise.
 */
export async function createDailyFunding(
  db: Database,
  input: DailyFundingInput,
  start: FundingStart = "now",
): Promise<string> {
  const { profile, amountCents, windowStart, windowEnd } =
    dailyFundingSchema.parse(input);
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
    await tx
      .insert(dailyFundings)
      .values({ userId, amountCents, windowStart, windowEnd });
    await recordEvent(tx, {
      type: "admin.daily_funding_saved",
      userId,
      payload: { amountCents, windowStart, windowEnd, created: true, start },
    });
  });
  if (start === "now") await fundToday(db, userId);
  return userId;
}

/**
 * A credit already landed today stays as it was: a new amount applies from
 * the next credit, a new window from the next draw (today's, if it has
 * not landed yet).
 */
export async function updateDailyFunding(
  db: Database,
  userId: string,
  input: DailyFundingInput,
): Promise<void> {
  const { profile, amountCents, windowStart, windowEnd } =
    dailyFundingSchema.parse(input);
  const logoUrl = await resolveLogo(db, profile.logo);
  await db.transaction(async (tx) => {
    const [funding] = await tx
      .update(dailyFundings)
      .set({ amountCents, windowStart, windowEnd })
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
      payload: { amountCents, windowStart, windowEnd },
    });
  });
  await fundDaily(db);
}

export type ProviderCompute = {
  provider: ComputeProvider;
  pause: Pick<ProviderPause, "since" | "until" | "message"> | null;
  /** Compute the provider reported (Anthropic) or Yarrow priced (OpenAI, Meta). */
  todayCents: number;
  weekCents: number;
  monthCents: number;
  exact: boolean;
};

export type ComputeSummary = {
  providers: ProviderCompute[];
  /** Sponsor credit not spent yet: what Yarrow still owes in compute. */
  owedCents: { stripe: number; direct: number; promo: number };
  /** Run cost no sponsor money covered, over 30 days. */
  absorbedCents: number;
};

const DAY = 86_400_000;

/** The admin's view of the compute: spend per provider, pauses, what is owed. */
export async function computeSummary(
  db: Database,
  now = new Date(),
): Promise<ComputeSummary> {
  const at = (date: Date) => sql`${date.toISOString()}::timestamptz`;
  const day = startOfUtcDay(now);
  const week = new Date(now.getTime() - 7 * DAY);
  const month = new Date(now.getTime() - 30 * DAY);
  // Claude or Meta implements; OpenAI reviews (and checks clarity).
  const provider = sql<ComputeProvider>`case when ${runModels.model} like 'muse-%' then 'meta' when ${runModels.role} = 'implementer' then 'anthropic' else 'openai' end`;
  const spent = await db
    .select({
      provider,
      today: sql<number>`coalesce(sum(${runModels.costCents}) filter (where ${runModels.createdAt} >= ${at(day)}), 0)::int`,
      week: sql<number>`coalesce(sum(${runModels.costCents}) filter (where ${runModels.createdAt} >= ${at(week)}), 0)::int`,
      month: sql<number>`coalesce(sum(${runModels.costCents}), 0)::int`,
    })
    .from(runModels)
    .where(gte(runModels.createdAt, month))
    .groupBy(provider);
  const pauses = await listPauses(db);
  // Meta shows once it has implemented in the last 30 days.
  const shown: ComputeProvider[] = spent.some(
    (line) => line.provider === "meta",
  )
    ? ["anthropic", "meta", "openai"]
    : ["anthropic", "openai"];
  const providers = shown.map((provider) => {
    const row = spent.find((line) => line.provider === provider);
    const pause = pauses.find((line) => line.provider === provider);
    return {
      provider,
      pause: pause
        ? { since: pause.since, until: pause.until, message: pause.message }
        : null,
      todayCents: row?.today ?? 0,
      weekCents: row?.week ?? 0,
      monthCents: row?.month ?? 0,
      exact: provider === "anthropic",
    };
  });

  const owed = await db
    .select({
      source: contributions.source,
      cents: sql<number>`coalesce(sum(${contributions.creditCents} - ${contributions.debitedCents}), 0)::int`,
    })
    .from(contributions)
    .where(eq(contributions.paymentStatus, "settled"))
    .groupBy(contributions.source);
  const owedBy = (source: "stripe" | "direct" | "promo") =>
    owed.find((line) => line.source === source)?.cents ?? 0;

  const [absorbed] = await db
    .select({
      cents: sql<number>`coalesce(sum(${agentRuns.uncoveredCents}), 0)::int`,
    })
    .from(agentRuns)
    .where(gte(agentRuns.finishedAt, month));

  return {
    providers,
    owedCents: {
      stripe: owedBy("stripe"),
      direct: owedBy("direct"),
      promo: owedBy("promo"),
    },
    absorbedCents: absorbed?.cents ?? 0,
  };
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
