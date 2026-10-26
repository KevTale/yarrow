import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LiveRow } from "@/db/boards";
import { Logo, plural, type SponsorRow } from "./boards";
import { timeAgo } from "./ui";

const working = (status: LiveRow["status"]) =>
  status !== "pull_request" && status !== "merged";

function statusLabel(row: LiveRow) {
  switch (row.status) {
    case "writing":
      return "Writing";
    case "reviewing":
      return "In review";
    case "delivering":
      return "Opening the PR";
    case "pull_request":
      return row.prNumber ? `PR #${row.prNumber} open` : "PR open";
    case "merged":
      return row.prNumber ? `PR #${row.prNumber} merged` : "Merged";
  }
}

/** A row turns every this often; the slide itself is in CSS. */
const STEP_MS = 4_000;
const SLIDE_MS = 600;

/**
 * The latest tickets as a column that turns: one row each, the newest on
 * top, the next one coming in from the top every few seconds while the
 * rows above and below fade out at the edges. Each row says who paid.
 */
export function TicketStack({
  live,
  totals,
  sponsors,
}: {
  live: LiveRow[];
  totals: { inProgress: number; merged: number };
  /** The boards' sponsors, for their logos. */
  sponsors: SponsorRow[];
}) {
  const n = live.length;
  // Fewer rows than the window: nothing to turn.
  const turning = n > 3;
  // The rows three times over; the window sits in the middle copy and
  // slides down one row at a time, then jumps back a copy, unseen.
  const rows = turning ? [...live, ...live, ...live] : live;
  const [offset, setOffset] = useState(2 * n);
  const [paused, setPaused] = useState(false);
  const [seen, setSeen] = useState(live);
  const list = useRef<HTMLOListElement>(null);
  // The offset last painted: a step goes down one; anything up is a jump.
  const painted = useRef(offset);
  // New work: back to the newest.
  if (seen !== live) {
    setSeen(live);
    setOffset(2 * n);
  }
  useEffect(() => {
    if (!turning || paused) return;
    const timer = setInterval(
      () => setOffset((current) => current - 1),
      STEP_MS,
    );
    return () => clearInterval(timer);
  }, [turning, paused, n]);
  // Back at the first copy's edge: once the slide ends, jump a copy up.
  useEffect(() => {
    if (!turning || offset > n) return;
    const timer = setTimeout(() => setOffset(offset + n), SLIDE_MS);
    return () => clearTimeout(timer);
  }, [turning, offset, n]);
  // A jump is painted with no transition, which then comes back.
  useLayoutEffect(() => {
    const element = list.current;
    const jumped = offset > painted.current;
    painted.current = offset;
    if (!jumped || !element) return;
    element.style.transition = "none";
    void element.offsetHeight;
    element.style.transition = "";
  }, [offset]);

  const logos = new Map(sponsors.map((row) => [row.publicId, row.logoUrl]));

  return (
    <div
      className="tk-stack"
      style={{ "--max": Math.max(1, n - 1) } as React.CSSProperties}
    >
      <div
        className={`tk-window ${turning ? "turning" : ""}`}
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
      >
        <ol
          className="tk-list"
          ref={list}
          style={
            turning
              ? { transform: `translateY(calc(var(--row) * ${0.5 - offset}))` }
              : undefined
          }
        >
          {n === 0 && (
            <li className="tk tk-empty">The first tickets show up here</li>
          )}
          {rows.map((row, i) => {
            const sponsor = row.sponsors[0];
            const body = (
              <>
                <Logo name={row.project} url={row.logoUrl} size="small" />
                <span className="tk-head">
                  <span className="tk-project">{row.project}</span>
                  {row.issueRef && (
                    <span className="tk-ref">{row.issueRef}</span>
                  )}
                  <span className="tk-when">{timeAgo(row.at)}</span>
                </span>
                <span className={`tk-status s-${row.status}`}>
                  {working(row.status) && (
                    <span className="live-dot" aria-hidden="true" />
                  )}
                  {statusLabel(row)}
                </span>
                <span className={`tk-title ${row.title ? "" : "private"}`}>
                  {row.title ?? "Private ticket"}
                </span>
                {sponsor && (
                  <span className="tk-paid">
                    Paid by
                    <Logo
                      name={sponsor.name}
                      url={logos.get(sponsor.publicId ?? "") ?? null}
                      size="small"
                    />
                    <b className={sponsor.name ? "" : "anonymous"}>
                      {sponsor.name ?? "Anonymous sponsor"}
                    </b>
                    {row.sponsors.length > 1 && (
                      <span>+{row.sponsors.length - 1}</span>
                    )}
                  </span>
                )}
              </>
            );
            const href =
              row.prUrl ?? (working(row.status) ? `/runs/${row.key}` : null);
            // The copies repeat the rows: only the middle one is read out.
            const copy = turning ? Math.floor(i / n) : 1;
            return (
              <li key={`${copy}-${row.key}`} aria-hidden={copy !== 1}>
                {href ? (
                  <a
                    className="tk"
                    href={href}
                    tabIndex={copy === 1 ? undefined : -1}
                    {...(row.prUrl
                      ? { target: "_blank", rel: "noopener" }
                      : {})}
                  >
                    {body}
                  </a>
                ) : (
                  <div className="tk">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <p className="tk-totals">
        <span>
          <b>{totals.inProgress}</b> in progress
        </span>
        <span>
          <b>{totals.merged.toLocaleString("en-US")}</b>{" "}
          {plural(totals.merged, "merged PR").replace(/^[\d,]+ /, "")}
        </span>
      </p>
    </div>
  );
}
