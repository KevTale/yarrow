import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  CircleCheck,
  ExternalLink,
  GitPullRequest,
  Lock,
} from "lucide-react";
import { sponsorNames } from "@/core/attribution";
import { projectLogo } from "@/core/logos";
import { money } from "@/core/packs";
import { modelDisplayName } from "@/core/pipeline";
import { bareTitle, ticketIdentity } from "@/core/tickets";
import { getRunFn } from "@/functions/public.functions";
import { JiraIcon } from "@/components/brand-icons";
import { BackArrow } from "@/components/back-arrow";
import { Rich, RunFeed, StopReason } from "@/components/run-activity";
import { capitalize, duration, RunStatus, timeAgo } from "@/components/ui";

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
      <Link to="/" className="text-link">
        <ArrowLeft size={14} /> Home
      </Link>
    </main>
  ),
});

function RunPage() {
  const run = Route.useLoaderData();
  const sponsors = sponsorNames(run.sponsors);
  const ticket = run.ticketKey
    ? ticketIdentity(run.source, run.ticketKey)
    : null;
  const title = ticket ? bareTitle(run.ticketTitle, ticket.key) : null;
  const logo = projectLogo(run.logoUrl, run.repository || null);
  const pr = run.pullRequestUrl
    ? /github\.com\/(.+)\/pull\/(\d+)/.exec(run.pullRequestUrl)
    : null;
  return (
    <main id="main" className="container page-main rp">
      <header className="rp-head">
        <BackArrow />
        <div className="rp-intro">
          <p className="rp-project">
            {logo && <img src={logo} alt="" width={18} height={18} />}
            <span>{run.repository || run.projectName}</span>
            {ticket && (
              <a
                className="rp-ticket"
                href={run.ticketUrl}
                target="_blank"
                rel="noreferrer"
              >
                {run.source === "jira" && <JiraIcon size={12} />}
                {ticket.ref}
                <ExternalLink size={11} />
              </a>
            )}
          </p>
          <h1 className={title ? "" : "rp-hidden"}>
            {title ?? (
              <>
                <Lock size={20} aria-hidden="true" /> A private ticket
              </>
            )}
          </h1>
          <p className="rp-meta">
            <RunStatus run={run} />
            {run.kind === "correction" && <span>Correction</span>}
            <span>{timeAgo(run.createdAt)}</span>
          </p>
        </div>
      </header>

      {pr && run.pullRequestUrl && (
        <a
          className="rp-pr"
          href={run.pullRequestUrl}
          target="_blank"
          rel="noreferrer"
        >
          <GitPullRequest size={18} aria-hidden="true" />
          <span>
            <strong>Draft pull request #{pr[2]}</strong>
            <span className="muted">{pr[1]}</span>
          </span>
          <span className="rp-pr-open">
            Open on GitHub <ArrowUpRight size={14} />
          </span>
        </a>
      )}
      {pr && run.pullRequestOpen && (
        <p className="rp-correct">
          Need a change? Comment <code>{run.mention}</code> on the pull request,
          followed by what to change.
        </p>
      )}
      {run.status === "abstained" && (
        <StopReason reason={run.abstentionReason} summary={run.summary} />
      )}

      <div className="rp-layout">
        <div className="rp-main">
          {run.instruction && (
            <section className="rp-panel">
              <h2>Correction requested</h2>
              <p>{run.instruction}</p>
            </section>
          )}
          {run.summary && !run.abstentionReason && (
            <section className="rp-panel">
              <h2>
                What changed
                <span className="rp-by">
                  by {modelDisplayName(run.implementer)}
                </span>
              </h2>
              <p>
                <Rich text={run.summary} />
              </p>
              {run.evidence.length > 0 && (
                <ul className="rp-checks">
                  {run.evidence.map((line) => (
                    <li key={line}>
                      <CircleCheck size={14} aria-hidden="true" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {run.review && (
            <section className="rp-panel">
              <h2>
                Review
                <span className="rp-by">
                  by {modelDisplayName(run.review.reviewer)}
                </span>
                {run.review.rounds > 1 && (
                  <span className="rp-tag">after one fix round</span>
                )}
              </h2>
              <p>
                <Rich text={run.review.summary} />
              </p>
              {run.review.comments.length > 0 && (
                <ul className="rp-comments">
                  {run.review.comments.map((comment, i) => (
                    <li key={i}>
                      <span className={`rp-severity s-${comment.severity}`}>
                        {capitalize(comment.severity)}
                      </span>
                      {comment.path && (
                        <code>
                          {comment.path}
                          {comment.line ? `:${comment.line}` : ""}
                        </code>
                      )}
                      <p>{comment.body}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {run.artifacts.length > 0 && (
            <section className="rp-panel">
              <h2>Evidence</h2>
              <div className="rp-media">
                {run.artifacts.map((artifact) => (
                  <figure key={artifact.key}>
                    {artifact.kind === "video" ? (
                      <video src={`/evidence/${artifact.key}`} controls />
                    ) : (
                      <img
                        src={`/evidence/${artifact.key}`}
                        alt={artifact.label}
                      />
                    )}
                    <figcaption>{artifact.label}</figcaption>
                  </figure>
                ))}
              </div>
            </section>
          )}
          <RunFeed runId={run.runId} />
        </div>

        <aside>
          <dl className="rp-facts">
            <div>
              <dt>Implemented by</dt>
              <dd>{modelDisplayName(run.implementer)}</dd>
            </div>
            <div>
              <dt>Reviewed by</dt>
              <dd>{modelDisplayName(run.reviewer)}</dd>
            </div>
            <div>
              <dt>Duration</dt>
              <dd>
                {run.finishedAt
                  ? duration(run.createdAt, run.finishedAt)
                  : "Running"}
              </dd>
            </div>
            <div>
              <dt>Compute cost</dt>
              <dd className="mono">{money(run.costCents)}</dd>
            </div>
            {/* Set aside while it works; returned or spent once it ends. */}
            {run.member && !run.finishedAt && (
              <div>
                <dt>Reserved</dt>
                <dd className="mono">{money(run.reservedCents)}</dd>
              </div>
            )}
            <div className="rp-sponsors">
              <dt>Sponsored by</dt>
              <dd>{sponsors ?? "—"}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </main>
  );
}
