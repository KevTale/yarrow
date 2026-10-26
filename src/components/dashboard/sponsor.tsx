import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, money } from "@/core/packs";
import { projectLogo } from "@/core/logos";
import type { Standing } from "@/db/sponsor-dashboard";
import {
  getSponsorDashboardFn,
  saveSponsorFundingFn,
  saveSponsorProfileFn,
} from "@/functions/sponsor.functions";
import {
  domain,
  Impact,
  Logo,
  Paid,
  plural,
  ResetsIn,
  SponsorName,
} from "@/components/boards";
import { Confetti } from "@/components/confetti";
import { useFlip, useLive } from "@/components/live";
import { Spinner } from "@/components/navigation-feedback";
import { RunHover } from "@/components/run-activity";
import {
  SavedState,
  useSavedFades,
  type SaveState,
} from "@/components/saved-state";
import {
  SponsorCardRow,
  websiteAddress,
  type CardValue,
} from "@/components/sponsor-card";
import { timeAgo } from "@/components/ui";

export type SponsorData = Extract<
  Awaited<ReturnType<typeof getSponsorDashboardFn>>,
  { status: "ok" }
>;

const statusLabel = {
  writing: "Writing",
  reviewing: "Reviewing",
  delivering: "Opening the pull request",
  pull_request: "PR open",
  merged: "PR merged",
  pr_closed: "PR closed",
  abstained: "Abstained",
  queued: "Queued",
  none: "",
} as const;

const working = ["writing", "reviewing", "delivering"];

/** Beside the role tabs: the credit left, and where it goes. */
export function SponsorActions({ data }: { data: SponsorData }) {
  return (
    <span className="dashboard-actions sd-actions">
      <span className="sd-left">
        <b>{money(Math.max(0, data.balanceCents))}</b> balance
        {data.inUseCents > 0 && (
          <small>{money(data.inUseCents)} in use</small>
        )}
      </span>
      <FundingPicker data={data} />
    </span>
  );
}

/** Every project, or only the ones ticked; saved at each change. */
function FundingPicker({ data }: { data: SponsorData }) {
  const save = useServerFn(saveSponsorFundingFn);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(data.funding.mode);
  const [chosen, setChosen] = useState<string[]>(
    data.funding.selectedProjectIds,
  );
  const [search, setSearch] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  useSavedFades(state, setState);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  async function apply(nextMode: typeof mode, nextChosen: string[]) {
    setMode(nextMode);
    setChosen(nextChosen);
    // "Only" with nothing ticked funds nothing: wait for a first tick.
    if (nextMode === "only" && nextChosen.length === 0)
      return setState("idle");
    setState("saving");
    try {
      await save({
        data: { mode: nextMode, selectedProjectIds: nextChosen },
      });
      setState("saved");
      void router.invalidate();
    } catch {
      setState("error");
    }
  }

  const q = search.trim().toLowerCase();
  const projects = data.projects.filter(
    (project) => !q || project.name.toLowerCase().includes(q),
  );
  const savedMode = data.funding.mode;
  const savedCount = data.funding.selectedProjectIds.length;
  return (
    <div className="jp sd-funds" ref={root}>
      <button
        type="button"
        className="jp-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="muted">funds</span>
        {savedMode === "only" ? plural(savedCount, "project") : "every project"}
        <ChevronDown size={14} className="jp-chevron" />
      </button>
      {open && (
        <div className="jp-menu sd-funds-menu" role="dialog" aria-label="Your money funds">
          <div className="sd-funds-head">
            <span className="bd-label">Your money funds</span>
            <SavedState state={state} />
          </div>
          <label className="jp-option">
            <input
              type="radio"
              name="funding"
              checked={mode === "all_except"}
              onChange={() => void apply("all_except", [])}
            />
            <span>Every project</span>
          </label>
          <label className="jp-option">
            <input
              type="radio"
              name="funding"
              checked={mode === "only"}
              onChange={() => void apply("only", chosen)}
            />
            <span>Only the projects I choose</span>
          </label>
          {mode === "only" && (
            <div className="sd-funds-pick">
              <input
                className="bd-search"
                type="search"
                placeholder="Search projects"
                aria-label="Search projects"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="sd-funds-list">
                {projects.map((project) => {
                  const on = chosen.includes(project.id);
                  return (
                    <label className="jp-option" key={project.id}>
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() =>
                          void apply(
                            "only",
                            on
                              ? chosen.filter((id) => id !== project.id)
                              : [...chosen, project.id],
                          )
                        }
                      />
                      <span>{project.name}</span>
                      <span className="muted small">
                        {project.visibility}
                      </span>
                    </label>
                  );
                })}
                {projects.length === 0 && (
                  <span className="jp-empty muted">No project</span>
                )}
              </div>
              {chosen.length === 0 && (
                <span className="jp-empty muted">Tick at least one</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const anonymousProfile = {
  publicName: null,
  tagline: null,
  description: null,
  websiteUrl: null,
  logo: null,
};

/** Rank reached on a board when the viewer adds `cents`. */
const rankWith = (standing: Standing, cents: number) =>
  standing.others.filter((paid) => paid >= standing.paidCents + cents).length +
  1;

/**
 * Today's board with the viewer's card in it, edited in place: at their
 * place once they paid today, otherwise where $10 would put them. The
 * amount beside it says the place it takes, and pays it.
 */
function TodayBoard({ data }: { data: SponsorData }) {
  const save = useServerFn(saveSponsorProfileFn);
  const router = useRouter();
  const today = data.standings.today;
  const { profile } = data.settings;
  const [card, setCard] = useState<CardValue>({
    anonymous: profile.publicName === null && data.isSponsor,
    name: profile.publicName ?? "",
    tagline: profile.tagline ?? "",
    description: profile.description ?? "",
    website: profile.websiteUrl ?? "",
    logo: profile.logoUrl,
  });
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  useSavedFades(state, setState);
  const last = useRef<string | null>(null);
  const [dollars, setDollars] = useState(String(MIN_AMOUNT_CENTS / 100));
  const [going, setGoing] = useState(false);
  const list = useFlip<HTMLOListElement>(today);

  async function commit(patch: Partial<CardValue> = {}): Promise<boolean> {
    const next = { ...card, ...patch };
    const name = next.name.trim();
    const site = websiteAddress(next.website);
    // Nothing typed yet: nothing to save, nothing to complain about.
    if (!next.anonymous && name.length === 0) return true;
    if (!next.anonymous && name.length < 2) {
      setError("Use a name of two letters or more.");
      return false;
    }
    if (!next.anonymous && site === null) {
      setError("That website address does not look right.");
      return false;
    }
    const values = next.anonymous
      ? anonymousProfile
      : {
          publicName: name,
          tagline: next.tagline,
          description: next.description,
          websiteUrl: site ?? "",
          logo: next.logo,
        };
    const key = JSON.stringify(values);
    if (key === last.current) return true;
    setError("");
    setState("saving");
    try {
      await save({ data: { profile: values } });
      last.current = key;
      setState("saved");
      void router.invalidate();
      return true;
    } catch (cause) {
      setState("error");
      if (cause instanceof Error && /image/i.test(cause.message))
        setError(cause.message);
      return false;
    }
  }

  const cents = Math.round(Number(dollars || 0) * 100);
  const valid = cents >= MIN_AMOUNT_CENTS && cents <= MAX_AMOUNT_CENTS;
  const onBoard = today.rank !== null;
  const target = rankWith(today, valid ? cents : MIN_AMOUNT_CENTS);
  const yours =
    today.rows.find((row) => row.you) ??
    data.standings.all.rows.find((row) => row.you);
  const label = !valid
    ? cents < MIN_AMOUNT_CENTS
      ? "From $10"
      : "Up to $1,000"
    : onBoard && target >= today.rank!
      ? "Add"
      : `Take #${target}`;

  async function take() {
    if (!valid) return;
    setGoing(true);
    // The card first: the checkout carries what was just typed.
    if (!(await commit())) return setGoing(false);
    window.location.href = `/fund?amount=${cents / 100}`;
  }

  const youRow = (
    <li key="you" className="sd-you-row">
      <SponsorCardRow
        className={onBoard ? "you" : "ghost"}
        value={card}
        onChange={(patch) => setCard((current) => ({ ...current, ...patch }))}
        onCommit={(patch) => void commit(patch)}
        rank={
          onBoard && target < today.rank! ? (
            <>
              {today.rank}
              <small>→{target}</small>
            </>
          ) : onBoard ? (
            today.rank
          ) : (
            target
          )
        }
        stats={yours}
        amount={
          <span className="sd-take">
            {onBoard && yours && <Paid row={{ ...yours, paidCents: today.paidCents }} />}
            <form
              className="sd-take-form"
              onSubmit={(event) => {
                event.preventDefault();
                void take();
              }}
            >
              <label className="sd-take-amount">
                {onBoard ? "+$" : "$"}
                <input
                  value={dollars}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-label="Amount in dollars"
                  onChange={(event) =>
                    setDollars(
                      event.target.value.replace(/[^0-9]/g, "").slice(0, 6),
                    )
                  }
                />
              </label>
              <button type="submit" className="sd-take-go" aria-disabled={!valid}>
                {label}
                {going ? <Spinner /> : <ArrowRight size={14} strokeWidth={2.2} />}
              </button>
            </form>
          </span>
        }
      />
    </li>
  );

  // Off the board: the card slides in at the place the amount takes, and
  // whoever it passes moves one down.
  const rows: React.ReactNode[] = [];
  let placed = false;
  for (const row of today.rows) {
    if (row.you) {
      rows.push(youRow);
      placed = true;
      continue;
    }
    if (!onBoard && !placed && row.rank >= target) {
      rows.push(youRow);
      placed = true;
    }
    rows.push(
      <BoardRow
        key={row.publicId}
        row={row}
        rank={!onBoard && placed ? row.rank + 1 : row.rank}
        size="large"
      />,
    );
  }
  if (!placed) rows.push(youRow);

  return (
    <div className="sd-today">
      <div className="board-head">
        <span>
          Today <ResetsIn />
        </span>
        <span className="board-total">
          <small>total</small> {money(today.totalCents, false)}
        </span>
      </div>
      <ol className="board-list" ref={list}>
        {rows}
      </ol>
      <div className="sd-today-foot">
        <label className="sd-anon">
          <input
            type="checkbox"
            checked={card.anonymous}
            onChange={(event) => {
              const anonymous = event.target.checked;
              setCard((current) => ({ ...current, anonymous }));
              void commit({ anonymous });
            }}
          />
          Stay anonymous
        </label>
        <SavedState state={state} />
        {error && (
          <span className="sd-error" role="alert">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}

/** A sponsor on the boards, as everyone sees them. */
function BoardRow({
  row,
  rank,
  size,
}: {
  row: Standing["rows"][number];
  rank: number;
  size: "large" | "small";
}) {
  return (
    <li
      data-flip={row.publicId}
      data-flip-value={row.paidCents}
      className={`board-row ${size} ${rank === 1 ? "first" : ""} ${row.you ? "you" : ""}`}
    >
      <span className="board-rank">{rank}</span>
      <Logo name={row.name} url={row.logoUrl} size={size} />
      <span className="board-body">
        <span className="board-title">
          <SponsorName name={row.name} />
          {size === "large" && row.tagline && <span> · {row.tagline}</span>}
          {row.you && <span className="sd-you">You</span>}
        </span>
        <span className="board-meta">
          {size === "large" && row.websiteUrl && (
            <span>{domain(row.websiteUrl)}</span>
          )}
          {size === "large" && row.name && (
            <span>{plural(row.clicks, "click")}</span>
          )}
          {size === "large" ? (
            <Impact row={row} />
          ) : (
            <span>
              {plural(row.pullRequests, "PR")} · {row.merged} merged
            </span>
          )}
        </span>
      </span>
      {size === "large" ? (
        <Paid row={row} />
      ) : (
        <span className="board-amount">{money(row.paidCents, false)}</span>
      )}
    </li>
  );
}

function AllTimeBoard({ standing }: { standing: Standing }) {
  const list = useFlip<HTMLOListElement>(standing);
  return (
    <div>
      <div className="board-head">
        <span>All time</span>
        <span className="board-total">
          <small>total</small> {money(standing.totalCents, false)}
        </span>
      </div>
      <ol className="board-list" ref={list}>
        {standing.rows.map((row) => (
          <BoardRow key={row.publicId} row={row} rank={row.rank} size="small" />
        ))}
      </ol>
    </div>
  );
}

/** Sponsor tab: where you stand, your card in it, then the runs. */
export function SponsorView({
  data,
  celebrate = false,
}: {
  data: SponsorData;
  /** Just back from Stripe: thank the sponsor. */
  celebrate?: boolean;
}) {
  const { standings, shipped, activity } = data;
  const router = useRouter();
  // Someone passing you, your runs moving: refetch at once.
  useLive(
    // A guest has no session for private channels; the boards still tell
    // when their payment lands.
    ["boards", data.guest ? null : `sponsor:${data.userId}`],
    () => router.invalidate(),
  );
  // Guests get no private signal when their runs move: poll instead.
  useEffect(() => {
    if (!data.guest) return;
    const timer = setInterval(() => void router.invalidate(), 10_000);
    return () => clearInterval(timer);
  }, [data.guest, router]);
  const shippedList = useFlip<HTMLDivElement>(shipped);
  const live = shipped.filter((row) => working.includes(row.status)).length;
  return (
    <div className="sd">
      {celebrate && <ThankYou data={data} />}
      <div className="sd-standings">
        <TodayBoard data={data} />
        <AllTimeBoard standing={standings.all} />
      </div>

      <div className="sd-shipped" ref={shippedList}>
        <div className="sd-row sd-shipped-head">
          <span>
            Funded by you <em>{shipped.length}</em>
            {live > 0 && <span className="sd-live">{live} live</span>}
          </span>
          <span>Project</span>
          <span>When</span>
          <span>Status</span>
          <span className="right">Cost</span>
        </div>
        {shipped.length === 0 && (
          <p className="bd-none muted">
            {data.isSponsor && activity.waiting > 0
              ? "Your first ticket starts within a minute"
              : "Nothing funded yet"}
          </p>
        )}
        {shipped.map((row) => {
          const logo = projectLogo(row.logoUrl, row.repository);
          const cells = (
            <>
              <span className={row.title ? "sd-title" : "sd-title private"}>
                {row.title ?? "Private ticket"}
              </span>
              <span className="sd-project">
                <span className="sd-project-logo" aria-hidden="true">
                  {logo && <img src={logo} alt="" width={18} height={18} />}
                </span>
                <span>{row.projectName}</span>
              </span>
              <span className="sd-when">{timeAgo(row.createdAt)}</span>
              <span className={`bd-status s-${row.status}`}>
                <span className="dot" aria-hidden="true" />
                <RunHover runId={row.runId} link={false}>
                  <span>{statusLabel[row.status]}</span>
                </RunHover>
              </span>
              <span className="sd-cost">
                {working.includes(row.status) ? "—" : money(row.costCents)}
              </span>
            </>
          );
          return row.linkable ? (
            <Link
              key={row.runId}
              data-flip={row.runId}
              data-flip-value={row.status}
              className="sd-row linked"
              to="/runs/$runId"
              params={{ runId: row.runId }}
            >
              {cells}
            </Link>
          ) : (
            <div
              key={row.runId}
              data-flip={row.runId}
              data-flip-value={row.status}
              className="sd-row"
            >
              {cells}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Back from Stripe: thanks, the place reached, and what happens next. */
function ThankYou({ data }: { data: SponsorData }) {
  const name = data.settings.profile.publicName;
  const rank = data.standings.today.rank;
  return (
    <section className="sd-thanks" aria-live="polite">
      <Confetti />
      <span className="sd-thanks-kicker">Payment received</span>
      <h2>Thank you{name ? `, ${name}` : ""}!</h2>
      {data.isSponsor ? (
        <p>
          {rank && (
            <>
              You are <b>#{rank}</b> today.{" "}
            </>
          )}
          Your credit is already funding builders&apos; tickets.
        </p>
      ) : (
        <p className="sd-thanks-wait">
          <Spinner /> Confirming with Stripe
        </p>
      )}
    </section>
  );
}
