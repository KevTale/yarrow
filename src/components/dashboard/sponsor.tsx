import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, ArrowUpRight, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, money } from "@/core/packs";
import { projectLogo } from "@/core/logos";
import type { Standing } from "@/db/sponsor-dashboard";
import {
  getSponsorDashboardFn,
  saveSponsorFundingFn,
  saveSponsorProfileFn,
} from "@/functions/sponsor.functions";
import { Paid, plural } from "@/components/boards";
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
 * The sponsor's campaign: their card as the boards print it, edited in
 * place; beside it the budget (balance, where it goes, what more buys); under
 * them what the card brought.
 */
function Campaign({ data }: { data: SponsorData }) {
  const save = useServerFn(saveSponsorProfileFn);
  const router = useRouter();
  const { today, all } = data.standings;
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

  const yours = all.rows.find((row) => row.you);
  return (
    <div className="sd-campaign">
      <section className="sd-card" aria-label="Your card">
        <div className="sd-card-head">
          <span className="bd-label">Your card</span>
          <span className="sd-ranks">
            <span>
              <b>{today.rank ? `#${today.rank}` : "–"}</b> today
            </span>
            <span>
              <b>{all.rank ? `#${all.rank}` : "–"}</b> all time
            </span>
          </span>
        </div>
        <SponsorCardRow
          className={all.rank === 1 ? "first" : ""}
          value={card}
          onChange={(patch) => setCard((current) => ({ ...current, ...patch }))}
          onCommit={(patch) => void commit(patch)}
          rank={all.rank ?? "–"}
          stats={yours}
          amount={
            yours ? (
              <Paid row={yours} />
            ) : (
              <span className="board-amount muted">$0</span>
            )
          }
        />
        <div className="sd-card-foot">
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
          <a className="sd-board-link" href="/#sponsors">
            See the leaderboard <ArrowUpRight size={13} />
          </a>
        </div>
      </section>
      <Budget data={data} commit={commit} />
    </div>
  );
}

/** Rank reached on a board when the viewer adds `cents`. */
const rankWith = (standing: Standing, cents: number) =>
  standing.others.filter((paid) => paid >= standing.paidCents + cents).length +
  1;

/** What #1 today costs on top of what the viewer paid today. */
function toTop(today: Standing): number {
  const top = Math.max(0, ...today.others);
  const needed = today.rank === 1 ? 0 : top - today.paidCents + 100;
  return Math.min(
    MAX_AMOUNT_CENTS,
    Math.max(MIN_AMOUNT_CENTS, Math.ceil(needed / 100) * 100),
  );
}

/**
 * The money side: what is left and what it still buys, where it goes, and
 * what more takes. Paying saves the card first.
 */
function Budget({
  data,
  commit,
}: {
  data: SponsorData;
  commit: () => Promise<boolean>;
}) {
  const { today } = data.standings;
  const [dollars, setDollars] = useState(String(toTop(today) / 100));
  const [going, setGoing] = useState(false);
  const cents = Math.round(Number(dollars || 0) * 100);
  const valid = cents >= MIN_AMOUNT_CENTS && cents <= MAX_AMOUNT_CENTS;
  const target = rankWith(today, valid ? cents : MIN_AMOUNT_CENTS);
  const gains = today.rank === null || target < today.rank;
  // What a ticket cost this sponsor so far, to say what the balance buys.
  const done = data.shipped.filter(
    (row) => !working.includes(row.status) && row.costCents > 0,
  );
  const average = done.length
    ? done.reduce((sum, row) => sum + row.costCents, 0) / done.length
    : 0;
  const balance = Math.max(0, data.balanceCents);
  const left = average ? Math.floor(balance / average) : null;

  async function take() {
    if (!valid) return;
    setGoing(true);
    if (!(await commit())) return setGoing(false);
    window.location.href = `/fund?amount=${cents / 100}`;
  }

  return (
    <section className="sd-budget" aria-label="Budget">
      <span className="bd-label">Balance</span>
      <p className="sd-balance">
        <b>{money(balance)}</b>
        {left !== null && <span>≈ {plural(left, "ticket")}</span>}
      </p>
      {data.inUseCents > 0 && (
        <p className="sd-in-use">{money(data.inUseCents)} at work right now</p>
      )}
      <FundingPicker data={data} />
      <form
        className="sd-add"
        onSubmit={(event) => {
          event.preventDefault();
          void take();
        }}
      >
        <p className="sd-add-pitch">
          {today.rank === 1 ? (
            <>
              You are <b>#1 today</b>
            </>
          ) : (
            <>
              <b>{money(toTop(today), false)}</b>
              {today.rank === null ? " takes " : " more takes "}
              <b>#1 today</b>
            </>
          )}
        </p>
        <div className="sd-add-row">
          <label className="sd-take-amount">
            $
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
          <button type="submit" className="sd-take-go" aria-disabled={!valid}>
            {!valid
              ? cents < MIN_AMOUNT_CENTS
                ? "From $10"
                : "Up to $1,000"
              : gains
                ? `Take #${target} today`
                : "Add funds"}
            {going ? <Spinner /> : <ArrowRight size={14} strokeWidth={2.2} />}
          </button>
        </div>
      </form>
    </section>
  );
}

/** What the card brought, in large. */
function Results({ data }: { data: SponsorData }) {
  const yours = data.standings.all.rows.find((row) => row.you);
  const items = [
    { label: "Clicks", value: (yours?.clicks ?? 0).toLocaleString("en-US") },
    { label: "Merged PRs", value: String(yours?.merged ?? 0) },
    { label: "Spent", value: money(data.spentCents) },
  ];
  return (
    <dl className="sd-results">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Sponsor tab: your card and budget, what they brought, where your name went. */
export function SponsorView({
  data,
  celebrate = false,
}: {
  data: SponsorData;
  /** Just back from Stripe: thank the sponsor. */
  celebrate?: boolean;
}) {
  const { shipped, activity } = data;
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
      <Campaign data={data} />
      {data.isSponsor && <Results data={data} />}

      <div className="sd-shipped" ref={shippedList}>
        <div className="sd-row sd-shipped-head">
          <span>
            Your name on <em>{shipped.length}</em>
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
