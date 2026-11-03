import {
  createFileRoute,
  getRouteApi,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { BuilderView } from "@/components/dashboard/builder";
import { ConnectNotice } from "@/components/dashboard/connect-notice";
import { SponsorView } from "@/components/dashboard/sponsor";
import { WelcomeView } from "@/components/dashboard/welcome";
import { SignInPrompt } from "@/components/email-sign-in";
import { NotConfigured } from "@/components/ui";
import { getBuilderFn } from "@/functions/builder.functions";
import { settleConnectFn } from "@/functions/connect.functions";
import { getSponsorDashboardFn } from "@/functions/sponsor.functions";

type Tab = "builder" | "sponsor";
const rootRoute = getRouteApi("__root__");

export const Route = createFileRoute("/dashboard")({
  validateSearch: z.object({
    tab: z.enum(["builder", "sponsor"]).optional(),
    project: z.uuid().optional(),
    /** Back from connecting Jira from this project: link the pasted ticket. */
    from: z.enum(["jira"]).optional().catch(undefined),
    checkout: z.enum(["success"]).optional(),
    /** Set by /connect/done: GitHub's webhook may not have landed yet. */
    installation: z.number().int().positive().optional().catch(undefined),
    /** Set by /connect/done: an organization's admins were asked instead. */
    requested: z.boolean().optional().catch(undefined),
  }),
  // Switching projects stays on the page: the builder view keeps every
  // project's copy and loads them in the background (see BuilderView).
  loader: async ({ location, preload }) => {
    // A ticket pasted on the landing is queued as soon as its repo is
    // connected. Preloading (from any page, signed in) leaves that alone.
    const search = location.search as { project?: string; from?: string };
    const connect = preload
      ? { queued: null, waiting: null, issue: null, jira: null }
      : await settleConnectFn({
          data: { projectId: search.from ? search.project : undefined },
        });
    const projectId = search.project ?? connect.queued?.projectId;
    const [builder, sponsor] = await Promise.all([
      getBuilderFn({ data: { projectId, issues: true } }),
      getSponsorDashboardFn(),
    ]);
    if (builder.status === "ok" && !builder.project && builder.importable)
      throw redirect({ to: "/start" });
    return { connect, builder, sponsor };
  },
  // Switching tabs or coming back soon after does not reload everything;
  // the views refresh themselves (realtime and polling).
  staleTime: 30_000,
  head: () => ({ meta: [{ title: "Dashboard · Yarrow" }] }),
  component: DashboardPage,
});

/**
 * The page's own choice of tab goes into the address, so the header's
 * Tickets or Sponsoring lights up.
 */
function TabInAddress({ tab, chosen }: { tab: Tab; chosen?: Tab }) {
  const navigate = Route.useNavigate();
  useEffect(() => {
    if (!chosen)
      navigate({ search: (current) => ({ ...current, tab }), replace: true });
  }, [tab, chosen, navigate]);
  return null;
}

/** GitHub's install webhook usually lands within seconds. */
const CONNECT_POLLS = 20;
/** After an install: up to 30 s for the first projects to appear. */
const INSTALL_POLLS = 10;
/** After an install, with projects there: the pasted repository is late. */
const MISSING_POLLS = 3;

function DashboardPage() {
  const { connect, builder, sponsor } = Route.useLoaderData();
  const { viewer } = rootRoute.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [polls, setPolls] = useState(0);
  const [afterInstall] = useState(search.installation !== undefined);
  const [requested] = useState(search.requested === true);
  const [closed, setClosed] = useState(false);
  // Back from Stripe: celebrate once, then drop the flag from the address
  // so a refresh does not replay it.
  const [celebrate] = useState(search.checkout === "success");
  useEffect(() => {
    if (search.checkout)
      navigate({
        search: (current) => ({
          ...current,
          checkout: undefined,
          tab: "sponsor",
        }),
        replace: true,
      });
  }, [search.checkout, navigate]);
  const projectCount = builder.status === "ok" ? builder.projects.length : 0;
  const [startCount] = useState(projectCount);
  // New repositories showed up, or the install only changed existing ones.
  const installed =
    projectCount > startCount || (projectCount > 0 && polls >= 2);
  const installing =
    search.installation !== undefined && polls < INSTALL_POLLS && !installed;
  const pending = !requested && polls < CONNECT_POLLS ? connect.waiting : null;
  // The pasted repository did not come: not picked on GitHub, or not the
  // visitor's to install. Polling goes on, in case it was only late.
  const missing =
    !requested &&
    connect.waiting !== null &&
    (polls >= CONNECT_POLLS ||
      (afterInstall && projectCount > 0 && polls >= MISSING_POLLS));
  const polling = pending ?? (installing ? "GitHub" : null);
  const waiting = missing ? null : polling;
  const notice = (missing || requested) && !closed;

  useEffect(() => {
    if (!polling) return;
    const timer = setTimeout(async () => {
      await router.invalidate();
      setPolls((count) => count + 1);
    }, 3_000);
    return () => clearTimeout(timer);
  }, [polling, polls, router]);

  // Read once: a refresh does not tell of the request again.
  useEffect(() => {
    if (search.requested)
      navigate({
        search: (current) => ({ ...current, requested: undefined }),
        replace: true,
      });
  }, [search.requested, navigate]);

  // Done waiting: a refresh should not wait again.
  useEffect(() => {
    if (search.installation !== undefined && !installing)
      navigate({
        search: (current) => ({ ...current, installation: undefined }),
        replace: true,
      });
  }, [search.installation, installing, navigate]);

  // Back from Jira: linked once, so a refresh does not link again.
  useEffect(() => {
    if (search.from)
      navigate({
        search: (current) => ({ ...current, from: undefined }),
        replace: true,
      });
  }, [search.from, navigate]);

  // A guest who paid from this browser has a Sponsor tab, no Builder tab.
  if (sponsor.status === "signed_out")
    return <SignInPrompt next="/dashboard" />;
  if (sponsor.status !== "ok" || builder.status === "not_configured")
    return (
      <main id="main" className="container page-main">
        <NotConfigured />
      </main>
    );

  const isBuilder =
    builder.status === "ok" &&
    (builder.projects.length > 0 || waiting !== null || notice);
  const isSponsor = sponsor.isSponsor;
  // A new account sees both roles; without GitHub it is most likely a sponsor.
  const fresh = !isBuilder && !isSponsor;
  const tab: Tab =
    search.tab ??
    (search.checkout
      ? "sponsor"
      : isBuilder
        ? "builder"
        : isSponsor || !viewer?.githubLogin
          ? "sponsor"
          : "builder");
  const welcome = fresh && !sponsor.guest && !search.tab;

  // A new account, signed in on purpose: the two ways in, not empty tabs.
  if (welcome)
    return (
      <main id="main" className="container dashboard">
        <WelcomeView data={sponsor} />
      </main>
    );

  return (
    <main id="main" className="container dashboard">
      {/* The header's Tickets and Sponsoring say where one is. */}
      <h1 className="sr-only">
        {tab === "builder" ? "Tickets" : "Sponsoring"}
      </h1>
      <TabInAddress tab={tab} chosen={search.tab} />
      {tab === "builder" && notice && (
        <ConnectNotice
          repository={connect.waiting}
          issue={connect.issue}
          requested={requested}
          onClose={() => setClosed(true)}
        />
      )}
      {tab === "builder" && builder.status === "ok" ? (
        <BuilderView
          data={builder}
          highlight={connect.queued?.key ?? null}
          jira={connect.jira}
          waiting={waiting}
          projectId={search.project ?? connect.queued?.projectId}
        />
      ) : (
        <SponsorView data={sponsor} celebrate={celebrate} />
      )}
    </main>
  );
}
