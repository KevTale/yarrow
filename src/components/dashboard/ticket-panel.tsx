import { useServerFn } from "@tanstack/react-start";
import { RotateCcw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Markdown } from "@/components/markdown";
import { Spinner } from "@/components/navigation-feedback";
import { RunStory, StopReason } from "@/components/run-activity";
import { ticketText } from "@/core/new-ticket";
import { workText, type TicketRow } from "@/core/tickets";
import { answerTicketFn, getTicketFn } from "@/functions/builder.functions";
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
 * review, the changes): it says what the ticket asked. Before, what the
 * ticket asks, as written in GitHub or Jira. Start, Cancel, Retry and Merge
 * stay on the row's line.
 */
export function TicketPanel({
  projectId,
  row,
  onChanged,
}: {
  projectId: string;
  row: TicketRow;
  /** The row moved (merged, a change asked). */
  onChanged: () => void;
}) {
  if (row.pullRequest)
    return (
      <PullPanel projectId={projectId} rowKey={row.key} onChanged={onChanged} />
    );
  return <TicketBrief projectId={projectId} row={row} onChanged={onChanged} />;
}

/**
 * The ticket as written in its tracker, read live and again whenever the
 * tracker says it changed; why the agents stopped, or their work live.
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
  const stopped = row.status === "abstained";
  const text = detail ? ticketText(detail.body, row.title) : "";
  return (
    <div className="pp-grid">
      <section className="pp-main" aria-label={`${row.ref}, as written`}>
        {stopped && <StopReason reason={row.reason} summary={row.summary} />}
        {detail === undefined ? (
          <div className="tp-lines" aria-busy="true" aria-label="Loading">
            <span className="sk" style={{ width: "88%" }} />
            <span className="sk" style={{ width: "64%" }} />
          </div>
        ) : text ? (
          <Markdown source={text} />
        ) : (
          // Stopped, the reason says enough: no "No description" under it.
          !stopped && <p className="tp-empty">No description</p>
        )}
        {working && row.runId && <RunStory runId={row.runId} />}
      </section>
      {stopped ? (
        // Answered as a pull request is talked about: the box at the foot of
        // the right column.
        <aside className="pp-talk tp-talk" aria-label="Answer">
          <p className="tp-talk-note">
            Your answer goes on the ticket, then it starts again.
          </p>
          <Answer projectId={projectId} row={row} onAnswered={onChanged} />
        </aside>
      ) : (
        <aside className="pp-aside">
          {/* An app (Yarrow's own, opening a ticket written here) says
              nothing: the ticket names who wrote it. */}
          {detail?.author && !detail.author.endsWith("[bot]") && (
            <p className="tp-by">by {detail.author}</p>
          )}
        </aside>
      )}
    </div>
  );
}

/**
 * The agents stopped and asked: the builder answers here. The answer is
 * written on the ticket, where the agents read it, and the ticket starts
 * again.
 */
function Answer({
  projectId,
  row,
  onAnswered,
}: {
  projectId: string;
  row: TicketRow;
  onAnswered: () => void;
}) {
  const send = useServerFn(answerTicketFn);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  // One line, growing with what is typed, as the pull request's box.
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const area = box.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [text]);

  async function submit() {
    const answer = text.trim();
    if (!answer || pending) return;
    setError("");
    setPending(true);
    try {
      const result = await send({
        data: { projectId, key: row.key, answer },
      });
      if (result.ok) {
        setText("");
        onAnswered();
      } else setError(result.error);
    } catch {
      setError("That did not go through. Try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="pp-asking">
      <form
        className="pp-input"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={box}
          aria-label={`Answer the agents on ${row.ref}`}
          placeholder="Answer the questions…"
          rows={1}
          value={text}
          maxLength={4000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {text.trim() && (
          <button
            type="submit"
            className="pp-go"
            aria-label="Answer and retry"
            data-tip="Answer and retry"
            aria-disabled={pending}
          >
            {pending ? <Spinner /> : <RotateCcw size={16} strokeWidth={2.2} />}
          </button>
        )}
      </form>
      {error && (
        <p className="pp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
