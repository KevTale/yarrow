import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { LiveRow } from "@/db/boards";
import { ModelsCell } from "./dashboard/models";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, money } from "@/core/packs";
import { useFlip } from "./live";
import { Spinner } from "./navigation-feedback";
import { timeAgo } from "./ui";

/** Time left before the Today boards reset (midnight UTC). Client-only. */
export function ResetsIn() {
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const next = Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      );
      const minutes = Math.max(0, Math.floor((next - now.getTime()) / 60000));
      setLabel(
        `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`,
      );
    };
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, []);
  if (!label) return null;
  return (
    <em className="board-resets">
      (resets in <b>{label}</b>)
    </em>
  );
}

export type SponsorRow = {
  publicId: string;
  /** Null for an anonymous sponsor. */
  name: string | null;
  tagline: string | null;
  description: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  paidCents: number;
  creditCents: number;
  spentCents: number;
  clicks: number;
  tickets: number;
  pullRequests: number;
  merged: number;
};

const tiles = [
  "#e6ae38",
  "#9db4ff",
  "#ee7b6e",
  "#c7a6ff",
  "#7fd6e6",
  "#5ccb95",
];
function tileColor(name: string): string {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return tiles[hash % tiles.length]!;
}

export function Logo({
  name,
  url,
  size,
}: {
  /** Null for an anonymous sponsor. */
  name: string | null;
  url?: string | null;
  size: "large" | "small";
}) {
  if (name === null)
    return (
      <span className={`board-logo ${size} anonymous`} aria-hidden="true">
        ?
      </span>
    );
  if (url)
    return (
      <img className={`board-logo ${size}`} src={url} alt="" loading="lazy" />
    );
  return (
    <span
      className={`board-logo ${size}`}
      style={{ background: tileColor(name) }}
      aria-hidden="true"
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

export function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export const plural = (n: number, word: string) =>
  `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;

/**
 * The whole row opens the sponsor's website, through Yarrow's redirect so
 * the click is counted.
 */
function SponsorLink({ row }: { row: SponsorRow }) {
  if (!row.websiteUrl || !row.name) return null;
  return (
    <a
      className="board-row-link"
      href={`/out/${row.publicId}`}
      rel="sponsored noopener"
      target="_blank"
      aria-label={`${row.name}, ${domain(row.websiteUrl)}`}
    />
  );
}

/**
 * The place an amount reaches, with one rank in the sentence: "Claim #1
 * today and all time", or "Claim #2 today" with the all-time rank aside.
 */
export function ClaimPlace({
  today,
  all,
  verb = "Claim",
}: {
  today: number | null;
  all: number | null;
  verb?: string;
}) {
  if (today === null || all === null) return <>{verb} a spot</>;
  if (today === all)
    return (
      <>
        {verb} <strong>#{today}</strong> today and all time
      </>
    );
  return (
    <>
      {verb} <strong>#{today}</strong> today{" "}
      <small className="claim-all">#{all} all time</small>
    </>
  );
}

/** What a sponsor's money produced: "8 tickets · 6 PRs · 2 merged". */
export function Impact({
  row,
}: {
  row: Pick<SponsorRow, "tickets" | "pullRequests" | "merged">;
}) {
  return (
    <span>
      {plural(row.tickets, "ticket")} · {plural(row.pullRequests, "PR")} ·{" "}
      {row.merged} merged
    </span>
  );
}

/** The amount paid, and under it how much of its credit is already work. */
export function Paid({
  row,
}: {
  row: Pick<SponsorRow, "paidCents" | "creditCents" | "spentCents">;
}) {
  const share = row.creditCents
    ? Math.min(100, Math.round((row.spentCents / row.creditCents) * 100))
    : 0;
  return (
    <span className="board-amount">
      {money(row.paidCents, false)}
      {row.spentCents > 0 && (
        <span className="board-spent">
          <span className="board-spent-bar" aria-hidden="true">
            <i style={{ width: `${share}%` }} />
          </span>
          {money(row.spentCents)} spent
        </span>
      )}
    </span>
  );
}

/** "Anonymous sponsor" in place of a name. */
export function SponsorName({ name }: { name: string | null }) {
  return name ? <b>{name}</b> : <b className="anonymous">Anonymous sponsor</b>;
}

/** The sponsor boards, side by side, with one control to claim a place on both. */
export function SponsorBoards({
  today,
  all,
}: {
  today: SponsorRow[];
  all: SponsorRow[];
}) {
  const [dollars, setDollars] = useState("10");
  const [typed, setTyped] = useState(false);
  const [going, setGoing] = useState(false);
  // Back from the next page: the browser may restore this one as it was.
  useEffect(() => {
    const reset = () => setGoing(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  const cents = Math.round(Number(dollars.replace(/[^0-9]/g, "")) * 100);
  const valid = cents >= MIN_AMOUNT_CENTS && cents <= MAX_AMOUNT_CENTS;
  const showYou = typed && valid;
  const rankToday = today.filter((row) => row.paidCents >= cents).length;
  const rankAll = all.filter((row) => row.paidCents >= cents).length;
  const todayTotal = today.reduce((sum, row) => sum + row.paidCents, 0);
  const allTotal = all.reduce((sum, row) => sum + row.paidCents, 0);
  const todayBox = useRef<HTMLDivElement>(null);
  const allBox = useRef<HTMLDivElement>(null);
  const todayList = useFlip<HTMLOListElement>(today);
  const allList = useFlip<HTMLOListElement>(all);
  useEffect(() => {
    if (!showYou) return;
    for (const box of [todayBox.current, allBox.current]) {
      const ghost = box?.querySelector<HTMLElement>(".ghost");
      if (box && ghost) box.scrollTop = Math.max(0, ghost.offsetTop - 120);
    }
  }, [showYou, cents]);

  const you = (rank: number, size: "large" | "small") => (
    <li className={`board-row ${size} ghost`} key="you">
      <span className="board-rank">{rank + 1}</span>
      <span className={`board-logo ${size}`} aria-hidden="true">
        Y
      </span>
      <span className="board-body">
        <span className="board-title">
          <b>You</b>
        </span>
        {size === "large" && (
          <span className="board-meta">
            Your name, tagline and link, after payment
          </span>
        )}
      </span>
      <span className="board-amount">{money(cents, false)}</span>
    </li>
  );
  const withYou = (
    rows: SponsorRow[],
    rank: number,
    size: "large" | "small",
    render: (row: SponsorRow, i: number) => React.ReactNode,
  ) => {
    const items = rows.map((row, i) =>
      render(row, i >= rank && showYou ? i + 1 : i),
    );
    if (showYou) items.splice(rank, 0, you(rank, size));
    return items;
  };

  return (
    <section
      className="board-section"
      id="sponsors"
      aria-labelledby="sponsors-title"
    >
      <h2 id="sponsors-title">Sponsors</h2>
      <div className="board-grid">
        <div className="board-box" ref={todayBox} data-board="today">
          <div className="board-head">
            <span>
              Today <ResetsIn />
            </span>
            <span className="board-total">
              <small>total</small> {money(todayTotal, false)}
            </span>
          </div>
          <ol className="board-list" ref={todayList}>
            {withYou(today, rankToday, "large", (row, i) => (
              <li
                className={`board-row large ${i === 0 ? "first" : ""} ${row.websiteUrl ? "linked" : ""}`}
                key={row.publicId}
                data-sponsor={row.publicId}
                data-flip={row.publicId}
                data-flip-value={row.paidCents}
              >
                <SponsorLink row={row} />
                <span className="board-rank">{i + 1}</span>
                <Logo name={row.name} url={row.logoUrl} size="large" />
                <span className="board-body">
                  <span className="board-title">
                    <SponsorName name={row.name} />
                    {row.tagline && <span> · {row.tagline}</span>}
                  </span>
                  {row.description && (
                    <span
                      className="board-description"
                      title={row.description}
                    >
                      {row.description}
                    </span>
                  )}
                  <span className="board-meta">
                    {row.websiteUrl && (
                      <span className="board-domain">
                        {domain(row.websiteUrl)}
                      </span>
                    )}
                    {row.name && <span>{plural(row.clicks, "click")}</span>}
                    <Impact row={row} />
                  </span>
                </span>
                <Paid row={row} />
              </li>
            ))}
            {Array.from(
              { length: Math.max(0, 5 - today.length - (showYou ? 1 : 0)) },
              (_, i) => (
                <li className="board-row large open" key={`open-${i}`}>
                  <span className="board-rank">
                    {today.length + (showYou ? 1 : 0) + i + 1}
                  </span>
                  <span className="board-logo large open" aria-hidden="true">
                    +
                  </span>
                  <span className="board-body">
                    <span className="board-title">Open spot</span>
                  </span>
                  <span className="board-amount open">$10 takes it</span>
                </li>
              ),
            )}
          </ol>
        </div>
        <div className="board-box" ref={allBox} data-board="all">
          <div className="board-head">
            <span>All time</span>
            <span className="board-total">
              <small>total</small> {money(allTotal, false)}
            </span>
          </div>
          <ol className="board-list" ref={allList}>
            {withYou(all, rankAll, "small", (row, i) => (
              <li
                className={`board-row small ${i === 0 ? "first" : ""} ${row.websiteUrl ? "linked" : ""}`}
                key={row.publicId}
                data-sponsor={row.publicId}
                data-flip={row.publicId}
                data-flip-value={row.paidCents}
              >
                <SponsorLink row={row} />
                <span className="board-rank">{i + 1}</span>
                <Logo name={row.name} url={row.logoUrl} size="small" />
                <span className="board-body">
                  <span className="board-title">
                    <SponsorName name={row.name} />
                  </span>
                  <span className="board-meta">
                    <span>
                      {plural(row.pullRequests, "PR")} · {row.merged} merged
                    </span>
                  </span>
                </span>
                <span className="board-amount">
                  {money(row.paidCents, false)}
                </span>
              </li>
            ))}
          </ol>
        </div>
        <form
          className="claim"
          onSubmit={(event) => {
            event.preventDefault();
            if (!valid) return;
            setGoing(true);
            window.location.href = `/fund?amount=${cents / 100}`;
          }}
        >
          <p>
            <ClaimPlace
              today={valid ? rankToday + 1 : null}
              all={valid ? rankAll + 1 : null}
            />{" "}
            for{" "}
            <label className="claim-amount">
              <span>$</span>
              <input
                id="claim-amount"
                value={dollars}
                inputMode="numeric"
                autoComplete="off"
                aria-label="Amount in dollars"
                onChange={(event) => {
                  setTyped(true);
                  setDollars(
                    event.target.value.replace(/[^0-9]/g, "").slice(0, 6),
                  );
                }}
              />
            </label>
          </p>
          <button className="go" type="submit" aria-disabled={!valid}>
            {cents < MIN_AMOUNT_CENTS
              ? "From $10"
              : cents > MAX_AMOUNT_CENTS
                ? "Up to $1,000"
                : "Claim"}
            <i>
              {going ? <Spinner /> : <ArrowRight size={14} strokeWidth={2.2} />}
            </i>
          </button>
        </form>
      </div>
    </section>
  );
}

/**
 * Brings a sponsor's row on the boards into view and lights it up: the
 * Today board when they are on it, All time otherwise.
 */
export function focusSponsor(publicId: string) {
  for (const box of document.querySelectorAll<HTMLElement>("[data-board]")) {
    const row = [...box.querySelectorAll<HTMLElement>("[data-sponsor]")].find(
      (item) => item.dataset.sponsor === publicId,
    );
    if (!row) continue;
    box.scrollIntoView({ behavior: "smooth", block: "center" });
    box.scrollTo({
      top: row.offsetTop - box.clientHeight / 2 + row.clientHeight / 2,
      behavior: "smooth",
    });
    row.classList.remove("flash");
    void row.offsetWidth;
    row.classList.add("flash");
    return;
  }
}

const isWorking = (status: LiveRow["status"]) =>
  status !== "pull_request" && status !== "merged";

const liveLabel: Record<LiveRow["status"], string> = {
  writing: "Writing",
  reviewing: "Reviewing",
  delivering: "Opening the PR",
  pull_request: "PR open",
  merged: "PR merged",
};

/** Today's work as it happens: tickets at work first, then pull requests. */
export function LiveBoard({ live }: { live: LiveRow[] }) {
  const list = useFlip<HTMLDivElement>(live);
  const working = live.filter((row) => isWorking(row.status)).length;
  const merged = live.filter((row) => row.status === "merged").length;
  return (
    <section className="board-section" id="shipped" aria-labelledby="live-title">
      <h2 id="live-title">Live</h2>
      <div className="live-table" role="table" aria-label="Today's work" ref={list}>
        <div className="board-head live-caption">
          <span>
            Today <ResetsIn />
          </span>
          <span className="live-counts">
            <span>
              <b>{working}</b> ongoing {working === 1 ? "ticket" : "tickets"}
            </span>
            <span>
              <b>{merged}</b> merged {merged === 1 ? "PR" : "PRs"}
            </span>
          </span>
        </div>
        <div className="live-row live-thead" role="row">
          <span>Ticket</span>
          <span>Project</span>
          <span>Models</span>
          <span>Status</span>
          <span>Sponsors</span>
          <span className="right">When</span>
        </div>
        {live.length === 0 && (
          <p className="live-empty">The next ticket shows up here as it starts</p>
        )}
        {live.map((row) => (
          <LiveItem row={row} key={row.key} />
        ))}
      </div>
    </section>
  );
}

function LiveItem({ row }: { row: LiveRow }) {
  const working = isWorking(row.status);
  const ticketUrl = row.prUrl ?? row.issueUrl;
  return (
    <div
      role="row"
      className={`live-row ${working ? "working" : ""}`}
      data-flip={row.key}
      data-flip-value={row.status}
    >
      <span className="live-ticket" role="cell">
        {row.title === null ? (
          <span className="live-title private">Private ticket</span>
        ) : ticketUrl ? (
          <a className="live-title" href={ticketUrl} target="_blank" rel="noopener">
            {row.title}
          </a>
        ) : (
          <span className="live-title">{row.title}</span>
        )}
        {row.issueRef && <span className="live-num">{row.issueRef}</span>}
      </span>
      <span className="live-project" role="cell">
        <Logo name={row.project} url={row.logoUrl} size="small" />
        {row.repository ? (
          <a
            href={`https://github.com/${row.repository}`}
            target="_blank"
            rel="noopener"
          >
            {row.repository}
          </a>
        ) : (
          <span>{row.project}</span>
        )}
      </span>
      <span role="cell">
        <ModelsCell models={row.models} />
      </span>
      <span role="cell">
        <span className={`live-chip s-${row.status}`}>
          {working && <span className="live-dot" aria-hidden="true" />}
          {row.prUrl ? (
            <a href={row.prUrl} target="_blank" rel="noopener">
              {liveLabel[row.status]} #{row.prNumber}
            </a>
          ) : (
            liveLabel[row.status]
          )}
        </span>
      </span>
      <span className="live-sponsors" role="cell">
        {row.sponsors.length === 0 && <span className="muted">—</span>}
        {row.sponsors.map((sponsor, i) =>
          sponsor.publicId ? (
            <button
              type="button"
              key={`${sponsor.publicId}-${i}`}
              className={sponsor.name ? "" : "anonymous"}
              onClick={() => focusSponsor(sponsor.publicId!)}
            >
              {sponsor.name ?? "Anonymous sponsor"}
            </button>
          ) : (
            <span key={i} className={sponsor.name ? "" : "anonymous"}>
              {sponsor.name ?? "Anonymous sponsor"}
            </span>
          ),
        )}
      </span>
      <span className="live-when" role="cell">
        {timeAgo(row.at)}
      </span>
    </div>
  );
}
