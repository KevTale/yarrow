import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { safeNext } from "@/server/auth-request.server";
import { getViewer, supabaseServer } from "@/server/auth.server";
import { afterSignIn, sendSignInLink } from "@/server/sign-in.server";

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
