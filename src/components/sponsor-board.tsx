import { useServerFn } from "@tanstack/react-start";
import { useRouter } from "@tanstack/react-router";
import {
  ArrowRight,
  GitMerge,
  LockKeyhole,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, money } from "@/core/packs";
import { prCardSvg, shortSite, type PrCardSponsor } from "@/core/pr-card";
import { DESCRIPTION_MAX } from "@/core/forms";
import { estimateBreakdown, pullRequestsFor } from "@/core/pricing";
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
  /** Where their row shows: their place, or the target while it is a form. */
  place: number;
}

/**
 * The amount, the card as it is typed, and the place that amount takes on
 * each board. `adding` moves a sponsor's rows to the place the amount takes.
 */
function useClaim(
  today: SponsorRow[],
  all: SponsorRow[],
  you: BoardViewer | null,
  adding: boolean,
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
  // Sponsors who chose anonymity before the landing stopped offering it.
  const wasAnonymous = Boolean(sponsoring && you?.publicName === null);
  const [card, setCard] = useState<CardValue>({
    anonymous: false,
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
    const place = mine && !adding ? current! : target;
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
  // The pull requests the compute funds, at about $2.50 each.
  const prs = fees ? pullRequestsFor(fees.creditCents) : null;

  /** The card as the profile it saves, or an error to show. */
  function profileOf(next: CardValue) {
    const name = next.name.trim();
    if (!name && wasAnonymous) return { profile: anonymousProfile };
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
    prs,
    founding,
    profileOf,
  };
}

type Claim = ReturnType<typeof useClaim>;

/** A sponsor's card is saved as each field is left. */
function useSaver(claim: Claim) {
  const save = useServerFn(saveSponsorProfileFn);
  const router = useRouter();
  const [state, setState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  useSavedFades(state, setState);

  async function commit(patch: Partial<CardValue> = {}) {
    if (!claim.sponsoring) return;
    const result = claim.profileOf({ ...claim.card, ...patch });
    if (!result.profile) return setError(result.error);
    const key = JSON.stringify(result.profile);
    if (key === saved) return;
    setError("");
    setState("saving");
    try {
      await save({ data: { profile: result.profile } });
      setSaved(key);
      setState("saved");
      void router.invalidate();
    } catch (cause) {
      setState("error");
      if (cause instanceof Error && /image/i.test(cause.message))
        setError(cause.message);
    }
  }
  return { commit, state, error, setError };
}

type Saver = ReturnType<typeof useSaver>;

/**
 * Today and all time side by side, every row three lines (name and amount,
 * description, website and stats), the viewer's own row in both as a form
 * of the same size: typed in place, the other board following.
 * A sponsor's row shows as everyone sees it until they edit it. Claim
 * opens the payment over the page once the card has a name; before, it
 * moves into the row.
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
  /** Arriving from the dashboard: the row opens at once. */
  startEditing?: boolean;
}) {
  // A sponsor's rows become the form on Edit; a visitor's always are.
  const [editing, setEditing] = useState(startEditing);
  const [engaged, setEngaged] = useState<Period | null>(
    startEditing ? "today" : null,
  );
  // Each request moves the focus into that board's row.
  const [focus, setFocus] = useState<{ period: Period; tick: number }>({
    period: "today",
    tick: startEditing ? 1 : 0,
  });
  const claim = useClaim(today, all, you, editing);
  // One board at a time: Today, the cheap place to take, comes first.
  const [period, setPeriod] = useState<Period>("today");
  const saver = useSaver(claim);
  const form = editing || !claim.sponsoring;
  const [paying, setPaying] = useState(false);
  const open = (period: Period) => {
    setEditing(true);
    setEngaged(period);
    setFocus((current) => ({ period, tick: current.tick + 1 }));
  };
  // A card that can be paid opens the payment; otherwise, into the row,
  // saying what is missing once the row was used.
  const claimFrom = (period: Period) => {
    const result = claim.profileOf(claim.card);
    if (claim.valid && result.profile) {
      saver.setError("");
      setEditing(true);
      return setPaying(true);
    }
    if (engaged !== null)
      saver.setError(
        result.error ?? "Choose a whole-dollar amount from $10 to $1,000.",
      );
    open(period);
  };

  const board = claim.boards.find((item) => item.period === period)!;
  // The visitor's card once a name is typed, otherwise the first sponsor's.
  const preview = claim.card.name.trim()
    ? typedSponsor(claim.card)
    : (sample(claim.boards[1]!.rows) ?? typedSponsor(claim.card));

  return (
    <section className="sb" id="sponsors" aria-labelledby="sponsors-title">
      <div className="sb-pitch">
        <p className="sb-pitch-lede">
          Get your company name on every pull request you fund
        </p>
        <PrSketch sponsor={preview} />
        <p className="sb-pitch-text">
          Your money pays for the compute behind each pull request, and your
          card closes every one. Maintainers see it when they merge, and so
          does anyone who opens it later. Every click to your site, from a
          pull request or this page, is counted on your row.
        </p>
      </div>
      <Column
        board={board}
        head={
          <>
            <h2 id="sponsors-title">Sponsors</h2>
            <PeriodTabs
              boards={claim.boards}
              period={period}
              onChange={setPeriod}
            />
          </>
        }
        claim={claim}
        saver={saver}
        form={form}
        engaged={engaged !== null}
        onEngage={() => setEngaged(period)}
        onOpen={() => open(period)}
        onClaim={() => claimFrom(period)}
        focus={focus.tick}
      />
      <ClaimDialog
        claim={claim}
        open={paying}
        onClose={() => setPaying(false)}
      />
    </section>
  );
}

/** Today or All time, each with its total: the other board says what it holds. */
function PeriodTabs({
  boards,
  period,
  onChange,
}: {
  boards: Board[];
  period: Period;
  onChange: (period: Period) => void;
}) {
  return (
    <div className="sb-tabs" role="tablist" aria-label="Period">
      {boards.map((item) => (
        <button
          key={item.period}
          type="button"
          role="tab"
          aria-selected={item.period === period}
          onClick={() => onChange(item.period)}
        >
          {item.period === "today" ? "Today" : "All time"}
          <span>
            {money(
              item.rows.reduce((sum, row) => sum + row.paidCents, 0),
              false,
            )}
          </span>
        </button>
      ))}
    </div>
  );
}

/** The first named sponsor all time, to show a card before anything is typed. */
function sample(rows: SponsorRow[]): PrCardSponsor | null {
  const row = rows.find((candidate) => candidate.name);
  return row
    ? {
        name: row.name,
        description: row.description,
        site: shortSite(row.websiteUrl),
        logo: row.logoUrl,
        publicId: row.publicId,
      }
    : null;
}

/** "https://www.acme.com/" → "acme.com". */
function host(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
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

/**
 * A row's three lines, the viewer's and everyone else's alike: the name
 * and the amount, the description, the website and the stats.
 */
function RowBody({
  rank,
  logo,
  name,
  description,
  website,
  amount,
  stats,
  you = false,
  edit = false,
}: {
  rank: number;
  logo: React.ReactNode;
  name: React.ReactNode;
  description: string | null;
  website: string | null;
  amount: number;
  stats: React.ReactNode;
  you?: boolean;
  /** Their own row, once on the board: it opens as its form. */
  edit?: boolean;
}) {
  return (
    <>
      <Rank rank={rank} />
      {logo}
      <span className="sb-body">
        <span className="sb-line">
          <span className="sb-name">{name}</span>
          {you && <span className="sb-you">You</span>}
          {edit && <span className="sb-edit">Edit</span>}
          <b className="sb-amount">{money(amount, false)}</b>
        </span>
        <span className="sb-description" title={description ?? undefined}>
          {description}
        </span>
        <span className="sb-line">
          <span className="sb-site">{host(website)}</span>
          {stats}
        </span>
      </span>
    </>
  );
}

/** One board: its head, then the sponsors with the viewer's row among them. */
function Column({
  board,
  head,
  claim,
  saver,
  form,
  engaged,
  onEngage,
  onOpen,
  onClaim,
  focus,
}: {
  board: Board;
  /** The board's head: the title and the period tabs. */
  head: React.ReactNode;
  claim: Claim;
  saver: Saver;
  /** The viewer's row is a form (a visitor's always, a sponsor's on Edit). */
  form: boolean;
  /** This board's row was used: the payment opens under it. */
  engaged: boolean;
  onEngage: () => void;
  onOpen: () => void;
  onClaim: () => void;
  /** Changes when the focus should move into this row. */
  focus: number;
}) {
  const { period, rows, mine, others, place } = board;
  const motion = useMemo(() => ({ rows, place, form }), [rows, place, form]);
  const list = useFlip<HTMLOListElement>(motion);

  // The rows keep one order in the page and move through CSS `order`, so
  // the viewer's row never leaves its spot in the page while it is typed in.
  const top = others.slice(0, TOP);
  const inside = place <= top.length;
  const youOrder = inside ? place - 1 : top.length + 1;
  const gap = !inside && place > TOP + 1;

  const stats = (
    <Stats
      clicks={claim.allMine?.clicks ?? 0}
      merged={claim.allMine?.merged ?? 0}
      anonymous={!form && mine?.name === null}
    />
  );

  const you = (
    <li
      key="you"
      className={`sb-row you ${mine ? "" : "ghost"} ${form ? "form" : ""} ${engaged ? "engaged" : ""} ${place <= 3 ? "top" : ""}`}
      data-flip="you"
      style={{ order: youOrder }}
      onFocus={form ? onEngage : undefined}
    >
      {form ? (
        <>
          <FormRow
            claim={claim}
            saver={saver}
            rank={place}
            stats={stats}
            focus={focus}
            onClaim={onClaim}
          />
        </>
      ) : (
        <button type="button" className="sb-row-button" onClick={onOpen}>
          <RowBody
            rank={place}
            logo={
              <Logo
                name={mine?.name ?? null}
                url={mine?.logoUrl ?? null}
                size="large"
              />
            }
            name={<SponsorName name={mine?.name ?? null} />}
            description={mine?.description ?? null}
            website={mine?.websiteUrl ?? null}
            amount={mine?.paidCents ?? 0}
            stats={stats}
            you
            edit
          />
        </button>
      )}
    </li>
  );

  return (
    <div className="sb-board" data-period={period}>
      <div className="sb-board-head">{head}</div>
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
      logo={<Logo name={row.name} url={row.logoUrl} size="large" />}
      name={<SponsorName name={row.name} />}
      description={row.description}
      website={row.name ? row.websiteUrl : null}
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
 * The viewer's row as a form the size of any other row, each field where
 * its text prints: the name and the amount, the description, the website.
 */
function FormRow({
  claim,
  saver,
  rank,
  stats,
  focus,
  onClaim,
}: {
  claim: Claim;
  saver: Saver;
  rank: number;
  stats: React.ReactNode;
  focus: number;
  onClaim: () => void;
}) {
  const { card, setCard } = claim;
  const claimButton = (where: "inline" | "below") => (
    <button
      type="button"
      className={`sb-claim-go sb-row-claim ${where}`}
      onClick={onClaim}
    >
      Claim #{rank}
    </button>
  );
  const root = useRef<HTMLDivElement>(null);
  // Asked for (Claim, Edit, the dashboard): into the first empty field.
  useEffect(() => {
    const element = root.current;
    if (!focus || !element) return;
    element.scrollIntoView({ block: "center", behavior: "smooth" });
    const name = element.querySelector<HTMLInputElement>(".fund-name");
    (name?.value
      ? element.querySelector<HTMLInputElement>(".sb-amount-field input")
      : name
    )?.focus({ preventScroll: true });
  }, [focus]);

  const change =
    (key: "name" | "description" | "website") =>
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value;
      setCard((current) => ({ ...current, [key]: value }));
    };

  return (
    <div className="sb-form-row" ref={root}>
      <Rank rank={rank} />
      <LogoPicker
        size="large"
        name={card.name.trim() || "+"}
        value={card.logo}
        onChange={(logo) => {
          setCard((current) => ({ ...current, logo }));
          void saver.commit({ logo });
        }}
      />
      <span className="sb-body">
        <span className="sb-line">
          <input
            className="fund-input fund-name"
            maxLength={60}
            size={Math.max(card.name.length, 10)}
            placeholder="Your company name"
            aria-label="Public name"
            value={card.name}
            onChange={change("name")}
            onBlur={() => void saver.commit()}
          />
          <span className="sb-you">You</span>
          <SavedState state={saver.state} />
          <AmountField
            claim={claim}
            label={claim.sponsoring ? "Dollars to add" : "Amount in dollars"}
          />
          {claimButton("inline")}
        </span>
        <span className="sb-line">
          <input
            className="fund-input fund-description"
            maxLength={DESCRIPTION_MAX}
            placeholder="What you do, in a sentence"
            aria-label="Description (optional)"
            value={card.description}
            onChange={change("description")}
            onBlur={() => void saver.commit()}
          />
          <Funds prs={claim.prs} />
        </span>
        <span className="sb-line">
          <input
            className="fund-input fund-site"
            maxLength={300}
            inputMode="url"
            autoComplete="url"
            size={Math.max(card.website.length, 16)}
            placeholder="yourcompany.com"
            aria-label="Website (optional)"
            value={card.website}
            onChange={change("website")}
            onBlur={() => void saver.commit()}
          />
          {stats}
        </span>
      </span>
      {/* On phones Claim takes the whole width, under the card. */}
      <span className="sb-claim-below">
        {claimButton("below")}
        <Funds prs={claim.prs} />
      </span>
      {saver.error && (
        <p className="sb-error" role="alert">
          {saver.error}
        </p>
      )}
    </div>
  );
}

/** Under Claim: the pull requests the amount funds. */
function Funds({ prs }: { prs: number | null }) {
  return <small className="sb-funds">{prs ? `funds ≈${prs} PRs` : ""}</small>;
}

/** The place, the same plain figure for every row. */
function Rank({ rank }: { rank: number }) {
  return <span className="sb-rank">{rank}</span>;
}

/** Five dollars a step, from $10 to $1,000. */
const STEP = 5;

/** The amount: typed, or moved by five dollars with − and +. */
function AmountField({ claim, label }: { claim: Claim; label: string }) {
  const dollars = Number(claim.dollars || 0);
  const min = MIN_AMOUNT_CENTS / 100;
  const max = MAX_AMOUNT_CENTS / 100;
  const step = (delta: number) => {
    const next =
      dollars < min ? min : Math.round((dollars + delta) / STEP) * STEP;
    claim.setDollars(String(Math.min(max, Math.max(min, next))));
  };
  return (
    <span className="sb-amount sb-amount-field">
      <button
        type="button"
        className="sb-step"
        aria-label="Five dollars less"
        disabled={dollars <= min}
        onClick={() => step(-STEP)}
      >
        −
      </button>
      <label>
        $
        <input
          value={claim.dollars}
          size={Math.max(claim.dollars.length, 2)}
          inputMode="numeric"
          autoComplete="off"
          aria-label={label}
          onChange={(event) =>
            claim.setDollars(
              event.target.value.replace(/[^0-9]/g, "").slice(0, 6),
            )
          }
        />
      </label>
      <button
        type="button"
        className="sb-step"
        aria-label="Five dollars more"
        disabled={dollars >= max}
        onClick={() => step(STEP)}
      >
        +
      </button>
    </span>
  );
}

/**
 * The card as it closes a pull request, drawn from the same SVG the pull
 * request shows, with what the visitor typed.
 */
function PrCardPreview({ sponsor }: { sponsor: PrCardSponsor }) {
  return (
    <span
      className="sb-prcard"
      // Our own SVG, every text escaped by prCardSvg.
      dangerouslySetInnerHTML={{
        __html: prCardSvg({
          sponsors: [sponsor],
          // Light on the pull request drawn in GitHub's dark theme: the
          // card takes the colors opposite to the page, as on GitHub.
          theme: "light",
          links: {
            // A real sponsor's site goes through the click counter.
            site: !sponsor.site
              ? null
              : sponsor.publicId
                ? `/out/${sponsor.publicId}`
                : `https://${sponsor.site}`,
            yarrow: "/",
          },
        }),
      }}
    />
  );
}

/** The card being typed, as the pull request will show it. */
function typedSponsor(card: CardValue): PrCardSponsor {
  return {
    name: card.name.trim() || "Your company",
    description: card.description.trim() || null,
    site: shortSite(websiteAddress(card.website) || null),
    logo: card.logo,
  };
}

/** A dialog over the page: Escape, the close button or the backdrop close it. */
function Modal({
  open,
  onClose,
  labelledBy,
  wide = false,
  children,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`sb-dialog ${wide ? "wide" : ""}`}
      aria-labelledby={labelledBy}
      onClose={onClose}
      onClick={(event) => {
        // A click on the backdrop closes it.
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
    >
      {children}
    </dialog>
  );
}

/** The dialog's title and its close button. */
function ModalHead({
  id,
  title,
  onClose,
}: {
  id: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="sb-dialog-head">
      <h2 id={id}>{title}</h2>
      <button
        type="button"
        className="sb-dialog-close"
        aria-label="Close"
        onClick={onClose}
      >
        <X size={18} />
      </button>
    </div>
  );
}

/**
 * A pull request, sketched: its state and title, then the bot's message,
 * its text as gray lines and the real card closing it. Enough of a pull
 * request to read as one, without a host's page around it.
 */
function PrSketch({ sponsor }: { sponsor: PrCardSponsor }) {
  return (
    <figure
      className="pr-sketch"
      aria-label={`A pull request ending with the card of ${sponsor.name ?? "an anonymous sponsor"}`}
    >
      <div className="pr-sketch-head">
        <span className="pr-sketch-state">
          <GitMerge size={13} /> Merged
        </span>
        <span className="pr-sketch-title">
          Keep the stroke width when exporting to SVG
        </span>
      </div>
      <div className="pr-sketch-message">
        <div className="pr-sketch-author">
          <span className="pr-sketch-avatar" aria-hidden="true" />
          <b>yarrow-run</b>
          <span className="pr-sketch-bot">bot</span>
          <span className="pr-sketch-opened">opened this pull request</span>
        </div>
        <div className="pr-sketch-body">
          <div className="pr-sketch-text" aria-hidden="true">
            <i style={{ width: "72%" }} />
            <i style={{ width: "88%" }} />
            <i style={{ width: "46%" }} />
          </div>
          <PrCardPreview sponsor={sponsor} />
        </div>
      </div>
    </figure>
  );
}

/**
 * The payment, over the page: the card as it will show, the amount, the
 * fees and the compute it buys, the two boxes the law and the Terms ask
 * for, and Pay, which opens Stripe Checkout (where the card, the billing
 * address and the VAT are taken).
 */
function ClaimDialog({
  claim,
  open,
  onClose,
}: {
  claim: Claim;
  open: boolean;
  onClose: () => void;
}) {
  const checkout = useServerFn(startCheckoutFn);
  const [terms, setTerms] = useState(false);
  const [waiver, setWaiver] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const { card, valid, cents, fees } = claim;
  // Back from Stripe: the browser may restore the page as it was left.
  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  async function pay() {
    setError("");
    if (!valid)
      return setError("Choose a whole-dollar amount from $10 to $1,000.");
    const result = claim.profileOf(card);
    if (!result.profile) return setError(result.error);
    if (!terms || !waiver) return setError("Tick both boxes to continue.");
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

  const ready = valid && terms && waiver && !pending;
  return (
    <Modal open={open} onClose={onClose} labelledBy="sb-dialog-title" wide>
      <div className="sb-dialog-body">
        <ModalHead
          id="sb-dialog-title"
          title={
            claim.prs
              ? `Get your company name on ≈${claim.prs} ${claim.prs === 1 ? "pull request" : "pull requests"}`
              : claim.label
          }
          onClose={onClose}
        />
        <div className="sb-dialog-preview">
          <PrSketch sponsor={typedSponsor(card)} />
        </div>
        <dl className="sb-dialog-lines">
          <div>
            <dt>Amount</dt>
            <dd>
              <AmountField claim={claim} label="Amount in dollars" />
            </dd>
          </div>
          <div>
            <dt>Fees</dt>
            <dd>
              {fees ? `≈ ${money(fees.feeCents + fees.marginCents)}` : "–"}
            </dd>
          </div>
          <div className="total">
            <dt>Compute</dt>
            <dd>{fees ? `≈ ${money(fees.creditCents)}` : "–"}</dd>
          </div>
        </dl>
        <div className="sb-dialog-checks">
          <label className="sb-check">
            <input
              type="checkbox"
              checked={terms}
              onChange={(event) => setTerms(event.target.checked)}
            />
            <span>
              I have read and agree to the{" "}
              <a href="/terms" target="_blank" className="sb-terms">
                Terms of Service
              </a>{" "}
              of yarrow.run
            </span>
          </label>
          <label className="sb-check">
            <input
              type="checkbox"
              checked={waiver}
              onChange={(event) => setWaiver(event.target.checked)}
            />
            <span>
              Compute starts right away: I give up my 14-day withdrawal right
            </span>
          </label>
        </div>
        <button
          type="button"
          className="sb-claim-go sb-dialog-pay"
          onClick={() => void pay()}
          aria-disabled={!ready}
        >
          {valid ? `Pay ${money(cents, false)}` : claim.label}
          {pending ? <Spinner /> : <ArrowRight size={14} strokeWidth={2.4} />}
        </button>
        {error && (
          <p className="sb-error" role="alert">
            {error}
          </p>
        )}
        <small className="sb-dialog-note">
          <LockKeyhole size={12} /> Paid on Stripe · VAT included where it
          applies
        </small>
      </div>
    </Modal>
  );
}
