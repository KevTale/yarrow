import { createFileRoute } from "@tanstack/react-router";
import { company, LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms · Yarrow" }] }),
  component: Terms,
});

function Terms() {
  return (
    <LegalPage title="Terms" updated="October 10, 2026">
      <p>
        These terms govern the use of Yarrow (yarrow.run), operated by the
        company {company.name}, founded in {company.founded} (“we”). By using
        Yarrow you accept them. Yarrow is in beta.
      </p>

      <h2>1. The service</h2>
      <p>
        Builders connect repositories and choose tickets. For each ticket, AI
        models from Anthropic, Meta and OpenAI, used through their commercial
        APIs, write and review a draft pull request, or explain why they
        abstained. Sponsors pay for that compute, and their public name appears
        on the leaderboard and on the pull requests they fund.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You sign in with GitHub or with a link sent to your email. You keep your
        access private and are responsible for what happens under your account.
      </p>

      <h2>3. Builders</h2>
      <ul>
        <li>Yarrow is free for builders.</li>
        <li>
          You may only connect repositories and tickets you are allowed to share
          with us and with the AI providers. Connecting a repository requires
          installing our GitHub App on it.
        </li>
        <li>
          Choosing a ticket (by pasting it or tagging it with the{" "}
          <code>yarrow</code> label) authorizes us to work on it. Your code is
          processed in an isolated sandbox that is destroyed after each run.
        </li>
        <li>Only give us test or staging secrets, never production ones.</li>
        <li>
          Every pull request we open for you ends with the card of the sponsors
          whose credit paid for it: their name, logo, description and website,
          labelled “Sponsored by”. The card is how the work stays free for you:
          it is part of the service and cannot be removed. You accept it, with
          these terms, by ticking them before you connect GitHub. If the card is
          removed or hidden from a pull request, we may stop handling that
          project&apos;s tickets. We review sponsors&apos; cards; tell us if one
          looks wrong.
        </li>
        <li>
          Pull requests are drafts, provided as is. You review them before
          merging and remain responsible for what you merge. We claim no rights
          over your code or the pull requests made for you.
        </li>
        <li>
          Work depends on available sponsor credit. We do not guarantee that a
          ticket will be handled, nor when.
        </li>
      </ul>

      <h2>4. Sponsors</h2>
      <ul>
        <li>
          Sponsoring buys compute credit, for a one-time amount in US dollars
          from $10 to $1,000. Payment is handled by Stripe; we never see your
          card number.
        </li>
        <li>
          Prices include VAT where it applies. EU businesses with a valid VAT
          number are reverse-charged. An invoice is issued for every payment.
        </li>
        <li>
          From each payment we deduct card fees and our margin (7.5%, 5% for
          founding sponsors); the rest becomes compute credit, spent at cost on
          the tickets in the queue.
        </li>
        <li>
          Compute starts immediately. If you are a consumer in the EU, you ask
          for this and acknowledge that you lose your 14-day right of withdrawal
          once compute starts. Compute credit is not refundable as cash, except
          where the law requires otherwise.
        </li>
        <li>
          Your name, logo, description and website appear publicly on the
          leaderboard and on the pull requests you fund, unless you choose to
          stay anonymous. They must be accurate and lawful; we may remove them
          otherwise. Sponsors are ranked by the amount they paid, excluding VAT.
        </li>
        <li>
          If you pay without an account, we email you a sign-in link at the
          address you gave Stripe, so you can find your sponsoring.
        </li>
      </ul>

      <h2>5. Acceptable use</h2>
      <p>
        No illegal projects, malware, spam, attempts to harm others, or abuse of
        the platform or of the AI providers. We may decline tickets and suspend
        projects or accounts that break these terms.
      </p>

      <h2>6. Liability</h2>
      <p>
        Yarrow is provided as is, during a beta. To the extent the law allows,
        our liability is limited to the amounts you paid us in the twelve months
        before the claim. Nothing here limits the rights that consumer law gives
        you.
      </p>

      <h2>7. Changes</h2>
      <p>
        We may update these terms. The date at the top changes, and significant
        changes are announced on the site before they apply.
      </p>

      <h2>8. Law and disputes</h2>
      <p>
        These terms are governed by French law. Contact us first at{" "}
        <a href={`mailto:${company.email}`}>{company.email}</a>; we answer
        within 30 days. Consumers may also turn to a consumer mediator, and keep
        the right to go to the court of their place of residence.
      </p>
    </LegalPage>
  );
}
