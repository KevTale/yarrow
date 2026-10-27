import { workLabel } from "@/core/tickets";
import type { LiveRow } from "@/db/boards";
import { Logo, plural, type SponsorRow } from "./boards";
import { useFlip } from "./live";
import { timeAgo } from "./ui";

const working = (status: LiveRow["status"]) =>
  status !== "pull_request" && status !== "merged";

/** The maker's color for a model name, as in the pitch. */
const makerClass = (model: string) =>
  model.startsWith("Claude") ? "model-claude" : "model-gpt";

/** The status pill: who is at work, or the pull request's state. */
function Status({ row }: { row: LiveRow }) {
  const work = workLabel(row.status, row.models);
  return (
    <span className={`tk-status s-${row.status}`}>
      {work && <span className="live-dot" aria-hidden="true" />}
      {work ? (
        <>
          {work.model && (
            <span className={`model ${makerClass(work.model)}`}>
              {work.model}
            </span>
          )}{" "}
          {work.text}
        </>
      ) : row.status === "merged" ? (
        "PR merged"
      ) : (
        "PR open"
      )}
    </span>
  );
}

/** Cards shown: the latest few, whole. */
const SHOWN = 4;

/**
 * The latest tickets as a short column of cards under a "Live" line that
 * carries the platform's totals. Nothing moves on its own: a new ticket
 * slides in at the top, a ticket whose state changed flashes, a ticket
 * that moved slides to its place (useFlip, from the Realtime signal). Each
 * card says who paid and opens the pull request or the run.
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
  const rows = live.slice(0, SHOWN);
  const list = useFlip<HTMLOListElement>(live);
  const logos = new Map(sponsors.map((row) => [row.publicId, row.logoUrl]));
  // A named sponsor with a website opens it, counted, from the card.
  const linked = new Set(
    sponsors
      .filter((row) => row.name && row.websiteUrl)
      .map((row) => row.publicId),
  );

  return (
    <div className="tk-stack">
      <p className="tk-live">
        <span className="tk-live-label">
          <span className="live-dot" aria-hidden="true" />
          Live
        </span>
        <span className="tk-totals">
          {totals.inProgress > 0 && (
            <span>
              <b>{totals.inProgress}</b> in progress
            </span>
          )}
          <span>
            <b>{totals.merged.toLocaleString("en-US")}</b>{" "}
            {plural(totals.merged, "merged PR").replace(/^[\d,]+ /, "")}
          </span>
        </span>
      </p>
      <ol className="tk-list" ref={list}>
        {rows.length === 0 && (
          <li className="tk-item">
            <div className="tk tk-empty">The first tickets show up here</div>
          </li>
        )}
        {rows.map((row) => {
          const sponsor = row.sponsors[0];
          const href =
            row.prUrl ?? (working(row.status) ? `/runs/${row.key}` : null);
          const paidBy = sponsor && (
            <>
              <span className="tk-paid-label">Paid by</span>
              <Logo
                name={sponsor.name}
                url={logos.get(sponsor.publicId ?? "") ?? null}
                size="small"
              />
              <b className={sponsor.name ? "" : "anonymous"}>
                {sponsor.name ?? "Anonymous sponsor"}
              </b>
              {row.sponsors.length > 1 && (
                <span className="tk-more">+{row.sponsors.length - 1}</span>
              )}
            </>
          );
          return (
            <li key={row.key} className="tk-item">
              {/* The card, not its frame, carries the flip key: a flash
                  tints it over the frame's own background. */}
              <div
                className={`tk ${href ? "linked" : ""}`}
                data-flip={row.key}
                data-flip-value={row.status}
              >
                {/* The whole card opens the pull request or the run; the
                    sponsor, above it, opens their website. */}
                {href && (
                  <a
                    className="tk-link"
                    href={href}
                    aria-label={`${row.project}: ${row.title ?? "Private ticket"}`}
                    {...(row.prUrl
                      ? { target: "_blank", rel: "noopener" }
                      : {})}
                  />
                )}
                <Logo name={row.project} url={row.logoUrl} size="small" />
                <span className="tk-head">
                  <span className="tk-project">{row.project}</span>
                  <span className="tk-when">{timeAgo(row.at)}</span>
                </span>
                <Status row={row} />
                <span className={`tk-title ${row.title ? "" : "private"}`}>
                  {row.title ?? "Private ticket"}
                </span>
                {sponsor &&
                  (sponsor.publicId && linked.has(sponsor.publicId) ? (
                    <a
                      className="tk-paid"
                      href={`/out/${sponsor.publicId}`}
                      target="_blank"
                      rel="sponsored noopener"
                    >
                      {paidBy}
                    </a>
                  ) : (
                    <span className="tk-paid">{paidBy}</span>
                  ))}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
