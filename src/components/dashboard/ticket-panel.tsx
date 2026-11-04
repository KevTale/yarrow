import { useEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { RunStory, StopReason } from "@/components/run-activity";
import { ticketText } from "@/core/new-ticket";
import { merging, workText, type TicketRow } from "@/core/tickets";
import { getTicketFn } from "@/functions/builder.functions";
import { Conversation, PullPanel, usePullPanel } from "./pull-panel";

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
 * review, the changes): it says what the ticket asked. Before, what the
 * ticket asks, as written in GitHub or Jira. Start, Cancel, Retry and Merge
 * stay on the row's line.
 */
export function TicketPanel({
  projectId,
  row,
  onChanged,
  onMerge,
  notMerged,
}: {
  projectId: string;
  row: TicketRow;
  /** The row moved (merged, a change asked). */
  onChanged: () => void;
  onMerge: () => void;
  /** GitHub's words, when it refused to merge. */
  notMerged?: string;
}) {
  if (row.pullRequest)
    return (
      <PullPanel
        projectId={projectId}
        rowKey={row.key}
        onChanged={onChanged}
        merging={merging(row)}
        onMerge={row.status === "merged" ? undefined : onMerge}
        notMerged={notMerged}
      />
    );
  return <TicketBrief projectId={projectId} row={row} onChanged={onChanged} />;
}

/**
 * The ticket as written in its tracker, read live and again whenever the
 * tracker says it changed, the same in every stage; beside it the
 * conversation on why the agents stopped, or their work live, from the moment
 * it is In progress.
 */
function TicketBrief({
  projectId,
  row,
  onChanged,
}: {
  projectId: string;
  row: TicketRow;
  onChanged: () => void;
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

  const working = workText(row.status, row.models) !== null;
  const going = working || row.status === "queued";
  const stopped = row.status === "abstained";
  const text = detail ? ticketText(detail.body, row.title) : "";
  return (
    <div className={stopped || going ? "pp-grid" : undefined}>
      <section className="pp-main" aria-label={`${row.ref}, as written`}>
        {detail === undefined ? (
          <div className="tp-lines" aria-busy="true" aria-label="Loading">
            <span className="sk" style={{ width: "88%" }} />
            <span className="sk" style={{ width: "64%" }} />
          </div>
        ) : text ? (
          <Markdown source={text} />
        ) : (
          <p className="tp-empty">No description</p>
        )}
      </section>
      {stopped && (
        <StoppedTalk projectId={projectId} row={row} onChanged={onChanged} />
      )}
      {going && (
        <aside className="pp-aside">
          {working && row.runId ? (
            <RunStory runId={row.runId} />
          ) : (
            <p className="muted">Waiting</p>
          )}
        </aside>
      )}
    </div>
  );
}

/**
 * Why the agents stopped, at the head of the conversation: the agent looks
 * into it with the member and starts the ticket again on their word, the row
 * following. Nothing said here starts a run by itself.
 */
function StoppedTalk({
  projectId,
  row,
  onChanged,
}: {
  projectId: string;
  row: TicketRow;
  onChanged: () => void;
}) {
  const { panel, setPanel, refresh } = usePullPanel(projectId, row.key);
  const [draft, setDraft] = useState("");
  const answering = Boolean(
    panel?.messages.some((message) => message.status === "pending"),
  );
  const wasAnswering = useRef(false);
  useEffect(() => {
    if (wasAnswering.current && !answering) onChanged();
    wasAnswering.current = answering;
  }, [answering, onChanged]);
  const reason = <StopReason reason={row.reason} summary={row.summary} />;
  if (!panel) return <aside className="pp-aside">{reason}</aside>;
  return (
    <Conversation
      panel={panel}
      projectId={projectId}
      rowKey={row.key}
      draft={draft}
      onDraft={setDraft}
      onPanel={setPanel}
      onRefresh={refresh}
      onSeek={null}
      onMade={onChanged}
      head={reason}
    />
  );
}
