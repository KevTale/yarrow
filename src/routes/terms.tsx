import { createFileRoute } from "@tanstack/react-router";
import { company, LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/terms")({
  head: () => ({ meta: [{ title: "Terms · Yarrow" }] }),
  component: Terms,
});

function Terms() {
  return (
    <LegalPage title="Terms" updated="November 5, 2026">
      <p>
        These terms govern the use of Yarrow (yarrow.run), a product of{" "}
        {company.name}, {company.form} (“we”). By using Yarrow you accept them.
        Yarrow is in beta.
      </p>

      <h2>1. The service</h2>
      <p>
        Yarrow takes a ticket from the idea to the pull request. You write the
        ticket with an agent, in writing or on a voice call, or bring it from
        GitHub Issues, Jira, Linear or Trello. Once you start it, AI models from
        Anthropic and OpenAI, used through their commercial APIs, implement and
        review the change in an isolated container. The outcome is a draft pull
        request with a narrated demo, or the reason they stopped. You can then
        ask the agent about the change, by text or voice, while it shows you the
        app running that branch on a live desktop.
      </p>

      <h2>2. Accounts</h2>
      <p>
        You sign in with GitHub or with a link sent to your email. You keep your
        access private and are responsible for what happens under your account.
      </p>

      <h2>3. Price</h2>
      <p>
        Yarrow is free during the beta: we pay for the compute. We may limit how
        many tickets an account runs, or end the free beta; significant changes
        are announced on the site before they apply. No payment is taken today.
      </p>

      <h2>4. Your repositories and tickets</h2>
      <ul>
        <li>
          You may only connect repositories and tickets you are allowed to share
          with us and with the AI and voice providers. Connecting a repository
          requires installing our GitHub App on it; connecting Jira, Linear or
          Trello gives us access to the boards you choose.
        </li>
        <li>
          Starting a ticket, from Yarrow or by giving it the <code>yarrow</code>{" "}
          label, authorizes us to work on it. Your code is processed in isolated
          containers that are discarded after use.
        </li>
        <li>Only give us test or staging secrets, never production ones.</li>
        <li>
          Pull requests are drafts, provided as is. You review them before
          merging and remain responsible for what you merge. They end with a
          short Yarrow footer linking back to the run. We claim no rights over
          your code, your tickets or the pull requests made for you.
        </li>
        <li>We do not guarantee that a ticket will be handled, nor when.</li>
      </ul>

      <h2>5. Conversations and voice</h2>
      <p>
        A call uses your microphone only while it is on, after your browser asks
        for it. What you say or type to Yarrow’s agents is sent to the AI and
        voice providers to answer you, and kept with the ticket so the
        conversation stays where you left it. Share only what the ticket needs.
      </p>

      <h2>6. Acceptable use</h2>
      <p>
        No illegal projects, malware, spam, attempts to harm others, or abuse of
        the platform or of the AI providers. We may decline tickets and suspend
        projects or accounts that break these terms.
      </p>

      <h2>7. Liability</h2>
      <p>
        Yarrow is provided as is, during a beta. To the extent the law allows,
        our liability is limited to the amounts you paid us in the twelve months
        before the claim. Nothing here limits the rights that consumer law gives
        you.
      </p>

      <h2>8. Changes</h2>
      <p>
        We may update these terms. The date at the top changes, and significant
        changes are announced on the site before they apply.
      </p>

      <h2>9. Law and disputes</h2>
      <p>
        These terms are governed by French law. Contact us first at{" "}
        <a href={`mailto:${company.email}`}>{company.email}</a>; we answer
        within 30 days. Consumers keep the right to go to the court of their
        place of residence.
      </p>
    </LegalPage>
  );
}
