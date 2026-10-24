import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Plus, SlidersHorizontal } from "lucide-react";
import { z } from "zod";
import { money } from "@/core/packs";
import { getOwnerDashboardFn } from "@/functions/owner.functions";
import { getSponsorDashboardFn } from "@/functions/sponsor.functions";
import {
  capitalize,
  EmptyState,
  NotConfigured,
  PageHeading,
  RunStatus,
  SignInPrompt,
  StatGrid,
  timeAgo,
  VisibilityBadge,
} from "@/components/ui";

export const Route = createFileRoute("/dashboard")({
  validateSearch: z.object({ checkout: z.enum(["success"]).optional() }),
  loader: async () => {
    const [sponsor, owner] = await Promise.all([
      getSponsorDashboardFn(),
      getOwnerDashboardFn(),
    ]);
    return { sponsor, owner };
  },
  head: () => ({ meta: [{ title: "My activity · Yarrow" }] }),
  component: DashboardPage,
});

function DashboardPage() {
  const { sponsor, owner } = Route.useLoaderData();
  const search = Route.useSearch();
  if (sponsor.status === "signed_out")
    return (
      <main id="main" className="container page-main">
        <SignInPrompt
          next="/dashboard"
          reason="Your sponsoring and your projects, in one place."
        />
      </main>
    );
  if (sponsor.status === "not_configured" || owner.status !== "ok")
    return (
      <main id="main" className="container page-main">
        <NotConfigured />
      </main>
    );
  const { dashboard, filters, viewer } = sponsor;
  return (
    <main id="main" className="container page-main dashboard-layout">
      <PageHeading
        eyebrow="MY ACTIVITY"
        title={`Hi ${viewer.githubLogin ?? viewer.name ?? "there"}.`}
        description="What your money ships, and what your projects receive."
      >
        <div className="row">
          <Link to="/fund" className="button button-primary button-small">
            Fund AI work <ArrowUpRight size={14} />
          </Link>
          <a
            href="/connect/github"
            className="button button-secondary button-small"
          >
            <Plus size={14} /> Add a project
          </a>
        </div>
      </PageHeading>
      {search.checkout === "success" && (
        <p className="feedback" role="status">
          Payment received. Your compute credit appears as soon as Stripe
          confirms it, usually within a minute.
        </p>
      )}

      <section className="activity-section">
        <div className="activity-heading row spread">
          <h2 id="sponsoring">As a sponsor</h2>
          <Link to="/sponsor/filters" className="text-link">
            <SlidersHorizontal size={14} /> Where my money goes
          </Link>
        </div>
        <StatGrid
          items={[
            { label: "Paid", value: money(dashboard.totals.paidCents, false) },
            {
              label: "Compute credit",
              value: money(dashboard.totals.creditCents, false),
              detail: "After fees and margin",
            },
            {
              label: "Consumed",
              value: money(dashboard.totals.consumedCents, false),
              detail: "Counts toward your rank",
            },
            {
              label: "Available",
              value: money(
                dashboard.totals.creditCents -
                  dashboard.totals.consumedCents -
                  dashboard.totals.reservedCents,
                false,
              ),
              detail: `${filters.mode === "only" ? "Selected projects only" : "Every visible project"}${filters.includeHidden ? " + hidden" : ""}`,
            },
          ]}
        />
        <p className="small muted">
          Public name: <strong>{filters.publicName ?? "anonymous"}</strong>
          {filters.foundingSponsor && " · Founding sponsor"}
        </p>
        {dashboard.fundedRuns.length === 0 ? (
          <EmptyState title="Nothing funded yet">
            Once your credit settles, it funds the next tickets in the queue.
          </EmptyState>
        ) : (
          <ol className="work-list">
            {dashboard.fundedRuns.map((run) => (
              <li key={run.runId}>
                <Link
                  to="/runs/$runId"
                  params={{ runId: run.runId }}
                  className="work-row"
                >
                  <span className="work-row-title">
                    <strong>{run.ticketTitle}</strong>
                    <span className="muted small">
                      {run.projectName} · {timeAgo(run.createdAt)}
                    </span>
                  </span>
                  <span className="mono small">
                    your share {money(run.fundedCents ?? 0)}
                  </span>
                  <RunStatus run={run} />
                </Link>
              </li>
            ))}
          </ol>
        )}
        {dashboard.contributions.length > 0 && (
          <div className="table-wrap ledger-section">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th className="right">Paid</th>
                  <th className="right">VAT</th>
                  <th className="right">Fees</th>
                  <th className="right">Margin</th>
                  <th className="right">Credit</th>
                  <th className="right">Consumed</th>
                </tr>
              </thead>
              <tbody>
                {dashboard.contributions.map((row) => (
                  <tr key={row.id}>
                    <td>
                      {new Date(row.createdAt).toLocaleDateString("en-US")}
                    </td>
                    <td>{capitalize(row.paymentStatus)}</td>
                    <td className="right mono">{money(row.amountCents)}</td>
                    <td className="right mono">{money(row.taxCents)}</td>
                    <td className="right mono">{money(row.feeCents)}</td>
                    <td className="right mono">{money(row.marginCents)}</td>
                    <td className="right mono">{money(row.creditCents)}</td>
                    <td className="right mono">{money(row.debitedCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="activity-section">
        <div className="activity-heading row spread">
          <h2 id="projects">As a builder</h2>
          <a href="/connect/github" className="text-link">
            <Plus size={14} /> Add a project
          </a>
        </div>
        {owner.projects.length === 0 ? (
          <EmptyState title="No project yet">
            Connect a repository, tag tickets with <code>yarrow</code>, and
            reviewed pull requests start arriving. It's free.
          </EmptyState>
        ) : (
          <div className="project-list">
            {owner.projects.map((project) => (
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                key={project.id}
                className="project-row"
              >
                <span className="project-info">
                  <strong>{project.name}</strong>
                  <span className="mono small">{project.repository}</span>
                  {!project.linked && (
                    <span className="small amber">
                      Install the GitHub App to start
                    </span>
                  )}
                  {project.suspended && (
                    <span className="small error">Suspended</span>
                  )}
                </span>
                <VisibilityBadge visibility={project.visibility} />
                <span className="project-amount mono small">
                  {project.queued} queued · {project.running} running
                  <small>
                    {project.delivered} in review · {project.merged} merged ·{" "}
                    {project.abstained} abstained
                  </small>
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
