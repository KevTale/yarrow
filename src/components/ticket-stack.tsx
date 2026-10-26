import { useEffect, useState } from "react";
import type { LiveRow } from "@/db/boards";
import { Logo, plural, type SponsorRow } from "./boards";
import { useFlip } from "./live";
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

/**
 * The latest tickets as cards, the newest on top, a few at a time: they turn
 * by themselves, and a ticket that starts or ships comes in from the top.
 * Each card says who paid for it.
 */
export function TicketStack({
  live,
  totals,
  sponsors,
  shown = 3,
}: {
  live: LiveRow[];
  totals: { inProgress: number; merged: number };
  /** The boards' sponsors, for their logos. */
  sponsors: SponsorRow[];
  shown?: number;
}) {
  const [start, setStart] = useState(0);
  const [seen, setSeen] = useState(live);
  // New work: back to the newest.
  if (seen !== live) {
    setSeen(live);
    setStart(0);
  }
  const turning = live.length > shown;
  useEffect(() => {
    if (!turning) return;
    const timer = setInterval(
      () => setStart((current) => (current - 1 + live.length) % live.length),
      4_500,
    );
    return () => clearInterval(timer);
  }, [turning, live.length]);
  const cards = Array.from(
    { length: Math.min(shown, live.length) },
    (_, i) => live[(start + i) % live.length]!,
  );
  const list = useFlip<HTMLOListElement>(cards.map((row) => row.key).join());
  const logos = new Map(sponsors.map((row) => [row.publicId, row.logoUrl]));

  return (
    <div className="tk-stack">
      <ol className="tk-list" ref={list}>
        {cards.length === 0 && (
          <li className="tk tk-empty">The first tickets show up here</li>
        )}
        {cards.map((row) => {
          const sponsor = row.sponsors[0];
          const body = (
            <>
              <span className="tk-head">
                <Logo name={row.project} url={row.logoUrl} size="small" />
                <span className="tk-project">{row.project}</span>
                {row.issueRef && <span className="tk-ref">{row.issueRef}</span>}
                <span className="tk-when">{timeAgo(row.at)}</span>
              </span>
              <strong className={`tk-title ${row.title ? "" : "private"}`}>
                {row.title ?? "Private ticket"}
              </strong>
              <span className="tk-foot">
                <span className={`tk-status s-${row.status}`}>
                  {working(row.status) && (
                    <span className="live-dot" aria-hidden="true" />
                  )}
                  {statusLabel(row)}
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
              </span>
            </>
          );
          const href =
            row.prUrl ?? (working(row.status) ? `/runs/${row.key}` : null);
          return (
            <li key={row.key} data-flip={row.key}>
              {href ? (
                <a
                  className="tk"
                  href={href}
                  {...(row.prUrl ? { target: "_blank", rel: "noopener" } : {})}
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
