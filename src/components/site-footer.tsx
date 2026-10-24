import { Link } from "@tanstack/react-router";
import { Brand } from "./site-header";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-main">
        <Link to="/">
          <Brand />
        </Link>
        <nav aria-label="Footer">
          <Link to="/leaderboard">Leaderboard</Link>
          <Link to="/shipped">Shipped</Link>
          <Link to="/projects/new">Add a project</Link>
        </nav>
        <span className="badge">MVP</span>
      </div>
      <div className="container footer-bottom">
        <span>Frontier AI for free.</span>
        <span className="mono">
          Implemented by Claude · reviewed by OpenAI · platform API compute.
        </span>
      </div>
    </footer>
  );
}
