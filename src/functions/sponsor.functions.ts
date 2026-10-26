import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { checkoutSchema, sponsorProfileSchema } from "@/core/forms";
import { selectableProjects, sponsorDashboard } from "@/db/queries";
import { sponsorBoard } from "@/db/boards";
import { resolveLogo } from "@/db/images";
import type { Database } from "@/db/client";
import type { SponsorProfile } from "@/core/forms";
import {
  queueActivity,
  sponsorImpact,
  sponsorSettings,
  sponsorShipped,
  sponsorStandings,
} from "@/db/sponsor-dashboard";
import {
  boardViewer,
  getSponsorFilters,
  getSponsorProfile,
  saveSponsorFilters,
  saveSponsorProfile,
} from "@/db/sponsors";
import { getViewer, UnauthorizedError } from "@/server/auth.server";
import { currentGuest, rememberGuest } from "@/server/guest.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { NotConfiguredError } from "@/server/env.server";
import {
  paymentsConfigured,
  createCheckout,
} from "@/server/stripe/stripe.server";
import { supabaseServer } from "@/server/auth.server";

/** The form's profile, its logo stored and replaced by its URL. */
async function profileValues(db: Database, profile: SponsorProfile) {
  const { logo, ...rest } = profile;
  return { ...rest, logoUrl: await resolveLogo(db, logo) };
}

/** The signed-in user, or the guest who paid from this browser. */
async function sponsorIdentity() {
  const viewer = await getViewer().catch(() => null);
  if (viewer) return { userId: viewer.userId, guest: false };
  const guestId = await currentGuest();
  return guestId ? { userId: guestId, guest: true } : null;
}

export const getSponsorDashboardFn = createServerFn({ method: "GET" }).handler(
  async () => {
    if (!databaseConfigured()) return { status: "not_configured" as const };
    const viewer = await sponsorIdentity();
    if (!viewer) return { status: "signed_out" as const };
    return withDb(async (db) => {
      const { totals, contributions } = await sponsorDashboard(
        db,
        viewer.userId,
      );
      const filters = await getSponsorFilters(db, viewer.userId);
      return {
        status: "ok" as const,
        userId: viewer.userId,
        guest: viewer.guest,
        isSponsor: contributions.length > 0,
        // Spent only when a run finishes, at its real cost; what a running
        // ticket set aside is shown apart, still part of the balance.
        balanceCents: totals.creditCents - totals.consumedCents,
        inUseCents: totals.reservedCents,
        spentCents: totals.consumedCents,
        impact: await sponsorImpact(db, viewer.userId),
        standings: await sponsorStandings(db, viewer.userId),
        boards: {
          today: await sponsorBoard(db, "today"),
          all: await sponsorBoard(db, "all"),
        },
        you: await boardViewer(db, viewer.userId),
        shipped: await sponsorShipped(db, viewer.userId),
        activity: await queueActivity(db),
        settings: await sponsorSettings(db, viewer.userId),
        funding: {
          mode: filters.mode,
          selectedProjectIds:
            filters.mode === "only" ? filters.selectedProjectIds : [],
        },
        projects: (await selectableProjects(db)).projects,
      };
    });
  },
);

/** The sponsor's card on the boards, saved as it is edited. */
export const saveSponsorProfileFn = createServerFn({ method: "POST" })
  .validator(z.object({ profile: sponsorProfileSchema }))
  .handler(async ({ data }) => {
    const viewer = await sponsorIdentity();
    if (!viewer) throw new UnauthorizedError();
    await withDb(async (db) =>
      saveSponsorProfile(db, viewer.userId, await profileValues(db, data.profile), {
        guest: viewer.guest,
      }),
    );
    return { saved: true };
  });

/** Where the money goes: every project, or only the ones chosen. */
export const saveSponsorFundingFn = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        mode: z.enum(["all_except", "only"]),
        selectedProjectIds: z.array(z.uuid()).max(500),
      })
      .refine((value) => value.mode === "all_except" || value.selectedProjectIds.length > 0),
  )
  .handler(async ({ data }) => {
    const viewer = await sponsorIdentity();
    if (!viewer) throw new UnauthorizedError();
    await withDb(async (db) => {
      const filters = await getSponsorFilters(db, viewer.userId);
      await saveSponsorFilters(db, viewer.userId, {
        ...filters,
        mode: data.mode,
        // In all_except mode, selections mean "excluded": none from here.
        selectedProjectIds: data.mode === "only" ? data.selectedProjectIds : [],
      });
    });
    return { saved: true };
  });

export const getFundContextFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const viewer = await getViewer().catch(() => null);
    const [profile, today] = databaseConfigured()
      ? await withDb((db) =>
          Promise.all([
            viewer ? getSponsorProfile(db, viewer.userId) : null,
            // Today's amounts, for the rank shown on the sponsor's card.
            sponsorBoard(db, "today").then((rows) =>
              rows.map((row) => row.paidCents),
            ),
          ]),
        )
      : [null, [] as number[]];
    return {
      signedIn: Boolean(viewer),
      githubLogin: viewer?.githubLogin ?? null,
      profile,
      today,
      paymentsReady: paymentsConfigured() && databaseConfigured(),
    };
  },
);

/**
 * Signed in or not: a guest pays with a placeholder id, Stripe collects the
 * email, and signing in with that email later claims the payment.
 */
export const startCheckoutFn = createServerFn({ method: "POST" })
  .validator(checkoutSchema)
  .handler(async ({ data }) => {
    const viewer = await getViewer().catch(() => null);
    if (!paymentsConfigured()) throw new NotConfiguredError("Payments");
    const email = viewer
      ? ((await supabaseServer().auth.getUser()).data.user?.email ?? null)
      : null;
    // A returning guest pays again as the same guest: one row on the boards.
    const userId =
      viewer?.userId ?? (await currentGuest()) ?? crypto.randomUUID();
    const url = await withDb(async (db) => {
      await saveSponsorProfile(db, userId, await profileValues(db, data.profile), {
        guest: !viewer,
      });
      return createCheckout(db, {
        userId,
        email,
        amountCents: data.amountCents,
        // Back from Stripe straight to the Sponsor tab, recognized.
        successPath: "/dashboard?tab=sponsor&checkout=success",
      });
    });
    if (!viewer) await rememberGuest(userId);
    return { url };
  });
