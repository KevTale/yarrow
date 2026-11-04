import { createFileRoute } from "@tanstack/react-router";
import { company, LegalPage } from "@/components/legal-page";

export const Route = createFileRoute("/legal")({
  head: () => ({ meta: [{ title: "Legal notice · Yarrow" }] }),
  component: Legal,
});

function Legal() {
  return (
    <LegalPage title="Legal notice" updated="November 5, 2026">
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
        Publication director: {company.director}, manager of {company.name}.
      </p>

      <h2>Hosting</h2>
      <p>
        Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, United
        States, +1 888 993 5273 (cloudflare.com).
      </p>
      <p>
        Database: Supabase Pte. Ltd., Singapore (supabase.com), servers in
        Ireland (EU).
      </p>

      <h2>Intellectual property</h2>
      <p>
        The Yarrow name, logo and website are the property of {company.name}.
        Code, tickets and pull requests belong to their owners; see the{" "}
        <a href="/terms">Terms</a>.
      </p>
    </LegalPage>
  );
}
