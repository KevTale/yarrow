import { createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { BuilderView } from "@/components/dashboard/builder";
import { ConnectNotice } from "@/components/dashboard/connect-notice";
import { SignInPrompt } from "@/components/email-sign-in";
import { NotConfigured } from "@/components/ui";
import { getBuilderFn } from "@/functions/builder.functions";
import { settleConnectFn } from "@/functions/connect.functions";

export const Route = createFileRoute("/dashboard")({
  validateSearch: z.object({
    project: z.uuid().optional(),
    /** Back from connecting Jira from this project: link the pasted ticket. */
    from: z.enum(["jira"]).optional().catch(undefined),
    /** Set by /connect/done: GitHub's webhook may not have landed yet. */
    installation: z.number().int().positive().optional().catch(undefined),
    /** Set by /connect/done: an organization's admins were asked instead. */
    requested: z.boolean().optional().catch(undefined),
  }),
  // Switching projects stays on the page: the builder view keeps every
  // project's copy and loads them in the background (see BuilderView).
  loader: async ({ location, preload }) => {
    // A ticket pasted on the landing is queued as soon as its repo is
    // connected. Preloading (from any page, signed in) leaves that alone.
    const search = location.search as { project?: string; from?: string };
    const connect = preload
      ? { queued: null, waiting: null, issue: null, jira: null }
      : await settleConnectFn({
          data: { projectId: search.from ? search.project : undefined },
        });
    const projectId = search.project ?? connect.queued?.projectId;
    const builder = await getBuilderFn({ data: { projectId, issues: true } });
    if (builder.status === "ok" && !builder.project && builder.importable)
      throw redirect({ to: "/start" });
    return { connect, builder };
  },
  // Coming back soon after does not reload everything; the view refreshes
  // itself (realtime and polling).
  staleTime: 30_000,
  head: () => ({ meta: [{ title: "Dashboard · Yarrow" }] }),
  component: DashboardPage,
});

/** GitHub's install webhook usually lands within seconds. */
const CONNECT_POLLS = 20;
/** After an install: up to 30 s for the first projects to appear. */
const INSTALL_POLLS = 10;
/** After an install, with projects there: the pasted repository is late. */
const MISSING_POLLS = 3;

function DashboardPage() {
  const { connect, builder } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const router = useRouter();
  const [polls, setPolls] = useState(0);
  const [afterInstall] = useState(search.installation !== undefined);
  const [requested] = useState(search.requested === true);
  const [closed, setClosed] = useState(false);
  const projectCount = builder.status === "ok" ? builder.projects.length : 0;
  const [startCount] = useState(projectCount);
  // New repositories showed up, or the install only changed existing ones.
  const installed =
    projectCount > startCount || (projectCount > 0 && polls >= 2);
  const installing =
    search.installation !== undefined && polls < INSTALL_POLLS && !installed;
  const pending = !requested && polls < CONNECT_POLLS ? connect.waiting : null;
  // The pasted repository did not come: not picked on GitHub, or not the
  // visitor's to install. Polling goes on, in case it was only late.
  const missing =
    !requested &&
    connect.waiting !== null &&
    (polls >= CONNECT_POLLS ||
      (afterInstall && projectCount > 0 && polls >= MISSING_POLLS));
  const polling = pending ?? (installing ? "GitHub" : null);
  const waiting = missing ? null : polling;
  const notice = (missing || requested) && !closed;

  useEffect(() => {
    if (!polling) return;
    const timer = setTimeout(async () => {
      await router.invalidate();
      setPolls((count) => count + 1);
    }, 3_000);
    return () => clearTimeout(timer);
  }, [polling, polls, router]);

  // Read once: a refresh does not tell of the request again.
  useEffect(() => {
    if (search.requested)
      navigate({
        search: (current) => ({ ...current, requested: undefined }),
        replace: true,
      });
  }, [search.requested, navigate]);

  // Done waiting: a refresh should not wait again.
  useEffect(() => {
    if (search.installation !== undefined && !installing)
      navigate({
        search: (current) => ({ ...current, installation: undefined }),
        replace: true,
      });
  }, [search.installation, installing, navigate]);

  // Back from Jira: linked once, so a refresh does not link again.
  useEffect(() => {
    if (search.from)
      navigate({
        search: (current) => ({ ...current, from: undefined }),
        replace: true,
      });
  }, [search.from, navigate]);

  if (builder.status === "signed_out")
    return <SignInPrompt next="/dashboard" />;
  if (builder.status !== "ok")
    return (
      <main id="main" className="container page-main">
        <NotConfigured />
      </main>
    );

  return (
    <main id="main" className="container dashboard">
      <h1 className="sr-only">Tickets</h1>
      {notice && (
        <ConnectNotice
          repository={connect.waiting}
          issue={connect.issue}
          requested={requested}
          onClose={() => setClosed(true)}
        />
      )}
      <BuilderView
        data={builder}
        highlight={connect.queued?.key ?? null}
        jira={connect.jira}
        waiting={waiting}
        projectId={search.project ?? connect.queued?.projectId}
      />
    </main>
  );
}
