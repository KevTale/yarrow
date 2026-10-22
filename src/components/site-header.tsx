"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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

export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const links = [
    { href: "/work", label: "Work" },
    { href: "/leaderboard", label: "Leaderboard" },
    { href: "/projects/new", label: "Add a project" },
    { href: "/dashboard", label: "My activity" },
  ];
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link
          href="/"
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
              key={link.href}
              href={link.href}
              aria-current={path.startsWith(link.href) ? "page" : undefined}
              onClick={() => setOpen(false)}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          <Link href="/sign-in" className="sign-in">
            Sign in
          </Link>
          <Link href="/fund" className="button button-primary button-small">
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
