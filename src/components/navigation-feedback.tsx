import { useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * Signed in: the dashboard loads in the background once the page is idle,
 * so opening it shows everything at once (it then refreshes itself).
 */
export function WarmDashboard({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!signedIn || router.state.location.pathname === "/dashboard") return;
    const warm = () =>
      void router
        .preloadRoute({ to: "/dashboard", search: {} })
        .catch(() => {});
    if ("requestIdleCallback" in window) {
      const handle = window.requestIdleCallback(warm, { timeout: 4_000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = setTimeout(warm, 1_500);
    return () => clearTimeout(timer);
  }, [signedIn, router]);
  return null;
}

/** A spinner sized to the text around it. */
export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}

/**
 * A thin bar at the top of the page while the router loads the next page.
 * It only appears past 120 ms, so fast navigations stay quiet.
 */
export function NavProgress() {
  const loading = useRouterState({ select: (state) => state.isLoading });
  const [phase, setPhase] = useState<"idle" | "on" | "done">("idle");

  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => setPhase("on"), 120);
      return () => clearTimeout(timer);
    }
    const finish = setTimeout(
      () => setPhase((current) => (current === "on" ? "done" : "idle")),
      0,
    );
    const hide = setTimeout(() => setPhase("idle"), 400);
    return () => {
      clearTimeout(finish);
      clearTimeout(hide);
    };
  }, [loading]);

  return <div className={`nav-progress ${phase}`} aria-hidden="true" />;
}

/**
 * Plain links that load a whole page (sign-in, GitHub, Stripe) get a
 * loading state as soon as they are clicked. Router links are skipped:
 * they prevent the default, and the progress bar covers them.
 */
export function PendingLinks() {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target && link.target !== "_self") return;
      if (link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      const samePage =
        url.origin === window.location.origin &&
        url.pathname === window.location.pathname &&
        url.search === window.location.search;
      if (samePage || url.protocol === "mailto:") return;
      link.dataset.loading = "";
    };
    // Coming back with the back button restores the page as it was left.
    const onShow = () =>
      document
        .querySelectorAll<HTMLElement>("[data-loading]")
        .forEach((element) => delete element.dataset.loading);
    window.addEventListener("click", onClick);
    window.addEventListener("pageshow", onShow);
    return () => {
      window.removeEventListener("click", onClick);
      window.removeEventListener("pageshow", onShow);
    };
  }, []);
  return null;
}
