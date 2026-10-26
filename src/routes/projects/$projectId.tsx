import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Check, ExternalLink, Github } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";
import { capitalize, NotConfigured } from "@/components/ui";
import { SignInPrompt } from "@/components/email-sign-in";
import { Spinner } from "@/components/navigation-feedback";
import { JiraIcon } from "@/components/brand-icons";
import {
  listJiraProjectsFn,
  setJiraProjectFn,
} from "@/functions/connect.functions";
import {
  getProjectFn,
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
      <VisibilityChoice
        projectId={project.id}
        initial={project.visibility}
      />
    </main>
  );
}

function Connections({ data }: { data: Loaded }) {
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
          <span className={`st-state ${linked ? "on" : "off"}`}>
            {linked ? "Connected" : "Not connected"}
          </span>
          <a
            className={`bd-btn ${linked ? "bd-btn-line" : "bd-btn-amber"}`}
            href={data.githubInstallUrl}
          >
            {linked ? "Manage" : "Connect"} <ExternalLink size={13} />
          </a>
        </div>
        {data.trackersAvailable.jira && <JiraConnection data={data} />}
      </div>
    </section>
  );
}

/**
 * Jira: Connect opens Atlassian's consent; once connected, the Jira project
 * whose tickets this repository takes is chosen here and saved at once.
 */
function JiraConnection({ data }: { data: Loaded }) {
  const router = useRouter();
  const listProjects = useServerFn(listJiraProjectsFn);
  const setJiraProject = useServerFn(setJiraProjectFn);
  const { project } = data;
  const board = data.boards.find((item) => item.tracker === "jira");
  const connection =
    data.connections.find((item) => item.id === board?.connectionId) ??
    data.connections.find((item) => item.tracker === "jira");
  const [jiraProjects, setJiraProjects] = useState<
    { id: string; name: string }[] | null
  >(null);
  const [state, setState] = useState<SaveState>("idle");
  useSavedFades(state, setState);

  useEffect(() => {
    if (!connection) return;
    let stopped = false;
    listProjects({ data: { connectionId: connection.id } })
      .then((list) => !stopped && setJiraProjects(list))
      .catch(() => !stopped && setState("error"));
    return () => {
      stopped = true;
    };
  }, [connection, listProjects]);

  async function choose(jiraKey: string | null) {
    if (!connection) return;
    setState("saving");
    try {
      await setJiraProject({
        data: { projectId: project.id, connectionId: connection.id, jiraKey },
      });
      await router.invalidate();
      setState("saved");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="st-card">
      <span className="st-icon" aria-hidden="true">
        <JiraIcon size={18} />
      </span>
      <span className="st-card-body">
        <strong>
          Jira <SavedState state={state} />
        </strong>
        {connection ? (
          <span className="st-jira">
            <select
              aria-label="Jira project"
              value={board?.key ?? ""}
              disabled={!jiraProjects || state === "saving"}
              onChange={(event) => void choose(event.target.value || null)}
            >
              <option value="">
                {jiraProjects ? "No Jira project" : "Loading…"}
              </option>
              {(jiraProjects ?? (board ? [{ id: board.key, name: board.name }] : [])).map(
                (item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ),
              )}
            </select>
            <span className="mono muted">{connection.name}</span>
          </span>
        ) : (
          <span className="muted">Tickets from a Jira project</span>
        )}
      </span>
      <span className={`st-state ${connection ? "on" : "off"}`}>
        {connection ? "Connected" : "Not connected"}
      </span>
      {connection ? (
        // Atlassian lists the apps each person allowed, and revokes them.
        <a
          className="bd-btn bd-btn-line"
          href="https://id.atlassian.com/manage-profile/apps"
          target="_blank"
          rel="noopener"
        >
          Manage <ExternalLink size={13} />
        </a>
      ) : (
        <a
          className="bd-btn bd-btn-amber"
          href={`/integrations/jira/connect?projectId=${project.id}`}
        >
          Connect
        </a>
      )}
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

/** "Saved" fades out after a moment. */
function useSavedFades(state: SaveState, set: (next: SaveState) => void) {
  useEffect(() => {
    if (state !== "saved") return;
    const timer = setTimeout(() => set("idle"), 1800);
    return () => clearTimeout(timer);
  }, [state, set]);
}

function SavedState({ state }: { state: SaveState }) {
  return (
    <span className={`st-saved ${state}`} role="status">
      {state === "saving" && <Spinner />}
      {state === "saved" && (
        <>
          <Check size={13} /> Saved
        </>
      )}
      {state === "error" && "Not saved, try again"}
    </span>
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
  const [state, setState] = useState<SaveState>("idle");
  useSavedFades(state, setState);

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
        <SavedState state={state} />
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
