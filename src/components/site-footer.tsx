import Link from "next/link";
import { Brand } from "./site-header";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <Link href="/">
          <Brand />
        </Link>
        <nav aria-label="Footer">
          <Link href="/work">Explore work</Link>
          <Link href="/dashboard#ledger">Ledger</Link>
          <Link href="/projects/new">Add a project</Link>
        </nav>
        <span className="badge">MVP preview</span>
      </div>
      <div className="container footer-bottom">
        <span>Built for the work worth doing.</span>
        <span className="mono">
          Platform API compute. No personal subscriptions.
        </span>
      </div>
    </footer>
  );
}
