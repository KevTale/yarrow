import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Check, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { MAX_AMOUNT_CENTS, MIN_AMOUNT_CENTS, money, packs } from "@/core/packs";
import { estimateBreakdown } from "@/core/pricing";
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
  const [publicName, setPublicName] = useState(
    saved?.publicName ?? context.githubLogin ?? "",
  );
  const [anonymous, setAnonymous] = useState(
    Boolean(saved) && saved?.publicName === null,
  );
  const [tagline, setTagline] = useState(saved?.tagline ?? "");
  const [description, setDescription] = useState(saved?.description ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(saved?.websiteUrl ?? "");
  const [euConsumer, setEuConsumer] = useState(false);
  const [waiver, setWaiver] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const cents = Math.round(dollars * 100);
  const valid =
    Number.isInteger(dollars) &&
    cents >= MIN_AMOUNT_CENTS &&
    cents <= MAX_AMOUNT_CENTS;
  const estimate = valid
    ? estimateBreakdown(cents, {
        vatRateBps: euConsumer ? 2000 : 0,
        founding: saved?.foundingSponsor ?? false,
      })
    : null;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!valid)
      return setError("Choose a whole-dollar amount from $10 to $1,000.");
    if (!anonymous && publicName.trim().length < 2)
      return setError("Choose a public name, or stay anonymous.");
    const site = websiteUrl.trim();
    if (!anonymous && site && !site.startsWith("https://"))
      return setError("Use a website address starting with https://");
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
              }
            : {
                publicName: publicName.trim(),
                tagline,
                description,
                websiteUrl: site,
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
        description="Your money becomes API compute. Claude implements, OpenAI reviews, and your name is on every PR it funds."
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
            <div className="choice-list">
              <label className="choice-row">
                <input
                  type="radio"
                  name="visibility"
                  checked={!anonymous}
                  onChange={() => setAnonymous(false)}
                />
                <span>
                  <strong>Show my name</strong>
                  <small>On the leaderboard and on every PR you fund.</small>
                </span>
              </label>
              {!anonymous && (
                <div className="sponsor-profile-fields">
                  <label className="field">
                    Public name
                    <input
                      value={publicName}
                      maxLength={60}
                      onChange={(event) => setPublicName(event.target.value)}
                      placeholder="Your name or your company"
                    />
                  </label>
                  <label className="field">
                    <span>
                      Tagline <span className="muted">· optional</span>
                    </span>
                    <input
                      value={tagline}
                      maxLength={80}
                      onChange={(event) => setTagline(event.target.value)}
                      placeholder="Payments for indie hackers"
                    />
                  </label>
                  <label className="field">
                    <span>
                      Website <span className="muted">· optional</span>
                    </span>
                    <input
                      type="url"
                      value={websiteUrl}
                      maxLength={300}
                      onChange={(event) => setWebsiteUrl(event.target.value)}
                      placeholder="https://"
                    />
                  </label>
                  <label className="field">
                    <span>
                      Description <span className="muted">· optional</span>
                    </span>
                    <textarea
                      value={description}
                      maxLength={280}
                      onChange={(event) => setDescription(event.target.value)}
                    />
                  </label>
                </div>
              )}
              <label className="choice-row">
                <input
                  type="radio"
                  name="visibility"
                  checked={anonymous}
                  onChange={() => setAnonymous(true)}
                />
                <span>
                  <strong>Stay anonymous</strong>
                  <small>
                    The work still happens. PRs say “an anonymous sponsor”.
                  </small>
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset className="form-section">
            <legend className="eyebrow">03 / Before you pay</legend>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={euConsumer}
                onChange={(event) => setEuConsumer(event.target.checked)}
              />
              <span>
                Show the estimate as an EU consumer (prices include VAT;
                businesses with a VAT number are reverse-charged)
              </span>
            </label>
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
                , ask for compute to start immediately and acknowledge that I
                lose my 14-day withdrawal right once it starts. Compute credit
                is not refundable as cash.
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
                  {estimate.taxCents > 0 && (
                    <div>
                      <dt>VAT (20%, estimate)</dt>
                      <dd>−{money(estimate.taxCents)}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Card fees (estimate)</dt>
                    <dd>−{money(estimate.feeCents)}</dd>
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
                  <ArrowRight size={16} />
                </button>
              )}
              <p className="field-note row">
                <LockKeyhole size={12} /> Secure payment by Stripe. The real fee
                and VAT are applied when the payment settles.
              </p>
              {error && (
                <div className="feedback feedback-error" role="alert">
                  {error}
                </div>
              )}
              <ul className="summary-checks">
                <li>
                  <Check size={13} /> Reserved before each run, debited at cost
                </li>
                <li>
                  <Check size={13} /> Ranked by money paid
                </li>
                <li>
                  <Check size={13} /> A PR or a documented reason, every time
                </li>
              </ul>
            </div>
          </div>
        </aside>
      </form>
    </main>
  );
}
