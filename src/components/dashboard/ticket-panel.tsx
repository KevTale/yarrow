import { Play, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { Markdown } from "@/components/markdown";
import { Rich } from "@/components/run-activity";
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

/**
 * A ticket's row, opened. With a pull request, the pull request alone (the
 * review, the changes, merge): it says what the ticket asked. Before, what
 * the ticket asks, as written in GitHub or Jira, and what can be done with
 * it now (start, cancel, retry).
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
  if (row.pullRequest)
    return (
      <PullPanel projectId={projectId} rowKey={row.key} onChanged={onChanged} />
    );
  return <TicketBrief projectId={projectId} row={row} act={act} />;
}

/**
 * The ticket as written in its tracker, read live and again whenever the
 * tracker says it changed; on the right, what can be done with it now.
 */
function TicketBrief({
  projectId,
  row,
  act,
}: {
  projectId: string;
  row: TicketRow;
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
    // A ticket edited in GitHub or Jira comes back with a newer date.
  }, [projectId, row.key, row.updatedAt]);

  const work = workText(row.status, row.models);
  return (
    <div className="pp-grid">
      <section className="pp-main" aria-label={`${row.ref}, as written`}>
        {row.status === "abstained" && row.reason && (
          <p className="tp-reason">
            <Rich text={row.reason} />
          </p>
        )}
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
      <aside className="pp-aside">
        <div className="pp-actions">
          {act && <TicketActions row={row} act={act} />}
          {work && <TextShimmer className="tp-state">{work}</TextShimmer>}
        </div>
        {detail && (detail.author || detail.labels.length > 0) && (
          <p className="tp-by">
            {detail.author && <span>by {detail.author}</span>}
            {detail.labels.map((label) => (
              <span key={label} className="tp-label">
                {label}
              </span>
            ))}
          </p>
        )}
      </aside>
    </div>
  );
}

/** Start, Cancel while it waits its turn, Retry once stopped. */
function TicketActions({ row, act }: { row: TicketRow; act: TicketAct }) {
  if (row.status === "none")
    return (
      <button
        type="button"
        className="pp-btn start"
        disabled={row.pending}
        onClick={() => act("queue", [row.key])}
      >
        <Play size={13} fill="currentColor" aria-hidden="true" /> Start
      </button>
    );
  if (row.status === "queued")
    return (
      <>
        <p className="tp-state">
          {row.pending ? "Starting" : "Waiting for its turn"}
        </p>
        <button
          type="button"
          className="pp-btn"
          disabled={row.pending}
          onClick={() => act("unqueue", [row.key])}
        >
          <X size={15} aria-hidden="true" /> Cancel
        </button>
      </>
    );
  if (row.status === "abstained")
    return (
      <button
        type="button"
        className="pp-btn start"
        onClick={() => act("retry", [row.key])}
      >
        <RotateCcw size={14} aria-hidden="true" /> Retry
      </button>
    );
  return null;
}
