import type { ReactNode } from "react";
import type { Pool } from "@/core/forms";
import type { WorkStatus } from "@/lib/demo-data";

export function PoolBadge({ pool }: { pool: Pool }) {
  return (
    <span className={`badge pool-${pool}`}>
      {pool === "commons" ? "Commons" : "Commercial"}
    </span>
  );
}

export function StatusBadge({ status }: { status: WorkStatus }) {
  return (
    <span className={`status status-${status.toLowerCase().replace(" ", "-")}`}>
      <span className="status-dot" aria-hidden="true" />
      {status}
    </span>
  );
}

export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {children}
    </header>
  );
}

export function StatGrid({
  items,
}: {
  items: { label: string; value: ReactNode; detail?: string }[];
}) {
  return (
    <dl className="stat-grid">
      {items.map((item) => (
        <div key={item.label}>
          <dt className="eyebrow">{item.label}</dt>
          <dd className="stat-value mono">{item.value}</dd>
          {item.detail && <p className="stat-detail mono">{item.detail}</p>}
        </div>
      ))}
    </dl>
  );
}

export function DemoNotice({ children }: { children?: ReactNode }) {
  return (
    <p className="demo-notice">
      <span className="demo-dot" aria-hidden="true" />
      {children ??
        "Demo workspace · sample data, no real payments or agent activity."}
    </p>
  );
}
