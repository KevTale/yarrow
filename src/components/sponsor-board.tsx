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
import { LogoPicker } from "./logo-picker";
import { Spinner } from "./navigation-feedback";
import { SavedState, useSavedFades, type SaveState } from "./saved-state";
import { websiteAddress, type CardValue } from "./sponsor-card";

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
  /** Their place now, once on the board. */
  current: number | null;
  /** The place the amount being typed would take. */
  target: number;
  /** Where their row shows: their place, or the target while editing. */
  place: number;
}

/**
 * The amount, the card as it is being edited, and the place that amount
 * takes on each board. `editing` moves the viewer's rows to that place.
 */
function useClaim(
  today: SponsorRow[],
  all: SponsorRow[],
  you: BoardViewer | null,
  editing: boolean,
) {
  const [dollars, setDollars] = useState(String(MIN_AMOUNT_CENTS / 100));
  const cents = Math.round(Number(dollars || 0) * 100);
  const valid = cents >= MIN_AMOUNT_CENTS && cents <= MAX_AMOUNT_CENTS;
  const added = valid ? cents : MIN_AMOUNT_CENTS;
  const allMine = you
    ? all.find((row) => row.publicId === you.publicId)
    : undefined;
  // Their row is saved as it is edited once they sponsor; before, at Claim.
  const sponsoring = Boolean(allMine);
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
    const target = placeAmong(others, base + added);
    const place = mine && !editing ? current! : target;
    return { period, rows, mine, others, current, target, place };
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
    allMine,
    card,
    setCard,
    boards,
    label,
    fees,
    founding,
  };
}

type Claim = ReturnType<typeof useClaim>;

/**
 * Today and all time side by side, the viewer's own row in both: at their
 * place once they paid, otherwise where $10 would put them. Claim, or the
 * row itself, turns that row into its own form, right on the board; the
 * row on the other board follows what is typed.
 */
export function SponsorBoard({
  today,
  all,
  you,
  startEditing = false,
}: {
  today: SponsorRow[];
  all: SponsorRow[];
  you: BoardViewer | null;
  /** Arriving from the dashboard's Edit: the row opens at once. */
  startEditing?: boolean;
}) {
  const [editing, setEditing] = useState<Period | null>(
    startEditing ? "today" : null,
  );
  const claim = useClaim(today, all, you, editing !== null);
  return (
    <section className="sb" id="sponsors" aria-labelledby="sponsors-title">
      <div className="sb-head">
        <h2 id="sponsors-title">Sponsors</h2>
        {!editing && (
          <div className="sb-head-side">
            <div className="sb-claim-bar">
              <Dollars dollars={claim.dollars} setDollars={claim.setDollars} />
              <button
                type="button"
                className="sb-claim-go"
                onClick={() => setEditing("today")}
              >
                {claim.label}
                <ArrowRight size={14} strokeWidth={2.4} />
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="sb-boards">
        {claim.boards.map((board) => (
          <Column
            key={board.period}
            board={board}
            claim={claim}
            editing={editing}
            onEdit={setEditing}
            close={() => setEditing(null)}
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
  large = false,
}: {
  dollars: string;
  setDollars: (value: string) => void;
  large?: boolean;
}) {
  return (
    <label className={`sb-dollars ${large ? "large" : ""}`}>
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
  );
}

/** What the sponsor's money did, zeros included. Anonymous rows get no clicks. */
function Stats({
  clicks,
  merged,
  anonymous,
}: {
  clicks: number;
  merged: number;
  anonymous: boolean;
}) {
  return (
    <small className="sb-stats">
      {!anonymous && <span>{plural(clicks, "click")}</span>}
      <span>{plural(merged, "merged PR")}</span>
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
  edit = false,
}: {
  rank: number;
  logo: React.ReactNode;
  name: React.ReactNode;
  tagline: string | null;
  description: string | null;
  amount: number;
  stats: React.ReactNode;
  you?: boolean;
  /** Their own row, once on the board: it opens as its form. */
  edit?: boolean;
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
          {edit && <span className="sb-edit">Edit</span>}
        </span>
        {description && (
          <span className="sb-description" title={description}>
            {description}
          </span>
        )}
        {/* On phones the stats sit under the name, where there is room. */}
        <span className="sb-stats-under">{stats}</span>
      </span>
      <span className="sb-paid">
        <b>{money(amount, false)}</b>
        <span className="sb-stats-side">{stats}</span>
      </span>
    </>
  );
}

/** One board: its head, then the sponsors with the viewer's row among them. */
function Column({
  board,
  claim,
  editing,
  onEdit,
  close,
}: {
  board: Board;
  claim: Claim;
  editing: Period | null;
  onEdit: (period: Period) => void;
  close: () => void;
}) {
  const { period, rows, mine, others, place } = board;
  const { card } = claim;
  const open = editing !== null;
  const total = rows.reduce((sum, row) => sum + row.paidCents, 0);
  const motion = useMemo(() => ({ rows, place, open }), [rows, place, open]);
  const list = useFlip<HTMLOListElement>(motion);

  // The rows keep one order in the page and move through CSS `order`, so
  // the viewer's row never leaves its spot in the page while it is typed in.
  const top = others.slice(0, TOP);
  const inside = place <= top.length;
  const youOrder = inside ? place - 1 : top.length + 1;
  const gap = !inside && place > TOP + 1;

  // On the board and not being edited: the row as everyone sees it.
  // Otherwise the card as typed, at the place the amount takes.
  const settled = mine && !open ? mine : null;
  const typed = card.anonymous ? null : card.name.trim() || null;
  const anonymous = settled ? settled.name === null : card.anonymous;
  const stats = (
    <Stats
      clicks={claim.allMine?.clicks ?? 0}
      merged={claim.allMine?.merged ?? 0}
      anonymous={anonymous}
    />
  );

  const you = (
    <li
      key="you"
      className={`sb-row you ${mine ? "" : "ghost"} ${editing === period ? "editing" : ""} ${place <= 3 ? "top" : ""}`}
      data-flip="you"
      style={{ order: youOrder }}
    >
      {editing === period ? (
        <EditRow claim={claim} rank={place} close={close} />
      ) : (
        <button
          type="button"
          className="sb-row-button"
          onClick={() => onEdit(period)}
          disabled={open}
        >
          <RowBody
            rank={place}
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
            // Their own description always shows, whatever their place.
            description={
              settled
                ? settled.description
                : typed
                  ? card.description.trim() || null
                  : null
            }
            amount={(mine?.paidCents ?? 0) + (settled ? 0 : claim.added)}
            stats={stats}
            you
            edit={claim.sponsoring && !open}
          />
        </button>
      )}
    </li>
  );

  return (
    <div className="sb-board" data-period={period}>
      <div className="sb-board-head">
        <h3>{period === "today" ? "Today" : "All time"}</h3>
        <span>{money(total, false)}</span>
      </div>
      <ol className="sb-list" ref={list}>
        {top.map((row, i) => (
          <SponsorLine
            key={row.publicId}
            row={row}
            rank={i + 1 >= place ? i + 2 : i + 1}
            order={i + 1 >= place ? i + 1 : i}
          />
        ))}
        {gap && (
          <li
            key="gap"
            className="sb-gap"
            aria-hidden="true"
            style={{ order: top.length }}
          >
            ···
          </li>
        )}
        {you}
      </ol>
    </div>
  );
}

/** A sponsor as everyone sees them; the row opens their website. */
function SponsorLine({
  row,
  rank,
  order,
}: {
  row: SponsorRow;
  rank: number;
  order: number;
}) {
  const linked = Boolean(row.websiteUrl && row.name);
  const body = (
    <RowBody
      rank={rank}
      logo={<Logo name={row.name} url={row.logoUrl} size="small" />}
      name={<SponsorName name={row.name} />}
      tagline={row.tagline}
      description={rank <= 3 ? row.description : null}
      amount={row.paidCents}
      stats={
        <Stats
          clicks={row.clicks}
          merged={row.merged}
          anonymous={row.name === null}
        />
      }
    />
  );
  return (
    <li
      className={`sb-row ${rank <= 3 ? "top" : ""} ${linked ? "linked" : ""}`}
      data-flip={row.publicId}
      data-sponsor={row.publicId}
      style={{ order }}
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
 * The viewer's row as its own form: logo, name, tagline, description and
 * website where they show, the amount where it shows, then what the amount
 * buys after fees, the waiver, and Claim, which opens Stripe Checkout.
 */
function EditRow({
  claim,
  rank,
  close,
}: {
  claim: Claim;
  rank: number;
  close: () => void;
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
    const element = root.current;
    if (!element) return;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    (
      element.querySelector<HTMLInputElement>(".fund-name") ??
      element.querySelector<HTMLInputElement>(".sb-dollars input")
    )?.focus({ preventScroll: true });
  }, []);
  // Back from Stripe: the browser may restore the page as it was left.
  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
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

  const change =
    (key: "name" | "tagline" | "description" | "website") =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setCard((current) => ({ ...current, [key]: value }));
    };

  return (
    <div className="sb-editor" ref={root}>
      <div className="sb-edit-row">
        <span className="sb-rank">{rank}</span>
        {card.anonymous ? (
          <Logo name={null} size="small" />
        ) : (
          <LogoPicker
            size="small"
            name={card.name.trim()}
            value={card.logo}
            onChange={(logo) => {
              setCard((current) => ({ ...current, logo }));
              void commit({ logo });
            }}
          />
        )}
        <span className="sb-body sb-fields">
          {card.anonymous ? (
            <span className="sb-name">
              <SponsorName name={null} />
            </span>
          ) : (
            <>
              <span className="sb-fields-line">
                <input
                  className="fund-input fund-name"
                  maxLength={60}
                  size={Math.max(card.name.length, 12)}
                  placeholder="Your company name"
                  aria-label="Public name"
                  value={card.name}
                  onChange={change("name")}
                  onBlur={() => void commit()}
                />
                <span className="fund-sep" aria-hidden="true">
                  ·
                </span>
                <input
                  className="fund-input fund-tagline"
                  maxLength={80}
                  size={Math.max(card.tagline.length, 8)}
                  placeholder="Tagline"
                  aria-label="Tagline (optional)"
                  value={card.tagline}
                  onChange={change("tagline")}
                  onBlur={() => void commit()}
                />
              </span>
              <input
                className="fund-input fund-description"
                maxLength={280}
                placeholder="What you do, in a sentence"
                aria-label="Description (optional)"
                value={card.description}
                onChange={change("description")}
                onBlur={() => void commit()}
              />
              <input
                className="fund-input fund-site"
                maxLength={300}
                inputMode="url"
                autoComplete="url"
                size={Math.max(card.website.length, 14)}
                placeholder="yourcompany.com"
                aria-label="Website (optional)"
                value={card.website}
                onChange={change("website")}
                onBlur={() => void commit()}
              />
            </>
          )}
        </span>
        <span className="sb-paid">
          <Dollars dollars={dollars} setDollars={setDollars} large />
          {sponsoring && claim.allMine && (
            <small className="sb-stats">
              <span>{money(claim.allMine.paidCents, false)} paid</span>
            </small>
          )}
        </span>
      </div>
      <div className="sb-edit-checks">
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
      </div>
      <div className="sb-edit-pay">
        {claim.fees ? (
          <span className="sb-fees">
            <b>≈ {money(claim.fees.creditCents)} of compute</b>
            <small>
              −{money(claim.fees.feeCents)} card fees · −
              {money(claim.fees.marginCents)} margin (
              {claim.founding ? "5" : "10"}%)
            </small>
          </span>
        ) : (
          <span />
        )}
        <span className="sb-claim-actions">
          <SavedState state={state} />
          <button
            type="button"
            className="bd-btn bd-btn-ghost"
            onClick={() => {
              close();
              setError("");
            }}
          >
            {sponsoring ? "Close" : "Cancel"}
          </button>
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
