import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { safeNext } from "@/server/auth-request.server";
import { getViewer, supabaseServer } from "@/server/auth.server";
import { getSponsorProfile } from "@/db/sponsors";
import { reviewCount } from "@/db/queries";
import { databaseConfigured, withDb } from "@/server/db.server";
import { appEnv } from "@/server/env.server";
import { currentGuest } from "@/server/guest.server";
import { afterSignIn, sendSignInLink } from "@/server/sign-in.server";

/** Where the site is served, for the absolute links a share card needs. */
export const getSiteOriginFn = createServerFn({ method: "GET" }).handler(
  () => appEnv().APP_URL,
);

export const getViewerFn = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      return await getViewer();
    } catch {
      // Auth outage or misconfiguration: render the public site signed out.
      return null;
    }
  },
);

/** How many pull requests wait for the viewer's review; 0 when signed out. */
export const getReviewCountFn = createServerFn({ method: "GET" }).handler(
  async () => {
    try {
      const viewer = await getViewer();
      if (!viewer || !databaseConfigured()) return 0;
      return await withDb((db) => reviewCount(db, viewer.userId));
    } catch {
      return 0;
    }
  },
);

export const sendSignInLinkFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      email: z.email().max(320),
      next: z.string().max(300),
    }),
  )
  .handler(async ({ data }) => {
    await sendSignInLink(data.email, safeNext(data.next));
    return { sent: true };
  });

/**
 * Sign-in links that come back with the session in the URL fragment
 * (Supabase's default email templates): the page hands the tokens over and
 * the server stores the session in cookies, like /auth/confirm does.
 */
export const adoptSessionFn = createServerFn({ method: "POST" })
  .validator(
    z.object({
      accessToken: z.string().min(20).max(8000),
      refreshToken: z.string().min(6).max(1000),
    }),
  )
  .handler(async ({ data }) => {
    const { data: session, error } = await supabaseServer().auth.setSession({
      access_token: data.accessToken,
      refresh_token: data.refreshToken,
    });
    if (error || !session.user)
      throw new Error(error?.message ?? "This link has expired");
    await afterSignIn(session.user);
    return { ok: true };
  });

/** Public values the browser needs for Realtime (the publishable key). */
export const getLiveConfigFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const env = appEnv();
    return env.SUPABASE_URL && env.SUPABASE_PUBLISHABLE_KEY
      ? { url: env.SUPABASE_URL, key: env.SUPABASE_PUBLISHABLE_KEY }
      : null;
  },
);

/** The sponsor who paid from this browser without an account, for the header. */
export const getGuestFn = createServerFn({ method: "GET" }).handler(
  async () => {
    const guestId = await currentGuest().catch(() => null);
    if (!guestId) return null;
    const profile = await withDb((db) => getSponsorProfile(db, guestId));
    return {
      name: profile?.publicName ?? null,
      githubLogin: null,
      avatarUrl: null,
      guest: true as const,
    };
  },
);
