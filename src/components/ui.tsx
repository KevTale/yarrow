import type { ReactNode } from "react";
import { sponsorNames, type RunSponsor } from "@/core/attribution";

export function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="muted">{description}</p>}
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

type RunLike = {
  status: "running" | "completed" | "abstained";
  outcome: "pull_request" | "abstained" | null;
  phase?: string | null;
};

const statusLabel: Record<string, string> = {
  running: "Running",
  completed: "PR delivered",
  abstained: "Abstained",
};

export function RunStatus({ run }: { run: RunLike }) {
  const css =
    run.status === "running"
      ? "status-running"
      : run.status === "completed"
        ? "status-merged"
        : "status-abstained";
  return (
    <span className={`status ${css}`}>
      <span className="status-dot" aria-hidden="true" />
      {run.status === "running" && run.phase
        ? capitalize(run.phase)
        : statusLabel[run.status]}
    </span>
  );
}

export function TicketStatus({ status }: { status: string }) {
  const css =
    status === "running"
      ? "status-running"
      : status === "delivered" || status === "closed"
        ? "status-merged"
        : status === "abstained"
          ? "status-abstained"
          : "";
  return (
    <span className={`status ${css}`}>
      <span className="status-dot" aria-hidden="true" />
      {capitalize(status)}
    </span>
  );
}

export function VisibilityBadge({
  visibility,
}: {
  visibility: "public" | "listed" | "hidden";
}) {
  const label = { public: "Public", listed: "Listed", hidden: "Hidden" };
  return (
    <span
      className={`badge ${visibility === "public" ? "pool-commons" : "pool-commercial"}`}
    >
      {label[visibility]}
    </span>
  );
}

export function SponsorLine({ sponsors }: { sponsors: RunSponsor[] }) {
  const names = sponsorNames(sponsors);
  return names ? (
    <span className="muted small">Sponsored by {names}</span>
  ) : null;
}

export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children && <p className="muted">{children}</p>}
    </div>
  );
}

export function NotConfigured({ what = "The database" }: { what?: string }) {
  return (
    <EmptyState title="Not connected yet">
      {what} is not configured on this deployment. Live data appears here once
      it is connected.
    </EmptyState>
  );
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

export function timeAgo(value: Date | string | null): string {
  if (!value) return "";
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/** "48s", "2m 34s", "1h 05m". */
export function duration(from: Date | string, to: Date | string): string {
  const seconds = Math.max(
    0,
    Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000),
  );
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60)
    return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
