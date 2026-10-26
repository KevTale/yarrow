import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { money } from "@/core/packs";
import { projectLogo } from "@/core/logos";
import { workText } from "@/core/tickets";
import {
  getSponsorDashboardFn,
  saveSponsorFundingFn,
} from "@/functions/sponsor.functions";
import { plural } from "@/components/boards";
import { Confetti } from "@/components/confetti";
import { useFlip, useLive } from "@/components/live";
import { Spinner } from "@/components/navigation-feedback";
import { RunHover } from "@/components/run-activity";
import {
  SavedState,
  useSavedFades,
  type SaveState,
} from "@/components/saved-state";
import { SponsorCard, useClaim } from "@/components/sponsor-board";
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
    if (nextMode === "only" && nextChosen.length === 0) return setState("idle");
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
        <div
          className="jp-menu sd-funds-menu"
          role="dialog"
          aria-label="Your money funds"
        >
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
                      <span className="muted small">{project.visibility}</span>
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

/** Beside the role tabs: the credit left, what it still buys, where it goes. */
export function SponsorActions({ data }: { data: SponsorData }) {
  // What a ticket cost this sponsor so far, to say what the balance buys.
  const done = data.shipped.filter(
    (row) => !working.includes(row.status) && row.costCents > 0,
  );
  const average = done.length
    ? done.reduce((sum, row) => sum + row.costCents, 0) / done.length
    : 0;
  const balance = Math.max(0, data.balanceCents);
  const left = average ? Math.floor(balance / average) : null;
  return (
    <span className="dashboard-actions sd-actions">
      <span className="sd-left">
        <b>{money(balance)}</b>
        {left !== null ? ` ≈ ${plural(left, "ticket")}` : " balance"}
        {data.inUseCents > 0 && <small>{money(data.inUseCents)} at work</small>}
      </span>
      <FundingPicker data={data} />
    </span>
  );
}

/** Sponsor tab: your card, open to edit or add credit, then where your name went. */
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
  const claim = useClaim(data.boards.today, data.boards.all, data.you, true);
  return (
    <div className="sd">
      {celebrate && <ThankYou data={data} />}
      <section className="sd-card" aria-labelledby="sd-card-title">
        <h2 id="sd-card-title" className="sd-card-title">
          Your card
        </h2>
        <SponsorCard claim={claim} />
      </section>

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
                  <span>
                    {workText(row.status, row.models) ??
                      statusLabel[row.status]}
                  </span>
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
