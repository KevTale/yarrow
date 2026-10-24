import { Link } from "@tanstack/react-router";
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
        <span>Frontier AI for free.</span>
        <span>© 2026 Yarrow</span>
      </div>
    </footer>
  );
}
