import { Link } from "@tanstack/react-router";
import { Plus, SlidersHorizontal } from "lucide-react";
import { money } from "@/core/packs";
import type { getSponsorDashboardFn } from "@/functions/sponsor.functions";
import { capitalize, RunStatus, timeAgo } from "@/components/ui";

type SponsorData = Extract<
  Awaited<ReturnType<typeof getSponsorDashboardFn>>,
  { status: "ok" }
>;

/** Sponsor tab (replaced by the standings view in the next step). */
export function SponsorView({ data }: { data: SponsorData }) {
  const { dashboard, filters } = data;
  const { totals } = dashboard;
  const available =
    totals.creditCents - totals.consumedCents - totals.reservedCents;
  return (
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
  );
}
