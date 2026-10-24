import { createFileRoute, Link } from "@tanstack/react-router";
import { money } from "@/core/packs";
import { getWorkFeedFn } from "@/functions/public.functions";
import {
  capitalize,
  EmptyState,
  NotConfigured,
  PageHeading,
  RunStatus,
  SponsorLine,
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
        description="Each ticket is implemented by Claude, reviewed by OpenAI, and paid by sponsors. Listed projects hide ticket details; hidden projects are not shown."
      />
      {!data.configured ? (
        <NotConfigured />
      ) : data.runs.length === 0 ? (
        <EmptyState title="No runs yet">
          Runs appear here as soon as a tagged ticket meets sponsor money.
        </EmptyState>
      ) : (
        <ol className="work-list">
          {data.runs.map((run) => (
            <li key={run.runId}>
              <Link
                to="/runs/$runId"
                params={{ runId: run.runId }}
                className="work-row"
              >
                <span className="work-row-title">
                  <strong>{run.ticketTitle}</strong>
                  <span className="muted small">
                    {run.projectName} · {capitalize(run.kind)} ·{" "}
                    {capitalize(run.source)} · {timeAgo(run.createdAt)}
                  </span>
                  <SponsorLine sponsors={run.sponsors} />
                </span>
                <span className="work-row-detail mono small">
                  {money(run.costCents)}
                  {run.abstentionReason && (
                    <span className="muted">
                      {" "}
                      · {capitalize(run.abstentionReason)}
                    </span>
                  )}
                </span>
                <RunStatus run={run} />
              </Link>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
