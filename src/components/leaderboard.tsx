"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import { demoFunders } from "@/lib/demo-data";
import { money } from "@/core/packs";
import { StatGrid } from "./ui";

export function Leaderboard() {
  const [period, setPeriod] = useState<"7d" | "30d" | "All time">("30d");
  const [pool, setPool] = useState("All");
  const [search, setSearch] = useState("");
  const allRows = demoFunders
    .map((funder) => ({
      ...funder,
      amount:
        period === "7d"
          ? funder.weekCents
          : period === "All time"
            ? funder.allCents
            : funder.fundedCents,
    }))
    .sort((a, b) => b.amount - a.amount);
  const rows = allRows.filter(
    (funder) =>
      (pool === "All" || funder.pool === pool.toLowerCase()) &&
      `${funder.name} ${funder.project}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const total = allRows.reduce((sum, row) => sum + row.amount, 0);
  const commons = allRows
    .filter((row) => row.pool === "commons")
    .reduce((sum, row) => sum + row.amount, 0);
  return (
    <>
      <div className="row spread board-controls" style={{ marginBottom: 22 }}>
        <p className="small muted">
          Every contribution moves the work forward.
        </p>
        <div
          className="segments segments-box"
          role="group"
          aria-label="Leaderboard period"
        >
          {(["7d", "30d", "All time"] as const).map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={period === value}
              onClick={() => setPeriod(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <StatGrid
        items={[
          {
            label: `Funded · ${period}`,
            value: money(total, false),
            detail: "Sample settled contributions",
          },
          {
            label: "Funders on this board",
            value: String(allRows.length).padStart(2, "0"),
            detail: "Individuals + organizations",
          },
          {
            label: "Commons share",
            value: `${Math.round((commons / total) * 100)}%`,
            detail: "Commercial work counts equally",
          },
          {
            label: "Ranked by",
            value: "USD",
            detail: "Promo credits excluded",
          },
        ]}
      />
      <div className="filter-toolbar">
        <div className="segments" role="group" aria-label="Project type">
          {["All", "Commons", "Commercial"].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={pool === value}
              onClick={() => setPool(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <label className="search-wrap">
          <span className="sr-only">Search funders or projects</span>
          <Search size={14} />
          <input
            type="search"
            className="search-input"
            placeholder="Search funders or projects"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <div className="table-wrap">
        <table>
          <caption className="sr-only">
            Demo funders ranked by settled dollars, {period}. Work and PR
            columns show all-time context.
          </caption>
          <thead>
            <tr>
              <th scope="col">Rank</th>
              <th scope="col">Funder</th>
              <th scope="col">Top project</th>
              <th scope="col" className="right">
                Work · all time
              </th>
              <th scope="col" className="right">
                PRs · all time
              </th>
              <th scope="col" className="right">
                Funded ↓
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((funder, index) => (
              <tr key={funder.name} className={`rank-${index + 1}`}>
                <td className="mono muted">
                  {String(index + 1).padStart(2, "0")}
                </td>
                <td>
                  <span className="table-person">
                    <span className="avatar" aria-hidden="true">
                      {funder.initials}
                    </span>
                    {funder.name}
                  </span>
                </td>
                <td className="muted">{funder.project}</td>
                <td className="mono right muted">
                  {funder.units.toLocaleString("en-US")}
                </td>
                <td className="mono right muted">
                  {funder.prs.toLocaleString("en-US")}
                </td>
                <td>
                  <span className="funded-cell">
                    <span className="bar-track" aria-hidden="true">
                      <span
                        style={{
                          width: `${(funder.amount / (rows[0]?.amount ?? 1)) * 100}%`,
                        }}
                      />
                    </span>
                    <span className="mono right">
                      {money(funder.amount, false)}
                    </span>
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="empty-state">
                  No funders match. Try another name or project type.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="board-footnote">
        <span>{rows.length} funders · sample data</span>
        <span>
          Settled dollars determine rank. Pull requests are a separate metric.
        </span>
      </div>
      <div className="pinned-row">
        <span className="mono amber">You</span>
        <span>Your first contribution belongs here.</span>
        <Link
          href="/fund"
          className="text-link amber"
          style={{ marginLeft: "auto" }}
        >
          Fund AI work <ArrowUpRight size={14} />
        </Link>
      </div>
    </>
  );
}
