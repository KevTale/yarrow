import { createFileRoute } from "@tanstack/react-router";
import { company, LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/privacy")({
  head: () => ({ meta: [{ title: "Privacy · Yarrow" }] }),
  component: Privacy,
});

function Privacy() {
  return (
    <LegalPage title="Privacy" updated="November 5, 2026">
      <p>
        {company.name}, {company.address}, publishes Yarrow and is the data
        controller. Contact:{" "}
        <a href={`mailto:${company.email}`}>{company.email}</a>.
      </p>

      <h2>What we collect, and why</h2>
      <ul>
        <li>
          <b>Account:</b> your GitHub username, name and avatar, or your email.
          To sign you in and run the service (contract).
        </li>
        <li>
          <b>Projects and tickets:</b> repository names, the tickets you write
          or bring from GitHub, Jira, Linear or Trello, runs and their results,
          and pull request links. Access to Jira, Linear and Trello is stored
          encrypted. For projects with secrets, we keep only references to your
          provider’s vault, never the values (contract).
        </li>
        <li>
          <b>Conversations:</b> what you type or say to Yarrow’s agents, while
          writing a ticket or reviewing one, kept as text with the ticket
          (contract).
        </li>
        <li>
          <b>Voice:</b> during a call, your voice is sent to ElevenLabs, which
          turns it into text and speaks the agent’s answers. We do not keep
          recordings of your voice; ElevenLabs may keep call audio and
          transcripts under its own retention rules (contract).
        </li>
        <li>
          <b>Code and demos:</b> your code is read in isolated containers during
          a run or a call, and we keep no copy of your repository. We keep what
          the run produced: the demo, which can show your app and code, the
          summary of the change and the agents’ notes (contract).
        </li>
        <li>
          <b>Security:</b> technical logs kept briefly to protect the service
          against abuse (legitimate interest).
        </li>
      </ul>

      <h2>Who processes it</h2>
      <p>
        Cloudflare (hosting, containers and demo storage), Supabase (database
        and sign-in, servers in Ireland), GitHub (repositories and sign-in),
        Atlassian (Jira and Trello), Linear, Resend (emails), Meta, Anthropic
        and OpenAI (the AI models, through their commercial APIs) and ElevenLabs
        (voice). Some are based outside the EU; transfers rely on the EU-US Data
        Privacy Framework or the European Commission’s standard contractual
        clauses. We do not sell your data.
      </p>

      <h2>Cookies</h2>
      <p>
        Only the cookies needed to keep you signed in and to finish a sign-in or
        a connection to GitHub, Jira, Linear or Trello. No analytics, no
        advertising.
      </p>

      <h2>How long</h2>
      <p>
        Account data is kept while your account exists. Conversations and demos
        stay with their ticket until you delete the project or your account. Ask
        us to delete any of it at any time.
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
