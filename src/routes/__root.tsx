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
  getGuestFn,
  getLiveConfigFn,
  getReviewCountFn,
  getSiteOriginFn,
  getViewerFn,
} from "@/functions/viewer.functions";
import { siteJsonLd } from "@/core/company";

const TITLE = "Yarrow · The best ticket harness for your team";
const DESCRIPTION =
  "Coding is solved. Writing the right ticket and reviewing what agents ship are not.";

export const Route = createRootRoute({
  loader: async () => {
    const [viewer, live, origin, toReview] = await Promise.all([
      getViewerFn(),
      getLiveConfigFn(),
      getSiteOriginFn(),
      getReviewCountFn(),
    ]);
    // Not signed in, but paid from this browser: recognized as a guest.
    return { viewer: viewer ?? (await getGuestFn()), live, origin, toReview };
  },
  // Who is signed in only changes through a full page load or an
  // invalidate (email link), so navigations reuse it.
  staleTime: Infinity,
  // The share card (Open Graph, Twitter): the title, the pitch and an
  // image drawn by `pnpm brand:assets`. Absolute links, as the crawlers ask.
  head: ({ loaderData }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      {
        "script:ld+json": siteJsonLd(
          loaderData?.origin || "https://yarrow.run",
        ),
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Yarrow" },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:url", content: `${loaderData?.origin ?? ""}/` },
      { property: "og:image", content: `${loaderData?.origin ?? ""}/og.png` },
      { property: "og:image:width", content: "1200" },
      { property: "og:image:height", content: "630" },
      {
        property: "og:image:alt",
        content: "Yarrow: The best ticket harness for your team",
      },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
      {
        name: "twitter:image",
        content: `${loaderData?.origin ?? ""}/og.png`,
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
  const { viewer, live, toReview } = Route.useLoaderData();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader viewer={viewer} toReview={toReview} />
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
