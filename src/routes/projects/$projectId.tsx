import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, ExternalLink, Github, Trash2 } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { NotConfigured } from "@/components/ui";
import { SignInPrompt } from "@/components/email-sign-in";
import {
  TrackerConnection,
  type ProjectSetup,
} from "@/components/project-connections";
import { Spinner } from "@/components/navigation-feedback";
import { getProjectFn, removeProjectFn } from "@/functions/owner.functions";

export const Route = createFileRoute("/projects/$projectId")({
  validateSearch: z.object({
    connected: z.string().optional(),
    error: z.string().optional(),
  }),
  loader: ({ params }) =>
    getProjectFn({ data: { projectId: params.projectId } }),
  head: () => ({ meta: [{ title: "Settings · Yarrow" }] }),
  component: ProjectPage,
});

function ProjectPage() {
  const data = Route.useLoaderData();
  const { projectId } = Route.useParams();
  if (data.status === "signed_out")
    return <SignInPrompt next={`/projects/${projectId}`} />;
  if (data.status === "not_configured")
    return (
      <main id="main" className="container page-main">
        <NotConfigured />
      </main>
    );
  return <ProjectSettings data={data} />;
}

/**
 * A project's settings: where its tickets come from (GitHub, Jira, Linear,
 * Trello). Every change saves itself. Its visibility on the public boards is
 * left out while sponsors are off the site.
 */
function ProjectSettings({ data }: { data: ProjectSetup }) {
  const search = Route.useSearch();
  const { project } = data;
  return (
    <main id="main" className="container page-main st">
      <div className="st-head">
        <Link
          to="/dashboard"
          search={{ project: project.id }}
          className="st-back"
          aria-label="Back to the dashboard"
          data-tip="Dashboard"
        >
          <ArrowLeft size={22} />
        </Link>
        <h1>{project.name}</h1>
      </div>
      {search.error && (
        <p className="feedback feedback-error" role="alert">
          {search.error}
        </p>
      )}
      {project.suspendedAt && (
        <p className="feedback feedback-error" role="alert">
          This project is suspended under the acceptable use policy. Contact us.
        </p>
      )}
      <Connections data={data} />
      <RemoveProject projectId={project.id} repository={project.repository} />
    </main>
  );
}

function Connections({ data }: { data: ProjectSetup }) {
  const { project } = data;
  const linked = Boolean(project.githubInstallationId);
  return (
    <section className="st-section">
      <h2>Connections</h2>
      <div className="st-cards">
        <div className="st-card">
          <span className="st-icon" aria-hidden="true">
            <Github size={18} />
          </span>
          <span className="st-card-body">
            <strong>GitHub</strong>
            <span className="mono muted">{project.repository}</span>
          </span>
          {linked && <span className="st-state on">Connected</span>}
          <a
            className={`bd-btn ${linked ? "bd-btn-line" : "bd-btn-amber"}`}
            href={data.githubInstallUrl}
          >
            {linked ? "Manage" : "Connect"} <ExternalLink size={13} />
          </a>
        </div>
        {data.trackersAvailable.jira && (
          <TrackerConnection data={data} tracker="jira" />
        )}
        {data.trackersAvailable.linear && (
          <TrackerConnection data={data} tracker="linear" />
        )}
        {data.trackersAvailable.trello && (
          <TrackerConnection data={data} tracker="trello" />
        )}
      </div>
    </section>
  );
}

/**
 * Remove project: off the dashboard and its boards unlinked, after a second
 * click. The GitHub App and the tracker connections stay, for the other
 * projects; the setup imports it again. Refused while a ticket of it works.
 */
function RemoveProject({
  projectId,
  repository,
}: {
  projectId: string;
  repository: string;
}) {
  const remove = useServerFn(removeProjectFn);
  const [asking, setAsking] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    setError("");
    setPending(true);
    try {
      const { status } = await remove({ data: { projectId } });
      if (status === "busy") {
        setError("A ticket of this project is at work.");
        setPending(false);
        return;
      }
      // A full load: the dashboard's copy of the project goes with it.
      window.location.assign("/dashboard");
    } catch {
      setError("The project could not be removed. Try again in a moment.");
      setPending(false);
    }
  }

  return (
    <section className="st-section">
      <h2>Remove</h2>
      <div className="st-cards">
        <div className="st-card-wrap ac-danger">
          <div className="st-card">
            <span className="st-icon" aria-hidden="true">
              <Trash2 size={18} />
            </span>
            <span className="st-card-body">
              <strong>Remove project</strong>
              <span className="mono muted">{repository}</span>
            </span>
            {asking ? (
              <>
                <button
                  type="button"
                  className="bd-btn bd-btn-ghost"
                  onClick={() => {
                    setAsking(false);
                    setError("");
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="bd-btn ac-delete"
                  disabled={pending}
                  onClick={() => void confirm()}
                >
                  {pending ? <Spinner /> : "Remove"}
                </button>
              </>
            ) : (
              <button
                type="button"
                className="bd-btn ac-delete"
                onClick={() => setAsking(true)}
              >
                Remove
              </button>
            )}
          </div>
          {error && (
            <p className="st-remove-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
