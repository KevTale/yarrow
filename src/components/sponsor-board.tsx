import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, money } from "@/core/packs";
import { estimateBreakdown } from "@/core/pricing";
import type { BoardViewer } from "@/db/sponsors";
import {
  saveSponsorProfileFn,
  startCheckoutFn,
} from "@/functions/sponsor.functions";
import { Logo, plural, SponsorName, type SponsorRow } from "./boards";
import { useFlip } from "./live";
import { Spinner } from "./navigation-feedback";
import { SavedState, useSavedFades, type SaveState } from "./saved-state";
import { SponsorCardRow, websiteAddress, type CardValue } from "./sponsor-card";

type Period = "today" | "all";

/** The first places; the viewer's row shows further down when it lands there. */
const TOP = 10;

const anonymousProfile = {
  publicName: null,
  tagline: null,
  description: null,
  websiteUrl: null,
  logo: null,
};

/** The place an amount takes among the others on a board. */
function placeAmong(others: SponsorRow[], cents: number): number {
  return others.filter((row) => row.paidCents >= cents).length + 1;
}

interface Board {
  period: Period;
  rows: SponsorRow[];
  /** The viewer's row on this board, once they paid in the period. */
  mine: SponsorRow | undefined;
  others: SponsorRow[];
  current: number | null;
  /** The place the amount being typed takes. */
  target: number;
}

/**
 * The claim as both the landing and the dashboard carry it: the amount, the
 * card being edited, and the place that amount takes on each board. `open`
 * says whether the amount is being added (the card is open) or the viewer's
 * rows just show where they stand.
 */
export function useClaim(
  today: SponsorRow[],
  all: SponsorRow[],
  you: BoardViewer | null,
  open: boolean,
) {
  const [dollars, setDollars] = useState(String(MIN_AMOUNT_CENTS / 100));
  const cents = Math.round(Number(dollars || 0) * 100);
  const valid = cents >= MIN_AMOUNT_CENTS && cents <= MAX_AMOUNT_CENTS;
  const added = valid ? cents : MIN_AMOUNT_CENTS;
  // Their row is saved as it is edited once they sponsor; before, at Claim.
  const sponsoring = Boolean(
    you && all.some((row) => row.publicId === you.publicId),
  );
  const [card, setCard] = useState<CardValue>({
    anonymous: Boolean(you && sponsoring && you.publicName === null),
    name: you?.publicName ?? "",
    tagline: you?.tagline ?? "",
    description: you?.description ?? "",
    website: you?.websiteUrl ?? "",
    logo: you?.logoUrl ?? null,
  });

  const boards = (["today", "all"] as const).map((period): Board => {
    const rows = period === "today" ? today : all;
    const mine = you
      ? rows.find((row) => row.publicId === you.publicId)
      : undefined;
    const others = rows.filter((row) => row !== mine);
    const base = mine?.paidCents ?? 0;
    const current = mine ? placeAmong(others, base) : null;
    // Closed and on the board: their own place. Otherwise the place taken.
    const target = mine && !open ? current! : placeAmong(others, base + added);
    return { period, rows, mine, others, current, target };
  });
  const [todayBoard, allBoard] = boards as [Board, Board];
  const gains = boards.some(
    ({ current, target }) => current === null || target < current,
  );
  const label = !valid
    ? cents < MIN_AMOUNT_CENTS
      ? "From $10"
      : "Up to $1,000"
    : gains
      ? `Claim #${todayBoard.target} today · #${allBoard.target} all time`
      : `Add ${money(cents, false)}`;
  const founding = you?.foundingSponsor ?? false;
  const fees = valid
    ? estimateBreakdown(cents, { vatRateBps: 0, founding })
    : null;

  return {
    dollars,
    setDollars,
    cents,
    valid,
    added,
    sponsoring,
    card,
    setCard,
    boards,
    label,
    fees,
    founding,
  };
}

export type Claim = ReturnType<typeof useClaim>;

/**
 * Today and all time side by side, the viewer's own row in both: at their
 * place once they paid, otherwise where $10 would put them. Under the
 * boards, the amount and Claim, which opens the card in its place.
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
  const [open, setOpen] = useState(false);
  const claim = useClaim(today, all, you, open);
  const foot = useRef<HTMLDivElement>(null);
  // Opened from a row: the card is under the boards, so bring it in view.
  useEffect(() => {
    if (open)
      foot.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);

  return (
    <section className="sb" id="sponsors" aria-labelledby="sponsors-title">
      <h2 id="sponsors-title" className="sb-title">
        Paid for by
      </h2>
      <div className="sb-boards">
        {claim.boards.map((board) => (
          <Column
            key={board.period}
            {...board}
            open={open}
            added={claim.added}
            card={claim.card}
            onClaim={() => setOpen(true)}
          />
        ))}
      </div>
      <div className="sb-foot" ref={foot}>
        {open ? (
          <SponsorCard claim={claim} close={() => setOpen(false)} autoFocus />
        ) : (
          <div className="sb-claim-bar">
            <Dollars
              dollars={claim.dollars}
              setDollars={claim.setDollars}
              plus={claim.sponsoring}
            />
            <button
              type="button"
              className="sb-claim-go"
              onClick={() => setOpen(true)}
            >
              {claim.label}
              <ArrowRight size={14} strokeWidth={2.4} />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** The amount, in whole dollars. */
function Dollars({
  dollars,
  setDollars,
  plus,
  large = false,
}: {
  dollars: string;
  setDollars: (value: string) => void;
  /** On top of what the sponsor already paid. */
  plus: boolean;
  large?: boolean;
}) {
  return (
    <label className={`sb-dollars ${large ? "large" : ""}`}>
      {plus ? "+$" : "$"}
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
  );
}

/** What the sponsor's money did, under the amount. */
function Stats({
  row,
}: {
  row: Pick<SponsorRow, "name" | "clicks" | "merged">;
}) {
  return (
    <small>
      {row.name && (
        <span className="sb-clicks">{plural(row.clicks, "click")}</span>
      )}
      <span>{plural(row.merged, "merged PR")}</span>
    </small>
  );
}

/** A row's content, the viewer's and everyone else's alike. */
function RowBody({
  rank,
  logo,
  name,
  tagline,
  description,
  amount,
  stats,
  you = false,
}: {
  rank: number;
  logo: React.ReactNode;
  name: React.ReactNode;
  tagline: string | null;
  description: string | null;
  amount: number;
  stats: React.ReactNode;
  you?: boolean;
}) {
  return (
    <>
      <span className="sb-rank">{rank}</span>
      {logo}
      <span className="sb-body">
        <span className="sb-title-row">
          <span className="sb-name">
            {name}
            {tagline && <span> · {tagline}</span>}
          </span>
          {you && <span className="sb-you">You</span>}
        </span>
        {rank <= 3 && description && (
          <span className="sb-description" title={description}>
            {description}
          </span>
        )}
      </span>
      <span className="sb-paid">
        <b>{money(amount, false)}</b>
        {stats}
      </span>
    </>
  );
}

/** One board: its head, then the sponsors with the viewer's row among them. */
function Column({
  period,
  rows,
  mine,
  others,
  target,
  open,
  added,
  card,
  onClaim,
}: Board & {
  open: boolean;
  added: number;
  /** The card as it is being edited, for the viewer's row. */
  card: CardValue;
  onClaim: () => void;
}) {
  const total = rows.reduce((sum, row) => sum + row.paidCents, 0);
  const motion = useMemo(() => ({ rows, target, open }), [rows, target, open]);
  const list = useFlip<HTMLOListElement>(motion);

  // On the board and closed: the row as everyone sees it. Otherwise the
  // card as typed, at the place the amount takes.
  const settled = mine && !open ? mine : null;
  const typed = card.anonymous ? null : card.name.trim() || null;
  const you = (
    <li
      key="you"
      className={`sb-row you ${mine ? "" : "ghost"} ${open ? "open" : ""} ${target <= 3 ? "top" : ""}`}
      data-flip="you"
    >
      <button
        type="button"
        className="sb-row-button"
        onClick={onClaim}
        disabled={open}
      >
        <RowBody
          rank={target}
          logo={
            settled ? (
              <Logo name={settled.name} url={settled.logoUrl} size="small" />
            ) : typed || card.anonymous ? (
              <Logo name={typed} url={card.logo} size="small" />
            ) : (
              <span className="board-logo small open" aria-hidden="true">
                +
              </span>
            )
          }
          name={
            settled ? (
              <SponsorName name={settled.name} />
            ) : typed ? (
              <b>{typed}</b>
            ) : card.anonymous ? (
              <SponsorName name={null} />
            ) : (
              <span className="sb-placeholder">Your company here</span>
            )
          }
          tagline={
            settled
              ? settled.tagline
              : typed
                ? card.tagline.trim() || null
                : null
          }
          description={
            settled
              ? settled.description
              : typed
                ? card.description.trim() || null
                : null
          }
          amount={(mine?.paidCents ?? 0) + (settled ? 0 : added)}
          stats={mine && <Stats row={mine} />}
          you
        />
      </button>
    </li>
  );

  const items: React.ReactNode[] = [];
  others.slice(0, TOP).forEach((row, i) => {
    if (i + 1 === target) items.push(you);
    items.push(
      <SponsorLine
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
    items.push(you);
  }

  return (
    <div className="sb-board" data-period={period}>
      <div className="sb-board-head">
        <h3>{period === "today" ? "Today" : "All time"}</h3>
        <span>{money(total, false)}</span>
      </div>
      <ol className="sb-list" ref={list}>
        {items}
      </ol>
    </div>
  );
}

/** A sponsor as everyone sees them; the row opens their website. */
function SponsorLine({ row, rank }: { row: SponsorRow; rank: number }) {
  const linked = Boolean(row.websiteUrl && row.name);
  const body = (
    <RowBody
      rank={rank}
      logo={<Logo name={row.name} url={row.logoUrl} size="small" />}
      name={<SponsorName name={row.name} />}
      tagline={row.tagline}
      description={row.description}
      amount={row.paidCents}
      stats={<Stats row={row} />}
    />
  );
  return (
    <li
      className={`sb-row ${rank <= 3 ? "top" : ""} ${linked ? "linked" : ""}`}
      data-flip={row.publicId}
      data-sponsor={row.publicId}
    >
      {linked ? (
        <a
          className="sb-row-link"
          href={`/out/${row.publicId}`}
          rel="sponsored noopener"
          target="_blank"
        >
          {body}
        </a>
      ) : (
        <span className="sb-row-link">{body}</span>
      )}
    </li>
  );
}

/**
 * The viewer's card: the profile as a form, the amount with what it buys
 * after fees, the waiver, and Claim, which opens Stripe Checkout. On the
 * landing it opens under the boards; the dashboard shows it open.
 */
export function SponsorCard({
  claim,
  close,
  autoFocus = false,
}: {
  claim: Claim;
  /** Cancel, where the card can close. */
  close?: () => void;
  autoFocus?: boolean;
}) {
  const {
    sponsoring,
    card,
    setCard,
    label,
    dollars,
    setDollars,
    cents,
    valid,
  } = claim;
  const save = useServerFn(saveSponsorProfileFn);
  const checkout = useServerFn(startCheckoutFn);
  const router = useRouter();
  const [waiver, setWaiver] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [state, setState] = useState<SaveState>("idle");
  useSavedFades(state, setState);
  const last = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (autoFocus)
      root.current
        ?.querySelector<HTMLInputElement>(".fund-name")
        ?.focus({ preventScroll: true });
  }, [autoFocus]);

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

  async function pay() {
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

  return (
    <div className="sb-card" ref={root}>
      <SponsorCardRow
        value={card}
        onChange={(patch) => setCard((current) => ({ ...current, ...patch }))}
        onCommit={(patch) => void commit(patch)}
        rank=""
        amount={null}
      />
      <div className="sb-pay">
        <Dollars
          dollars={dollars}
          setDollars={setDollars}
          plus={sponsoring}
          large
        />
        {claim.fees && (
          <span className="sb-fees">
            <span>Card fees ≈ −{money(claim.fees.feeCents)}</span>
            <span>
              Margin {claim.founding ? "5" : "10"}% −
              {money(claim.fees.marginCents)}
            </span>
            <b>Compute ≈ {money(claim.fees.creditCents)}</b>
          </span>
        )}
      </div>
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
          {close && (
            <button
              type="button"
              className="bd-btn bd-btn-ghost"
              onClick={() => {
                close();
                setError("");
              }}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            className="sb-claim-go"
            onClick={() => void pay()}
            aria-disabled={!valid || pending}
          >
            {label}
            {pending ? <Spinner /> : <ArrowRight size={14} strokeWidth={2.4} />}
          </button>
        </span>
        {error && (
          <p className="sb-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
