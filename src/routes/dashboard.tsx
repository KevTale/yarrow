import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Github } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { BuilderView } from "@/components/dashboard/builder";
import { SponsorView } from "@/components/dashboard/sponsor";
import { NotConfigured, SignInPrompt } from "@/components/ui";
import { getBuilderFn } from "@/functions/builder.functions";
import { settleConnectFn } from "@/functions/connect.functions";
import { getSponsorDashboardFn } from "@/functions/sponsor.functions";

type Tab = "builder" | "sponsor";

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
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [polls, setPolls] = useState(0);
  const waiting = polls < CONNECT_POLLS ? connect.waiting : null;

  useEffect(() => {
    if (!connect.waiting || polls >= CONNECT_POLLS) return;
    const timer = setTimeout(async () => {
      await router.invalidate();
      setPolls((count) => count + 1);
    }, 3_000);
    return () => clearTimeout(timer);
  }, [connect, polls, router]);

  if (builder.status === "signed_out" || sponsor.status === "signed_out")
    return (
      <main id="main" className="container page-main">
        <SignInPrompt
          next="/dashboard"
          reason="Your projects and sponsoring."
        />
      </main>
    );
  if (builder.status !== "ok" || sponsor.status !== "ok")
    return (
      <main id="main" className="container page-main">
        <NotConfigured />
      </main>
    );

  const isBuilder = builder.projects.length > 0 || waiting !== null;
  const isSponsor = sponsor.dashboard.contributions.length > 0;
  const tab: Tab =
    search.tab ??
    (search.checkout
      ? "sponsor"
      : isBuilder || !isSponsor
        ? "builder"
        : "sponsor");
  const both = isBuilder && isSponsor;
  const choose = (next: Tab) =>
    navigate({ search: (current) => ({ ...current, tab: next }) });

  if (!isBuilder && !isSponsor)
    return (
      <main id="main" className="container dashboard">
        <div className="dashboard-start">
          <a className="go" href="/connect/github">
            <Github size={16} /> Connect GitHub
          </a>
          <a className="button button-secondary" href="/fund">
            Sponsor
          </a>
        </div>
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
      </div>
      {search.checkout === "success" && tab === "sponsor" && (
        <p className="feedback" role="status">
          Payment received. Your credit appears once Stripe confirms it.
        </p>
      )}
      {tab === "builder" ? (
        <BuilderView
          data={builder}
          highlight={connect.queued?.issue ?? null}
          waiting={waiting}
        />
      ) : (
        <SponsorView data={sponsor} />
      )}
    </main>
  );
}
