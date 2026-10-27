import { workLabel } from "@/core/tickets";
import type { LiveRow } from "@/db/boards";
import { Logo, plural, type SponsorRow } from "./boards";
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

/** Seconds each card takes to slide by: slow enough to read on the move. */
const SECONDS_PER_CARD = 5;

/**
 * The latest tickets as a column of cards that slides down slowly and
 * without end, stopping while a card is hovered; the cards above and below
 * fade out at the edges. Each card says who paid.
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
  // Fewer cards than the window: nothing to slide.
  const turning = n > 3;
  // The cards twice over: the list slides by one copy, then starts again.
  const rows = turning ? [...live, ...live] : live;
  const logos = new Map(sponsors.map((row) => [row.publicId, row.logoUrl]));
  // A named sponsor with a website opens it, counted, from the card.
  const linked = new Set(
    sponsors
      .filter((row) => row.name && row.websiteUrl)
      .map((row) => row.publicId),
  );

  return (
    <div
      className="tk-stack"
      style={
        {
          "--max": Math.max(1, n - 1),
          "--loop": `${n * SECONDS_PER_CARD}s`,
        } as React.CSSProperties
      }
    >
      <div className={`tk-window ${turning ? "turning" : ""}`}>
        <ol className="tk-list">
          {n === 0 && (
            <li>
              <div className="tk tk-empty">The first tickets show up here</div>
            </li>
          )}
          {rows.map((row, i) => {
            const sponsor = row.sponsors[0];
            const href =
              row.prUrl ?? (working(row.status) ? `/runs/${row.key}` : null);
            // The second copy repeats the first: only the first is read out.
            const copy = turning ? Math.floor(i / n) : 0;
            const tab = copy === 0 ? undefined : -1;
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
              <li key={`${copy}-${row.key}`} aria-hidden={copy !== 0}>
                <div className={`tk ${href ? "linked" : ""}`}>
                  {/* The whole card opens the pull request or the run; the
                      sponsor, above it, opens their website. */}
                  {href && (
                    <a
                      className="tk-link"
                      href={href}
                      tabIndex={tab}
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
                        tabIndex={tab}
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
      <p className="tk-totals">
        {totals.inProgress > 0 && (
          <span>
            <b>{totals.inProgress}</b> in progress
          </span>
        )}
        <span>
          <b>{totals.merged.toLocaleString("en-US")}</b>{" "}
          {plural(totals.merged, "merged PR").replace(/^[\d,]+ /, "")}
        </span>
      </p>
    </div>
  );
}
