import type { ReactNode } from "react";
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import geistSans from "@fontsource-variable/geist/index.css?url";
import geistMono from "@fontsource-variable/geist-mono/index.css?url";
import appCss from "@/styles.css?url";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { getViewerFn } from "@/functions/viewer.functions";

export const Route = createRootRoute({
  loader: () => getViewerFn(),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Agent Commons — Fund the compute. Ship the PR." },
      {
        name: "description",
        content:
          "Sponsors fund AI compute, builders get their tickets shipped. Every PR implemented by Claude, reviewed by OpenAI, and signed by its sponsors.",
      },
    ],
    links: [
      { rel: "stylesheet", href: geistSans },
      { rel: "stylesheet", href: geistMono },
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
});

function RootComponent() {
  const viewer = Route.useLoaderData();
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <SiteHeader signedIn={Boolean(viewer)} />
      <Outlet />
      <SiteFooter />
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
