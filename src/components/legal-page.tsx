import type { ReactNode } from "react";

/** Shared layout for the legal notice, the terms and the privacy policy. */
export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <main id="main" className="container legal">
      <h1>{title}</h1>
      <p className="legal-updated mono">Last updated {updated}</p>
      {children}
    </main>
  );
}

export const company = {
  name: "TOTEM",
  form: "EURL (single-member limited liability company) with a share capital of €1,000",
  siren: "881 263 503",
  registry: "RCS Nanterre 881 263 503",
  vat: "FR37881263503",
  address: "1 avenue Galois, 92340 Bourg-la-Reine, France",
  email: "contact@yarrow.run",
};
