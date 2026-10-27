import { Link } from "@tanstack/react-router";
import { operatorStatement } from "@/core/company";
import { Brand } from "./site-header";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <Link to="/">
          <Brand />
        </Link>
        <span className="badge">BETA</span>
      </div>
      <div className="container footer-bottom">
        <span>Frontier AI for free. {operatorStatement}</span>
        <nav aria-label="Legal" className="footer-legal">
          <Link to="/legal">Legal notice</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <span>© 2026 Yarrow</span>
        </nav>
      </div>
    </footer>
  );
}
