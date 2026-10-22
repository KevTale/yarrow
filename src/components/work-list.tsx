"use client";

import { useState } from "react";
import Link from "next/link";
import { demoWork } from "@/lib/demo-data";
import { money } from "@/core/packs";
import { PoolBadge, StatusBadge } from "./ui";

export function WorkList({
  directory = false,
  initialPool = "All",
}: {
  directory?: boolean;
  initialPool?: string;
}) {
  const [filter, setFilter] = useState("All");
  const [pool, setPool] = useState(initialPool);
  const work = demoWork.filter(
    (item) =>
      (filter === "All" || item.status === filter) &&
      (pool === "All" || item.pool === pool),
  );
  return (
    <section
      className={directory ? "work-directory" : "activity-section"}
      aria-labelledby="funded-work"
    >
      <div className="activity-heading">
        <h2 id="funded-work" className="section-title">
          {directory ? "The work, in the open" : "Work you funded"}
        </h2>
        <div className="segments" role="group" aria-label="Work status">
          {["All", "Running", "Abstained"].map((value) => (
            <button
              type="button"
              key={value}
              aria-pressed={filter === value}
              onClick={() => setFilter(value)}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      {directory && (
        <div
          className="segments"
          role="group"
          aria-label="Work pool"
          style={{ marginBottom: 20 }}
        >
          {["All", "commons", "commercial"].map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={pool === value}
              onClick={() => setPool(value)}
            >
              {value === "All"
                ? value
                : value[0]?.toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>
      )}
      <div className="work-list">
        {work.map((item) => (
          <Link className="work-row" key={item.id} href={`/work/${item.id}`}>
            <StatusBadge status={item.status} />
            <span>
              <span className="work-row-title">{item.title}</span>
              <span className="work-row-detail mono">
                {item.project} · {item.issue}
                {item.pr
                  ? ` → PR ${item.pr}`
                  : item.reason
                    ? " · scope too broad"
                    : " · tests in progress"}
              </span>
            </span>
            {directory && <PoolBadge pool={item.pool} />}
            <span className="mono">{money(item.costCents)}</span>
          </Link>
        ))}
        {work.length === 0 && (
          <p className="empty-state">No sample work matches these filters.</p>
        )}
      </div>
    </section>
  );
}
