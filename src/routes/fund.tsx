import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, money, packs } from "@/core/packs";
import { estimateBreakdown } from "@/core/pricing";
import {
  SponsorCardRow,
  websiteAddress,
  type CardValue,
} from "@/components/sponsor-card";
import { Spinner } from "@/components/navigation-feedback";
import { PageHeading } from "@/components/ui";
import {
  getFundContextFn,
  startCheckoutFn,
} from "@/functions/sponsor.functions";

export const Route = createFileRoute("/fund")({
  validateSearch: z.object({
    amount: z.number().int().optional(),
    checkout: z.enum(["cancelled"]).optional(),
  }),
  loader: () => getFundContextFn(),
  head: () => ({ meta: [{ title: "Fund AI work · Yarrow" }] }),
  component: FundPage,
});

function FundPage() {
  const context = Route.useLoaderData();
  const search = Route.useSearch();
  const startCheckout = useServerFn(startCheckoutFn);
  const initial =
    search.amount && search.amount * 100 >= MIN_AMOUNT_CENTS
      ? search.amount
      : 25;
  const [dollars, setDollars] = useState<number>(initial);
  const saved = context.profile;
  const [card, setCard] = useState<CardValue>({
    anonymous: Boolean(saved) && saved?.publicName === null,
    name: saved?.publicName ?? context.githubLogin ?? "",
    tagline: saved?.tagline ?? "",
    description: saved?.description ?? "",
    website: saved?.websiteUrl ?? "",
    logo: saved?.logoUrl ?? null,
  });
  const { anonymous } = card;
  const setAnonymous = (value: boolean) =>
    setCard((current) => ({ ...current, anonymous: value }));
  const [waiver, setWaiver] = useState(false);
  const [pending, setPending] = useState(false);
  // Back from Stripe: the browser may restore the page as it was left.
  useEffect(() => {
    const reset = () => setPending(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  const [error, setError] = useState("");

  const cents = Math.round(dollars * 100);
  const valid =
    Number.isInteger(dollars) &&
    cents >= MIN_AMOUNT_CENTS &&
    cents <= MAX_AMOUNT_CENTS;
  const estimate = valid
    ? estimateBreakdown(cents, {
        vatRateBps: 0,
        founding: saved?.foundingSponsor ?? false,
      })
    : null;
  const rank = context.today.filter((paid) => paid >= cents).length + 1;
  const name = card.name.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!valid)
      return setError("Choose a whole-dollar amount from $10 to $1,000.");
    if (!anonymous && name.length < 2)
      return setError("Choose a public name, or stay anonymous.");
    const site = websiteAddress(card.website);
    if (!anonymous && site === null)
      return setError("That website address does not look right.");
    if (!waiver)
      return setError("Please confirm that compute starts immediately.");
    setPending(true);
    try {
      const { url } = await startCheckout({
        data: {
          amountCents: cents,
          withdrawalWaiver: true,
          profile: anonymous
            ? {
                publicName: null,
                tagline: null,
                description: null,
                websiteUrl: null,
                logo: null,
              }
            : {
                publicName: name,
                tagline: card.tagline,
                description: card.description,
                websiteUrl: site ?? "",
                logo: card.logo,
              },
        },
      });
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Checkout failed.");
      setPending(false);
    }
  }

  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="FUND AI WORK"
        title="Sponsor the builders."
        description="Your money pays for frontier AI on builders' tickets. Your name ships with every pull request it funds."
      />
      {search.checkout === "cancelled" && (
        <p className="feedback" role="status">
          Checkout cancelled. Nothing was charged.
        </p>
      )}
      <form onSubmit={submit} className="form-layout">
        <div className="form-main">
          <fieldset className="form-section">
            <legend className="eyebrow">01 / Choose an amount</legend>
            <div className="pack-options">
              {packs.map((pack) => (
                <label className="radio-card" key={pack.id}>
                  <input
                    type="radio"
                    name="pack"
                    checked={cents === pack.amountCents}
                    onChange={() => setDollars(pack.amountCents / 100)}
                  />
                  <span className="radio-card-content">
                    <span className="pack-name">{pack.name}</span>
                    <span className="pack-price mono">
                      {money(pack.amountCents, false)}
                    </span>
                    <span className="pack-description">{pack.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <label className="field" style={{ marginTop: 18 }}>
              Or any amount (whole dollars, $10 to $1,000)
              <input
                type="number"
                min={10}
                max={1000}
                step={1}
                value={dollars}
                onChange={(event) => setDollars(Number(event.target.value))}
              />
            </label>
          </fieldset>

          <fieldset className="form-section">
            <legend className="eyebrow">02 / Your place on the board</legend>
            <div className="fund-switch" role="radiogroup" aria-label="Name">
              <label>
                <input
                  type="radio"
                  name="visibility"
                  checked={!anonymous}
                  onChange={() => setAnonymous(false)}
                />
                <span>Show my name</span>
              </label>
              <label>
                <input
                  type="radio"
                  name="visibility"
                  checked={anonymous}
                  onChange={() => setAnonymous(true)}
                />
                <span>Stay anonymous</span>
              </label>
            </div>
            {/* The form is the card the boards will show. */}
            <div className="fund-card">
              <div className="board-head">
                <span>Today</span>
                <span className="board-total">
                  <small>your rank</small> {valid ? `#${rank}` : "–"}
                </span>
              </div>
              <SponsorCardRow
                value={card}
                onChange={(patch) =>
                  setCard((current) => ({ ...current, ...patch }))
                }
                rank={valid ? String(rank) : "–"}
                amount={valid ? money(cents, false) : "–"}
                clicks={0}
                pullRequests={0}
              />
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend className="eyebrow">03 / Before you pay</legend>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={waiver}
                onChange={(event) => setWaiver(event.target.checked)}
              />
              <span>
                I accept the{" "}
                <a href="/terms" className="text-link" target="_blank">
                  Terms
                </a>
                , ask for compute to start right away and give up my 14-day
                withdrawal right.
              </span>
            </label>
          </fieldset>
        </div>

        <aside aria-label="Order summary">
          <div className="summary-card">
            <div className="summary-top">
              <p className="eyebrow">YOUR SPONSORING</p>
              <p className="summary-price mono" aria-live="polite">
                {valid ? money(cents, false) : "—"}
                <span>.00</span>
              </p>
              <p className="small muted" style={{ marginTop: 7 }}>
                One-time · USD
              </p>
            </div>
            <div className="summary-content">
              {estimate && (
                <dl className="summary-lines">
                  <div>
                    <dt>Card fees</dt>
                    <dd>≈ −{money(estimate.feeCents)}</dd>
                  </div>
                  <div>
                    <dt>
                      Platform margin ({saved?.foundingSponsor ? "5" : "10"}%)
                    </dt>
                    <dd>−{money(estimate.marginCents)}</dd>
                  </div>
                  <div className="divider">
                    <dt>
                      <strong>Compute credit</strong>
                    </dt>
                    <dd>
                      <strong>≈ {money(estimate.creditCents)}</strong>
                    </dd>
                  </div>
                </dl>
              )}
              <p className="summary-vat">VAT included where it applies</p>
              {!context.paymentsReady ? (
                <p className="feedback feedback-error" role="status">
                  Payments are not open yet on this deployment.
                </p>
              ) : (
                <button
                  className="button button-primary button-full"
                  disabled={pending || !valid}
                >
                  {pending ? "Opening Stripe…" : `Continue to payment`}
                  {pending ? <Spinner /> : <ArrowRight size={16} />}
                </button>
              )}
              <p className="field-note row">
                <LockKeyhole size={12} /> Secure payment by Stripe
              </p>
              {error && (
                <div className="feedback feedback-error" role="alert">
                  {error}
                </div>
              )}
            </div>
          </div>
        </aside>
      </form>
    </main>
  );
}
