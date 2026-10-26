import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Settings, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, money } from "@/core/packs";
import type { Standing } from "@/db/sponsor-dashboard";
import {
  getSponsorDashboardFn,
  saveSponsorSettingsFn,
} from "@/functions/sponsor.functions";
import {
  ClaimPlace,
  domain,
  Logo,
  plural,
  ResetsIn,
  SponsorName,
} from "@/components/boards";
import { LogoPicker } from "@/components/logo-picker";
import { Confetti } from "@/components/confetti";
import { useFlip, useLive } from "@/components/live";
import { Spinner } from "@/components/navigation-feedback";
import { ModelsCell } from "./models";

export type SponsorData = Extract<
  Awaited<ReturnType<typeof getSponsorDashboardFn>>,
  { status: "ok" }
>;

const statusLabel = {
  writing: "Writing",
  reviewing: "Reviewing",
  delivering: "Opening the pull request",
  pull_request: "Pull request",
  merged: "Merged",
  pr_closed: "Closed",
  abstained: "Abstained",
  queued: "Queued",
  none: "",
} as const;

/** Beside the role tabs: credit left, add funds, settings. */
export function SponsorActions({
  data,
  onSettings,
}: {
  data: SponsorData;
  onSettings: () => void;
}) {
  return (
    <span className="dashboard-actions sd-actions">
      <span className="sd-left">
        <b>{money(Math.max(0, data.balanceCents))}</b> balance
        {data.inUseCents > 0 && (
          <small>{money(data.inUseCents)} in use</small>
        )}
      </span>
      <a className="button button-small button-secondary" href="/fund">
        Add funds
      </a>
      <button type="button" className="bd-settings" onClick={onSettings}>
        <Settings size={15} /> <span>Settings</span>
      </button>
    </span>
  );
}

/** Sponsor tab: where you stand, then what your money shipped. */
export function SponsorView({
  data,
  onSettings,
  celebrate = false,
}: {
  data: SponsorData;
  onSettings: () => void;
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
  const working = shipped.filter((row) =>
    ["writing", "reviewing", "delivering"].includes(row.status),
  ).length;
  return (
    <div className="sd">
      {celebrate && <ThankYou data={data} />}
      {standings.anonymous && data.isSponsor && (
        <p className="sd-anonymous">
          You sponsor anonymously.{" "}
          <button type="button" className="bd-retry" onClick={onSettings}>
            Show my name
          </button>
        </p>
      )}
      <div className="sd-standings">
        <Board
          title={
            <>
              Today <ResetsIn />
            </>
          }
          standing={standings.today}
          size="large"
          onEdit={onSettings}
        />
        <Board
          title="All time"
          standing={standings.all}
          size="small"
          onEdit={onSettings}
        />
      </div>
      {/* First everywhere: nothing to claim. */}
      {!(standings.today.rank === 1 && standings.all.rank === 1) && (
        <Claim today={standings.today} all={standings.all} />
      )}

      <div className="sd-shipped" ref={shippedList}>
        <div className="sd-row sd-shipped-head">
          <span>
            Funded by you <em>{shipped.length}</em>
            {working > 0 && <span className="sd-live">{working} live</span>}
          </span>
          <span>Project</span>
          <span>Models</span>
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
          const cells = (
            <>
              <span className={row.title ? "sd-title" : "sd-title private"}>
                {row.title ?? "Private ticket"}
                {row.url && <span className="sd-go">↗</span>}
              </span>
              <span className="sd-project">{row.projectName}</span>
              <span>
                <ModelsCell models={row.models} />
              </span>
              <span className={`bd-status s-${row.status}`}>
                <span className="dot" aria-hidden="true" />
                {statusLabel[row.status]}
              </span>
              <span className="sd-cost">
                {["writing", "reviewing", "delivering"].includes(row.status)
                  ? "—"
                  : money(row.costCents)}
              </span>
            </>
          );
          return row.url ? (
            <a
              key={row.runId}
              data-flip={row.runId}
              data-flip-value={row.status}
              className="sd-row linked"
              href={row.url}
              target="_blank"
              rel="noopener"
            >
              {cells}
            </a>
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
  onEdit,
}: {
  title: React.ReactNode;
  standing: Standing;
  size: "large" | "small";
  onEdit: () => void;
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
                  {row.you && (
                    <button type="button" className="sd-edit" onClick={onEdit}>
                      Edit
                    </button>
                  )}
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

/** Settings drawer: leaderboard profile, where the money goes, payments. */
export function SponsorSettings({
  data,
  open,
  onClose,
}: {
  data: SponsorData;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const save = useServerFn(saveSponsorSettingsFn);
  const { profile } = data.settings;
  const [name, setName] = useState(profile.publicName ?? "");
  const [anonymous, setAnonymous] = useState(profile.publicName === null);
  const [tagline, setTagline] = useState(profile.tagline ?? "");
  const [website, setWebsite] = useState(profile.websiteUrl ?? "");
  const [description, setDescription] = useState(profile.description ?? "");
  const [logo, setLogo] = useState<string | null>(profile.logoUrl);
  const [mode, setMode] = useState(data.funding.mode);
  const [chosen, setChosen] = useState(
    new Set(data.funding.selectedProjectIds),
  );
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, onClose]);

  if (!open) return null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const site = website.trim();
    if (!anonymous && name.trim().length < 2)
      return setError("Choose a name, or stay anonymous.");
    if (!anonymous && site && !site.startsWith("https://"))
      return setError("Use a website address starting with https://");
    if (mode === "only" && chosen.size === 0)
      return setError("Choose at least one project.");
    setPending(true);
    try {
      await save({
        data: {
          profile: anonymous
            ? {
                publicName: null,
                tagline: null,
                description: null,
                websiteUrl: null,
                logo: null,
              }
            : {
                publicName: name.trim(),
                tagline,
                description,
                websiteUrl: site,
                logo,
              },
          mode,
          selectedProjectIds: [...chosen],
        },
      });
      await router.invalidate();
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error && /image/i.test(cause.message)
          ? cause.message
          : "Not saved. Try again in a moment.",
      );
    } finally {
      setPending(false);
    }
  }

  const q = search.trim().toLowerCase();
  const projects = data.projects.filter(
    (project) => !q || project.name.toLowerCase().includes(q),
  );

  return (
    <>
      <div className="sd-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="sd-drawer" aria-label="Sponsor settings">
        <form onSubmit={submit}>
          <div className="sd-drawer-head">
            <h3>Settings</h3>
            <button
              type="button"
              className="bd-btn bd-btn-ghost"
              aria-label="Close"
              onClick={onClose}
            >
              <X size={16} />
            </button>
          </div>

          <section>
            <span className="bd-label">On the leaderboard</span>
            <label className="sd-check">
              <input
                type="checkbox"
                checked={anonymous}
                onChange={(event) => setAnonymous(event.target.checked)}
              />
              Stay anonymous
            </label>
            {!anonymous && (
              <>
                <div className="sd-identity">
                  <LogoPicker name={name} value={logo} onChange={setLogo} />
                  <label className="field">
                    Name
                    <input
                      value={name}
                      maxLength={60}
                      autoFocus
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                </div>
                <label className="field">
                  Tagline
                  <input
                    value={tagline}
                    maxLength={80}
                    onChange={(event) => setTagline(event.target.value)}
                  />
                </label>
                <label className="field">
                  Website
                  <input
                    type="url"
                    value={website}
                    maxLength={300}
                    placeholder="https://"
                    onChange={(event) => setWebsite(event.target.value)}
                  />
                </label>
                <label className="field">
                  Description
                  <textarea
                    value={description}
                    maxLength={280}
                    onChange={(event) => setDescription(event.target.value)}
                  />
                </label>
              </>
            )}
          </section>

          <section>
            <span className="bd-label">Your money funds</span>
            <label className="sd-check">
              <input
                type="radio"
                name="mode"
                checked={mode === "all_except"}
                onChange={() => setMode("all_except")}
              />
              Every project
            </label>
            <label className="sd-check">
              <input
                type="radio"
                name="mode"
                checked={mode === "only"}
                onChange={() => setMode("only")}
              />
              Only the projects I choose
            </label>
            {mode === "only" && (
              <div className="sd-pick">
                <input
                  className="bd-search"
                  type="search"
                  placeholder="Search projects"
                  aria-label="Search projects"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
                <div className="sd-pick-list">
                  {projects.map((project) => (
                    <label key={project.id} className="sd-pick-row">
                      <input
                        type="checkbox"
                        checked={chosen.has(project.id)}
                        onChange={() =>
                          setChosen((current) => {
                            const next = new Set(current);
                            if (next.has(project.id)) next.delete(project.id);
                            else next.add(project.id);
                            return next;
                          })
                        }
                      />
                      <span className="sd-pick-name">
                        <b>{project.name}</b>
                        <span>{project.visibility}</span>
                      </span>
                      <span className="sd-pick-stack">
                        {project.stacks.slice(0, 2).join(" · ")}
                      </span>
                    </label>
                  ))}
                  {projects.length === 0 && (
                    <p className="bd-none muted">No project</p>
                  )}
                </div>
                <span className="bd-count">{chosen.size} selected</span>
              </div>
            )}
          </section>

          {data.settings.payments.length > 0 && (
            <section>
              <span className="bd-label">Payments</span>
              <div>
                {data.settings.payments.map((payment) => (
                  <div className="sd-pay" key={payment.id}>
                    <span>
                      {new Date(payment.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                    <span className="muted">
                      {payment.source === "promo"
                        ? "Founding credit"
                        : payment.paymentStatus === "refunded"
                          ? "Refunded"
                          : "Card"}
                    </span>
                    <span className="sd-cost">
                      {money(payment.amountCents)}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {error && (
            <p className="feedback feedback-error" role="alert">
              {error}
            </p>
          )}
          <div className="sd-drawer-foot">
            <button
              type="submit"
              className="bd-btn bd-btn-amber"
              disabled={pending}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </aside>
    </>
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
