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
  clicks: number;
  pullRequests: number;
};
type ProjectRow = {
  id: string;
  name: string;
  repository: string | null;
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
        <div className="board-box" ref={todayBox}>
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
                className={`board-row large ${i === 0 ? "first" : ""}`}
                key={row.publicId}
                data-flip={row.publicId}
                data-flip-value={row.paidCents}
              >
                <span className="board-rank">{i + 1}</span>
                <Logo name={row.name} url={row.logoUrl} size="large" />
                <span className="board-body">
                  <span className="board-title">
                    <SponsorName name={row.name} />
                    {row.tagline && <span> · {row.tagline}</span>}
                  </span>
                  {row.description && (
                    <span className="board-description">{row.description}</span>
                  )}
                  <span className="board-meta">
                    {row.websiteUrl && (
                      <a
                        href={`/out/${row.publicId}`}
                        rel="sponsored noopener"
                        target="_blank"
                      >
                        {domain(row.websiteUrl)}
                      </a>
                    )}
                    {row.name && <span>{plural(row.clicks, "click")}</span>}
                    <span>{plural(row.pullRequests, "PR")} funded</span>
                  </span>
                </span>
                <span className="board-amount">
                  {money(row.paidCents, false)}
                </span>
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
        <div className="board-box" ref={allBox}>
          <div className="board-head">
            <span>All time</span>
            <span className="board-total">
              <small>total</small> {money(allTotal, false)}
            </span>
          </div>
          <ol className="board-list" ref={allList}>
            {withYou(all, rankAll, "small", (row, i) => (
              <li
                className={`board-row small ${i === 0 ? "first" : ""}`}
                key={row.publicId}
                data-flip={row.publicId}
                data-flip-value={row.paidCents}
              >
                <span className="board-rank">{i + 1}</span>
                <Logo name={row.name} url={row.logoUrl} size="small" />
                <span className="board-body">
                  <span className="board-title">
                    <SponsorName name={row.name} />
                  </span>
                  <span className="board-meta">
                    {plural(row.pullRequests, "PR")} funded
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
            Claim <strong>{valid ? `#${rankToday + 1}` : "–"}</strong> today{" "}
            <span className="claim-sep">·</span>{" "}
            <strong>{valid ? `#${rankAll + 1}` : "–"}</strong> all time for{" "}
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

/** Today's work as it happens beside the projects ranked by merges. */
export function ShippedBoards({
  live,
  projects,
  totals,
}: {
  live: LiveRow[];
  projects: ProjectRow[];
  totals: { today: number; all: number };
}) {
  const liveList = useFlip<HTMLOListElement>(live);
  const projectList = useFlip<HTMLOListElement>(projects);
  const working = live.filter((row) => isWorking(row.status)).length;
  return (
    <section
      className="board-section"
      id="shipped"
      aria-labelledby="shipped-title"
    >
      <h2 id="shipped-title">Live</h2>
      <div className="board-grid">
        <div className="board-box">
          <div className="board-head">
            <span>
              Today <ResetsIn />
            </span>
            <span className="board-total live-counts">
              {working > 0 && (
                <>
                  <span className="live-dot" aria-hidden="true" />
                  <small>working</small> {working}
                </>
              )}
              <small>PRs</small> {live.length - working}
            </span>
          </div>
          <ol className="board-list" ref={liveList}>
            {live.length === 0 && (
              <li className="board-row large open">
                <span className="board-rank" />
                <span className="board-logo large open" aria-hidden="true">
                  +
                </span>
                <span className="board-body">
                  <span className="board-title">
                    The next ticket starts here
                  </span>
                </span>
                <span />
              </li>
            )}
            {live.map((row) => (
              <LiveItem row={row} key={row.key} />
            ))}
          </ol>
        </div>
        <div className="board-box">
          <div className="board-head">
            <span>All time</span>
            <span className="board-total">
              <small>merged</small> {totals.all.toLocaleString("en-US")}
            </span>
          </div>
          <ol className="board-list" ref={projectList}>
            {projects.map((project, i) => (
              <li
                className={`board-row small ${i === 0 ? "first" : ""} ${project.repository ? "linked" : ""}`}
                key={project.id}
                data-flip={project.id}
                data-flip-value={project.merged}
              >
                <span className="board-rank">{i + 1}</span>
                <Logo name={project.name} size="small" />
                <span className="board-body">
                  {project.repository ? (
                    <a
                      className="board-title"
                      href={`https://github.com/${project.repository}`}
                      target="_blank"
                      rel="noopener"
                    >
                      {project.repository}
                    </a>
                  ) : (
                    <span className="board-title">{project.name}</span>
                  )}
                  <span className="board-meta">pull requests merged</span>
                </span>
                <span className="board-amount">
                  {project.merged.toLocaleString("en-US")}
                </span>
              </li>
            ))}
          </ol>
          {projects.length === 0 && (
            <p className="board-empty">
              <a href="/connect/github">Add your project</a>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

const isWorking = (status: LiveRow["status"]) =>
  status !== "pull_request" && status !== "merged";

const liveLabel: Record<LiveRow["status"], string> = {
  writing: "writing",
  reviewing: "reviewing",
  delivering: "opening the PR",
  pull_request: "pull request",
  merged: "merged",
};

/** One line of the live board: a ticket at work, or a pull request out. */
function LiveItem({ row }: { row: LiveRow }) {
  const working = isWorking(row.status);
  const title = row.title ? (
    <b>{row.title}</b>
  ) : (
    <b className="anonymous">Private ticket</b>
  );
  return (
    <li
      className={`board-row large live-row ${working ? "working" : ""} ${row.url ? "linked" : ""}`}
      data-flip={row.key}
      data-flip-value={row.status}
    >
      <span className="board-rank" />
      <Logo name={row.project} size="large" />
      <span className="board-body">
        {row.url ? (
          <a className="board-title" href={row.url} target="_blank" rel="noopener">
            {title}
          </a>
        ) : (
          <span className="board-title">{title}</span>
        )}
        <span className="board-meta">
          <span className={`live-chip s-${row.status}`}>
            {working && <span className="live-dot" aria-hidden="true" />}
            {liveLabel[row.status]}
          </span>
          <span>
            {row.repository ?? row.project}
            {row.number ? ` #${row.number}` : ""}
          </span>
          <ModelsCell models={row.models} inline />
          {row.sponsors.length > 0 && (
            <span>
              sponsored by{" "}
              {row.sponsors
                .map((sponsor) => sponsor.name ?? "an anonymous sponsor")
                .join(", ")}
            </span>
          )}
        </span>
      </span>
      <span className="board-when">{timeAgo(row.at)}</span>
    </li>
  );
}
