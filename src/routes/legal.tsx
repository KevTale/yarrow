import { createFileRoute } from "@tanstack/react-router";
import { company, LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/legal")({
  head: () => ({ meta: [{ title: "Legal notice · Yarrow" }] }),
  component: Legal,
});

function Legal() {
  return (
    <LegalPage title="Legal notice" updated="October 7, 2026">
      <h2>Publisher</h2>
      <p>
        Yarrow (yarrow.run) is published by {company.name}, {company.form},
        registered under {company.registry}, VAT number {company.vat}.
      </p>
      <p>
        Registered office: {company.address}
        <br />
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
