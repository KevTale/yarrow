import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { ArrowRight, Github, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { ticketSources } from "@/core/ticket-link";
import { settleConnectFn } from "@/functions/connect.functions";
import { PageHeading, SignInPrompt, VisibilityBadge } from "@/components/ui";

const trackers = new Set(["jira", "linear", "trello"]);
/** GitHub's install webhook usually lands within seconds. */
const POLLS = 10;

/** GitHub App "Setup URL": where GitHub sends the owner after installing. */
export const Route = createFileRoute("/connect/done")({
  loader: () => settleConnectFn(),
  head: () => ({ meta: [{ title: "Connected · Yarrow" }] }),
  component: ConnectDone,
});

function ConnectDone() {
  const data = Route.useLoaderData();
  const router = useRouter();
  const [polls, setPolls] = useState(0);

  const ok = data.status === "ok";
  const linked = ok ? data.projects.filter((project) => project.linked) : [];
  const waitingFor =
    ok && !data.queued && data.intent.repository && data.intent.issue
      ? data.intent.repository
      : null;
  const waiting = ok && (linked.length === 0 || waitingFor) && polls < POLLS;

  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(async () => {
      await router.invalidate();
      setPolls((count) => count + 1);
    }, 2000);
    return () => clearTimeout(timer);
  }, [waiting, polls, router]);

  if (data.status === "signed_out")
    return (
      <main id="main" className="container page-main">
        <SignInPrompt next="/connect/done" reason="Bring your backlog." />
      </main>
    );
  if (data.status !== "ok")
    return (
      <main id="main" className="container page-main">
        <p className="feedback feedback-error" role="alert">
          The database is not configured on this deployment.
        </p>
      </main>
    );

  const tracker =
    data.intent.source && trackers.has(data.intent.source)
      ? ticketSources.find((source) => source.id === data.intent.source)
      : undefined;

  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="GITHUB"
        title={linked.length > 0 ? "Connected" : "Waiting for GitHub"}
      />
      {data.queued && (
        <p className="feedback" role="status">
          <a
            className="mono"
            href={`https://github.com/${data.queued.repository}/issues/${data.queued.issue}`}
          >
            {data.queued.repository}#{data.queued.issue}
          </a>{" "}
          is in the queue.
        </p>
      )}
      {waiting && (
        <p className="muted small" role="status" aria-live="polite">
          Waiting for GitHub…
        </p>
      )}
      {!waiting && waitingFor && (
        <p className="feedback feedback-error" role="alert">
          <span className="mono">{waitingFor}</span> is not connected.{" "}
          <a className="text-link" href={data.installUrl}>
            Add it on GitHub <ArrowRight size={13} />
          </a>
        </p>
      )}

      {data.projects.length > 0 && (
        <div className="project-list connect-projects">
          {data.projects.map((project) => (
            <div className="project-row" key={project.id}>
              <span className="project-info">
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                >
                  <strong>{project.name}</strong>
                </Link>
                <span className="mono small">{project.repository}</span>
              </span>
              <VisibilityBadge visibility={project.visibility} />
              {tracker && project.linked ? (
                <a
                  className="button button-small button-secondary"
                  href={`/integrations/${tracker.id}/connect?projectId=${project.id}`}
                >
                  Connect {tracker.name}
                </a>
              ) : (
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                  className="text-link"
                >
                  Settings <ArrowRight size={13} />
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      <p className="connect-more">
        {linked.length > 0 || waiting ? (
          <a className="text-link" href={data.installUrl}>
            <Plus size={14} /> Add repositories
          </a>
        ) : (
          <a className="button button-primary" href={data.installUrl}>
            <Github size={16} /> Install the GitHub App
          </a>
        )}
      </p>
    </main>
  );
}
