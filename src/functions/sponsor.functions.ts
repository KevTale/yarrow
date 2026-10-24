import { createServerFn } from "@tanstack/react-start";
import { checkoutSchema, sponsorFiltersSchema } from "@/core/forms";
import { selectableProjects, sponsorDashboard } from "@/db/queries";
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
    return withDb(async (db) => ({
      status: "ok" as const,
      viewer,
      dashboard: await sponsorDashboard(db, viewer.userId),
      filters: await getSponsorFilters(db, viewer.userId),
    }));
  },
);

export const getFiltersFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const viewer = await getViewer().catch(() => null);
    if (!viewer) return { status: "signed_out" as const };
    if (!databaseConfigured()) return { status: "not_configured" as const };
    return withDb(async (db) => ({
      status: "ok" as const,
      filters: await getSponsorFilters(db, viewer.userId),
      ...(await selectableProjects(db)),
    }));
  },
);

export const saveFiltersFn = createServerFn({ method: "POST" })
  .validator(sponsorFiltersSchema)
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    await withDb((db) => saveSponsorFilters(db, viewer.userId, data));
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
