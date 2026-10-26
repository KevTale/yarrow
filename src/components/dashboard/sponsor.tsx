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
  ClaimPlace,
  domain,
  Logo,
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

/**
 * The sponsor's card as the boards show it, edited in place and saved when
 * a field is left.
 */
function YourCard({ data }: { data: SponsorData }) {
  const save = useServerFn(saveSponsorProfileFn);
  const router = useRouter();
  const { profile } = data.settings;
  const [card, setCard] = useState<CardValue>({
    anonymous: profile.publicName === null,
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

  async function commit(patch: Partial<CardValue> = {}) {
    const next = { ...card, ...patch };
    const site = websiteAddress(next.website);
    if (!next.anonymous && next.name.trim().length < 2)
      return setError("Choose a name of two letters or more.");
    if (!next.anonymous && site === null)
      return setError("That website address does not look right.");
    const values = next.anonymous
      ? anonymousProfile
      : {
          publicName: next.name.trim(),
          tagline: next.tagline,
          description: next.description,
          websiteUrl: site ?? "",
          logo: next.logo,
        };
    const key = JSON.stringify(values);
    if (key === last.current) return;
    setError("");
    setState("saving");
    try {
      await save({ data: { profile: values } });
      last.current = key;
      setState("saved");
      void router.invalidate();
    } catch (cause) {
      setState("error");
      if (cause instanceof Error && /image/i.test(cause.message))
        setError(cause.message);
    }
  }

  const all = data.standings.all;
  const you = all.rows.find((row) => row.you);
  const anonymous = (value: boolean) => {
    setCard((current) => ({ ...current, anonymous: value }));
    void commit({ anonymous: value });
  };
  return (
    <section className="fund-card sd-card" aria-label="Your card">
      <div className="board-head">
        <span>Your card</span>
        <span className="sd-card-tools">
          <SavedState state={state} />
          <span className="fund-switch" role="radiogroup" aria-label="Name">
            <label>
              <input
                type="radio"
                name="sd-visibility"
                checked={!card.anonymous}
                onChange={() => anonymous(false)}
              />
              <span>Show my name</span>
            </label>
            <label>
              <input
                type="radio"
                name="sd-visibility"
                checked={card.anonymous}
                onChange={() => anonymous(true)}
              />
              <span>Anonymous</span>
            </label>
          </span>
        </span>
      </div>
      <SponsorCardRow
        value={card}
        onChange={(patch) => setCard((current) => ({ ...current, ...patch }))}
        onCommit={(patch) => void commit(patch)}
        rank={all.rank ? String(all.rank) : "–"}
        amount={money(all.paidCents, false)}
        clicks={you?.clicks ?? 0}
        pullRequests={data.impact.pullRequests}
      />
      {error && (
        <p className="feedback feedback-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** What the money produced, in one line. */
function Impact({ data }: { data: SponsorData }) {
  const { tickets, pullRequests, merged } = data.impact;
  return (
    <p className="sd-impact">
      <b>{money(data.spentCents)}</b> spent
      <ArrowRight size={14} aria-hidden="true" />
      <span>
        <b>{tickets}</b> {tickets === 1 ? "ticket" : "tickets"}
      </span>
      <span>
        <b>{pullRequests}</b> {pullRequests === 1 ? "PR" : "PRs"}
      </span>
      <span>
        <b>{merged}</b> merged
      </span>
    </p>
  );
}

/** Sponsor tab: what the money did, your card, where you stand, the runs. */
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
      {data.isSponsor && <Impact data={data} />}
      {data.isSponsor && <YourCard data={data} />}
      <div className="sd-standings">
        <Board
          title={
            <>
              Today <ResetsIn />
            </>
          }
          standing={standings.today}
          size="large"
        />
        <Board title="All time" standing={standings.all} size="small" />
      </div>
      <Claim today={standings.today} all={standings.all} />

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

function Board({
  title,
  standing,
  size,
}: {
  title: React.ReactNode;
  standing: Standing;
  size: "large" | "small";
}) {
  const list = useFlip<HTMLOListElement>(standing);
  return (
    <div>
      <div className="board-head">
        <span>{title}</span>
        <span className="board-total">
          <small>total</small> {money(standing.totalCents, false)}
        </span>
      </div>
      <ol className="board-list" ref={list}>
        {standing.rows.length === 0 && (
          <li className={`board-row ${size} open`}>
            <span className="board-rank">1</span>
            <span className={`board-logo ${size} open`} aria-hidden="true">
              +
            </span>
            <span className="board-body">
              <span className="board-title">Open spot</span>
            </span>
            <span className="board-amount open">$10 takes it</span>
          </li>
        )}
        {standing.rows.map((row) => (
          <li
            key={row.publicId}
            data-flip={row.publicId}
            data-flip-value={row.paidCents}
            className={`board-row ${size} ${row.rank === 1 ? "first" : ""} ${row.you ? "you" : ""}`}
          >
            <span className="board-rank">{row.rank}</span>
            <Logo name={row.name} url={row.logoUrl} size={size} />
            <span className="board-body">
              <span className="board-title">
                <SponsorName name={row.name} />
                {size === "large" && row.tagline && (
                  <span> · {row.tagline}</span>
                )}
                {row.you && <span className="sd-you">You</span>}
              </span>
              {size === "large" && (
                <span className="board-meta">
                  {row.websiteUrl && <span>{domain(row.websiteUrl)}</span>}
                  {row.name && <span>{plural(row.clicks, "click")}</span>}
                  <span>{plural(row.pullRequests, "PR")} funded</span>
                </span>
              )}
            </span>
            <span className="board-amount">{money(row.paidCents, false)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Rank reached on a board when the viewer adds `cents`. */
const rankWith = (standing: Standing, cents: number) =>
  standing.others.filter((paid) => paid >= standing.paidCents + cents).length +
  1;

/** Priced for #1 today by default; any amount shows where it lands. */
export function Claim({ today, all }: { today: Standing; all: Standing }) {
  const top = Math.max(0, ...today.others);
  const needed =
    today.rank === 1 ? MIN_AMOUNT_CENTS : top - today.paidCents + 100;
  const suggested = Math.min(
    MAX_AMOUNT_CENTS,
    Math.max(MIN_AMOUNT_CENTS, Math.ceil(needed / 100) * 100),
  );
  const [dollars, setDollars] = useState(String(suggested / 100));
  const cents = Math.round(Number(dollars || 0) * 100);
  const valid = cents >= MIN_AMOUNT_CENTS && cents <= MAX_AMOUNT_CENTS;
  // Already first today: the control is about keeping the lead.
  const leading = today.rank === 1;
  return (
    <form
      className="claim"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) window.location.href = `/fund?amount=${cents / 100}`;
      }}
    >
      <p>
        <ClaimPlace
          today={valid ? rankWith(today, cents) : null}
          all={valid ? rankWith(all, cents) : null}
          verb={leading ? "Stay" : "Claim"}
        />{" "}
        {leading ? "with" : "for"}{" "}
        <label className="claim-amount">
          <span>$</span>
          <input
            value={dollars}
            inputMode="numeric"
            autoComplete="off"
            aria-label="Amount in dollars"
            onChange={(event) =>
              setDollars(event.target.value.replace(/[^0-9]/g, "").slice(0, 6))
            }
          />
        </label>
      </p>
      <button className="go" type="submit" aria-disabled={!valid}>
        {cents < MIN_AMOUNT_CENTS
          ? "From $10"
          : cents > MAX_AMOUNT_CENTS
            ? "Up to $1,000"
            : leading
              ? "Add funds"
              : "Claim"}
        <i>
          <ArrowRight size={14} strokeWidth={2.2} />
        </i>
      </button>
    </form>
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
