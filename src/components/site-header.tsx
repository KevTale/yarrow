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
  const member = Boolean(viewer && !viewer.guest);
  const waiting = useReviewCount(member, toReview);
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
          {member && (
            <nav className="header-nav" aria-label="Dashboard">
              <Link to="/dashboard">
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
              items={
                viewer.guest
                  ? [
                      {
                        label: "Dashboard",
                        icon: <LayoutDashboard size={16} strokeWidth={1.75} />,
                        onSelect: () => void navigate({ to: "/dashboard" }),
                      },
                      {
                        label: "Sign in",
                        icon: <LogIn size={16} strokeWidth={1.75} />,
                        onSelect: () =>
                          window.location.assign("/sign-in?next=/dashboard"),
                      },
                    ]
                  : [
                      {
                        label: "Account",
                        icon: <UserRound size={16} strokeWidth={1.75} />,
                        onSelect: () => void navigate({ to: "/account" }),
                      },
                    ]
              }
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
