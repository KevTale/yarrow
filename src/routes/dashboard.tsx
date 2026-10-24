import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus, SlidersHorizontal } from "lucide-react";
import { z } from "zod";
import { money } from "@/core/packs";
import { getOwnerDashboardFn } from "@/functions/owner.functions";
import { getSponsorDashboardFn } from "@/functions/sponsor.functions";
import {
  capitalize,
  NotConfigured,
  RunStatus,
  SignInPrompt,
  timeAgo,
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
          reason="Your projects and sponsoring."
        />
      </main>
    );
  if (sponsor.status === "not_configured" || owner.status !== "ok")
    return (
      <main id="main" className="container page-main">
        <NotConfigured />
      </main>
    );
  const { dashboard, filters } = sponsor;
  const { totals } = dashboard;
  const available =
    totals.creditCents - totals.consumedCents - totals.reservedCents;

  return (
    <main id="main" className="container dash">
      <h1>My activity</h1>
      {search.checkout === "success" && (
        <p className="feedback" role="status">
          Payment received. Your credit appears once Stripe confirms it.
        </p>
      )}

      <section className="dash-section" aria-labelledby="projects">
        <div className="dash-section-head">
          <h2 id="projects">Projects</h2>
          <a href="/connect/github" className="text-link">
            <Plus size={14} /> Add a project
          </a>
        </div>
        <div className="dash-list">
          <div className="board-head">
            <span>Repository</span>
            <span>Pull requests</span>
          </div>
          {owner.projects.length === 0 ? (
            <div className="dash-row dash-empty">
              <span className="muted">No project yet</span>
              <a
                href="/connect/github"
                className="button button-small button-secondary"
              >
                Connect GitHub
              </a>
            </div>
          ) : (
            owner.projects.map((project) => (
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                key={project.id}
                className="dash-row"
              >
                <span className="dash-main">
                  <b>{project.name}</b>
                  <span className="dash-sub mono">
                    {project.repository} · {capitalize(project.visibility)}
                  </span>
                  {!project.linked && (
                    <span className="dash-sub amber">
                      Install the GitHub App
                    </span>
                  )}
                  {project.suspended && (
                    <span className="dash-sub error">Suspended</span>
                  )}
                </span>
                <span className="dash-figures mono">
                  <span>
                    {project.merged} merged · {project.delivered} in review
                  </span>
                  <small>
                    {project.queued} queued · {project.running} running ·{" "}
                    {project.abstained} abstained
                  </small>
                </span>
              </Link>
            ))
          )}
        </div>
      </section>

      <section className="dash-section" aria-labelledby="sponsoring">
        <div className="dash-section-head">
          <h2 id="sponsoring">Sponsoring</h2>
          <span className="dash-actions">
            <Link to="/sponsor/filters" className="text-link">
              <SlidersHorizontal size={14} /> Where my money goes
            </Link>
            <Link to="/fund" className="text-link">
              <Plus size={14} /> Add funds
            </Link>
          </span>
        </div>
        <dl className="dash-stats">
          <div>
            <dt>Paid</dt>
            <dd>{money(totals.paidCents, false)}</dd>
          </div>
          <div>
            <dt>Credit</dt>
            <dd>{money(totals.creditCents, false)}</dd>
          </div>
          <div>
            <dt>Consumed</dt>
            <dd>{money(totals.consumedCents, false)}</dd>
          </div>
          <div>
            <dt>Available</dt>
            <dd>{money(available, false)}</dd>
          </div>
        </dl>
        <p className="dash-sub">
          Shown as <b>{filters.publicName ?? "anonymous"}</b>
          {filters.foundingSponsor && " · Founding sponsor"} ·{" "}
          {filters.mode === "only" ? "selected projects" : "every project"}
          {filters.includeHidden && " + hidden"}
        </p>

        <div className="dash-list">
          <div className="board-head">
            <span>Funded tickets</span>
            <span>Your share</span>
          </div>
          {dashboard.fundedRuns.length === 0 ? (
            <div className="dash-row dash-empty">
              <span className="muted">Nothing funded yet</span>
            </div>
          ) : (
            dashboard.fundedRuns.map((run) => (
              <Link
                to="/runs/$runId"
                params={{ runId: run.runId }}
                key={run.runId}
                className="dash-row"
              >
                <span className="dash-main">
                  <b>{run.ticketTitle}</b>
                  <span className="dash-sub">
                    {run.projectName} · {timeAgo(run.createdAt)}
                  </span>
                </span>
                <span className="dash-figures mono">
                  <span>{money(run.fundedCents ?? 0)}</span>
                  <RunStatus run={run} />
                </span>
              </Link>
            ))
          )}
        </div>

        {dashboard.contributions.length > 0 && (
          <div className="dash-list">
            <div className="board-head">
              <span>Payments</span>
            </div>
            <div className="table-wrap dash-table">
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
                      <td className="mono">
                        {new Date(row.createdAt).toLocaleDateString("en-US")}
                      </td>
                      <td>
                        {row.source === "promo"
                          ? "Promo credit"
                          : capitalize(row.paymentStatus)}
                      </td>
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
          </div>
        )}
      </section>
    </main>
  );
}
