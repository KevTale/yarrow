import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Ban,
  ExternalLink,
  GitMerge,
  GitPullRequest,
  Github,
  Sparkles,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { MorphSelect } from "@/components/arc/morph-select/morph-select";
import { MultiSelect } from "@/components/arc/multi-select/multi-select";
import { RadioCards } from "@/components/arc/radio-cards/radio-cards";
import type { MoveEvent, TrackerStatus } from "@/core/tracker-moves";
import { z } from "zod";
import { NotConfigured } from "@/components/ui";
import { SignInPrompt } from "@/components/email-sign-in";
import { JiraIcon } from "@/components/brand-icons";
import {
  SavedState,
  useSavedFades,
  type SaveState,
} from "@/components/saved-state";
import {
  getJiraBoardFn,
  listJiraProjectsFn,
  setJiraMovesFn,
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
    <div className="st-card-wrap">
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
      {connected && boards.length > 0 && (
        <div className="st-moves">
          {boards.map((board) => (
            <JiraMoves key={board.id} boardId={board.id} name={board.name} />
          ))}
        </div>
      )}
    </div>
  );
}

const moveRows: { event: MoveEvent; label: string; icon: ReactNode }[] = [
  { event: "started", label: "Yarrow starts", icon: <Sparkles size={14} /> },
  {
    event: "pullRequest",
    label: "Pull request opened",
    icon: <GitPullRequest size={14} />,
  },
  {
    event: "merged",
    label: "Pull request merged",
    icon: <GitMerge size={14} />,
  },
  { event: "stopped", label: "Yarrow stopped", icon: <Ban size={14} /> },
];

/**
 * Where a Jira project's tickets move as Yarrow works: one status per
 * event, or "Don't move". The project's own status names, saved at once.
 */
function JiraMoves({ boardId, name }: { boardId: string; name: string }) {
  const load = useServerFn(getJiraBoardFn);
  const save = useServerFn(setJiraMovesFn);
  const [board, setBoard] = useState<Awaited<
    ReturnType<typeof getJiraBoardFn>
  > | null>(null);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState<SaveState>("idle");
  useSavedFades(state, setState);

  useEffect(() => {
    let stopped = false;
    load({ data: { boardId } })
      .then((result) => !stopped && setBoard(result))
      .catch(() => !stopped && setFailed(true));
    return () => {
      stopped = true;
    };
  }, [boardId, load]);

  async function change(event: MoveEvent, statusId: string | null) {
    if (!board) return;
    const before = board;
    const moves = { ...board.moves, [event]: statusId };
    setBoard({ ...board, moves, chosen: true, warning: null });
    setState("saving");
    try {
      await save({ data: { boardId, moves } });
      setState("saved");
    } catch {
      setBoard(before);
      setState("error");
    }
  }

  const [key, title] = name.includes(" · ") ? name.split(" · ") : [name, ""];
  return (
    <div className="st-board">
      <div className="st-board-head">
        <span className="st-board-name">
          <b className="mono">{key}</b> {title}
        </span>
        <SavedState state={state} />
      </div>
      {failed ? (
        <p className="muted st-board-note">
          Jira did not answer. Reload the page in a moment.
        </p>
      ) : (
        <div className="st-move-list">
          {moveRows.map((row) => (
            <div className="st-move" key={row.event}>
              <span className="st-move-when">
                {row.icon}
                {row.label}
              </span>
              <ArrowRight size={14} className="st-move-arrow" />
              {board ? (
                <StatusSelect
                  label={row.label}
                  statuses={board.statuses}
                  value={board.moves[row.event] ?? null}
                  onChange={(statusId) => void change(row.event, statusId)}
                />
              ) : (
                <span className="sk st-move-sk" />
              )}
            </div>
          ))}
        </div>
      )}
      {board?.warning && (
        <p className="st-board-warning" role="status">
          <AlertTriangle size={14} />
          {board.warning}
        </p>
      )}
    </div>
  );
}

/**
 * The status a ticket moves to, or "Don't move": uiarc's morph select, each
 * status marked with its category's color as in Jira.
 */
function StatusSelect({
  label,
  statuses,
  value,
  onChange,
}: {
  label: string;
  statuses: TrackerStatus[];
  value: string | null;
  onChange: (statusId: string | null) => void;
}) {
  const none = "\u0000none";
  return (
    <div className="ss">
      <MorphSelect
        label={`${label}: Jira status`}
        hideLabel
        value={value ?? none}
        onValueChange={(next) => {
          const statusId = next === none ? null : next;
          if (statusId !== value) onChange(statusId);
        }}
        items={[
          { value: none, label: "Don't move" },
          ...statuses.map((status) => ({
            value: status.id,
            label: status.name,
            icon: (
              <span
                className={`ss-dot ${status.category}`}
                aria-hidden="true"
              />
            ),
          })),
        ]}
      />
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
  // "KAN · Démo" → key KAN, name Démo.
  const label = (option: { id: string; name: string }) =>
    option.name.startsWith(`${option.id} · `)
      ? option.name.slice(option.id.length + 3)
      : option.name;
  // uiarc's multi select; no clear-all, each project unlinks on its own.
  return (
    <MultiSelect
      className="jp"
      label="Jira projects"
      hideLabel
      clearable={false}
      placeholder={
        loading
          ? "Loading…"
          : options.length === 0
            ? "No Jira project on this site"
            : "Choose Jira projects"
      }
      options={options.map((option) => ({
        value: option.id,
        label: `${option.id} ${label(option)}`,
      }))}
      value={selected}
      onValueChange={onChange}
    />
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
      {/* uiarc's radio cards: one ring glides to the choice. */}
      <RadioCards
        className="st-visibility"
        aria-label="Visibility"
        layout="list"
        name="visibility"
        value={value}
        onValueChange={(next) => void choose(next as Visibility)}
        options={visibilities.map((option) => ({
          value: option.value,
          label: option.title,
          description: option.detail,
        }))}
      />
      <p className="st-note">
        Sponsors never see your code: only the AI providers process it, through
        their API, in a sandbox destroyed after each run.
      </p>
    </section>
  );
}
