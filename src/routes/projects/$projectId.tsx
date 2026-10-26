import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ExternalLink,
  Github,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { capitalize, NotConfigured } from "@/components/ui";
import { SignInPrompt } from "@/components/email-sign-in";
import { Spinner } from "@/components/navigation-feedback";
import { JiraIcon } from "@/components/brand-icons";
import {
  listJiraProjectsFn,
  setJiraProjectsFn,
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
    detail:
      "The repository, its tickets and pull requests, on the public boards.",
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
      <VisibilityChoice projectId={project.id} initial={project.visibility} />
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
  const saveProjects = useServerFn(setJiraProjectsFn);
  const { project } = data;
  const boards = data.boards.filter((item) => item.tracker === "jira");
  const connection =
    data.connections.find((item) => item.id === boards[0]?.connectionId) ??
    data.connections.find((item) => item.tracker === "jira");
  const connectionId = connection?.id;
  const [options, setOptions] = useState<{ id: string; name: string }[] | null>(
    null,
  );
  const [revoked, setRevoked] = useState(false);
  // Atlassian did not answer: the linked projects stay listed.
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState(boards.map((board) => board.key));
  const [state, setState] = useState<SaveState>("idle");
  useSavedFades(state, setState);

  useEffect(() => {
    if (!connectionId) return;
    let stopped = false;
    listProjects({ data: { connectionId } })
      .then((result) => {
        if (stopped) return;
        setRevoked(result.revoked);
        setOptions(result.projects);
      })
      .catch(() => !stopped && setFailed(true));
    return () => {
      stopped = true;
    };
  }, [connectionId, listProjects]);

  async function change(jiraKeys: string[]) {
    if (!connectionId) return;
    const before = selected;
    setSelected(jiraKeys);
    setState("saving");
    try {
      await saveProjects({
        data: { projectId: project.id, connectionId, jiraKeys },
      });
      await router.invalidate();
      setState("saved");
    } catch {
      setSelected(before);
      setState("error");
    }
  }

  const connected = Boolean(connection) && !revoked;
  const connect = `/integrations/jira/connect?projectId=${project.id}`;
  return (
    <div className="st-card">
      <span className="st-icon" aria-hidden="true">
        <JiraIcon size={18} />
      </span>
      <span className="st-card-body">
        <strong>
          Jira <SavedState state={state} />
        </strong>
        {connected ? (
          <span className="st-jira">
            <span className="mono muted">{connection!.name}</span>
            <JiraProjectPicker
              options={
                options ??
                boards.map((board) => ({ id: board.key, name: board.name }))
              }
              loading={options === null && !failed}
              selected={selected}
              onChange={(keys) => void change(keys)}
            />
          </span>
        ) : revoked ? (
          <span className="muted">
            Access removed in Atlassian · {connection!.name}
          </span>
        ) : (
          <span className="muted">Tickets from Jira projects</span>
        )}
      </span>
      <span
        className={`st-state ${connected ? "on" : revoked ? "warn" : "off"}`}
      >
        {connected ? "Connected" : revoked ? "Disconnected" : "Not connected"}
      </span>
      {connected ? (
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
        <a className="bd-btn bd-btn-amber" href={connect}>
          {revoked ? "Reconnect" : "Connect"}
        </a>
      )}
    </div>
  );
}

/** Jira projects, ticked in a menu; each tick saves. */
function JiraProjectPicker({
  options,
  loading,
  selected,
  onChange,
}: {
  options: { id: string; name: string }[];
  loading: boolean;
  selected: string[];
  onChange: (keys: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !root.current?.contains(event.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  // "KAN · Démo" → key KAN, name Démo.
  const label = (option: { id: string; name: string }) =>
    option.name.startsWith(`${option.id} · `)
      ? option.name.slice(option.id.length + 3)
      : option.name;
  const chosen = options.filter((option) => selected.includes(option.id));
  return (
    <div className="jp" ref={root}>
      <button
        type="button"
        className="jp-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {chosen.length === 0 ? (
          <span className="muted">Choose Jira projects</span>
        ) : (
          chosen.map((option) => (
            <span className="jp-tag" key={option.id}>
              <b>{option.id}</b> {label(option)}
            </span>
          ))
        )}
        <ChevronDown size={14} className="jp-chevron" />
      </button>
      {open && (
        <div className="jp-menu" role="listbox" aria-multiselectable="true">
          {loading && <span className="jp-empty muted">Loading…</span>}
          {!loading && options.length === 0 && (
            <span className="jp-empty muted">No Jira project on this site</span>
          )}
          {!loading &&
            options.map((option) => {
              const on = selected.includes(option.id);
              return (
                <label
                  className="jp-option"
                  key={option.id}
                  role="option"
                  aria-selected={on}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      onChange(
                        on
                          ? selected.filter((key) => key !== option.id)
                          : [...selected, option.id],
                      )
                    }
                  />
                  <b className="mono">{option.id}</b>
                  <span>{label(option)}</span>
                </label>
              );
            })}
        </div>
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
