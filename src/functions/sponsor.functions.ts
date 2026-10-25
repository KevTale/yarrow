import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { checkoutSchema, sponsorProfileSchema } from "@/core/forms";
import { selectableProjects, sponsorDashboard } from "@/db/queries";
import {
  sponsorSettings,
  sponsorShipped,
  sponsorStandings,
} from "@/db/sponsor-dashboard";
import {
  getSponsorFilters,
  getSponsorProfile,
  saveSponsorFilters,
  saveSponsorProfile,
} from "@/db/sponsors";
import { getViewer, requireViewer } from "@/server/auth.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import { NotConfiguredError } from "@/server/env.server";
import {
  paymentsConfigured,
  createCheckout,
} from "@/server/stripe/stripe.server";
import { supabaseServer } from "@/server/auth.server";

export const getSponsorDashboardFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const viewer = await getViewer().catch(() => null);
    if (!viewer) return { status: "signed_out" as const };
    if (!databaseConfigured()) return { status: "not_configured" as const };
    return withDb(async (db) => {
      const { totals, contributions } = await sponsorDashboard(
        db,
        viewer.userId,
      );
      const filters = await getSponsorFilters(db, viewer.userId);
      return {
        status: "ok" as const,
        isSponsor: contributions.length > 0,
        leftCents:
          totals.creditCents - totals.consumedCents - totals.reservedCents,
        standings: await sponsorStandings(db, viewer.userId),
        shipped: await sponsorShipped(db, viewer.userId),
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

/** Settings drawer: the leaderboard profile and where the money goes. */
export const saveSponsorSettingsFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      profile: sponsorProfileSchema,
      mode: z.enum(["all_except", "only"]),
      selectedProjectIds: z.array(z.uuid()).max(500),
    }),
  )
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    await withDb(async (db) => {
      await saveSponsorProfile(db, viewer.userId, data.profile);
      const filters = await getSponsorFilters(db, viewer.userId);
      await saveSponsorFilters(db, viewer.userId, {
        ...filters,
        publicName: data.profile.publicName,
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
    const profile =
      viewer && databaseConfigured()
        ? await withDb((db) => getSponsorProfile(db, viewer.userId))
        : null;
    return {
      signedIn: Boolean(viewer),
      githubLogin: viewer?.githubLogin ?? null,
      profile,
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
    const userId = viewer?.userId ?? crypto.randomUUID();
    const url = await withDb(async (db) => {
      await saveSponsorProfile(db, userId, data.profile, { guest: !viewer });
      return createCheckout(db, {
        userId,
        email,
        amountCents: data.amountCents,
        successPath: viewer
          ? "/dashboard?checkout=success#sponsoring"
          : "/?checkout=success#sponsors",
      });
    });
    return { url };
  });
