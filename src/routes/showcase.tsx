import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, ExternalLink } from "lucide-react";
import { getShowcaseFn } from "@/functions/public.functions";
import {
  EmptyState,
  NotConfigured,
  PageHeading,
  VisibilityBadge,
} from "@/components/ui";

export const Route = createFileRoute("/showcase")({
  loader: () => getShowcaseFn(),
  head: () => ({ meta: [{ title: "Projects · Agent Commons" }] }),
  component: ShowcasePage,
});

function ShowcasePage() {
  const data = Route.useLoaderData();
  return (
    <main id="main" className="container page-main">
      <PageHeading
        eyebrow="PROJECTS"
        title="Builders shipping with sponsored compute."
        description="Public projects show their code and pull requests. Listed projects show the product only. Hidden projects never appear here."
      >
        <Link to="/projects/new" className="button button-secondary">
          Add yours <ArrowUpRight size={16} />
        </Link>
      </PageHeading>
      {!data.configured ? (
        <NotConfigured />
      ) : data.projects.length === 0 ? (
        <EmptyState title="No projects yet">
          Be the first builder: connect a repo and tag a ticket.
        </EmptyState>
      ) : (
        <div className="project-list">
          {data.projects.map((project, i) => (
            <div key={project.id} className="project-row">
              <span
                className={`project-icon project-icon-${i % 4}`}
                aria-hidden="true"
              >
                {project.name.charAt(0).toUpperCase()}
              </span>
              <span className="project-info">
                <strong>{project.name}</strong>
                <span>{project.description || "—"}</span>
                <span className="small muted mono">
                  {[...project.categories, ...project.stacks].join(" · ")}
                </span>
              </span>
              <VisibilityBadge visibility={project.visibility} />
              <span className="project-amount mono">
                {project.merged}/{project.shipped} merged
                <small>{project.queued} queued</small>
              </span>
              <span className="row">
                {project.productUrl && (
                  <a
                    className="icon-button"
                    href={project.productUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`${project.name} website`}
                  >
                    <ExternalLink size={15} />
                  </a>
                )}
                {project.repository && (
                  <a
                    className="text-link small"
                    href={`https://github.com/${project.repository}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {project.repository}
                  </a>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
