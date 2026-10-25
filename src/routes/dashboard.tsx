import {
  createFileRoute,
  getRouteApi,
  useRouter,
} from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { BuilderView } from "@/components/dashboard/builder";
import {
  SponsorActions,
  SponsorSettings,
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
    checkout: z.enum(["success"]).optional(),
  }),
  loaderDeps: ({ search }) => ({ project: search.project }),
  loader: async ({ deps }) => {
    // A ticket pasted on the landing is queued as soon as its repo is connected.
    const connect = await settleConnectFn();
    const projectId = deps.project ?? connect.queued?.projectId;
    const [builder, sponsor] = await Promise.all([
      getBuilderFn({ data: { projectId, issues: true } }),
      getSponsorDashboardFn(),
    ]);
    return { connect, builder, sponsor };
  },
  head: () => ({ meta: [{ title: "Dashboard · Yarrow" }] }),
  component: DashboardPage,
});

/** GitHub's install webhook usually lands within seconds. */
const CONNECT_POLLS = 20;

function DashboardPage() {
  const { connect, builder, sponsor } = Route.useLoaderData();
  const { viewer } = rootRoute.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [polls, setPolls] = useState(0);
  const [settings, setSettings] = useState(false);
  const waiting = polls < CONNECT_POLLS ? connect.waiting : null;

  useEffect(() => {
    if (!connect.waiting || polls >= CONNECT_POLLS) return;
    const timer = setTimeout(async () => {
      await router.invalidate();
      setPolls((count) => count + 1);
    }, 3_000);
    return () => clearTimeout(timer);
  }, [connect, polls, router]);

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
      <div className="dashboard-roles" role={both ? "tablist" : undefined}>
        {(["builder", "sponsor"] as const)
          .filter((role) => both || role === tab)
          .map((role) =>
            both ? (
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
            ) : (
              <h1 key={role} className="dashboard-role" aria-selected>
                {role === "builder" ? "Builder" : "Sponsor"}
              </h1>
            ),
          )}
        {tab === "sponsor" && (
          <SponsorActions data={sponsor} onSettings={() => setSettings(true)} />
        )}
      </div>
      {search.checkout === "success" && tab === "sponsor" && (
        <p className="feedback" role="status">
          Payment received. Your credit appears once Stripe confirms it.
        </p>
      )}
      {tab === "builder" && builder.status === "ok" ? (
        <BuilderView
          data={builder}
          highlight={connect.queued?.issue ?? null}
          waiting={waiting}
        />
      ) : (
        <SponsorView data={sponsor} onSettings={() => setSettings(true)} />
      )}
      {tab === "sponsor" && (
        <SponsorSettings
          data={sponsor}
          open={settings}
          onClose={() => setSettings(false)}
        />
      )}
    </main>
  );
}
