import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, money } from "@/core/packs";
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

/**
 * Today and all time side by side, the viewer's own row in both: at their
 * place once they paid, otherwise where $10 would put them. The amount in
 * the head moves that row live; Claim opens the card, which pays it.
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

  const boards = (["today", "all"] as const).map((period) => {
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
  const [todayBoard, allBoard] = boards as [
    (typeof boards)[number],
    (typeof boards)[number],
  ];
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

  return (
    <section className="sb" id="sponsors" aria-labelledby="sponsors-title">
      <div className="sb-head">
        <h2 id="sponsors-title">Sponsors</h2>
        {!open && (
          <div className="sb-claim-bar">
            <Dollars
              dollars={dollars}
              setDollars={setDollars}
              plus={sponsoring}
            />
            <button
              type="button"
              className="sb-claim-go"
              onClick={() => setOpen(true)}
            >
              {label}
              <ArrowRight size={14} strokeWidth={2.4} />
            </button>
          </div>
        )}
      </div>
      {open && (
        <ClaimCard
          sponsoring={sponsoring}
          paid={allBoard.mine?.paidCents ?? 0}
          card={card}
          setCard={setCard}
          close={() => setOpen(false)}
          label={label}
          dollars={dollars}
          setDollars={setDollars}
          cents={cents}
          valid={valid}
        />
      )}
      <div className="sb-boards">
        {boards.map((board) => (
          <Column
            key={board.period}
            {...board}
            open={open}
            added={added}
            name={card.anonymous ? null : card.name.trim() || null}
            logo={card.anonymous ? null : card.logo}
            onClaim={() => setOpen(true)}
          />
        ))}
      </div>
    </section>
  );
}

/** The amount, in whole dollars. */
function Dollars({
  dollars,
  setDollars,
  plus,
  inputRef,
}: {
  dollars: string;
  setDollars: (value: string) => void;
  /** On top of what the sponsor already paid. */
  plus: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <label className="sb-dollars">
      {plus ? "+$" : "$"}
      <input
        ref={inputRef}
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

/** One board: its head, then the sponsors with the viewer's row among them. */
function Column({
  period,
  rows,
  mine,
  others,
  target,
  open,
  added,
  name,
  logo,
  onClaim,
}: {
  period: Period;
  rows: SponsorRow[];
  mine: SponsorRow | undefined;
  others: SponsorRow[];
  target: number;
  open: boolean;
  added: number;
  /** The name being typed on the card, for the viewer's row. */
  name: string | null;
  logo: string | null;
  onClaim: () => void;
}) {
  const total = rows.reduce((sum, row) => sum + row.paidCents, 0);
  const motion = useMemo(() => ({ rows, target, open }), [rows, target, open]);
  const list = useFlip<HTMLOListElement>(motion);

  const you = (
    <li
      key="you"
      className={`sb-row you ${mine ? "" : "ghost"} ${open ? "open" : ""}`}
      data-flip="you"
    >
      <button
        type="button"
        className="sb-row-button"
        onClick={onClaim}
        disabled={open}
      >
        <span className="sb-rank">{target}</span>
        {mine && !open ? (
          <Logo name={mine.name} url={mine.logoUrl} size="small" />
        ) : name ? (
          <Logo name={name} url={logo} size="small" />
        ) : (
          <span className="board-logo small open" aria-hidden="true">
            +
          </span>
        )}
        <span className="sb-body">
          <span className="sb-title">
            {mine && !open ? (
              <SponsorName name={mine.name} />
            ) : name ? (
              <b>{name}</b>
            ) : (
              <span className="sb-placeholder">Your company here</span>
            )}
            <span className="sb-you">You</span>
          </span>
        </span>
        <span className="sb-paid">
          <b>
            {money((mine?.paidCents ?? 0) + (mine && !open ? 0 : added), false)}
          </b>
          {mine && <Stats row={mine} />}
        </span>
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

/** A sponsor as everyone sees them; the row opens their website. */
function SponsorLine({ row, rank }: { row: SponsorRow; rank: number }) {
  const linked = Boolean(row.websiteUrl && row.name);
  const body = (
    <>
      <span className="sb-rank">{rank}</span>
      <Logo name={row.name} url={row.logoUrl} size="small" />
      <span className="sb-body">
        <span className="sb-title">
          <SponsorName name={row.name} />
          {row.tagline && <span> · {row.tagline}</span>}
        </span>
        {rank <= 3 && row.description && (
          <span className="sb-description" title={row.description}>
            {row.description}
          </span>
        )}
      </span>
      <span className="sb-paid">
        <b>{money(row.paidCents, false)}</b>
        <Stats row={row} />
      </span>
    </>
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
 * The viewer's card, open above the boards: the profile as a form, the
 * amount, the waiver, and Claim, which opens Stripe Checkout.
 */
function ClaimCard({
  sponsoring,
  paid,
  card,
  setCard,
  close,
  label,
  dollars,
  setDollars,
  cents,
  valid,
}: {
  sponsoring: boolean;
  /** What the sponsor paid so far, all time. */
  paid: number;
  card: CardValue;
  setCard: React.Dispatch<React.SetStateAction<CardValue>>;
  close: () => void;
  label: string;
  dollars: string;
  setDollars: (value: string) => void;
  cents: number;
  valid: boolean;
}) {
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
    root.current
      ?.querySelector<HTMLInputElement>(".fund-name")
      ?.focus({ preventScroll: true });
  }, []);

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

  return (
    <div className="sb-card" ref={root}>
      <SponsorCardRow
        value={card}
        onChange={(patch) => setCard((current) => ({ ...current, ...patch }))}
        onCommit={(patch) => void commit(patch)}
        rank=""
        amount={
          <span className="sb-amount">
            {sponsoring && (
              <span className="sb-paid-so-far">{money(paid, false)}</span>
            )}
            <Dollars
              dollars={dollars}
              setDollars={setDollars}
              plus={sponsoring}
            />
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
              close();
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
