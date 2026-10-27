import { createFileRoute } from "@tanstack/react-router";
import { company, LegalPage, operatorStatement } from "@/components/legal-page";

export const Route = createFileRoute("/legal")({
  head: () => ({ meta: [{ title: "Legal notice · Yarrow" }] }),
  component: Legal,
});

function Legal() {
  return (
    <LegalPage title="Legal notice" updated="October 10, 2026">
      <h2>Publisher</h2>
      <p>{operatorStatement}</p>
      <p>
        Contact: <a href={`mailto:${company.email}`}>{company.email}</a>
      </p>
      <p>
        Publication director: Kevin Taleb Dehkordi, manager of {company.name}.
      </p>

      <h2>Hosting</h2>
      <p>
        Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, United
        States (cloudflare.com).
      </p>
      <p>Database: Supabase, Inc. (supabase.com), servers in Ireland (EU).</p>

      <h2>Intellectual property</h2>
      <p>
        The Yarrow name, logo and website are the property of {company.name}.
        Code, tickets and pull requests belong to their owners; see the{" "}
        <a href="/terms">Terms</a>.
      </p>
    </LegalPage>
  );
}
