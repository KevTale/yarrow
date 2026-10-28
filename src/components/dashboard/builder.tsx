import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronRight,
  GitPullRequest,
  Github,
  Plus,
  Settings,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Fragment, useEffect, useMemo, useState } from "react";
import { AnimatedCounter } from "@/components/arc/animated-counter/animated-counter";
import { Checkbox } from "@/components/arc/checkbox/checkbox";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { MorphSelect } from "@/components/arc/morph-select/morph-select";
import { SearchField } from "@/components/arc/search-field/search-field";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { Segmented } from "@/components/segmented";
import {
  inYarrow,
  mergeTickets,
  moving,
  queueable,
  removable,
  selectable,
  done,
  workText,
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
import { JiraIcon } from "@/components/brand-icons";
import { RunHover } from "@/components/run-activity";
import { LogoPicker } from "@/components/logo-picker";
import { timeAgo } from "@/components/ui";
import { useFlip, useLive } from "@/components/live";
import type { JiraStep } from "@/server/trackers/jira-flow";
import { JiraCard } from "./jira-card";
import { ModelsCell } from "./models";
import { PaidByCell } from "./paid-by";
import { prefetchPullPanel, PullPanel } from "./pull-panel";
import { setReviewCount } from "@/components/review-count";

type BuilderData = Extract<
  Awaited<ReturnType<typeof getBuilderFn>>,
  { status: "ok" }
>;
/** The ticket's stage: each ticket is in exactly one. */
type Filter = "todo" | "progress" | "stopped" | "review" | "done";

const statusLabel: Record<TicketRow["status"], string> = {
  none: "",
  queued: "Queued",
  writing: "Writing",
  reviewing: "Reviewing",
  delivering: "Opening the pull request",
  pull_request: "",
  merged: " merged",
  pr_closed: " closed",
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
  jira = null,
}: {
  data: BuilderData;
  /** The ticket just pasted on the landing. */
  highlight: string | null;
  /** A repository still being connected after the GitHub install. */
  waiting: string | null;
  /** The project in the address; the loader's choice otherwise. */
  projectId?: string;
  view?: "review";
  /** A Jira link waiting for its repository or for Jira itself. */
  jira?: JiraStep | null;
}) {
  const navigate = useNavigate({ from: "/dashboard" });
  const reduced = useReducedMotion();
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
  // Null: the default, In progress, or To queue while nothing is.
  const [chosenFilter, setFilter] = useState<Filter | null>(null);
  const [query, setQuery] = useState("");
  // Searching looks in every stage, until a stage is picked again.
  const [narrowed, setNarrowed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState<string | null>(highlight);
  // The row opened under its chevron ("projectId:key"), one at a time.
  const [opened, setOpened] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [source, setSource] = useState({ data, highlight, jira });
  const [jiraStep, setJiraStep] = useState(jira);
  // The dashboard opens on To review while pull requests wait there.
  const [landOnReview] = useState(
    () =>
      view === undefined &&
      projectId === undefined &&
      data.projects.length > 1 &&
      data.review.length > 0,
  );
  const reviewing =
    view === "review" ||
    (landOnReview && view === undefined && projectId === undefined);
  const currentId = reviewing ? null : (projectId ?? data.project?.id ?? null);
  const [shownId, setShownId] = useState(currentId);

  // New loader data (a new ticket, a refresh) replaces that project's copy.
  if (
    source.data !== data ||
    source.highlight !== highlight ||
    source.jira !== jira
  ) {
    setSource({ data, highlight, jira });
    setJiraStep(jira);
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
    setFilter(null);
  }
  useEffect(() => {
    if (!data.project) return;
    readAt.set(data.project.id, Date.now());
    if (data.issues) issuesRead.set(data.project.id, Date.now());
  }, [data]);
  useEffect(() => {
    for (const [id, copy] of Object.entries(store)) cache.set(id, copy);
  }, [store]);
  // The header's badge follows what the dashboard knows.
  useEffect(() => setReviewCount(meta.review.length), [meta.review.length]);

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

  async function act(kind: "queue" | "unqueue" | "retry", keys: string[]) {
    if (!project || keys.length === 0) return;
    const id = project.id;
    setError("");
    const marked = new Set(keys);
    // Show the change at once; the next poll brings the real state.
    setStore((all) => {
      const current = all[id]!;
      return {
        ...all,
        [id]: {
          ...current,
          tickets: [
            ...current.tickets.map((row) =>
              marked.has(row.key)
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
                  marked.has(row.key) &&
                  !current.tickets.some((known) => known.key === row.key),
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
        await retry({ data: { projectId: id, key: keys[0]! } });
      else
        await (kind === "queue" ? queue : unqueue)({
          data: { projectId: id, keys },
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

  // A pipeline: to queue, in progress, to review, done.
  const filters: Record<Filter, (row: TicketRow) => boolean> = {
    todo: (row) => !inYarrow(row),
    progress: (row) =>
      inYarrow(row) &&
      !done(row) &&
      row.status !== "pull_request" &&
      row.status !== "abstained",
    // Abandoned by the agents: the builder's turn (edit, then retry).
    stopped: (row) => row.status === "abstained",
    review: (row) => row.status === "pull_request",
    done,
  };
  const q = query.trim().toLowerCase();
  const matches = rows.filter(
    (row) => !q || `${row.ref} ${row.title}`.toLowerCase().includes(q),
  );
  // While searching, each stage counts its matches.
  const counts = Object.fromEntries(
    Object.entries(filters).map(([key, test]) => [
      key,
      matches.filter(test).length,
    ]),
  ) as Record<Filter, number>;
  // A project opens where the builder has something to do: its pull
  // requests to review, else its tickets to queue.
  const filter: Filter =
    chosenFilter ?? (rows.some(filters.review) ? "review" : "todo");
  const everywhere = q !== "" && !narrowed;
  const shown = everywhere ? matches : matches.filter(filters[filter]);
  const chosen = rows.filter((row) => selected.has(row.key));
  const canQueue = chosen.filter(queueable).map((row) => row.key);
  const canRemove = chosen.filter(removable).map((row) => row.key);
  const pickable = shown.filter(selectable);
  const allShown =
    pickable.length > 0 && pickable.every((row) => selected.has(row.key));
  const toggle = (key: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
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
  const jiraCard = jiraStep && jiraStep.projects.length > 0 && (
    <JiraCard
      step={jiraStep}
      onClose={() => setJiraStep(null)}
      onLinked={(linked) => {
        setJiraStep(null);
        setFresh(linked.key);
        readAt.delete(linked.projectId);
        if (linked.projectId === currentId) void pull(linked.projectId);
        else choose(linked.projectId);
      }}
    />
  );
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
            {reviewing && <RailMark reduced={reduced} />}
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
              {item.id === currentId && <RailMark reduced={reduced} />}
            </button>
          ))}
          <a className="bd-add" href="/connect/github">
            <Plus size={14} /> Add a project
          </a>
        </nav>
      )}
      <div className="bd-main">
        {jiraCard}
        {many && (
          // uiarc's morph select, in the rail's place on phones.
          <div className="bd-picker">
            <MorphSelect
              label="Project"
              hideLabel
              value={reviewing ? "review" : (currentId ?? null)}
              onValueChange={(value) =>
                value === "add"
                  ? window.location.assign("/connect/github")
                  : value === "review"
                    ? openReview()
                    : choose(value)
              }
              items={[
                {
                  value: "review",
                  label: "To review",
                  icon: <GitPullRequest size={14} />,
                  meta: meta.review.length
                    ? String(meta.review.length)
                    : undefined,
                },
                {
                  label: "Projects",
                  options: meta.projects.map((item) => ({
                    value: item.id,
                    label: item.name,
                    icon: (
                      <Logo name={item.name} url={item.logoUrl} size="small" />
                    ),
                  })),
                },
                {
                  value: "add",
                  label: "Add a project",
                  icon: <Plus size={14} />,
                },
              ]}
            />
          </div>
        )}
        {reviewing ? (
          <ReviewList
            rows={meta.review}
            table={table}
            onProject={choose}
            opened={opened}
            onOpen={setOpened}
            onChanged={() => void pull()}
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
                <h2 title={project.repository}>{project.name}</h2>
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                  className="bd-cog"
                  aria-label="Settings"
                  data-tip="Settings"
                >
                  <Settings size={16} />
                </Link>
                <span className="bd-head-actions">
                  {!many && (
                    <a className="text-link" href="/connect/github">
                      <Plus size={14} /> Add a project
                    </a>
                  )}
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
                    <Segmented
                      className="bd-filters"
                      label="Show"
                      kind="pressed"
                      value={everywhere ? null : filter}
                      onChange={(key) => {
                        setFilter(key);
                        if (q) setNarrowed(true);
                      }}
                      items={(
                        [
                          ["todo", "To queue"],
                          ["progress", "In progress"],
                          ["stopped", "Stopped"],
                          ["review", "To review"],
                          ["done", "Done"],
                        ] as const
                      )
                        // Stopped shows only when a ticket is there.
                        .filter(
                          ([key]) =>
                            key !== "stopped" ||
                            counts.stopped > 0 ||
                            filter === "stopped",
                        )
                        .map(([key, label]) => ({
                          value: key,
                          label,
                          extra: <AnimatedCounter inline value={counts[key]} />,
                        }))}
                    />
                    <SearchField
                      fieldClassName="bd-search"
                      label="Search tickets"
                      hideLabel
                      placeholder="Search tickets"
                      value={query}
                      onValueChange={(next) => {
                        setQuery(next);
                        if (!next.trim()) setNarrowed(false);
                      }}
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
                        {pickable.length > 0 && (
                          <Checkbox
                            aria-label="Select all"
                            checked={allShown}
                            onCheckedChange={() =>
                              setSelected(
                                allShown
                                  ? new Set()
                                  : new Set(pickable.map((row) => row.key)),
                              )
                            }
                          />
                        )}
                      </span>
                      <span>Ticket</span>
                      <span>Models</span>
                      <span>Status</span>
                      <span>Paid by</span>
                      <span className="right">Updated</span>
                    </div>
                    {shown.length === 0 && (
                      <p className="bd-none muted">No ticket here</p>
                    )}
                    {shown.map((row) => {
                      const id = `${project.id}:${row.key}`;
                      return (
                        <Fragment key={row.key}>
                          <div
                            role="row"
                            data-flip={row.key}
                            data-flip-value={row.status}
                            className={`bd-row ${selected.has(row.key) ? "selected" : ""} ${fresh === row.key ? "fresh" : ""} ${opened === id ? "opened" : ""}`}
                            onAnimationEnd={() => setFresh(null)}
                          >
                            <span>
                              {/* Only rows the batch bar can act on; a pull
                              request opens under its chevron instead. */}
                              {selectable(row) ? (
                                <Checkbox
                                  aria-label={`Select ${row.ref}`}
                                  checked={selected.has(row.key)}
                                  onCheckedChange={() => toggle(row.key)}
                                />
                              ) : (
                                row.pullRequest && (
                                  <OpenChevron
                                    open={opened === id}
                                    label={row.ref}
                                    onToggle={() =>
                                      setOpened(opened === id ? null : id)
                                    }
                                    onIntent={() =>
                                      prefetchPullPanel(project.id, row.key)
                                    }
                                  />
                                )
                              )}
                            </span>
                            <span className="bd-ticket">
                              <TicketRef row={row} />
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
                            <span>
                              <PaidByCell sponsors={row.paidBy} />
                            </span>
                            <span className="bd-when">
                              {row.updatedAt ? timeAgo(row.updatedAt) : ""}
                            </span>
                          </div>
                          <OpenRow open={opened === id}>
                            <PullPanel
                              projectId={project.id}
                              rowKey={row.key}
                              onChanged={() => void pull()}
                            />
                          </OpenRow>
                        </Fragment>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )
        )}
      </div>
      {/* The selection's actions rise from the bottom edge and sink back
          when it clears; the count rolls. */}
      <AnimatePresence>
        {selected.size > 0 && !reviewing && (
          <motion.div
            key="batch"
            className="bd-batch"
            role="region"
            aria-label="Selection"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={
              reduced
                ? { opacity: 0 }
                : {
                    opacity: 0,
                    y: 12,
                    transition: {
                      duration: motionTokens.duration.fast,
                      ease: [...motionTokens.ease.standard],
                    },
                  }
            }
            transition={
              reduced
                ? { duration: motionTokens.duration.instant }
                : {
                    ...motionTokens.spring.smooth,
                    opacity: { duration: motionTokens.duration.fast },
                  }
            }
          >
            <b>
              <AnimatedCounter inline value={selected.size} /> selected
            </b>
            {canQueue.length > 0 && (
              <button
                type="button"
                className="bd-btn bd-btn-amber"
                onClick={() => act("queue", canQueue)}
              >
                Add to queue
              </button>
            )}
            {canRemove.length > 0 && (
              <button
                type="button"
                className="bd-btn bd-btn-line"
                onClick={() => act("unqueue", canRemove)}
              >
                Remove from queue
              </button>
            )}
            <button
              type="button"
              className="bd-btn bd-btn-ghost"
              aria-label="Clear selection"
              onClick={() => setSelected(new Set())}
            >
              <X size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Draft pull requests from every project, newest first. */
function ReviewList({
  rows,
  table,
  onProject,
  opened,
  onOpen,
  onChanged,
}: {
  rows: ReviewRow[];
  table: React.Ref<HTMLDivElement>;
  onProject: (projectId: string) => void;
  opened: string | null;
  onOpen: (id: string | null) => void;
  onChanged: () => void;
}) {
  const firstRows = rows
    .slice(0, 6)
    .map((row) => `${row.project.id}:${row.key}`)
    .join(",");
  // To review reads its first rows as soon as it shows.
  useEffect(() => {
    const timer = setTimeout(() => {
      for (const id of firstRows.split(",").filter(Boolean)) {
        const [projectId, ...key] = id.split(":");
        prefetchPullPanel(projectId!, key.join(":"));
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [firstRows]);
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
          <span>Paid by</span>
          <span className="right">Opened</span>
        </div>
        {rows.length === 0 && (
          <p className="bd-none muted">Nothing to review</p>
        )}
        {rows.map((row) => {
          const id = `${row.project.id}:${row.key}`;
          return (
            <Fragment key={id}>
              <div
                role="row"
                data-flip={id}
                className={`bd-row ${opened === id ? "opened" : ""}`}
              >
                <span>
                  <OpenChevron
                    open={opened === id}
                    label={row.ref}
                    onToggle={() => onOpen(opened === id ? null : id)}
                    onIntent={() => prefetchPullPanel(row.project.id, row.key)}
                  />
                </span>
                <span className="bd-ticket">
                  <Logo
                    name={row.project.name}
                    url={row.project.logoUrl}
                    size="small"
                  />
                  <button
                    type="button"
                    className="bd-project"
                    onClick={() => onProject(row.project.id)}
                  >
                    {row.project.name}
                  </button>
                  <TicketRef row={row} />
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
                  {row.pullRequest && row.runId && (
                    <RunHover runId={row.runId}>
                      <a
                        className="bd-status s-pull_request bd-review-link"
                        href={`${row.pullRequest.url}/files`}
                        target="_blank"
                        rel="noopener"
                      >
                        <span className="dot" aria-hidden="true" />
                        Review #{row.pullRequest.number}
                      </a>
                    </RunHover>
                  )}
                </span>
                <span>
                  <PaidByCell sponsors={row.paidBy} />
                </span>
                <span className="bd-when">{timeAgo(row.updatedAt)}</span>
              </div>
              <OpenRow open={opened === id}>
                <PullPanel
                  projectId={row.project.id}
                  rowKey={row.key}
                  onChanged={onChanged}
                />
              </OpenRow>
            </Fragment>
          );
        })}
      </div>
    </>
  );
}

/** The chevron that opens the row of a pull request. */
function OpenChevron({
  open,
  label,
  onToggle,
  onIntent,
}: {
  open: boolean;
  label: string;
  onToggle: () => void;
  /** Hover or focus: the row is read before the click. */
  onIntent: () => void;
}) {
  return (
    <button
      type="button"
      className="bd-chev"
      aria-expanded={open}
      aria-label={`${open ? "Close" : "Open"} ${label}`}
      onClick={onToggle}
      onPointerEnter={onIntent}
      onFocus={onIntent}
    >
      <ChevronRight size={16} aria-hidden="true" />
    </button>
  );
}

/** The opened row unfolds under its row and folds back on a spring. */
function OpenRow({
  open,
  children,
}: {
  open: boolean;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          className="bd-open"
          initial={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={reduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={
            reduced
              ? { duration: motionTokens.duration.instant }
              : {
                  ...motionTokens.spring.smooth,
                  opacity: { duration: motionTokens.duration.fast },
                }
          }
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * The rail's chosen row: one soft fill handed from row to row on a spring
 * (motion's shared layout), as in uiarc's button group.
 */
function RailMark({ reduced }: { reduced: boolean | null }) {
  return (
    <motion.span
      layoutId="bd-rail-mark"
      className="bd-rail-mark"
      aria-hidden="true"
      style={{ borderRadius: 8 }}
      transition={reduced ? { duration: 0 } : motionTokens.spring.highlight}
    />
  );
}

/** "#42", or a Jira key with Jira's mark in front. */
function TicketRef({ row }: { row: TicketRow }) {
  return (
    <span className={`bd-num ${row.source}`}>
      {row.source === "jira" && (
        <span className="bd-source" data-tip="Jira">
          <JiraIcon size={12} />
        </span>
      )}
      {row.ref}
    </span>
  );
}

function Status({
  row,
  act,
}: {
  row: TicketRow;
  act: (kind: "queue" | "unqueue" | "retry", keys: string[]) => void;
}) {
  if (row.status === "none")
    return (
      <span className="bd-status s-none">
        <span className="dot" aria-hidden="true" />
        Not queued
        <button
          type="button"
          className="bd-queue"
          aria-label={`Add ${row.ref} to the queue`}
          onClick={() => act("queue", [row.key])}
        >
          <Plus size={12} strokeWidth={2.4} /> Add
        </button>
      </span>
    );
  // "Claude Opus is writing": the model at work, named as on the landing,
  // uiarc's shimmer passing over it while it works.
  const work = workText(row.status, row.models);
  const label = work ? (
    <TextShimmer>{work}</TextShimmer>
  ) : (
    statusLabel[row.status]
  );
  const text = ["pull_request", "merged", "pr_closed"].includes(row.status) ? (
    // "PR #4", "PR #4 merged": the pull request, never the issue.
    row.pullRequest ? (
      <a href={row.pullRequest.url} target="_blank" rel="noopener">
        PR #{row.pullRequest.number}
        {label}
      </a>
    ) : (
      <span>PR{label}</span>
    )
  ) : row.runId && row.status !== "queued" ? (
    <Link
      to="/runs/$runId"
      params={{ runId: row.runId }}
      className="bd-run-link"
    >
      {label}
    </Link>
  ) : (
    <span>{label}</span>
  );
  return (
    <span className={`bd-status s-${row.status}`}>
      <span className="dot" aria-hidden="true" />
      {/* Hovering the status shows what the agents did, live. */}
      {row.runId && row.status !== "queued" ? (
        <RunHover runId={row.runId}>{text}</RunHover>
      ) : (
        text
      )}
      {row.status === "abstained" && (
        <button
          type="button"
          className="bd-retry"
          onClick={() => act("retry", [row.key])}
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
