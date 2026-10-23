import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { checkoutSchema, sponsorFiltersSchema } from "@/core/forms";
import { selectableProjects, sponsorDashboard } from "@/db/queries";
import {
  ensureSponsorProfile,
  getSponsorFilters,
  saveSponsorFilters,
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
        ? await withDb((db) => getSponsorFilters(db, viewer.userId))
        : null;
    return {
      signedIn: Boolean(viewer),
      githubLogin: viewer?.githubLogin ?? null,
      publicName: profile?.publicName ?? null,
      foundingSponsor: profile?.foundingSponsor ?? false,
      paymentsReady: paymentsConfigured() && databaseConfigured(),
    };
  },
);

export const startCheckoutFn = createServerFn({ method: "POST" })
  .validator(
    checkoutSchema.extend({
      publicName: z.string().trim().min(2).max(60).nullable(),
    }),
  )
  .handler(async ({ data }) => {
    const viewer = await requireViewer();
    if (!paymentsConfigured()) throw new NotConfiguredError("Payments");
    const {
      data: { user },
    } = await supabaseServer().auth.getUser();
    const url = await withDb(async (db) => {
      await ensureSponsorProfile(db, viewer.userId, data.publicName);
      // Name changes apply to the whole board, like the filters page.
      const filters = await getSponsorFilters(db, viewer.userId);
      if (filters.publicName !== data.publicName)
        await saveSponsorFilters(db, viewer.userId, {
          ...filters,
          publicName: data.publicName,
        });
      return createCheckout(db, {
        userId: viewer.userId,
        email: user?.email ?? null,
        amountCents: data.amountCents,
      });
    });
    return { url };
  });
