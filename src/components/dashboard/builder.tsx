import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { GitPullRequest, Github, Plus, Settings, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  inYarrow,
  mergeTickets,
  moving,
  queueable,
  removable,
  type ReviewRow,
  type TicketRow,
} from "@/core/tickets";
import {
  getBuilderFn,
  queueTicketsFn,
  retryTicketFn,
  setProjectLogoFn,
  unqueueTicketsFn,
} from "@/functions/builder.functions";
import { Logo } from "@/components/boards";
import { LogoPicker } from "@/components/logo-picker";
import { capitalize, timeAgo } from "@/components/ui";
import { useFlip, useLive } from "@/components/live";
import { ModelsCell } from "./models";

type BuilderData = Extract<
  Awaited<ReturnType<typeof getBuilderFn>>,
  { status: "ok" }
>;
type Filter = "all" | "in" | "review" | "out";

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

/**
 * Every project's last copy, kept for the whole visit: switching projects
 * shows it at once, then refreshes it. Written only from the browser.
 */
const cache = new Map<string, BuilderData>();
/** When each project's copy, and its open issues from GitHub, were read. */
const readAt = new Map<string, number>();
const issuesRead = new Map<string, number>();
/** GitHub's open issues are read again after a minute. */
const ISSUES_TTL = 60_000;

/**
 * Builder tab: one project's tickets, queued from here or by label on
 * GitHub, or the pull requests waiting for review across all projects.
 */
export function BuilderView({
  data,
  highlight,
  waiting,
  projectId,
  view,
}: {
  data: BuilderData;
  /** The ticket just pasted on the landing. */
  highlight: number | null;
  /** A repository still being connected after the GitHub install. */
  waiting: string | null;
  /** The project in the address; the loader's choice otherwise. */
  projectId?: string;
  view?: "review";
}) {
  const navigate = useNavigate({ from: "/dashboard" });
  const refresh = useServerFn(getBuilderFn);
  const queue = useServerFn(queueTicketsFn);
  const unqueue = useServerFn(unqueueTicketsFn);
  const retry = useServerFn(retryTicketFn);
  const saveLogo = useServerFn(setProjectLogoFn);
  const [store, setStore] = useState<Record<string, BuilderData>>(() => ({
    ...Object.fromEntries(cache),
    ...(data.project ? { [data.project.id]: data } : {}),
  }));
  // The project list and the review queue, from the latest answer.
  const [meta, setMeta] = useState({
    projects: data.projects,
    review: data.review,
  });
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [fresh, setFresh] = useState<number | null>(highlight);
  const [error, setError] = useState("");
  const [source, setSource] = useState({ data, highlight });
  const reviewing = view === "review";
  const currentId = reviewing ? null : (projectId ?? data.project?.id ?? null);
  const [shownId, setShownId] = useState(currentId);

  // New loader data (a new ticket, a refresh) replaces that project's copy.
  if (source.data !== data || source.highlight !== highlight) {
    setSource({ data, highlight });
    if (data.project) {
      const id = data.project.id;
      setStore((current) => ({ ...current, [id]: data }));
    }
    setMeta({ projects: data.projects, review: data.review });
    setFresh(highlight);
  }
  if (shownId !== currentId) {
    setShownId(currentId);
    setSelected(new Set());
  }
  useEffect(() => {
    if (!data.project) return;
    readAt.set(data.project.id, Date.now());
    if (data.issues) issuesRead.set(data.project.id, Date.now());
  }, [data]);
  useEffect(() => {
    for (const [id, copy] of Object.entries(store)) cache.set(id, copy);
  }, [store]);

  const absorb = (next: BuilderData, withIssues: boolean) => {
    const id = next.project?.id;
    setMeta({ projects: next.projects, review: next.review });
    if (!id) return;
    readAt.set(id, Date.now());
    if (withIssues) issuesRead.set(id, Date.now());
    setStore((current) => ({
      ...current,
      [id]: withIssues
        ? next
        : { ...next, issues: current[id]?.issues ?? next.issues },
    }));
  };
  // Realtime signals refresh at once; polling is the safety net.
  const pull = async (id: string | null = currentId) => {
    // The review list comes with any project's answer.
    const target = id ?? meta.projects[0]?.id;
    if (!target) return;
    const withIssues =
      id !== null && Date.now() - (issuesRead.get(id) ?? 0) > ISSUES_TTL;
    const next = await refresh({
      data: { projectId: target, issues: withIssues },
    }).catch(() => null);
    if (next?.status === "ok" && next.project?.id === target)
      absorb(next, withIssues);
  };

  // Every other project loads in the background, so switching is instant.
  const projectIds = meta.projects
    .filter((project) => project.linked)
    .map((project) => project.id)
    .join(",");
  useEffect(() => {
    let stopped = false;
    const todo = projectIds
      .split(",")
      .filter((id) => id && !cache.has(id) && id !== data.project?.id);
    const worker = async () => {
      for (let id = todo.shift(); id && !stopped; id = todo.shift()) {
        const next = await refresh({
          data: { projectId: id, issues: true },
        }).catch(() => null);
        if (!stopped && next?.status === "ok" && next.project?.id === id)
          absorb(next, true);
      }
    };
    const timer = setTimeout(() => void Promise.all([worker(), worker()]), 300);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
    // Once per set of projects; `absorb` and `refresh` are stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectIds]);

  const live = currentId ? store[currentId] : undefined;
  const project = live?.project ?? null;
  // Opened from the rail: a copy shows at once and refreshes; none loads now.
  useEffect(() => {
    if (!currentId || Date.now() - (readAt.get(currentId) ?? 0) < 10_000)
      return;
    const timer = setTimeout(() => void pull(currentId));
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  const rows = useMemo(
    () => (live ? mergeTickets(live.tickets, live.issues) : []),
    [live],
  );
  const busy = rows.some(moving) || waiting !== null;
  const topics = reviewing
    ? meta.projects.map((item) => `project:${item.id}`)
    : [currentId ? `project:${currentId}` : null];
  useLive(topics, () => void pull());
  useEffect(() => {
    if (meta.projects.length === 0) return;
    const timer = setTimeout(() => void pull(), busy ? 15_000 : 60_000);
    return () => clearTimeout(timer);
  });
  const table = useFlip<HTMLDivElement>(
    reviewing ? meta.review : live,
    reviewing ? "review" : (currentId ?? ""),
  );

  async function act(kind: "queue" | "unqueue" | "retry", numbers: number[]) {
    if (!project || numbers.length === 0) return;
    const id = project.id;
    setError("");
    const marked = new Set(numbers);
    // Show the change at once; the next poll brings the real state.
    setStore((all) => {
      const current = all[id]!;
      return {
        ...all,
        [id]: {
          ...current,
          tickets: [
            ...current.tickets.map((row) =>
              marked.has(row.number)
                ? {
                    ...row,
                    status:
                      kind === "unqueue"
                        ? ("none" as const)
                        : ("queued" as const),
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
              .map((row) => ({
                ...row,
                status: "queued" as const,
                pending: true,
              })),
          ],
        },
      };
    });
    setSelected(new Set());
    try {
      if (kind === "retry")
        await retry({ data: { projectId: id, number: numbers[0]! } });
      else
        await (kind === "queue" ? queue : unqueue)({
          data: { projectId: id, numbers },
        });
    } catch {
      setError("That did not go through. Try again in a moment.");
    }
  }

  async function changeLogo(logo: string | null) {
    if (!project) return;
    const id = project.id;
    const show = (logoUrl: string | null, uploadedLogo: boolean) => {
      setStore((all) => ({
        ...all,
        [id]: {
          ...all[id]!,
          project: { ...all[id]!.project!, logoUrl, uploadedLogo },
        },
      }));
      setMeta((current) => ({
        ...current,
        projects: current.projects.map((item) =>
          item.id === id ? { ...item, logoUrl } : item,
        ),
      }));
    };
    const before = project;
    if (logo) show(logo, true);
    try {
      const saved = await saveLogo({ data: { projectId: id, logo } });
      show(saved.logoUrl, logo !== null);
    } catch (cause) {
      show(before.logoUrl, before.uploadedLogo);
      setError(
        cause instanceof Error && /image/i.test(cause.message)
          ? cause.message
          : "The logo was not saved. Try again in a moment.",
      );
    }
  }

  if (meta.projects.length === 0)
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

  const toReview = rows.filter((row) => row.status === "pull_request");
  const counts = {
    all: rows.length,
    in: rows.filter(inYarrow).length,
    review: toReview.length,
    out: rows.filter((row) => !inYarrow(row)).length,
  };
  const q = query.trim().toLowerCase();
  const shown = rows
    .filter(
      (row) =>
        filter === "all" ||
        (filter === "in"
          ? inYarrow(row)
          : filter === "review"
            ? row.status === "pull_request"
            : !inYarrow(row)),
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
  const choose = (id: string) =>
    navigate({
      search: (current) => ({
        ...current,
        tab: "builder" as const,
        project: id,
        view: undefined,
      }),
    });
  const openReview = () =>
    navigate({
      search: (current) => ({
        ...current,
        tab: "builder" as const,
        view: "review" as const,
      }),
    });
  const many = meta.projects.length > 1;
  const loading = currentId !== null && !live;

  return (
    <div className={`bd ${many ? "with-rail" : ""}`}>
      {many && (
        <nav className="bd-rail" aria-label="Projects">
          <button
            type="button"
            className="bd-review"
            aria-current={reviewing}
            onClick={openReview}
          >
            <span>
              <GitPullRequest size={14} /> To review
            </span>
            {meta.review.length > 0 && (
              <span className="bd-review-count">{meta.review.length}</span>
            )}
          </button>
          <span className="bd-label">Projects</span>
          {meta.projects.map((item) => (
            <button
              type="button"
              key={item.id}
              aria-current={item.id === currentId}
              onClick={() => choose(item.id)}
            >
              <span>
                <Logo name={item.name} url={item.logoUrl} size="small" />
                {item.name}
              </span>
            </button>
          ))}
          <a className="bd-add" href="/connect/github">
            <Plus size={14} /> Add a project
          </a>
        </nav>
      )}
      <div className="bd-main">
        {many && (
          <select
            className="bd-picker"
            aria-label="Project"
            value={reviewing ? "review" : (currentId ?? "")}
            onChange={(event) =>
              event.target.value === "add"
                ? window.location.assign("/connect/github")
                : event.target.value === "review"
                  ? openReview()
                  : choose(event.target.value)
            }
          >
            <option value="review">
              To review{meta.review.length ? ` (${meta.review.length})` : ""}
            </option>
            {meta.projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
            <option value="add">+ Add a project</option>
          </select>
        )}
        {reviewing ? (
          <ReviewList
            rows={meta.review}
            table={table}
            onProject={choose}
          />
        ) : loading ? (
          <BuilderSkeleton
            name={meta.projects.find((item) => item.id === currentId)?.name}
          />
        ) : (
          project && (
            <>
              <div className="bd-head">
                <LogoPicker
                  name={project.name}
                  value={project.logoUrl}
                  removable={project.uploadedLogo}
                  onChange={(logo) => void changeLogo(logo)}
                  size="small"
                />
                <h2>{project.name}</h2>
                <span className="mono muted">{project.repository}</span>
                <span className="bd-chip">
                  {capitalize(project.visibility)}
                </span>
                <span className="bd-head-actions">
                  {!many && (
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
              {waiting && (
                <p className="bd-wait" role="status">
                  Connecting <span className="mono">{waiting}</span>…
                </p>
              )}
              {!project.linked ? (
                <div className="bd-empty">
                  <p className="muted">
                    GitHub is not connected to this repository
                  </p>
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
                          ["review", "To review"],
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
                  {live?.issues === null && (
                    <p className="bd-note">
                      GitHub did not answer: only the tickets already in Yarrow
                      are listed.
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
            </>
          )
        )}
      </div>
      {selected.size > 0 && !reviewing && (
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

/** Draft pull requests from every project, newest first. */
function ReviewList({
  rows,
  table,
  onProject,
}: {
  rows: ReviewRow[];
  table: React.Ref<HTMLDivElement>;
  onProject: (projectId: string) => void;
}) {
  return (
    <>
      <div className="bd-head">
        <h2>To review</h2>
      </div>
      <div
        className="bd-table"
        role="table"
        aria-label="Pull requests to review"
        ref={table}
      >
        <div className="bd-row bd-thead" role="row">
          <span />
          <span>Ticket</span>
          <span>Models</span>
          <span>Pull request</span>
          <span className="right">Opened</span>
        </div>
        {rows.length === 0 && (
          <p className="bd-none muted">Nothing to review</p>
        )}
        {rows.map((row) => (
          <div
            role="row"
            key={`${row.project.id}:${row.number}`}
            data-flip={`${row.project.id}:${row.number}`}
            className="bd-row"
          >
            <span>
              <Logo
                name={row.project.name}
                url={row.project.logoUrl}
                size="small"
              />
            </span>
            <span className="bd-ticket">
              <button
                type="button"
                className="bd-project"
                onClick={() => onProject(row.project.id)}
              >
                {row.project.name}
              </button>
              <span className="bd-num">#{row.number}</span>
              <a
                className="bd-title"
                href={row.url}
                target="_blank"
                rel="noopener"
              >
                {row.title}
              </a>
            </span>
            <span>
              <ModelsCell models={row.models} />
            </span>
            <span>
              {row.pullRequest && (
                <a
                  className="bd-status s-pull_request bd-review-link"
                  href={`${row.pullRequest.url}/files`}
                  target="_blank"
                  rel="noopener"
                >
                  <span className="dot" aria-hidden="true" />
                  Review #{row.pullRequest.number}
                </a>
              )}
            </span>
            <span className="bd-when">{timeAgo(row.updatedAt)}</span>
          </div>
        ))}
      </div>
    </>
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
