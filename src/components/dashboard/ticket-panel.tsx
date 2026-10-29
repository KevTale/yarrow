import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Play, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { Markdown } from "@/components/markdown";
import { Rich } from "@/components/run-activity";
import { longDate, shortDate } from "@/components/ui";
import { workText, type TicketRow } from "@/core/tickets";
import { getTicketFn } from "@/functions/builder.functions";
import { PullPanel } from "./pull-panel";

type Detail = Awaited<ReturnType<typeof getTicketFn>>;
export type TicketAct = (
  kind: "queue" | "unqueue" | "retry",
  keys: string[],
) => void;

/** What each opened ticket said, kept for the page's life, read again on open. */
const details = new Map<string, Detail>();
const inflight = new Map<string, Promise<Detail>>();
const cacheKey = (projectId: string, key: string) => `${projectId}:${key}`;

function fetchTicket(projectId: string, key: string): Promise<Detail> {
  const id = cacheKey(projectId, key);
  const pending = inflight.get(id);
  if (pending) return pending;
  const request = getTicketFn({ data: { projectId, key } })
    .then((detail) => {
      details.set(id, detail);
      return detail;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, request);
  return request;
}

/** Reads a ticket before its row opens (hover, focus). */
export function prefetchTicket(projectId: string, key: string): void {
  if (details.has(cacheKey(projectId, key))) return;
  void fetchTicket(projectId, key).catch(() => {});
}

const sourceName = {
  github: "GitHub",
  jira: "Jira",
  linear: "Linear",
  trello: "Trello",
} as const;

/**
 * A ticket's row, opened: what the ticket asks, as written in GitHub or
 * Jira, then its pull request (the review, the changes, merge) or what can
 * be done with it now (start, cancel, retry).
 */
export function TicketPanel({
  projectId,
  row,
  onChanged,
  act,
}: {
  projectId: string;
  row: TicketRow;
  /** The row moved (merged, a change asked). */
  onChanged: () => void;
  /** Start, cancel or retry; none in the cross-project review list. */
  act?: TicketAct;
}) {
  const id = cacheKey(projectId, row.key);
  const [detail, setDetail] = useState<Detail | undefined>(() =>
    details.get(id),
  );
  useEffect(() => {
    let live = true;
    fetchTicket(projectId, row.key)
      .then((next) => live && setDetail(next))
      // An unreachable tracker keeps what is shown.
      .catch(() => live && setDetail((shown) => shown ?? null));
    return () => {
      live = false;
    };
  }, [projectId, row.key]);

  const created = detail?.createdAt ?? row.createdAt;
  const url = detail?.url || row.url;
  return (
    <div className="tp">
      <section className="tp-brief" aria-label={`${row.ref}, as written`}>
        <p className="tp-meta">
          {detail?.author && <span>{detail.author}</span>}
          <time dateTime={created} title={longDate(created)}>
            {shortDate(created)}
          </time>
          {detail?.labels.map((label) => (
            <span key={label} className="tp-label">
              {label}
            </span>
          ))}
          {url && (
            <a className="tp-out" href={url} target="_blank" rel="noopener">
              Open on {sourceName[row.source]}
              <ArrowUpRight size={14} aria-hidden="true" />
            </a>
          )}
        </p>
        {detail === undefined ? (
          <div className="tp-lines" aria-busy="true" aria-label="Loading">
            <span className="sk" style={{ width: "88%" }} />
            <span className="sk" style={{ width: "64%" }} />
          </div>
        ) : detail?.body.trim() ? (
          <Markdown source={detail.body} />
        ) : (
          <p className="tp-empty">No description</p>
        )}
      </section>
      {row.pullRequest ? (
        <PullPanel
          projectId={projectId}
          rowKey={row.key}
          onChanged={onChanged}
        />
      ) : (
        act && <TicketActions row={row} act={act} />
      )}
    </div>
  );
}

/** A ticket without a pull request yet: what the builder can do now. */
function TicketActions({ row, act }: { row: TicketRow; act: TicketAct }) {
  if (row.status === "none")
    return (
      <div className="tp-actions">
        <button
          type="button"
          className="tix-btn tix-btn-amber"
          disabled={row.pending}
          onClick={() => act("queue", [row.key])}
        >
          <Play size={12} fill="currentColor" aria-hidden="true" /> Start
        </button>
      </div>
    );
  if (row.status === "queued")
    return (
      <div className="tp-actions">
        <span className="tp-state">Waiting for its turn</span>
        <button
          type="button"
          className="tix-btn tix-btn-line"
          disabled={row.pending}
          onClick={() => act("unqueue", [row.key])}
        >
          Cancel
        </button>
      </div>
    );
  if (row.status === "abstained")
    return (
      <div className="tp-actions stopped">
        {row.reason && (
          <p className="tp-reason">
            <Rich text={row.reason} />
          </p>
        )}
        <button
          type="button"
          className="tix-btn tix-btn-amber"
          onClick={() => act("retry", [row.key])}
        >
          <RotateCcw size={13} aria-hidden="true" /> Retry
        </button>
      </div>
    );
  const work = workText(row.status, row.models);
  return work ? (
    <div className="tp-actions">
      <TextShimmer className="tp-state">{work}</TextShimmer>
      {row.runId && (
        <Link
          to="/runs/$runId"
          params={{ runId: row.runId }}
          className="tp-out"
        >
          Follow the run <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      )}
    </div>
  ) : null;
}
