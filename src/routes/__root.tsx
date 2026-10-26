import type { ReactNode } from "react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import geistSans from "@fontsource-variable/geist/index.css?url";
import geistMono from "@fontsource-variable/geist-mono/index.css?url";
import jost from "@fontsource/jost/500.css?url";
import appCss from "@/styles.css?url";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SessionFromLink } from "@/components/session-from-link";
import { LiveProvider } from "@/components/live";
import {
  NavProgress,
  PendingLinks,
  WarmDashboard,
} from "@/components/navigation-feedback";
import {
  getBalanceFn,
  getGuestFn,
  getLiveConfigFn,
  getViewerFn,
} from "@/functions/viewer.functions";

export const Route = createRootRoute({
  loader: async () => {
    const [viewer, live, balance] = await Promise.all([
      getViewerFn(),
      getLiveConfigFn(),
      getBalanceFn(),
    ]);
    // Not signed in, but paid from this browser: recognized as a guest.
    return { viewer: viewer ?? (await getGuestFn()), live, balance };
  },
  // Who is signed in only changes through a full page load or an
  // invalidate (email link), so navigations reuse it.
  staleTime: Infinity,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Yarrow · Frontier AI for free" },
      {
        name: "description",
        content:
          "Sponsors fund AI compute, builders get their tickets shipped. Every PR implemented by Claude, reviewed by OpenAI, and signed by its sponsors.",
      },
    ],
    links: [
      { rel: "stylesheet", href: geistSans },
      { rel: "stylesheet", href: geistMono },
      { rel: "stylesheet", href: jost },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
});

function RootComponent() {
  const { viewer, live, balance } = Route.useLoaderData();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader viewer={viewer} balance={balance} />
      <LiveProvider config={live}>
        <Outlet />
      </LiveProvider>
      <SiteFooter />
      <SessionFromLink />
      <NavProgress />
      <PendingLinks />
      <WarmDashboard signedIn={viewer !== null} />
    </>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
