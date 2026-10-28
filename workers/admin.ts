import { parseClock } from "../src/core/daily-funding";
import { dailyFundingSchema, type DailyFundingInput } from "../src/core/forms";
import { verifyAccessToken } from "./admin-access";
import { adminPage } from "./admin-page";
import type { Admin } from "./brain";

/**
 * The admin: admin.yarrow.run (admin-dev.yarrow.run for dev), behind
 * Cloudflare Access. It holds no secret: the brain's `Admin` entrypoint
 * does every read and write.
 */
export interface AdminEnv {
  BRAIN: Service<Admin>;
  APP_URL: string;
  /** The Zero Trust team domain, e.g. "team.cloudflareaccess.com". */
  ACCESS_TEAM_DOMAIN?: string;
  /** The Access application's audience tag. */
  ACCESS_AUD?: string;
  ADMIN_EMAIL: string;
}

const notFound = () => new Response("Not found", { status: 404 });
const isLocal = (url: URL) =>
  url.hostname === "localhost" || url.hostname === "127.0.0.1";

/**
 * Only the admin's email, signed by Access, gets through. Anyone else gets
 * a 404: the admin does not say it exists. With no Access configured, only
 * `wrangler dev` on this machine is let in.
 */
export async function authorized(
  request: Request,
  env: AdminEnv,
): Promise<boolean> {
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN)
    return isLocal(new URL(request.url));
  return verifyAccessToken(request.headers.get("cf-access-jwt-assertion"), {
    team: env.ACCESS_TEAM_DOMAIN,
    aud: env.ACCESS_AUD,
    email: env.ADMIN_EMAIL,
  });
}

/** A form's fields as the brain expects them. Undefined logo keeps it. */
export function fundingFromForm(form: FormData): DailyFundingInput {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  const logo = text("logo");
  // An empty time keeps the default; one that is not a time fails the check.
  const minute = (name: string) =>
    text(name) ? (parseClock(text(name)) ?? -1) : undefined;
  return {
    profile: {
      publicName: text("name"),
      tagline: null,
      description: text("description") || null,
      websiteUrl: text("website") || null,
      logo: logo || undefined,
    },
    amountCents: Math.round(Number(text("amount")) * 100),
    windowStart: minute("from"),
    windowEnd: minute("to"),
  };
}

const INVALID =
  "Check the name (2 characters at least), the website (https), the amount ($1 at least) and the window (from before to).";

const home = (error?: string) =>
  new Response(null, {
    status: 303,
    headers: {
      location: error ? `/?error=${encodeURIComponent(error)}` : "/",
    },
  });

export default {
  async fetch(request: Request, env: AdminEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!(await authorized(request, env))) return notFound();

    if (request.method === "GET" && url.pathname === "/") {
      const [fundings, compute] = await Promise.all([
        env.BRAIN.dailyFundings(),
        env.BRAIN.compute(),
      ]);
      return new Response(
        adminPage({
          appUrl: env.APP_URL,
          fundings,
          compute,
          error: url.searchParams.get("error"),
        }),
        {
          headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "x-frame-options": "DENY",
            "referrer-policy": "same-origin",
          },
        },
      );
    }

    if (request.method !== "POST") return notFound();
    // Forms are only posted from this page.
    if (request.headers.get("origin") !== url.origin)
      return new Response("Forbidden", { status: 403 });

    const resume = /^\/providers\/(anthropic|openai)\/resume$/.exec(
      url.pathname,
    );
    if (resume) {
      try {
        await env.BRAIN.resumeProvider(resume[1] as "anthropic" | "openai");
        return home();
      } catch (error) {
        return home(error instanceof Error ? error.message : String(error));
      }
    }

    const match =
      /^\/fundings(?:\/([0-9a-f-]{36}))?(?:\/(pause|resume))?$/.exec(
        url.pathname,
      );
    const [, userId, toggle] = match ?? [];
    if (!match || (toggle && !userId)) return notFound();
    try {
      if (userId && toggle)
        await env.BRAIN.pauseDailyFunding(userId, toggle === "pause");
      else {
        const funding = fundingFromForm(await request.formData());
        if (!dailyFundingSchema.safeParse(funding).success)
          return home(INVALID);
        if (userId) await env.BRAIN.updateDailyFunding(userId, funding);
        else await env.BRAIN.createDailyFunding(funding);
      }
      return home();
    } catch (error) {
      return home(error instanceof Error ? error.message : String(error));
    }
  },
} satisfies ExportedHandler<AdminEnv>;
