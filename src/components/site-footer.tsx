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
          <Link to="/work">Explore work</Link>
          <Link to="/showcase">Projects</Link>
          <Link to="/projects/new">Add a project</Link>
        </nav>
        <span className="badge">MVP</span>
      </div>
      <div className="container footer-bottom">
        <span>Fund the compute. Ship the PR.</span>
        <span className="mono">
          Implemented by Claude · reviewed by OpenAI · platform API compute.
        </span>
      </div>
    </footer>
  );
}
