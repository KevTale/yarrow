import { Link, useRouterState } from "@tanstack/react-router";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { useState } from "react";

export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>
        Agent Commons<span className="brand-period">.</span>
      </span>
    </span>
  );
}

const links = [
  { to: "/work", label: "Work" },
  { to: "/showcase", label: "Projects" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/projects/new", label: "Add a project" },
  { to: "/dashboard", label: "My activity" },
] as const;

export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const path = useRouterState({ select: (state) => state.location.pathname });
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link
          to="/"
          aria-label="Agent Commons home"
          onClick={() => setOpen(false)}
        >
          <Brand />
        </Link>
        <nav
          aria-label="Primary"
          className={`main-nav ${open ? "is-open" : ""}`}
          id="primary-nav"
        >
          {links.map((link) => (
            <Link
              key={link.to}
              to={link.to}
              aria-current={path.startsWith(link.to) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          {signedIn ? (
            <a href="/auth/sign-out" className="sign-in">
              Sign out
            </a>
          ) : (
            <Link to="/sign-in" className="sign-in">
              Sign in
            </Link>
          )}
          <Link to="/fund" className="button button-primary button-small">
            Fund AI work <ArrowUpRight size={14} />
          </Link>
          <button
            className="icon-button mobile-menu"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="primary-nav"
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
    </header>
  );
}
