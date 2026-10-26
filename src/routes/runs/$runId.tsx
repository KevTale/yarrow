import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, GitPullRequest } from "lucide-react";
import { sponsorNames } from "@/core/attribution";
import { money } from "@/core/packs";
import { modelDisplayName } from "@/core/pipeline";
import { getRunFn } from "@/functions/public.functions";
import { RunFeed } from "@/components/run-activity";
import {
  capitalize,
  RunStatus,
  timeAgo,
  VisibilityBadge,
} from "@/components/ui";

export const Route = createFileRoute("/runs/$runId")({
  loader: ({ params }) => getRunFn({ data: { runId: params.runId } }),
  head: ({ loaderData }) => ({
    meta: [{ title: `${loaderData?.ticketTitle ?? "Run"} · Yarrow` }],
  }),
  component: RunPage,
  notFoundComponent: () => (
    <main id="main" className="container page-main not-found">
      <h1>Run not found</h1>
      <p className="muted">It does not exist, or its project is private.</p>
      <Link to="/work" className="text-link">
        <ArrowLeft size={14} /> All work
      </Link>
    </main>
  ),
});

const eventLabel: Record<string, string> = {
  "run.started": "Run started, budget reserved",
  "run.reserved_more": "More sponsor money reserved",
  "run.finished": "Run finished",
  "run.failed": "Provider error",
};

function RunPage() {
  const run = Route.useLoaderData();
  const sponsors = sponsorNames(run.sponsors);
  return (
    <main id="main" className="container page-main">
      <nav className="breadcrumb small">
        <Link to="/work">
          <ArrowLeft size={13} /> Work
        </Link>
      </nav>
      <header className="detail-intro">
        <div className="row">
          <RunStatus run={run} />
          <VisibilityBadge visibility={run.visibility} />
          <span className="muted small">
            {capitalize(run.kind)} · {timeAgo(run.createdAt)}
          </span>
        </div>
        <h1 className="detail-title">{run.ticketTitle}</h1>
        <p className="muted">
          {run.projectName}
          {run.ticketUrl && (
            <>
              {" · "}
              <a
                className="text-link"
                href={run.ticketUrl}
                target="_blank"
                rel="noreferrer"
              >
                Ticket <ExternalLink size={12} />
              </a>
            </>
          )}
        </p>
      </header>

      <div className="detail-layout">
        <div className="stack">
          {run.pullRequestUrl && (
            <section className="outcome-panel">
              <GitPullRequest size={20} />
              <div>
                <strong>Draft pull request delivered</strong>
                <a
                  className="text-link"
                  href={run.pullRequestUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {run.pullRequestUrl.replace("https://github.com/", "")}{" "}
                  <ExternalLink size={12} />
                </a>
              </div>
            </section>
          )}
          <RunFeed runId={run.runId} />
          {run.instruction && (
            <section className="panel">
              <p className="eyebrow">CORRECTION REQUESTED</p>
              <p>{run.instruction}</p>
            </section>
          )}
          {run.summary && !run.abstentionReason && (
            <section className="panel">
              <p className="eyebrow">WHAT CHANGED</p>
              <p>{run.summary}</p>
              {run.evidence.length > 0 && (
                <ul className="summary-checks">
                  {run.evidence.map((line) => (
                    <li key={line} className="mono small">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {run.review && (
            <section className="panel">
              <p className="eyebrow">
                REVIEW BY {modelDisplayName(run.review.reviewer).toUpperCase()}
                {run.review.rounds > 1 ? " · AFTER ONE FIX ROUND" : ""}
              </p>
              <p>{run.review.summary}</p>
              {run.review.comments.length > 0 && (
                <ul className="stack">
                  {run.review.comments.map((comment, i) => (
                    <li key={i} className="small">
                      <strong>{capitalize(comment.severity)}</strong>
                      {comment.path && (
                        <span className="mono muted">
                          {" "}
                          {comment.path}
                          {comment.line ? `:${comment.line}` : ""}
                        </span>
                      )}{" "}
                      — {comment.body}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {run.artifacts.length > 0 && (
            <section className="panel evidence-panel">
              <p className="eyebrow">EVIDENCE</p>
              <div className="stack">
                {run.artifacts.map((artifact) =>
                  artifact.kind === "video" ? (
                    <figure key={artifact.key}>
                      <video
                        src={`/evidence/${artifact.key}`}
                        controls
                        width="100%"
                      />
                      <figcaption className="small muted">
                        {artifact.label}
                      </figcaption>
                    </figure>
                  ) : (
                    <figure key={artifact.key}>
                      <img
                        src={`/evidence/${artifact.key}`}
                        alt={artifact.label}
                        width="100%"
                      />
                      <figcaption className="small muted">
                        {artifact.label}
                      </figcaption>
                    </figure>
                  ),
                )}
              </div>
            </section>
          )}
        </div>

        <aside className="stack">
          <dl className="summary-card summary-lines">
            <div>
              <dt>Implemented by</dt>
              <dd>{modelDisplayName(run.implementer)}</dd>
            </div>
            <div>
              <dt>Reviewed by</dt>
              <dd>{modelDisplayName(run.reviewer)}</dd>
            </div>
            <div>
              <dt>Compute cost</dt>
              <dd className="mono">{money(run.costCents)}</dd>
            </div>
            {run.member && (
              <div>
                <dt>Reserved</dt>
                <dd className="mono">{money(run.reservedCents)}</dd>
              </div>
            )}
            <div className="divider">
              <dt>Sponsored by</dt>
              <dd>{sponsors ?? "—"}</dd>
            </div>
          </dl>
          {run.timeline.length > 0 && (
            <section className="panel">
              <p className="eyebrow">TIMELINE</p>
              <ol className="timeline small">
                {run.timeline.map((event, i) => (
                  <li key={i}>
                    <span>{eventLabel[event.type] ?? event.type}</span>
                    <span className="muted mono">
                      {" "}
                      {new Date(event.at).toLocaleString("en-US")}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </aside>
      </div>
    </main>
  );
}
