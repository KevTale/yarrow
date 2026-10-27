import type { ReactNode } from "react";

export { company, operatorStatement } from "@/core/company";

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
