import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { deleteAccount } from "@/db/accounts";
import { accountMembers, contributions, trackerConnections } from "@/db/schema";
import {
  getViewer,
  supabaseServer,
  UnauthorizedError,
} from "@/server/auth.server";
import { databaseConfigured, withDb } from "@/server/db.server";
import {
  emailConfigured,
  sendEmailChangeLink,
  supabaseAdmin,
} from "@/server/email.server";
import { emailChangeToken } from "@/server/email-change";
import { appEnv, NotConfiguredError } from "@/server/env.server";
import { disconnectTracker, trackerContext } from "@/server/jira.server";
import { invoiceUrl, paymentsConfigured } from "@/server/stripe/stripe.server";

async function requirePerson() {
  const viewer = await getViewer().catch(() => null);
  if (!viewer) throw new UnauthorizedError();
  return viewer;
}

/** The account page: who you are, what you paid. */
export const getAccountFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const viewer = await getViewer().catch(() => null);
    if (!viewer) return { status: "signed_out" as const };
    const payments = databaseConfigured()
      ? await withDb((db) =>
          db
            .select({
              id: contributions.id,
              createdAt: contributions.createdAt,
              source: contributions.source,
              paymentStatus: contributions.paymentStatus,
              amountCents: contributions.amountCents,
              checkoutId: contributions.stripeCheckoutId,
            })
            .from(contributions)
            .where(
              and(
                eq(contributions.userId, viewer.userId),
                inArray(contributions.paymentStatus, ["settled", "refunded"]),
              ),
            )
            .orderBy(desc(contributions.createdAt)),
        )
      : [];
    // The tracker accounts every project of the person's accounts reuses.
    const connections = databaseConfigured()
      ? await withDb((db) =>
          db
            .select({
              id: trackerConnections.id,
              tracker: trackerConnections.tracker,
              name: trackerConnections.name,
            })
            .from(trackerConnections)
            .innerJoin(
              accountMembers,
              and(
                eq(accountMembers.accountId, trackerConnections.accountId),
                eq(accountMembers.userId, viewer.userId),
              ),
            )
            .orderBy(trackerConnections.createdAt),
        )
      : [];
    return {
      status: "ok" as const,
      connections,
      email: viewer.email,
      githubLogin: viewer.githubLogin,
      canChangeEmail:
        emailConfigured() && Boolean(appEnv().TOKEN_ENCRYPTION_KEY),
      canDelete: Boolean(appEnv().SUPABASE_SECRET_KEY),
      payments: payments.map(({ checkoutId, createdAt, ...payment }) => ({
        ...payment,
        createdAt: createdAt.toISOString(),
        invoice:
          payment.source === "stripe" &&
          Boolean(checkoutId) &&
          paymentsConfigured(),
      })),
    };
  },
);

/** Mails a confirmation link to the new address; nothing changes before. */
export const requestEmailChangeFn = createServerFn({ method: "POST" })
  .validator(z.object({ email: z.email().max(254) }))
  .handler(async ({ data }) => {
    const viewer = await requirePerson();
    const key = appEnv().TOKEN_ENCRYPTION_KEY;
    if (!emailConfigured() || !key) throw new NotConfiguredError("Email");
    const email = data.email.trim().toLowerCase();
    if (email === viewer.email?.toLowerCase())
      throw new Error("That is already your email.");
    const token = await emailChangeToken(key, viewer.userId, email);
    await sendEmailChangeLink(
      email,
      `${appEnv().APP_URL}/account/email?token=${encodeURIComponent(token)}`,
    );
    return { sent: email };
  });

/** A payment's invoice, from Stripe, for its owner only. */
export const invoiceUrlFn = createServerFn({ method: "POST" })
  .validator(z.object({ contributionId: z.uuid() }))
  .handler(async ({ data }) => {
    const viewer = await requirePerson();
    const [payment] = await withDb((db) =>
      db
        .select({ checkoutId: contributions.stripeCheckoutId })
        .from(contributions)
        .where(
          and(
            eq(contributions.id, data.contributionId),
            eq(contributions.userId, viewer.userId),
          ),
        ),
    );
    if (!payment?.checkoutId) throw new Error("No invoice for this payment.");
    const url = await invoiceUrl(payment.checkoutId);
    if (!url) throw new Error("Stripe has no invoice for this payment yet.");
    return { url };
  });

/** Disconnects a tracker account (see disconnectTracker). */
export const disconnectTrackerFn = createServerFn({ method: "POST" })
  .validator(z.object({ connectionId: z.uuid() }))
  .handler(async ({ data }) => {
    const viewer = await requirePerson();
    const result = await withDb((db) =>
      disconnectTracker(db, trackerContext(), viewer.userId, data.connectionId),
    );
    return { result };
  });

/** Deletes the person (see deleteAccount), then their sign-in. */
export const deleteAccountFn = createServerFn({ method: "POST" })
  .validator(z.object({ confirm: z.literal("delete") }))
  .handler(async () => {
    const viewer = await requirePerson();
    if (!appEnv().SUPABASE_SECRET_KEY)
      throw new NotConfiguredError("Account deletion (SUPABASE_SECRET_KEY)");
    await withDb((db) => deleteAccount(db, viewer.userId));
    const { error } = await supabaseAdmin().auth.admin.deleteUser(
      viewer.userId,
    );
    if (error) throw new Error(`Sign-in not deleted: ${error.message}`);
    await supabaseServer()
      .auth.signOut()
      .catch(() => undefined);
    return { deleted: true };
  });
