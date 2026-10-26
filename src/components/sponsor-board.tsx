import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { ArrowRight, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, money } from "@/core/packs";
import type { BoardViewer } from "@/db/sponsors";
import {
  saveSponsorProfileFn,
  startCheckoutFn,
} from "@/functions/sponsor.functions";
import { domain, Impact, Logo, Paid, plural, SponsorName, type SponsorRow } from "./boards";
import { useFlip } from "./live";
import { Spinner } from "./navigation-feedback";
import { SavedState, useSavedFades, type SaveState } from "./saved-state";
import { SponsorCardRow, websiteAddress, type CardValue } from "./sponsor-card";

type Period = "today" | "all";

/** The first places; the viewer's card shows further down when it lands there. */
const TOP = 10;

const anonymousProfile = {
  publicName: null,
  tagline: null,
  description: null,
  websiteUrl: null,
  logo: null,
};

/**
 * The sponsors, as cards, with the viewer's own card among them: at their
 * place once they paid, otherwise where $10 would put them. Opened, the card
 * is edited in place, and its amount moves it to the place it takes; Claim
 * pays it.
 */
export function SponsorBoard({
  today,
  all,
  you,
}: {
  today: SponsorRow[];
  all: SponsorRow[];
  you: BoardViewer | null;
}) {
  const [period, setPeriod] = useState<Period>(
    today.length > 0 || all.length === 0 ? "today" : "all",
  );
  const rows = period === "today" ? today : all;
  const total = rows.reduce((sum, row) => sum + row.paidCents, 0);
  const mine = you
    ? rows.find((row) => row.publicId === you.publicId)
    : undefined;
  // Their card is saved as it is edited once they sponsor; before, at Claim.
  const sponsoring = Boolean(
    you && all.some((row) => row.publicId === you.publicId),
  );
  const others = rows.filter((row) => row !== mine);

  const [open, setOpen] = useState(false);
  const [dollars, setDollars] = useState(String(MIN_AMOUNT_CENTS / 100));
  const cents = Math.round(Number(dollars || 0) * 100);
  const valid = cents >= MIN_AMOUNT_CENTS && cents <= MAX_AMOUNT_CENTS;
  const base = mine?.paidCents ?? 0;
  const place = (added: number) =>
    others.filter((row) => row.paidCents >= base + added).length + 1;
  // Closed and on the board: their own place. Otherwise the place it takes.
  const target =
    mine && !open ? place(0) : place(valid ? cents : MIN_AMOUNT_CENTS);

  const motion = useMemo(
    () => ({ rows, target, open }),
    [rows, target, open],
  );
  const list = useFlip<HTMLOListElement>(motion, period);

  const card = (
    <ClaimCard
      key="you"
      you={you}
      mine={mine}
      sponsoring={sponsoring}
      open={open}
      setOpen={setOpen}
      rank={target}
      current={mine ? place(0) : null}
      period={period}
      dollars={dollars}
      setDollars={setDollars}
      cents={cents}
      valid={valid}
    />
  );
  const items: React.ReactNode[] = [];
  others.slice(0, TOP).forEach((row, i) => {
    if (i + 1 === target) items.push(card);
    items.push(
      <SponsorCard
        key={row.publicId}
        row={row}
        rank={i + 1 >= target ? i + 2 : i + 1}
      />,
    );
  });
  if (target > Math.min(others.length, TOP)) {
    if (target > TOP + 1)
      items.push(
        <li key="gap" className="sb-gap" aria-hidden="true">
          ···
        </li>,
      );
    items.push(card);
  }

  return (
    <section className="sb" id="sponsors" aria-labelledby="sponsors-title">
      <div className="sb-head">
        <h2 id="sponsors-title">Sponsors</h2>
        <div className="sb-periods" role="tablist" aria-label="Period">
          {(["today", "all"] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={period === value}
              onClick={() => setPeriod(value)}
            >
              {value === "today" ? "Today" : "All time"}
            </button>
          ))}
        </div>
        <span className="sb-total">
          <small>total</small> {money(total, false)}
        </span>
      </div>
      <ol className="sb-list" ref={list}>
        {items}
      </ol>
    </section>
  );
}

/** A sponsor as everyone sees them; the card opens their website. */
function SponsorCard({ row, rank }: { row: SponsorRow; rank: number }) {
  return (
    <li
      className={`sb-card ${rank <= 3 ? "top" : ""} ${row.websiteUrl && row.name ? "linked" : ""}`}
      data-flip={row.publicId}
      data-sponsor={row.publicId}
    >
      {row.websiteUrl && row.name && (
        <a
          className="board-row-link"
          href={`/out/${row.publicId}`}
          rel="sponsored noopener"
          target="_blank"
          aria-label={`${row.name}, ${domain(row.websiteUrl)}`}
        />
      )}
      <div className="board-row large">
        <span className="board-rank">{rank}</span>
        <Logo name={row.name} url={row.logoUrl} size="large" />
        <span className="board-body">
          <span className="board-title">
            <SponsorName name={row.name} />
            {row.tagline && <span> · {row.tagline}</span>}
          </span>
          {row.description && (
            <span className="board-description" title={row.description}>
              {row.description}
            </span>
          )}
          <span className="board-meta">
            {row.websiteUrl && <span>{domain(row.websiteUrl)}</span>}
            {row.name && <span>{plural(row.clicks, "click")}</span>}
            <Impact row={row} />
          </span>
        </span>
        <Paid row={row} />
      </div>
    </li>
  );
}

/**
 * The viewer's card. Closed: their row (or, before they sponsor, the place
 * $10 takes). Open: the card as a form, the amount, and Claim.
 */
function ClaimCard({
  you,
  mine,
  sponsoring,
  open,
  setOpen,
  rank,
  current,
  period,
  dollars,
  setDollars,
  cents,
  valid,
}: {
  you: BoardViewer | null;
  mine: SponsorRow | undefined;
  sponsoring: boolean;
  open: boolean;
  setOpen: (open: boolean) => void;
  rank: number;
  /** The viewer's place on this board today, before paying more. */
  current: number | null;
  period: Period;
  dollars: string;
  setDollars: (value: string) => void;
  cents: number;
  valid: boolean;
}) {
  const save = useServerFn(saveSponsorProfileFn);
  const checkout = useServerFn(startCheckoutFn);
  const router = useRouter();
  const [card, setCard] = useState<CardValue>({
    anonymous: Boolean(you && sponsoring && you.publicName === null),
    name: you?.publicName ?? "",
    tagline: you?.tagline ?? "",
    description: you?.description ?? "",
    website: you?.websiteUrl ?? "",
    logo: you?.logoUrl ?? null,
  });
  const [waiver, setWaiver] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  useSavedFades(state, setState);
  const last = useRef<string | null>(null);
  const amount = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) amount.current?.focus({ preventScroll: true });
  }, [open]);

  /** The card as the profile it saves, or an error to show. */
  function profileOf(next: CardValue) {
    if (next.anonymous) return { profile: anonymousProfile };
    const name = next.name.trim();
    const site = websiteAddress(next.website);
    if (name.length < 2)
      return { error: "Give your card a name of two letters or more." };
    if (site === null)
      return { error: "That website address does not look right." };
    return {
      profile: {
        publicName: name,
        tagline: next.tagline,
        description: next.description,
        websiteUrl: site,
        logo: next.logo,
      },
    };
  }

  // Sponsors already on the boards: each field is saved as it is left.
  async function commit(patch: Partial<CardValue> = {}) {
    if (!sponsoring) return;
    const next = { ...card, ...patch };
    if (!next.anonymous && !next.name.trim()) return;
    const result = profileOf(next);
    if (!result.profile) return setError(result.error);
    const key = JSON.stringify(result.profile);
    if (key === last.current) return;
    setError("");
    setState("saving");
    try {
      await save({ data: { profile: result.profile } });
      last.current = key;
      setState("saved");
      void router.invalidate();
    } catch (cause) {
      setState("error");
      if (cause instanceof Error && /image/i.test(cause.message))
        setError(cause.message);
    }
  }

  async function claim() {
    setError("");
    if (!valid)
      return setError("Choose a whole-dollar amount from $10 to $1,000.");
    const result = profileOf(card);
    if (!result.profile) return setError(result.error);
    if (!waiver)
      return setError("Confirm that compute starts right away to continue.");
    setPending(true);
    try {
      const { url } = await checkout({
        data: {
          amountCents: cents,
          withdrawalWaiver: true,
          profile: result.profile,
        },
      });
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout failed.");
      setPending(false);
    }
  }

  const where = period === "today" ? "today" : "all time";
  const gains = current === null || rank < current;

  if (!open && mine)
    return (
      <li className="sb-card you" data-flip="you">
        <div className="board-row large">
          <span className="board-rank">{rank}</span>
          <Logo name={mine.name} url={mine.logoUrl} size="large" />
          <span className="board-body">
            <span className="board-title">
              <SponsorName name={mine.name} />
              {mine.tagline && <span> · {mine.tagline}</span>}
              <span className="sb-you">You</span>
            </span>
            {mine.description && (
              <span className="board-description">{mine.description}</span>
            )}
            <span className="board-meta">
              {mine.websiteUrl && <span>{domain(mine.websiteUrl)}</span>}
              {mine.name && <span>{plural(mine.clicks, "click")}</span>}
              <Impact row={mine} />
            </span>
          </span>
          <span className="sb-mine">
            <Paid row={mine} />
            <button
              type="button"
              className="sb-claim-go small"
              onClick={() => setOpen(true)}
            >
              <Plus size={13} /> Move up
            </button>
          </span>
        </div>
      </li>
    );

  if (!open)
    return (
      <li className="sb-card ghost" data-flip="you">
        <button
          type="button"
          className="board-row large sb-ghost"
          onClick={() => setOpen(true)}
        >
          <span className="board-rank">{rank}</span>
          <span className="board-logo large open" aria-hidden="true">
            +
          </span>
          <span className="board-body">
            <span className="board-title">Your company here</span>
          </span>
          <span className="sb-ghost-take">
            <b>{money(MIN_AMOUNT_CENTS, false)}</b> takes #{rank}
            <span className="sb-claim-go">
              Claim <ArrowRight size={13} strokeWidth={2.4} />
            </span>
          </span>
        </button>
      </li>
    );

  return (
    <li className="sb-card claiming" data-flip="you">
      <SponsorCardRow
        value={card}
        onChange={(patch) => setCard((current) => ({ ...current, ...patch }))}
        onCommit={(patch) => void commit(patch)}
        rank={rank}
        stats={mine}
        amount={
          <span className="sb-amount">
            {mine && (
              <span className="sb-paid">{money(mine.paidCents, false)}</span>
            )}
            <label className="sb-dollars">
              {mine ? "+$" : "$"}
              <input
                ref={amount}
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
          </span>
        }
      />
      <div className="sb-claim">
        <label className="sb-check">
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
        <label className="sb-check">
          <input
            type="checkbox"
            checked={waiver}
            onChange={(event) => setWaiver(event.target.checked)}
          />
          <span>
            Compute starts right away: I give up my 14-day withdrawal right (
            <a href="/terms" target="_blank" className="text-link">
              Terms
            </a>
            )
          </span>
        </label>
        <SavedState state={state} />
        <span className="sb-claim-actions">
          <button
            type="button"
            className="bd-btn bd-btn-ghost"
            onClick={() => {
              setOpen(false);
              setError("");
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="sb-claim-go"
            onClick={() => void claim()}
            aria-disabled={!valid || pending}
          >
            {!valid
              ? cents < MIN_AMOUNT_CENTS
                ? "From $10"
                : "Up to $1,000"
              : gains
                ? `Claim #${rank} ${where}`
                : `Add ${money(cents, false)}`}
            {pending ? <Spinner /> : <ArrowRight size={14} strokeWidth={2.4} />}
          </button>
        </span>
        {error && (
          <p className="sb-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
