import { createFileRoute, Link } from "@tanstack/react-router";
import { Lock } from "lucide-react";
import { sponsorNames } from "@/core/attribution";
import { projectLogo } from "@/core/logos";
import { money } from "@/core/packs";
import { bareTitle, ticketIdentity } from "@/core/tickets";
import { getWorkFeedFn } from "@/functions/public.functions";
import { JiraIcon } from "@/components/brand-icons";
import {
  capitalize,
  duration,
  EmptyState,
  NotConfigured,
  PageHeading,
  RunStatus,
  timeAgo,
} from "@/components/ui";

export const Route = createFileRoute("/work")({
  loader: () => getWorkFeedFn(),
  head: () => ({ meta: [{ title: "Work · Yarrow" }] }),
  component: WorkPage,
});

function WorkPage() {
  const data = Route.useLoaderData();
  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="WORK"
        title="Every run, in the open."
        description="Implemented by Claude Opus, reviewed by GPT Astra, paid for by sponsors."
      />
      {!data.configured ? (
        <NotConfigured />
      ) : data.runs.length === 0 ? (
        <EmptyState title="No runs yet">
          Runs appear here as soon as a tagged ticket meets sponsor money.
        </EmptyState>
      ) : (
        <ol className="wl">
          {data.runs.map((run) => {
            const ticket = run.ticketKey
              ? ticketIdentity(run.source, run.ticketKey)
              : null;
            const logo = projectLogo(run.logoUrl, run.repository || null);
            const sponsors = sponsorNames(run.sponsors);
            return (
              <li key={run.runId}>
                <Link
                  to="/runs/$runId"
                  params={{ runId: run.runId }}
                  className="wl-row"
                >
                  <span className="wl-logo" aria-hidden="true">
                    {logo && <img src={logo} alt="" width={28} height={28} />}
                  </span>
                  <span className="wl-main">
                    <span className="wl-project">
                      {run.repository || run.projectName}
                      {ticket && (
                        <span className="wl-ref">
                          {run.source === "jira" && <JiraIcon size={11} />}
                          {ticket.ref}
                        </span>
                      )}
                    </span>
                    <strong className={ticket ? "" : "wl-hidden"}>
                      {ticket ? (
                        bareTitle(run.ticketTitle, ticket.key)
                      ) : (
                        <>
                          <Lock size={12} aria-hidden="true" /> A private
                          ticket
                        </>
                      )}
                    </strong>
                    <span className="wl-sub">
                      {sponsors ? `Sponsored by ${sponsors} · ` : ""}
                      {timeAgo(run.createdAt)}
                    </span>
                  </span>
                  <span className="wl-num">{money(run.costCents)}</span>
                  <span className="wl-num wl-time">
                    {run.finishedAt
                      ? duration(run.createdAt, run.finishedAt)
                      : ""}
                  </span>
                  <span className="wl-status">
                    <RunStatus run={run} />
                    {run.abstentionReason && (
                      <span className="wl-reason">
                        {capitalize(run.abstentionReason)}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      )}
    </main>
  );
}
