import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Github, Plus, Settings, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  inYarrow,
  mergeTickets,
  moving,
  queueable,
  removable,
  type OpenIssue,
  type TicketRow,
} from "@/core/tickets";
import {
  getBuilderFn,
  queueTicketsFn,
  retryTicketFn,
  unqueueTicketsFn,
} from "@/functions/builder.functions";
import { capitalize, timeAgo } from "@/components/ui";
import { useFlip, useLive } from "@/components/live";
import { Spinner } from "@/components/navigation-feedback";
import { ModelsCell } from "./models";

type BuilderData = Extract<
  Awaited<ReturnType<typeof getBuilderFn>>,
  { status: "ok" }
>;
type Filter = "all" | "in" | "out";

const statusLabel: Record<TicketRow["status"], string> = {
  none: "",
  queued: "Queued",
  writing: "Writing",
  reviewing: "Reviewing",
  delivering: "Opening the pull request",
  pull_request: "Pull request",
  merged: "Merged",
  pr_closed: "Closed",
  abstained: "Abstained",
};

/** Builder tab: one project's tickets, queued from here or by label on GitHub. */
export function BuilderView({
  data,
  highlight,
  waiting,
  switching = null,
}: {
  data: BuilderData;
  /** The ticket just pasted on the landing. */
  highlight: number | null;
  /** A repository still being connected after the GitHub install. */
  waiting: string | null;
  /** The project being opened from the rail, while it loads. */
  switching?: string | null;
}) {
  const navigate = useNavigate();
  const refresh = useServerFn(getBuilderFn);
  const queue = useServerFn(queueTicketsFn);
  const unqueue = useServerFn(unqueueTicketsFn);
  const retry = useServerFn(retryTicketFn);
  const [live, setLive] = useState(data);
  const [issues, setIssues] = useState<OpenIssue[] | null>(data.issues);
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fresh, setFresh] = useState<number | null>(highlight);
  const [error, setError] = useState("");
  const [source, setSource] = useState({ data, highlight });
  // When GitHub's open issues were last read.
  const issuesAt = useRef(0);

  // New loader data (another project, a new ticket) replaces the live copy.
  if (source.data !== data || source.highlight !== highlight) {
    setSource({ data, highlight });
    setLive(data);
    setIssues(data.issues);
    setSelected(new Set());
    setFresh(highlight);
  }
  useEffect(() => {
    issuesAt.current = Date.now();
  }, [data]);

  const project = live.project;
  const rows = useMemo(
    () => mergeTickets(live.tickets, issues),
    [live.tickets, issues],
  );
  const busy = rows.some(moving) || waiting !== null;

  // Realtime signals refresh at once; polling is the safety net.
  const pull = async () => {
    if (!project) return;
    const withIssues = Date.now() - issuesAt.current > 60_000;
    const next = await refresh({
      data: { projectId: project.id, issues: withIssues },
    }).catch(() => null);
    if (next?.status !== "ok") return;
    setLive(next);
    if (withIssues) {
      issuesAt.current = Date.now();
      if (next.issues) setIssues(next.issues);
    }
  };
  useLive([project ? `project:${project.id}` : null], () => void pull());
  useEffect(() => {
    if (!project) return;
    const timer = setTimeout(() => void pull(), busy ? 15_000 : 60_000);
    return () => clearTimeout(timer);
  });
  const table = useFlip<HTMLDivElement>(live);

  async function act(kind: "queue" | "unqueue" | "retry", numbers: number[]) {
    if (!project || numbers.length === 0) return;
    setError("");
    const marked = new Set(numbers);
    // Show the change at once; the next poll brings the real state.
    setLive((current) => ({
      ...current,
      tickets: [
        ...current.tickets.map((row) =>
          marked.has(row.number)
            ? {
                ...row,
                status:
                  kind === "unqueue" ? ("none" as const) : ("queued" as const),
                pending: kind !== "retry",
                models: [],
              }
            : row,
        ),
        ...rows
          .filter(
            (row) =>
              marked.has(row.number) &&
              !current.tickets.some((known) => known.number === row.number),
          )
          .map((row) => ({ ...row, status: "queued" as const, pending: true })),
      ],
    }));
    setSelected(new Set());
    try {
      if (kind === "retry")
        await retry({ data: { projectId: project.id, number: numbers[0]! } });
      else
        await (kind === "queue" ? queue : unqueue)({
          data: { projectId: project.id, numbers },
        });
    } catch {
      setError("That did not go through. Try again in a moment.");
    }
  }

  if (live.projects.length === 0)
    return (
      <div className="bd-empty">
        {waiting ? (
          <p className="bd-wait" role="status">
            Connecting <span className="mono">{waiting}</span>…
          </p>
        ) : (
          <>
            <p className="muted">No project yet</p>
            <a className="go" href="/connect/github">
              <Github size={16} /> Connect GitHub
            </a>
          </>
        )}
      </div>
    );

  const counts = {
    all: rows.length,
    in: rows.filter(inYarrow).length,
    out: rows.filter((row) => !inYarrow(row)).length,
  };
  const q = query.trim().toLowerCase();
  const shown = rows
    .filter(
      (row) =>
        filter === "all" || (filter === "in" ? inYarrow(row) : !inYarrow(row)),
    )
    .filter(
      (row) => !q || `${row.number} ${row.title}`.toLowerCase().includes(q),
    );
  const chosen = rows.filter((row) => selected.has(row.number));
  const canQueue = chosen.filter(queueable).map((row) => row.number);
  const canRemove = chosen.filter(removable).map((row) => row.number);
  const allShown =
    shown.length > 0 && shown.every((row) => selected.has(row.number));
  const toggle = (number: number) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(number)) next.delete(number);
      else next.add(number);
      return next;
    });
  const choose = (projectId: string) =>
    navigate({
      to: "/dashboard",
      search: { tab: "builder", project: projectId },
    });

  return (
    <div className={`bd ${live.projects.length > 1 ? "with-rail" : ""}`}>
      {live.projects.length > 1 && (
        <nav className="bd-rail" aria-label="Projects">
          <span className="bd-label">Projects</span>
          {live.projects.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-current={item.id === (switching ?? project?.id)}
              onClick={() => choose(item.id)}
            >
              <span>{item.name}</span>
              {item.id === switching && <Spinner />}
            </button>
          ))}
          <a className="bd-add" href="/connect/github">
            <Plus size={14} /> Add a project
          </a>
        </nav>
      )}
      <div className="bd-main">
        {live.projects.length > 1 && (
          <select
            className="bd-picker"
            aria-label="Project"
            value={switching ?? project?.id}
            onChange={(event) =>
              event.target.value === "add"
                ? window.location.assign("/connect/github")
                : choose(event.target.value)
            }
          >
            {live.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            <option value="add">+ Add a project</option>
          </select>
        )}
        {switching ? (
          <BuilderSkeleton
            name={live.projects.find((item) => item.id === switching)?.name}
          />
        ) : null}
        {!switching && project && (
          <div className="bd-head">
            <h2>{project.name}</h2>
            <span className="mono muted">{project.repository}</span>
            <span className="bd-chip">{capitalize(project.visibility)}</span>
            <span className="bd-head-actions">
              {live.projects.length === 1 && (
                <a className="text-link" href="/connect/github">
                  <Plus size={14} /> Add a project
                </a>
              )}
              <Link
                to="/projects/$projectId"
                params={{ projectId: project.id }}
                className="bd-settings"
              >
                <Settings size={15} /> <span>Settings</span>
              </Link>
            </span>
          </div>
        )}
        {!switching && waiting && (
          <p className="bd-wait" role="status">
            Connecting <span className="mono">{waiting}</span>…
          </p>
        )}
        {switching ? null : project && !project.linked ? (
          <div className="bd-empty">
            <p className="muted">GitHub is not connected to this repository</p>
            <a className="go" href="/connect/github">
              <Github size={16} /> Connect GitHub
            </a>
          </div>
        ) : (
          <>
            <div className="bd-toolbar">
              <div className="bd-filters" role="group" aria-label="Show">
                {(
                  [
                    ["all", "All"],
                    ["in", "In Yarrow"],
                    ["out", "Not queued"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    type="button"
                    key={key}
                    aria-pressed={filter === key}
                    onClick={() => setFilter(key)}
                  >
                    {label} <span>{counts[key]}</span>
                  </button>
                ))}
              </div>
              <input
                className="bd-search"
                type="search"
                placeholder="Search tickets"
                aria-label="Search tickets"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {issues === null && (
              <p className="bd-note">
                GitHub did not answer: only the tickets already in Yarrow are
                listed.
              </p>
            )}
            {error && (
              <p className="feedback feedback-error" role="alert">
                {error}
              </p>
            )}
            <div
              className="bd-table"
              role="table"
              aria-label="Tickets"
              ref={table}
            >
              <div className="bd-row bd-thead" role="row">
                <span>
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allShown}
                    onChange={() =>
                      setSelected(
                        allShown
                          ? new Set()
                          : new Set(shown.map((row) => row.number)),
                      )
                    }
                  />
                </span>
                <span>Ticket</span>
                <span>Models</span>
                <span>Status</span>
                <span className="right">Updated</span>
              </div>
              {shown.length === 0 && (
                <p className="bd-none muted">No ticket here</p>
              )}
              {shown.map((row) => (
                <div
                  role="row"
                  key={row.number}
                  data-flip={row.number}
                  data-flip-value={row.status}
                  className={`bd-row ${selected.has(row.number) ? "selected" : ""} ${fresh === row.number ? "fresh" : ""}`}
                  onAnimationEnd={() => setFresh(null)}
                >
                  <span>
                    <input
                      type="checkbox"
                      aria-label={`Select #${row.number}`}
                      checked={selected.has(row.number)}
                      onChange={() => toggle(row.number)}
                    />
                  </span>
                  <span className="bd-ticket">
                    <span className="bd-num">#{row.number}</span>
                    {row.url ? (
                      <a
                        className="bd-title"
                        href={row.url}
                        target="_blank"
                        rel="noopener"
                      >
                        {row.title}
                      </a>
                    ) : (
                      <span className="bd-title">{row.title}</span>
                    )}
                  </span>
                  <span>
                    <ModelsCell models={row.models} />
                  </span>
                  <span>
                    <Status row={row} act={act} />
                  </span>
                  <span className="bd-when">
                    {row.updatedAt ? timeAgo(row.updatedAt) : ""}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
      {selected.size > 0 && (
        <div className="bd-batch" role="region" aria-label="Selection">
          <b>{selected.size} selected</b>
          <button
            type="button"
            className="bd-btn bd-btn-amber"
            disabled={canQueue.length === 0}
            onClick={() => act("queue", canQueue)}
          >
            Add to queue
          </button>
          <button
            type="button"
            className="bd-btn bd-btn-line"
            disabled={canRemove.length === 0}
            onClick={() => act("unqueue", canRemove)}
          >
            Remove from queue
          </button>
          <button
            type="button"
            className="bd-btn bd-btn-ghost"
            aria-label="Clear selection"
            onClick={() => setSelected(new Set())}
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function Status({
  row,
  act,
}: {
  row: TicketRow;
  act: (kind: "queue" | "unqueue" | "retry", numbers: number[]) => void;
}) {
  if (row.status === "none")
    return (
      <span className="bd-status s-none">
        <span className="dot" aria-hidden="true" />
        Not queued
        <button
          type="button"
          className="bd-queue"
          aria-label={`Add #${row.number} to the queue`}
          onClick={() => act("queue", [row.number])}
        >
          <Plus size={12} strokeWidth={2.4} /> Add
        </button>
      </span>
    );
  const label = statusLabel[row.status];
  return (
    <span className={`bd-status s-${row.status}`}>
      <span className="dot" aria-hidden="true" />
      {row.pullRequest &&
      ["pull_request", "merged", "pr_closed"].includes(row.status) ? (
        <a href={row.pullRequest.url} target="_blank" rel="noopener">
          {label} #{row.pullRequest.number}
        </a>
      ) : (
        <span title={row.reason ?? undefined}>{label}</span>
      )}
      {row.status === "abstained" && (
        <button
          type="button"
          className="bd-retry"
          onClick={() => act("retry", [row.number])}
        >
          Retry
        </button>
      )}
    </span>
  );
}

/** The next project's head and table, drawn while its tickets load. */
function BuilderSkeleton({ name }: { name?: string }) {
  return (
    <div className="bd-skeleton" aria-busy="true" aria-label="Loading tickets">
      <div className="bd-head">
        <h2>{name}</h2>
        <span className="sk sk-text" />
      </div>
      <div className="bd-toolbar">
        <span className="sk sk-filters" />
        <span className="sk sk-search" />
      </div>
      <div className="bd-table">
        {Array.from({ length: 6 }, (_, i) => (
          <div className="bd-row sk-row" key={i}>
            <span className="sk sk-box" />
            <span className="sk sk-line" style={{ width: `${72 - i * 7}%` }} />
            <span className="sk sk-chip" />
            <span className="sk sk-chip" />
            <span className="sk sk-when" />
          </div>
        ))}
      </div>
    </div>
  );
}
