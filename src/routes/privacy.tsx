import { createFileRoute } from "@tanstack/react-router";
import { company, LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy · Yarrow" }] }),
  component: Privacy,
});

function Privacy() {
  return (
    <LegalPage title="Privacy" updated="October 10, 2026">
      <p>
        The company {company.name}, founded in {company.founded}, operates this
        site and is the data controller for Yarrow. Contact:{" "}
        <a href={`mailto:${company.email}`}>{company.email}</a>.
      </p>

      <h2>What we collect, and why</h2>
      <ul>
        <li>
          <b>Account:</b> your GitHub username, name and avatar, or your email.
          To sign you in and run the service (contract).
        </li>
        <li>
          <b>Sponsor profile:</b> the name, logo, description and website you
          choose to show publicly, and the number of clicks on your website link
          (not who clicked).
        </li>
        <li>
          <b>Payments:</b> amounts, VAT, status and Stripe references. Card
          details stay with Stripe. Kept 10 years, as French accounting law
          requires (legal obligation).
        </li>
        <li>
          <b>Projects:</b> repository names, the tickets you choose, run results
          and pull request links. Your code is read during a run in an isolated
          sandbox and is not stored by us afterwards.
        </li>
        <li>
          <b>Security:</b> technical logs kept briefly to protect the service
          against abuse (legitimate interest).
        </li>
      </ul>

      <h2>Who processes it</h2>
      <p>
        Cloudflare (hosting), Supabase (database and sign-in, servers in
        Ireland), Stripe (payments), GitHub (repositories), Resend (sign-in
        emails), and Anthropic and OpenAI (the AI models, through their
        commercial APIs). Some are based in the United States; transfers rely on
        the EU-US Data Privacy Framework or the European Commission’s standard
        contractual clauses. We do not sell your data.
      </p>

      <h2>Cookies</h2>
      <p>
        Only the cookies needed to keep you signed in and to finish a sign-in or
        a GitHub connection. No analytics, no advertising.
      </p>

      <h2>How long</h2>
      <p>
        Account data is kept while your account exists. Ask us to delete it at
        any time; payment records stay as long as the law requires.
      </p>

      <h2>Your rights</h2>
      <p>
        You can access, correct, delete or export your data, and object to or
        restrict its use, by writing to{" "}
        <a href={`mailto:${company.email}`}>{company.email}</a>. You may also
        complain to the CNIL (cnil.fr).
      </p>
    </LegalPage>
  );
}
