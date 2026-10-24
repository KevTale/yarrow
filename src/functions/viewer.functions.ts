import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { safeNext } from "@/server/auth-request.server";
import { getViewer } from "@/server/auth.server";
import { sendSignInLink } from "@/server/sign-in.server";

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
