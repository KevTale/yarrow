import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ExternalLink, Github } from "lucide-react";
import { z } from "zod";
import { NotConfigured } from "@/components/ui";
import { SignInPrompt } from "@/components/email-sign-in";
import {
  TrackerConnection,
  type ProjectSetup,
} from "@/components/project-connections";
import { getProjectFn } from "@/functions/owner.functions";

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
