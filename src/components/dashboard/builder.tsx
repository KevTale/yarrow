import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronDown,
  ChevronRight,
  Github,
  Play,
  Plus,
  RotateCcw,
  Settings,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { SearchField } from "@/components/arc/search-field/search-field";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import {
  inYarrow,
  mergeTickets,
  moving,
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
import { longDate, shortDate } from "@/components/ui";
import { useFlip, useLive } from "@/components/live";
import type { JiraStep } from "@/server/trackers/jira-flow";
import { JiraCard } from "./jira-card";
import { NewTicket } from "./new-ticket";
import { ProjectSwitcher } from "./project-switcher";
import { RowMenu } from "./row-menu";
import { prefetchPullPanel } from "./pull-panel";
import { prefetchTicket, TicketPanel, type TicketAct } from "./ticket-panel";
import { setReviewCount } from "@/components/review-count";

type BuilderData = Extract<
  Awaited<ReturnType<typeof getBuilderFn>>,
  { status: "ok" }
>;

/** The ticket's stage: each ticket is in exactly one group. */
type Stage = "review" | "progress" | "todo" | "stopped" | "done";

/**
 * The groups, in the order the builder acts on them: what waits for them
 * first. "+" writes a ticket into To do, or into In progress, started.
 */
const stages: {
  key: Stage;
  label: string;
  test: (row: TicketRow) => boolean;
  add?: "create" | "start";
}[] = [
  {
    key: "review",
    label: "To review",
    test: (row) => row.status === "pull_request",
  },
  {
    key: "progress",
    label: "In progress",
    test: (row) =>
      inYarrow(row) &&
      !done(row) &&
      row.status !== "pull_request" &&
      row.status !== "abstained",
    add: "start",
  },
  { key: "todo", label: "To do", test: (row) => !inYarrow(row), add: "create" },
  // Abandoned by the agents: the builder's turn (edit, then retry).
  {
    key: "stopped",
    label: "Stopped",
    test: (row) => row.status === "abstained",
  },
  { key: "done", label: "Done", test: done },
];

/** Groups folded on this browser; Done starts folded, it only grows. */
const FOLDED_KEY = "yarrow:folded-groups";
const defaultFolded: Stage[] = ["done"];
const foldListeners = new Set<() => void>();
// Where the folding lives when the browser keeps no storage.
let foldedInMemory: string | null = null;
const readFolded = () => {
  try {
    return localStorage.getItem(FOLDED_KEY) ?? foldedInMemory;
  } catch {
    return foldedInMemory;
  }
};
const subscribeFolded = (listener: () => void) => {
  foldListeners.add(listener);
  return () => void foldListeners.delete(listener);
};
function writeFolded(stages: Stage[]) {
  foldedInMemory = JSON.stringify(stages);
  try {
    localStorage.setItem(FOLDED_KEY, foldedInMemory);
  } catch {
    // Kept for this visit only.
  }
  for (const listener of foldListeners) listener();
}
function parseFolded(text: string | null): Stage[] {
  try {
    const stages: unknown = JSON.parse(text ?? "null");
    return Array.isArray(stages) ? (stages as Stage[]) : defaultFolded;
  } catch {
    return defaultFolded;
  }
}

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
 * Tickets: one project's tickets in groups, from To review to Done, each
 * opening in place; or the pull requests waiting for review across all
 * projects.
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
  const [query, setQuery] = useState("");
  // Read from the browser after hydration; the server folds Done only.
  const foldedText = useSyncExternalStore(
    subscribeFolded,
    readFolded,
    () => null,
  );
  const folded = useMemo(() => parseFolded(foldedText), [foldedText]);
  const [fresh, setFresh] = useState<string | null>(highlight);
  // The row opened in place ("projectId:key"), one at a time.
  const [opened, setOpened] = useState<string | null>(null);
  const [error, setError] = useState("");
  // The new ticket dialog, and whether it came from In progress.
  const [composing, setComposing] = useState<{ start: boolean } | null>(null);
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
    setQuery("");
    setComposing(null);
  }
  const fold = (stage: Stage) =>
    writeFolded(
      folded.includes(stage)
        ? folded.filter((item) => item !== stage)
        : [...folded, stage],
    );
  const unfold = (stage: Stage) => {
    if (folded.includes(stage))
      writeFolded(folded.filter((item) => item !== stage));
  };
  useEffect(() => {
    if (!data.project) return;
    readAt.set(data.project.id, Date.now());
    if (data.issues) issuesRead.set(data.project.id, Date.now());
  }, [data]);
  useEffect(() => {
    for (const [id, copy] of Object.entries(store)) cache.set(id, copy);
  }, [store]);
  // The header's count follows what the page knows.
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
  // Opened from the switcher: a copy shows at once and refreshes; none loads now.
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
  useLive(topics, (signals) => {
    const stale = signals
      .filter((signal) => signal.event === "issues")
      .map((signal) => signal.topic.replace(/^project:/, ""));
    for (const id of stale) issuesRead.delete(id);
    void pull();
    // Jira's search shows a change a few seconds after its webhook: again.
    if (stale.includes(currentId ?? ""))
      setTimeout(() => {
        for (const id of stale) issuesRead.delete(id);
        void pull();
      }, 5_000);
  });
  useEffect(() => {
    if (meta.projects.length === 0) return;
    const timer = setTimeout(() => void pull(), busy ? 15_000 : 60_000);
    return () => clearTimeout(timer);
  });
  const list = useFlip<HTMLDivElement>(
    reviewing ? meta.review : live,
    reviewing ? "review" : (currentId ?? ""),
  );

  // "C" writes a ticket, as in the trackers builders know.
  const canWrite = Boolean(!reviewing && project?.linked && !composing);
  useEffect(() => {
    if (!canWrite) return;
    const keys = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.key.toLowerCase() !== "c" ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        target?.closest("input, textarea, select, [contenteditable=true]")
      )
        return;
      event.preventDefault();
      setComposing({ start: false });
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [canWrite]);

  const act: TicketAct = async (kind, keys) => {
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
    if (kind !== "unqueue") unfold("progress");
    else unfold("todo");
    for (const key of keys) setFresh(key);
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
  };

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

  const q = query.trim().toLowerCase();
  const matches = rows.filter(
    (row) => !q || `${row.ref} ${row.title}`.toLowerCase().includes(q),
  );
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
  const shownProject =
    project ?? meta.projects.find((item) => item.id === currentId) ?? null;
  const toggle = (id: string) => setOpened(opened === id ? null : id);

  return (
    <div className="bd">
      {jiraCard}
      <div className="tix-head">
        {!reviewing && project && (
          <LogoPicker
            name={project.name}
            value={project.logoUrl}
            removable={project.uploadedLogo}
            onChange={(logo) => void changeLogo(logo)}
            size="small"
          />
        )}
        <ProjectSwitcher
          projects={meta.projects}
          current={shownProject}
          reviewing={reviewing}
          toReview={meta.review.length}
          onProject={choose}
          onReview={openReview}
        />
        {!reviewing && shownProject && (
          <Link
            to="/projects/$projectId"
            params={{ projectId: shownProject.id }}
            className="bd-cog"
            aria-label="Settings"
            data-tip="Settings"
          >
            <Settings size={16} />
          </Link>
        )}
        {!reviewing && project?.linked && (
          <SearchField
            fieldClassName="bd-search"
            label="Search tickets"
            hideLabel
            placeholder="Search tickets"
            value={query}
            onValueChange={setQuery}
          />
        )}
      </div>
      {reviewing ? (
        <ReviewList
          rows={meta.review}
          list={list}
          opened={opened}
          onOpen={toggle}
          onChanged={() => void pull()}
          folded={folded.includes("review")}
          onFold={() => fold("review")}
        />
      ) : loading ? (
        <BuilderSkeleton />
      ) : (
        project && (
          <>
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
                <div className="tix-list" ref={list} style={refColumn(matches)}>
                  {stages.map((stage) => {
                    const shown = matches.filter(stage.test);
                    // Stopped only when a ticket is there; searching shows
                    // only the groups with a match.
                    if ((stage.key === "stopped" || q) && shown.length === 0)
                      return null;
                    return (
                      <TicketGroup
                        key={stage.key}
                        stage={stage.key}
                        label={stage.label}
                        count={shown.length}
                        folded={!q && folded.includes(stage.key)}
                        onFold={() => fold(stage.key)}
                        onAdd={
                          stage.add
                            ? () =>
                                setComposing({ start: stage.add === "start" })
                            : undefined
                        }
                      >
                        {shown.map((row) => {
                          const id = `${project.id}:${row.key}`;
                          return (
                            <TicketLine
                              key={row.key}
                              row={row}
                              projectId={project.id}
                              open={opened === id}
                              onToggle={() => toggle(id)}
                              fresh={fresh === row.key}
                              onFreshEnd={() => setFresh(null)}
                              act={act}
                              onChanged={() => void pull()}
                            />
                          );
                        })}
                      </TicketGroup>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )
      )}
      {composing && project && (
        <NewTicket
          projectId={project.id}
          projectName={project.name}
          boards={project.boards}
          start={composing.start}
          onClose={() => setComposing(null)}
          onCreated={(key, started) => {
            setComposing(null);
            setQuery("");
            // Where it now stands, lit like a pasted ticket.
            unfold(started ? "progress" : "todo");
            setFresh(key);
            issuesRead.delete(project.id);
            void pull(project.id);
          }}
        />
      )}
    </div>
  );
}

/** A stage: its head folds it, its "+" writes a ticket into it. */
function TicketGroup({
  stage,
  label,
  count,
  folded,
  onFold,
  onAdd,
  children,
}: {
  stage: Stage;
  label: string;
  count: number;
  folded: boolean;
  onFold: () => void;
  onAdd?: () => void;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  return (
    <section className="tix-group" aria-label={label}>
      <div className="tix-ghead">
        <button
          type="button"
          className="tix-gtoggle"
          aria-expanded={!folded}
          onClick={onFold}
        >
          <ChevronDown
            size={14}
            className={`tix-gchev ${folded ? "folded" : ""}`}
            aria-hidden="true"
          />
          <span className={`tix-stage ${stage}`} aria-hidden="true" />
          {label}
          <span className="tix-count">{count}</span>
        </button>
        {onAdd && (
          <button
            type="button"
            className="tix-icon-btn"
            aria-label={
              stage === "progress" ? "New ticket, started" : "New ticket"
            }
            data-tip={
              stage === "progress" ? "New ticket, started" : "New ticket"
            }
            onClick={onAdd}
          >
            <Plus size={16} />
          </button>
        )}
      </div>
      <AnimatePresence initial={false}>
        {!folded && count > 0 && (
          <motion.ul
            className="tix-rows"
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
          </motion.ul>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * One ticket: its key and title open it in place; on the right, what to do
 * with it now (Start, Retry), where it stands, its pull request, who paid,
 * and when it was written.
 */
function TicketLine({
  row,
  projectId,
  project,
  open,
  onToggle,
  fresh = false,
  onFreshEnd,
  act,
  onChanged,
}: {
  row: TicketRow;
  projectId: string;
  /** In the cross-project review list: whose ticket it is. */
  project?: ReviewRow["project"];
  open: boolean;
  onToggle: () => void;
  fresh?: boolean;
  onFreshEnd?: () => void;
  act?: TicketAct;
  onChanged: () => void;
}) {
  const intent = () => {
    prefetchTicket(projectId, row.key);
    if (row.pullRequest) prefetchPullPanel(projectId, row.key);
  };
  return (
    <li className={`tix-item ${open ? "open" : ""}`}>
      <div
        data-flip={`${projectId}:${row.key}`}
        data-flip-value={row.status}
        className={`tix-row ${open ? "open" : ""} ${fresh ? "fresh" : ""}`}
        onAnimationEnd={onFreshEnd}
      >
        <RowMenu row={row} />
        <button
          type="button"
          className="tix-open"
          aria-expanded={open}
          onClick={onToggle}
          onPointerEnter={intent}
          onFocus={intent}
        >
          <ChevronRight size={14} className="tix-chev" aria-hidden="true" />
          {project && (
            <span className="tix-project">
              <Logo name={project.name} url={project.logoUrl} size="small" />
              {project.name}
            </span>
          )}
          <TicketRef row={row} />
          <span className="tix-title">{row.title}</span>
        </button>
        <span className="tix-meta">
          <span className="tix-cell">
            <RowState row={row} />
            {act && row.status === "none" && (
              <button
                type="button"
                className="tix-go"
                disabled={row.pending}
                onClick={() => act("queue", [row.key])}
              >
                <Play size={10} fill="currentColor" aria-hidden="true" /> Start
              </button>
            )}
            {act && row.status === "abstained" && (
              <button
                type="button"
                className="tix-go"
                onClick={() => act("retry", [row.key])}
              >
                <RotateCcw size={12} aria-hidden="true" /> Retry
              </button>
            )}
          </span>
          <Sponsor row={row} />
          <time
            className="tix-date"
            dateTime={row.createdAt}
            title={longDate(row.createdAt)}
          >
            {shortDate(row.createdAt)}
          </time>
        </span>
      </div>
      <OpenRow open={open}>
        <TicketPanel
          projectId={projectId}
          row={row}
          onChanged={onChanged}
          act={act}
        />
      </OpenRow>
    </li>
  );
}

/** Where a ticket stands, when the group does not say it all. */
function RowState({ row }: { row: TicketRow }) {
  // The pull request itself is in the opened row; the line says only what
  // is happening to it.
  if (row.pullRequest) {
    const work = workText(row.status, row.models);
    if (work)
      return <TextShimmer className="tix-state working">{work}</TextShimmer>;
    return row.status === "pr_closed" ? (
      <span className="tix-state">Closed</span>
    ) : null;
  }
  if (row.status === "queued")
    return (
      <span className="tix-state waiting">
        {row.pending ? "Starting" : "Waiting"}
      </span>
    );
  if (row.status === "abstained")
    return <span className="tix-state stopped">Abstained</span>;
  // "Claude Opus is writing": the model at work, as on the landing.
  const work = workText(row.status, row.models);
  if (!work) return null;
  const text = <TextShimmer className="tix-state working">{work}</TextShimmer>;
  return row.runId ? (
    <RunHover runId={row.runId}>
      <Link to="/runs/$runId" params={{ runId: row.runId }} className="tix-run">
        {text}
      </Link>
    </RunHover>
  ) : (
    text
  );
}

/** The first sponsor of the ticket's runs, the others named on hover. */
function Sponsor({ row }: { row: TicketRow }) {
  const first = row.paidBy[0];
  if (!first) return <span className="tix-sponsor" />;
  const names = row.paidBy.map(
    (sponsor) => sponsor.name ?? "Anonymous sponsor",
  );
  return (
    <span className="tix-sponsor" title={`Paid by ${names.join(", ")}`}>
      <span className="tix-paid">Paid by</span>
      <Logo name={first.name} url={first.logoUrl} size="small" />
      <span>{names[0]}</span>
      {names.length > 1 && (
        <span className="tix-more">+{names.length - 1}</span>
      )}
    </span>
  );
}

/** Draft pull requests from every project, newest first. */
function ReviewList({
  rows,
  list,
  opened,
  onOpen,
  onChanged,
  folded,
  onFold,
}: {
  rows: ReviewRow[];
  list: React.Ref<HTMLDivElement>;
  opened: string | null;
  onOpen: (id: string) => void;
  onChanged: () => void;
  folded: boolean;
  onFold: () => void;
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
  if (rows.length === 0)
    return <p className="bd-none muted">Nothing to review</p>;
  return (
    <div className="tix-list" ref={list} style={refColumn(rows)}>
      <TicketGroup
        stage="review"
        label="To review"
        count={rows.length}
        folded={folded}
        onFold={onFold}
      >
        {rows.map((row) => {
          const id = `${row.project.id}:${row.key}`;
          return (
            <TicketLine
              key={id}
              row={row}
              projectId={row.project.id}
              project={row.project}
              open={opened === id}
              onToggle={() => onOpen(id)}
              onChanged={onChanged}
            />
          );
        })}
      </TicketGroup>
    </div>
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
          className="tix-opened"
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
          <div className="tix-card">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Titles line up after the longest ticket number shown, no further. */
const refColumn = (rows: TicketRow[]) =>
  ({
    "--ref-ch": Math.max(3, ...rows.map((row) => row.ref.length)),
  }) as React.CSSProperties;

/** "#42" or a Jira key, with its source's mark in front. */
function TicketRef({ row }: { row: TicketRow }) {
  return (
    <span className={`bd-num ${row.source}`}>
      <span className="bd-source">
        {row.source === "jira" ? (
          <JiraIcon size={12} />
        ) : (
          <Github size={12} aria-hidden="true" />
        )}
      </span>
      {row.ref}
    </span>
  );
}

/** The next project's groups, drawn while its tickets load. */
function BuilderSkeleton() {
  return (
    <div className="tix-list" aria-busy="true" aria-label="Loading tickets">
      {[3, 2, 5].map((count, group) => (
        <div className="tix-group" key={group}>
          <div className="tix-ghead">
            <span className="sk sk-group" />
          </div>
          {Array.from({ length: count }, (_, i) => (
            <div className="tix-row sk-row" key={i}>
              <span
                className="sk sk-line"
                style={{ width: `${62 - ((group + i) % 4) * 9}%` }}
              />
              <span className="sk sk-when" />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
