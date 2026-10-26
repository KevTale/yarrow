import { createFileRoute, getRouteApi, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { BuilderView } from "@/components/dashboard/builder";
import {
  SponsorActions,
  SponsorView,
} from "@/components/dashboard/sponsor";
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
    /** The pull requests waiting for review, across projects. */
    view: z.enum(["review"]).optional().catch(undefined),
    /** Back from connecting Jira from this project: link the pasted ticket. */
    from: z.enum(["jira"]).optional().catch(undefined),
    checkout: z.enum(["success"]).optional(),
    /** Set by /connect/done: GitHub's webhook may not have landed yet. */
    installation: z.number().int().positive().optional().catch(undefined),
  }),
  // Switching projects stays on the page: the builder view keeps every
  // project's copy and loads them in the background (see BuilderView).
  loader: async ({ location, preload }) => {
    // A ticket pasted on the landing is queued as soon as its repo is
    // connected. Preloading (from any page, signed in) leaves that alone.
    const search = location.search as { project?: string; from?: string };
    const connect = preload
      ? { queued: null, waiting: null, jira: null }
      : await settleConnectFn({
          data: { projectId: search.from ? search.project : undefined },
        });
    const projectId = search.project ?? connect.queued?.projectId;
    const [builder, sponsor] = await Promise.all([
      getBuilderFn({ data: { projectId, issues: true } }),
      getSponsorDashboardFn(),
    ]);
    return { connect, builder, sponsor };
  },
  // Switching tabs or coming back soon after does not reload everything;
  // the views refresh themselves (realtime and polling).
  staleTime: 30_000,
  head: () => ({ meta: [{ title: "Dashboard · Yarrow" }] }),
  component: DashboardPage,
});

/** GitHub's install webhook usually lands within seconds. */
const CONNECT_POLLS = 20;
/** After an install: up to 30 s for the first projects to appear. */
const INSTALL_POLLS = 10;

function DashboardPage() {
  const { connect, builder, sponsor } = Route.useLoaderData();
  const { viewer } = rootRoute.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [polls, setPolls] = useState(0);
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
  const waiting =
    (polls < CONNECT_POLLS ? connect.waiting : null) ??
    (installing ? "GitHub" : null);

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(async () => {
      await router.invalidate();
      setPolls((count) => count + 1);
    }, 3_000);
    return () => clearTimeout(timer);
  }, [waiting, polls, router]);

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
    (builder.projects.length > 0 || waiting !== null);
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
  const both = (isBuilder && isSponsor) || (fresh && builder.status === "ok");
  const choose = (next: Tab) =>
    navigate({ search: (current) => ({ ...current, tab: next }) });

  // A new account, signed in on purpose: the two ways in, not empty tabs.
  if (fresh && !sponsor.guest && !search.tab)
    return (
      <main id="main" className="container dashboard">
        <WelcomeView data={sponsor} />
      </main>
    );

  return (
    <main id="main" className="container dashboard">
      {/* The role tabs only when the account is both; one role needs no title. */}
      {both ? (
        <div className="dashboard-roles" role="tablist">
          {(["builder", "sponsor"] as const).map((role) => (
            <button
              type="button"
              key={role}
              role="tab"
              aria-selected={tab === role}
              className="dashboard-role"
              onClick={() => choose(role)}
            >
              {role === "builder" ? "Builder" : "Sponsor"}
            </button>
          ))}
          {tab === "sponsor" && <SponsorActions data={sponsor} />}
        </div>
      ) : (
        <>
          <h1 className="sr-only">
            {tab === "builder" ? "Builder" : "Sponsor"}
          </h1>
          {tab === "sponsor" && (
            <div className="dashboard-roles">
              <SponsorActions data={sponsor} />
            </div>
          )}
        </>
      )}
      {tab === "builder" && builder.status === "ok" ? (
        <BuilderView
          data={builder}
          highlight={connect.queued?.key ?? null}
          jira={connect.jira}
          waiting={waiting}
          projectId={search.project ?? connect.queued?.projectId}
          view={search.view}
        />
      ) : (
        <SponsorView data={sponsor} celebrate={celebrate} />
      )}
    </main>
  );
}
