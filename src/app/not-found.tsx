import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="container not-found">
      <span className="eyebrow">404 / NOT IN THE LEDGER</span>
      <h1 style={{ marginTop: 18 }}>This page took a different path.</h1>
      <p>Explore a work unit or head back to the commons.</p>
      <Link href="/" className="button button-primary">
        Back to the commons →
      </Link>
    </main>
  );
}
