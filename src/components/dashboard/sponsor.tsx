import { Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check } from "lucide-react";
import { useEffect, useState } from "react";
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

/**
 * Where the money goes, laid flat: every project, or the projects chosen
 * as chips. Saved at each change.
 */
function FundingChoice({ data }: { data: SponsorData }) {
  const save = useServerFn(saveSponsorFundingFn);
  const router = useRouter();
  const [mode, setMode] = useState(data.funding.mode);
  const [chosen, setChosen] = useState<string[]>(
    data.funding.selectedProjectIds,
  );
  const [search, setSearch] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  useSavedFades(state, setState);

  async function apply(nextMode: typeof mode, nextChosen: string[]) {
    setMode(nextMode);
    setChosen(nextChosen);
    // "Only" with nothing chosen funds nothing: wait for a first project.
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
  return (
    <div className="sd-funds">
      <div className="sd-funds-head">
        <span className="sd-label" id="sd-funds-label">
          Your money funds
        </span>
        <SavedState state={state} />
      </div>
      <div
        className="sd-seg"
        role="radiogroup"
        aria-labelledby="sd-funds-label"
      >
        <button
          type="button"
          role="radio"
          aria-checked={mode === "all_except"}
          onClick={() => void apply("all_except", [])}
        >
          Every project
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === "only"}
          onClick={() => void apply("only", chosen)}
        >
          Projects I choose
          {mode === "only" && chosen.length > 0 && <em>{chosen.length}</em>}
        </button>
      </div>
      {mode === "only" && (
        <div className="sd-chips">
          {data.projects.length > 12 && (
            <input
              className="bd-search sd-chips-search"
              type="search"
              placeholder="Search projects"
              aria-label="Search projects"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          {projects.map((project) => {
            const on = chosen.includes(project.id);
            return (
              <button
                type="button"
                key={project.id}
                className="sd-chip"
                aria-pressed={on}
                onClick={() =>
                  void apply(
                    "only",
                    on
                      ? chosen.filter((id) => id !== project.id)
                      : [...chosen, project.id],
                  )
                }
              >
                {on && <Check size={13} strokeWidth={2.6} />}
                {project.name}
              </button>
            );
          })}
          {projects.length === 0 && (
            <span className="muted small">No project</span>
          )}
        </div>
      )}
    </div>
  );
}

/** What the sponsor's money did and what is left, then where it goes. */
function SponsorSummary({ data }: { data: SponsorData }) {
  const you = data.you;
  const named = Boolean(data.isSponsor && you?.publicName);
  const mine = you
    ? data.boards.all.find((row) => row.publicId === you.publicId)
    : undefined;
  // What a ticket cost this sponsor so far, to say what the balance buys.
  const done = data.shipped.filter(
    (row) => !working.includes(row.status) && row.costCents > 0,
  );
  const average = done.length
    ? done.reduce((sum, row) => sum + row.costCents, 0) / done.length
    : 0;
  const balance = Math.max(0, data.balanceCents);
  const left = average ? Math.floor(balance / average) : null;
  const rank = (value: number | null) => (value ? `#${value}` : "–");
  return (
    <section className="sd-me" aria-label="Your sponsoring">
      <dl className="sd-metrics">
        <div className="sd-metric balance">
          <dt>Balance</dt>
          <dd>
            <b>{money(balance)}</b>
            {left !== null && <small>≈ {plural(left, "ticket")}</small>}
            {data.inUseCents > 0 && (
              <small>{money(data.inUseCents)} at work</small>
            )}
          </dd>
        </div>
        <div className="sd-metric">
          <dt>Today</dt>
          <dd>
            <b>{rank(data.standings.today.rank)}</b>
          </dd>
        </div>
        <div className="sd-metric">
          <dt>All time</dt>
          <dd>
            <b>{rank(data.standings.all.rank)}</b>
          </dd>
        </div>
        {named && (
          <div className="sd-metric">
            <dt>Clicks</dt>
            <dd>
              <b>{(mine?.clicks ?? 0).toLocaleString("en-US")}</b>
            </dd>
          </div>
        )}
        <div className="sd-metric">
          <dt>Merged PRs</dt>
          <dd>
            <b>{data.impact.merged.toLocaleString("en-US")}</b>
          </dd>
        </div>
      </dl>
      {data.isSponsor && <FundingChoice data={data} />}
    </section>
  );
}

/** Sponsor tab: your card and what it did, then the tickets you funded. */
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
      <SponsorSummary data={data} />

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
