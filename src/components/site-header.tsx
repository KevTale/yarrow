import { Link, useNavigate } from "@tanstack/react-router";
import { LayoutDashboard, LogIn, UserRound } from "lucide-react";
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
  const waiting = useReviewCount(Boolean(viewer && !viewer.guest), toReview);
  const name =
    viewer?.githubLogin ?? viewer?.name ?? viewer?.email ?? "Account";
  return (
    <header className="site-header">
      <div className="container header-inner">
        <div className="header-start">
          <Link to="/" aria-label="Yarrow home" className="header-brand">
            <Brand />
          </Link>
          <nav className="header-nav" aria-label="Site">
            {/* The sponsors' way in: the hero speaks to builders. */}
            <Link to="/" hash="sponsors" activeOptions={{ includeHash: true }}>
              Sponsors
            </Link>
            <Link to="/changelog">Changelog</Link>
          </nav>
        </div>
        <div className="header-actions">
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
              badge={waiting}
              items={[
                {
                  label: "Dashboard",
                  icon: <LayoutDashboard size={16} strokeWidth={1.75} />,
                  badge: waiting,
                  onSelect: () => void navigate({ to: "/dashboard" }),
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
            <Link to="/sign-in" className="sign-in">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
