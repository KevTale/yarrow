"use client";

import Link from "next/link";
import { ArrowUpRight, Plus, Wallet } from "lucide-react";
import { money } from "@/core/packs";
import { demoSpend } from "@/lib/demo-data";
import { useDemoProjects } from "@/lib/demo-storage";
import { PoolBadge, StatGrid } from "./ui";
import { WorkList } from "./work-list";

export function Dashboard() {
  const projects = useDemoProjects();
  const spend = demoSpend.reduce((total, cents) => total + cents, 0);
  return (
    <>
      <StatGrid
        items={[
          {
            label: "Funded",
            value: "$145.00",
            detail: "Sample paid contributions",
          },
          {
            label: "Available credit",
            value: "$31.40",
            detail: "$8.00 reserved · $105.60 spent",
          },
          {
            label: "Work units",
            value: "47",
            detail: "Every run, every outcome",
          },
          {
            label: "Pull requests merged",
            value: "16",
            detail: "9 open · 11 abstained · 11 running",
          },
        ]}
      />
      <div className="dashboard-layout">
        <div>
          <section className="panel" aria-labelledby="spend-title">
            <div className="row spread">
              <h2 id="spend-title">
                Compute spent <span className="muted">· 30 days</span>
              </h2>
              <span className="mono small">{money(spend)}</span>
            </div>
            <div
              className="spend-chart"
              role="img"
              aria-label={`Sample daily compute spend: ${money(spend)} over 30 days. Peak $5.30.`}
            >
              {demoSpend.map((value, index) => (
                <span key={index} title={`Day ${index + 1}: ${money(value)}`}>
                  <i style={{ height: `${(value / 530) * 100}%` }} />
                </span>
              ))}
            </div>
            <div className="chart-labels mono">
              <span>Sep 06</span>
              <span>Sep 20</span>
              <span>Oct 05</span>
            </div>
          </section>
          <WorkList />
        </div>
        <aside>
          <section>
            <h2 className="section-title">Your projects</h2>
            {projects.length > 0 ? (
              projects.map((project) => (
                <div className="panel project-panel" key={project.repository}>
                  <div className="row spread">
                    <strong>{project.name}</strong>
                    <PoolBadge pool={project.pool} />
                  </div>
                  <p className="mono small muted">{project.repository}</p>
                  <dl className="summary-lines">
                    <div>
                      <dt>Status</dt>
                      <dd>Local draft</dd>
                    </div>
                    <div>
                      <dt>Cap per work unit</dt>
                      <dd>{money(project.capCents)}</dd>
                    </div>
                    <div>
                      <dt>Integration</dt>
                      <dd>Not connected</dd>
                    </div>
                  </dl>
                </div>
              ))
            ) : (
              <div className="panel project-panel">
                <div className="row spread">
                  <strong>Sillage API</strong>
                  <PoolBadge pool="commercial" />
                </div>
                <p className="mono small muted">
                  sillage-io/api · Jira SIL · sample
                </p>
                <dl className="summary-lines">
                  <div>
                    <dt>Queued</dt>
                    <dd>14 work units</dd>
                  </div>
                  <div>
                    <dt>Pull requests</dt>
                    <dd>22 delivered</dd>
                  </div>
                  <div className="divider">
                    <dt>Sample pool</dt>
                    <dd>$212.60</dd>
                  </div>
                </dl>
              </div>
            )}
            <Link href="/projects/new" className="dashed-button">
              <Plus size={14} />
              Add a project
            </Link>
          </section>
          <section className="panel" style={{ marginTop: 25 }}>
            <Wallet size={20} className="amber" />
            <h2 style={{ marginTop: 15 }}>Make room for more work.</h2>
            <p className="field-note">
              Choose where your next contribution goes. Start with $5, keep the
              trail.
            </p>
            <Link
              href="/fund"
              className="text-link amber"
              style={{ marginTop: 20 }}
            >
              Fund AI work <ArrowUpRight size={14} />
            </Link>
          </section>
        </aside>
      </div>
      <section
        id="ledger"
        className="ledger-section"
        aria-labelledby="ledger-title"
      >
        <div className="section-heading">
          <h2 id="ledger-title" className="section-title">
            The ledger
          </h2>
          <span className="mono small muted">
            Sample contribution · ct_20_demo
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">
              Sample $20 contribution: reserve $8, debit $3.42, release $4.58.
              Available credit $16.58.
            </caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Entry</th>
                <th scope="col">Reference</th>
                <th scope="col">Destination</th>
                <th scope="col" className="right">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  time: "Oct 05 · 12:35",
                  kind: "credit",
                  reference: "Contribution · Builder pack",
                  destination: "Commons pool",
                  amount: "$20.00",
                },
                {
                  time: "Oct 05 · 12:40",
                  kind: "reserve",
                  reference: "AgentRun → wu_8f3a21",
                  destination: "tidepool · #4821",
                  amount: "$8.00",
                },
                {
                  time: "Oct 05 · 12:54",
                  kind: "debit",
                  reference: "Result · draft PR #4907",
                  destination: "Actual compute used",
                  amount: "$3.42",
                },
                {
                  time: "Oct 05 · 12:54",
                  kind: "release",
                  reference: "Unused reservation",
                  destination: "Back to commons credit",
                  amount: "$4.58",
                },
              ].map((entry) => (
                <tr key={entry.kind}>
                  <td className="mono muted">{entry.time}</td>
                  <td>
                    <span className={`ledger-kind ${entry.kind}`}>
                      {entry.kind}
                    </span>
                  </td>
                  <td>
                    <Link href="/work/wu_8f3a21">{entry.reference}</Link>
                  </td>
                  <td className="muted">{entry.destination}</td>
                  <td className="mono right">{entry.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field-note">
          Reserve moves available credit aside; debit records actual spend;
          release returns the unused reserve. This contribution has $16.58
          available.
        </p>
      </section>
    </>
  );
}
