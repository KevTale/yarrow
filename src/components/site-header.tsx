import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, LogIn, ScrollText, UserRound } from "lucide-react";
import { UserMenu } from "./arc/user-menu/user-menu";
import { logoOnDark } from "./brand-svg";
import { useReviewCount } from "./review-count";

/** Inline, so the flower can turn on hover. */
export function Brand() {
  return (
    <span
      className="brand"
      role="img"
      aria-label="Yarrow"
      dangerouslySetInnerHTML={{ __html: logoOnDark }}
    />
  );
}

type HeaderViewer = {
  name: string | null;
  githubLogin: string | null;
  avatarUrl: string | null;
  email?: string | null;
  /** Paid from this browser without an account. */
  guest?: boolean;
} | null;

export function SiteHeader({
  viewer,
  toReview,
}: {
  viewer: HeaderViewer;
  /** Pull requests waiting for review, as the page was served. */
  toReview: number;
}) {
  const navigate = useNavigate();
  const member = Boolean(viewer && !viewer.guest);
  const waiting = useReviewCount(member, toReview);
  const location = useLocation();
  const tab =
    location.pathname === "/dashboard"
      ? (location.search as { tab?: string }).tab
      : undefined;
  const name =
    viewer?.githubLogin ?? viewer?.name ?? viewer?.email ?? "Account";
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link
          to={member ? "/dashboard" : "/"}
          aria-label="Yarrow home"
          className="header-brand"
        >
          <Brand />
        </Link>
        <div className="header-actions">
          {member ? (
            // Signed in: the two places one works in, side by side.
            <nav className="header-nav" aria-label="Dashboard">
              <Link
                to="/dashboard"
                search={{ tab: "builder" }}
                data-status={tab === "builder" ? "active" : undefined}
                aria-current={tab === "builder" ? "page" : undefined}
                activeOptions={{ exact: true, includeSearch: true }}
              >
                Tickets
                {waiting > 0 && (
                  <span
                    className="header-count"
                    aria-label={`${waiting} to review`}
                  >
                    {waiting > 99 ? "99+" : waiting}
                  </span>
                )}
              </Link>
              <Link
                to="/dashboard"
                search={{ tab: "sponsor" }}
                data-status={tab === "sponsor" ? "active" : undefined}
                aria-current={tab === "sponsor" ? "page" : undefined}
                activeOptions={{ exact: true, includeSearch: true }}
              >
                Sponsoring
              </Link>
            </nav>
          ) : (
            <nav className="header-nav header-site" aria-label="Site">
              {/* The sponsors' way in: the page speaks to builders. */}
              <Link to="/sponsors">Sponsors</Link>
              <Link to="/changelog">Changelog</Link>
            </nav>
          )}
          {viewer ? (
            // uiarc's user menu: a panel from the avatar, a bottom sheet on
            // phones.
            <UserMenu
              user={{
                name,
                email: viewer.email ?? "",
                avatarSrc: viewer.avatarUrl ?? undefined,
              }}
              showTheme={false}
              items={[
                viewer.guest
                  ? {
                      label: "Dashboard",
                      icon: <LayoutDashboard size={16} strokeWidth={1.75} />,
                      onSelect: () => void navigate({ to: "/dashboard" }),
                    }
                  : {
                      label: "Changelog",
                      icon: <ScrollText size={16} strokeWidth={1.75} />,
                      onSelect: () => void navigate({ to: "/changelog" }),
                    },
                viewer.guest
                  ? {
                      label: "Sign in",
                      icon: <LogIn size={16} strokeWidth={1.75} />,
                      onSelect: () =>
                        window.location.assign("/sign-in?next=/dashboard"),
                    }
                  : {
                      label: "Account",
                      icon: <UserRound size={16} strokeWidth={1.75} />,
                      onSelect: () => void navigate({ to: "/account" }),
                    },
              ]}
              onSignOut={() => {
                window.location.assign("/auth/sign-out");
                // The item shows its progress until the page leaves.
                return new Promise(() => {});
              }}
            />
          ) : (
            <>
              <Link to="/sign-in" className="sign-in">
                Sign in
              </Link>
              <a className="lp-cta small" href="/connect/github?start">
                Get started
              </a>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
