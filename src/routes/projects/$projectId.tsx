import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, ExternalLink, Github, X } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { capitalize, NotConfigured } from "@/components/ui";
import { SignInPrompt } from "@/components/email-sign-in";
import { Spinner } from "@/components/navigation-feedback";
import {
  getProjectFn,
  removeBoardFn,
  setProjectVisibilityFn,
} from "@/functions/owner.functions";

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

type Loaded = Extract<
  Awaited<ReturnType<typeof getProjectFn>>,
  { status: "ok" }
>;
type Visibility = Loaded["project"]["visibility"];

const visibilities: { value: Visibility; title: string; detail: string }[] = [
  {
    value: "public",
    title: "Public",
    detail: "The repository, its tickets and pull requests, on the public boards.",
  },
  {
    value: "listed",
    title: "Listed",
    detail: "The repository's name on the public boards. Tickets stay private.",
  },
  {
    value: "hidden",
    title: "Hidden",
    detail:
      "Never on the public boards. Only sponsors who fund hidden projects pay for it.",
  },
];

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
 * A project's settings: where its tickets come from (GitHub, Jira) and who
 * sees it on the public boards. Every change saves itself.
 */
function ProjectSettings({ data }: { data: Loaded }) {
  const search = Route.useSearch();
  const { project } = data;
  return (
    <main id="main" className="container page-main st">
      <div className="st-head">
        <Link
          to="/dashboard"
          search={{ tab: "builder", project: project.id }}
          className="st-back"
          aria-label="Back to the dashboard"
          data-tip="Dashboard"
        >
          <ArrowLeft size={18} />
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
      <VisibilityChoice
        projectId={project.id}
        initial={project.visibility}
      />
    </main>
  );
}

function Connections({ data }: { data: Loaded }) {
  const router = useRouter();
  const removeBoard = useServerFn(removeBoardFn);
  const { project } = data;
  const linked = Boolean(project.githubInstallationId);
  const jiraBoards = data.boards.filter((board) => board.tracker === "jira");
  const [removing, setRemoving] = useState<string | null>(null);

  async function unlink(boardId: string) {
    setRemoving(boardId);
    try {
      await removeBoard({ data: { projectId: project.id, boardId } });
      await router.invalidate();
    } finally {
      setRemoving(null);
    }
  }

  return (
    <section className="st-section">
      <h2>Connections</h2>
      <div className="st-cards">
        <div className="st-card">
          <span className="st-icon github" aria-hidden="true">
            <Github size={18} />
          </span>
          <span className="st-card-body">
            <strong>GitHub</strong>
            <span className="mono muted">{project.repository}</span>
          </span>
          <span className={`st-state ${linked ? "on" : "off"}`}>
            {linked ? "Installed" : "Not installed"}
          </span>
          <a
            className={`bd-btn ${linked ? "bd-btn-line" : "bd-btn-amber"}`}
            href={data.githubInstallUrl}
          >
            {linked ? "Manage" : "Install"} <ExternalLink size={13} />
          </a>
        </div>
        {data.trackersAvailable.jira && (
          <div className="st-card">
            <span className="st-icon jira" aria-hidden="true">
              <i />
            </span>
            <span className="st-card-body">
              <strong>Jira</strong>
              {jiraBoards.length === 0 ? (
                <span className="muted">Tickets from a Jira project</span>
              ) : (
                jiraBoards.map((board) => (
                  <span className="st-board" key={board.id}>
                    <span className="mono">{board.name}</span>
                    <span className="muted"> · {board.connection}</span>
                    <button
                      type="button"
                      className="st-unlink"
                      aria-label={`Unlink ${board.name}`}
                      data-tip="Unlink"
                      disabled={removing === board.id}
                      onClick={() => void unlink(board.id)}
                    >
                      {removing === board.id ? <Spinner /> : <X size={13} />}
                    </button>
                  </span>
                ))
              )}
            </span>
            {jiraBoards.length > 0 && (
              <span className="st-state on">Linked</span>
            )}
            {jiraBoards.length === 0 && (
              <a className="bd-btn bd-btn-line" href="/connect/github?source=jira">
                Connect
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

/** Saved as soon as it is chosen, with a short "Saved" in the title. */
function VisibilityChoice({
  projectId,
  initial,
}: {
  projectId: string;
  initial: Visibility;
}) {
  const save = useServerFn(setProjectVisibilityFn);
  const [value, setValue] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  useEffect(() => {
    if (state !== "saved") return;
    const timer = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(timer);
  }, [state]);

  async function choose(next: Visibility) {
    const before = value;
    setValue(next);
    setState("saving");
    try {
      await save({ data: { projectId, visibility: next } });
      setState("saved");
    } catch {
      setValue(before);
      setState("error");
    }
  }

  return (
    <section className="st-section">
      <h2>
        Visibility
        <span className={`st-saved ${state}`} role="status">
          {state === "saving" && <Spinner />}
          {state === "saved" && (
            <>
              <Check size={13} /> Saved
            </>
          )}
          {state === "error" && "Not saved, try again"}
        </span>
      </h2>
      <div className="choice-list">
        {visibilities.map((option) => (
          <label className="choice-row" key={option.value}>
            <input
              type="radio"
              name="visibility"
              checked={value === option.value}
              onChange={() => void choose(option.value)}
            />
            <span>
              <strong>{capitalize(option.title)}</strong>
              <small>{option.detail}</small>
            </span>
          </label>
        ))}
      </div>
      <p className="st-note">
        Sponsors never see your code: only the AI providers process it, through
        their API, in a sandbox destroyed after each run.
      </p>
    </section>
  );
}
