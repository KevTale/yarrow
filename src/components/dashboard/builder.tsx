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
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import { SearchField } from "@/components/arc/search-field/search-field";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import {
  mergeTickets,
  moving,
  ticketStage,
  toReview,
  workText,
  type TicketRow,
  type TicketStage as Stage,
} from "@/core/tickets";
import {
  createTicketFn,
  getBuilderFn,
  queueTicketsFn,
  retryTicketFn,
  setProjectLogoFn,
  unqueueTicketsFn,
} from "@/functions/builder.functions";
import { TrackerIcon } from "@/components/brand-icons";
import { LogoPicker } from "@/components/logo-picker";
import { longDate, useDateTime } from "@/components/ui";
import { useFlip, useLive } from "@/components/live";
import type { JiraStep } from "@/server/trackers/flow";
import { JiraCard } from "./jira-card";
import {
  DraftTicket,
  NewTicket,
  ticketDestination,
  type TicketDraft,
} from "./new-ticket";
import { ProjectSwitcher } from "./project-switcher";
import { SponsorCell } from "./paid-by";
import { RowMenu } from "./row-menu";
import { SlideGo } from "./slide-go";
import { prefetchPullPanel } from "./pull-panel";
import { prefetchTicket, TicketPanel, type TicketAct } from "./ticket-panel";
import { setReviewCount } from "@/components/review-count";

type BuilderData = Extract<
  Awaited<ReturnType<typeof getBuilderFn>>,
  { status: "ok" }
>;

/**
 * The groups, in the order the builder acts on them: what waits for them
 * first. "+" writes a ticket into To do, or into In progress, started.
 * Each ticket's group is `ticketStage`.
 */
const stages: {
  key: Stage;
  label: string;
  add?: "create" | "start";
}[] = [
  { key: "review", label: "To review" },
  { key: "progress", label: "In progress", add: "start" },
  { key: "todo", label: "To do", add: "create" },
  { key: "stopped", label: "Stopped" },
  { key: "done", label: "Done" },
];

/** Done keeps two weeks in view; older tickets wait behind "Show older". */
const RECENT_MS = 14 * 24 * 60 * 60 * 1000;

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
 * opening in place. The switcher counts what waits for review in each.
 */
export function BuilderView({
  data,
  highlight,
  waiting,
  projectId,
  jira = null,
}: {
  data: BuilderData;
  /** The ticket just pasted on the landing. */
  highlight: string | null;
  /** A repository still being connected after the GitHub install. */
  waiting: string | null;
  /** The project in the address; the loader's choice otherwise. */
  projectId?: string;
  /** A Jira link waiting for its repository or for Jira itself. */
  jira?: JiraStep | null;
}) {
  const navigate = useNavigate({ from: "/dashboard" });
  const refresh = useServerFn(getBuilderFn);
  const queue = useServerFn(queueTicketsFn);
  const unqueue = useServerFn(unqueueTicketsFn);
  const retry = useServerFn(retryTicketFn);
  const createTicket = useServerFn(createTicketFn);
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
  // The row opened in place ("projectId:key"), one at a time. It moves
  // with its ticket, open, to the group its state now says.
  const [opened, setOpened] = useState<string | null>(null);
  const [error, setError] = useState("");
  // The new ticket dialog, and whether it came from In progress; drafted
  // from a pull request's notes, in that pull request's project.
  const [composing, setComposing] = useState<{
    start: boolean;
    projectId?: string;
    drafts?: TicketDraft[];
    onMade?: (draft: TicketDraft) => void;
  } | null>(null);
  // Done past two weeks, shown on demand.
  const [older, setOlder] = useState(false);
  const [source, setSource] = useState({ data, highlight, jira });
  const [jiraStep, setJiraStep] = useState(jira);
  const currentId = projectId ?? data.project?.id ?? null;
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
  // The header's count, and each project's in the switcher, follow what
  // the page knows.
  const waitingReview = meta.review.filter(toReview);
  const toReviewCount = waitingReview.length;
  useEffect(() => setReviewCount(toReviewCount), [toReviewCount]);
  const reviewCounts: Record<string, number> = {};
  for (const row of waitingReview)
    reviewCounts[row.project.id] = (reviewCounts[row.project.id] ?? 0) + 1;

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
  const busy =
    rows.some(moving) || meta.review.some(moving) || waiting !== null;
  const topics = [currentId ? `project:${currentId}` : null];
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
  const list = useFlip<HTMLDivElement>(live, currentId ?? "");
  // The opened ticket moved (started, finished, merged): its new group
  // unfolds, so the row the builder is reading stays in view.
  const openedRow = rows.find((row) => `${currentId}:${row.key}` === opened);
  const openedStage = openedRow ? ticketStage(openedRow) : null;
  useEffect(() => {
    if (openedStage) unfold(openedStage);
    // Only when the opened row changes group, not on every fold.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedStage]);

  // "C" writes a ticket, as in the trackers builders know.
  const canWrite = Boolean(project?.linked && !composing);
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
    (row) =>
      !q ||
      `${row.ref} ${row.title} ${row.headline ?? ""}`.toLowerCase().includes(q),
  );
  const choose = (id: string) =>
    navigate({
      search: (current) => ({
        ...current,
        tab: "builder" as const,
        project: id,
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
  // Every linked project loads in the background.
  const composeIn = composing?.projectId
    ? (store[composing.projectId]?.project ?? null)
    : project;
  const tickets = {
    open: (
      id: string,
      drafts: TicketDraft[],
      onMade?: (draft: TicketDraft) => void,
    ) => {
      setComposing({ start: false, projectId: id, drafts, onMade });
      // Not read yet: the dialog opens once it is.
      if (!store[id]) void pull(id);
    },
    create: async (id: string, draft: TicketDraft) => {
      const result = await createTicket({
        data: {
          projectId: id,
          destination: ticketDestination(id, store[id]?.project?.boards ?? []),
          title: draft.title,
          body: draft.body,
          queue: false,
          from: draft.from,
        },
      });
      if (result.ok) {
        setFresh(result.key);
        issuesRead.delete(id);
        void pull(id);
      }
      return result;
    },
    show: (id: string, key: string) => {
      setQuery("");
      const row = rows.find((one) => one.key === key);
      unfold(row ? ticketStage(row) : "todo");
      setFresh(key);
      setOpened(`${id}:${key}`);
    },
  };

  return (
    <DraftTicket.Provider value={tickets}>
      <div className="bd">
        {jiraCard}
        <div className="tix-head">
          {project && (
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
            toReview={reviewCounts}
            onProject={choose}
          />
          {shownProject && (
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
          {project?.linked && (
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
        {loading ? (
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
                  <div
                    className="tix-list"
                    ref={list}
                    style={refColumn(matches)}
                  >
                    {stages.map((stage) => {
                      const shown = matches.filter(
                        (row) => ticketStage(row) === stage.key,
                      );
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
                          {(stage.key === "done" && !q && !older
                            ? shown.filter(
                                (row) =>
                                  Date.parse(row.updatedAt) >
                                  Date.now() - RECENT_MS,
                              )
                            : shown
                          ).map((row) => {
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
                          {stage.key === "done" && !q && (
                            <OlderToggle
                              count={
                                shown.filter(
                                  (row) =>
                                    Date.parse(row.updatedAt) <=
                                    Date.now() - RECENT_MS,
                                ).length
                              }
                              shown={older}
                              onToggle={() => setOlder((value) => !value)}
                            />
                          )}
                        </TicketGroup>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )
        )}
        {composing && composeIn && (
          <NewTicket
            projectId={composeIn.id}
            projectName={composeIn.name}
            boards={composeIn.boards}
            start={composing.start}
            drafts={composing.drafts}
            onClose={() => setComposing(null)}
            onCreated={(key, started, draft, more) => {
              composing.onMade?.(draft);
              if (!more) setComposing(null);
              setQuery("");
              // Where it now stands, lit like a pasted ticket.
              unfold(started ? "progress" : "todo");
              setFresh(key);
              issuesRead.delete(composeIn.id);
              void pull(composeIn.id);
            }}
          />
        )}
      </div>
    </DraftTicket.Provider>
  );
}

/** The foot of Done: the tickets closed more than two weeks ago. */
function OlderToggle({
  count,
  shown,
  onToggle,
}: {
  count: number;
  shown: boolean;
  onToggle: () => void;
}) {
  if (count === 0) return null;
  return (
    <li className="tix-older">
      <button type="button" aria-expanded={shown} onClick={onToggle}>
        {shown ? "Hide older" : `Show older (${count})`}
      </button>
    </li>
  );
}

/** A stage: its head folds it, its "+" writes a ticket into it. */
/** The five petals of Yarrow's flower, around its heart. */
const PETALS = [0, 1, 2, 3, 4].map((index) => {
  const angle = ((-90 + index * 72) * Math.PI) / 180;
  return { cx: 8 + 5.2 * Math.cos(angle), cy: 8 + 5.2 * Math.sin(angle) };
});

/**
 * A group's mark, drawn from Yarrow's flower rather than the usual circles:
 * To do its outline, In progress three petals out of five, To review every
 * petal, Done the whole flower with its heart; Stopped its outline in red,
 * a bar at its heart.
 */
function StageMark({ stage }: { stage: Stage }) {
  const filled =
    stage === "progress" ? 3 : stage === "review" || stage === "done" ? 5 : 0;
  return (
    <svg
      className={`tix-stage ${stage}`}
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      {PETALS.map((petal, index) => (
        <circle
          key={index}
          {...petal}
          r={index < filled ? 2.1 : 1.6}
          className={index < filled ? "full" : "bare"}
        />
      ))}
      {stage === "done" && <circle cx={8} cy={8} r={2.2} className="full" />}
      {stage === "stopped" && (
        <rect
          x={5.6}
          y={7.25}
          width={4.8}
          height={1.5}
          rx={0.75}
          className="full"
        />
      )}
    </svg>
  );
}

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
          <StageMark stage={stage} />
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
/** The page's scroll padding: what a row brought into view stays under. */
const OVER_ROW = 100;
/** What the member does that leaves the page to them. */
const TAKEN_OVER = ["wheel", "touchmove", "keydown", "pointerdown"] as const;

/**
 * An opened row comes to the middle of the window, or under the header when
 * it is taller, the whole time it and the page settle (what it holds loads,
 * the row closing elsewhere folds), until the member takes over.
 */
function useOpenedInView(row: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    const opened = row.current;
    if (!open || !opened) return;
    const settling = new ResizeObserver(() => {
      const fits = opened.offsetHeight < window.innerHeight - OVER_ROW;
      opened.scrollIntoView({ block: fits ? "center" : "start" });
    });
    settling.observe(opened);
    settling.observe(document.body);
    const stop = () => settling.disconnect();
    const settled = window.setTimeout(stop, 4000);
    for (const event of TAKEN_OVER)
      window.addEventListener(event, stop, { passive: true });
    return () => {
      stop();
      window.clearTimeout(settled);
      for (const event of TAKEN_OVER) window.removeEventListener(event, stop);
    };
  }, [row, open]);
}

function TicketLine({
  row,
  projectId,
  open,
  onToggle,
  fresh = false,
  onFreshEnd,
  act,
  onChanged,
}: {
  row: TicketRow;
  projectId: string;
  open: boolean;
  onToggle: () => void;
  fresh?: boolean;
  onFreshEnd?: () => void;
  act?: TicketAct;
  onChanged: () => void;
}) {
  const dateTime = useDateTime(row.createdAt);
  const item = useRef<HTMLLIElement>(null);
  useOpenedInView(item, open);
  const intent = () => {
    prefetchTicket(projectId, row.key);
    if (row.pullRequest) prefetchPullPanel(projectId, row.key);
  };
  return (
    <li ref={item} className={`tix-item ${open ? "open" : ""}`}>
      <div
        data-flip={`${projectId}:${row.key}`}
        data-flip-value={row.status}
        className={`tix-row ${open ? "open" : ""} ${fresh ? "fresh" : ""}`}
        onAnimationEnd={onFreshEnd}
      >
        <RowMenu row={row} projectId={projectId} onChanged={onChanged} />
        <button
          type="button"
          className="tix-open"
          aria-expanded={open}
          onClick={onToggle}
          onPointerEnter={intent}
          onFocus={intent}
        >
          <ChevronRight size={14} className="tix-chev" aria-hidden="true" />
          <TicketRef row={row} />
          <span className="tix-title" title={row.title}>
            {row.headline ?? row.title}
          </span>
        </button>
        <span className="tix-meta">
          <span className="tix-cell">
            <RowState row={row} />
            {act && row.status === "none" && (
              <SlideGo
                label="Start"
                icon={<Play size={10} fill="currentColor" aria-hidden="true" />}
                busy={row.pending}
                onGo={() => act("queue", [row.key])}
              />
            )}
            {act && row.status === "queued" && !row.pending && (
              <button
                type="button"
                className="tix-go quiet"
                onClick={() => act("unqueue", [row.key])}
              >
                <X size={12} aria-hidden="true" /> Cancel
              </button>
            )}
            {act && row.status === "abstained" && (
              <SlideGo
                label="Retry"
                icon={<RotateCcw size={12} aria-hidden="true" />}
                onGo={() => act("retry", [row.key])}
              />
            )}
          </span>
          <SponsorCell row={row} projectId={projectId} />
          <time
            className="tix-date"
            dateTime={row.createdAt}
            title={longDate(row.createdAt)}
          >
            {dateTime}
          </time>
        </span>
      </div>
      <OpenRow open={open}>
        <TicketPanel projectId={projectId} row={row} onChanged={onChanged} />
      </OpenRow>
    </li>
  );
}

/** Where a ticket stands, when the group does not say it all. */
function RowState({ row }: { row: TicketRow }) {
  // The pull request itself is in the opened row; the line says only what
  // is happening to it.
  if (row.pullRequest) {
    // A change asked on it: waiting its turn, then at work on the branch.
    if (row.change === "queued")
      return <span className="tix-state waiting">Waiting</span>;
    const work =
      row.change === "delivering"
        ? "Adding the commit"
        : workText(row.change ?? row.status, row.models);
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
  // "Claude Opus is writing": the model at work, as on the landing; its
  // activity is in the opened row.
  const work = workText(row.status, row.models);
  return work ? (
    <TextShimmer className="tix-state working">{work}</TextShimmer>
  ) : null;
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

/** "#42" or a Jira or Linear key, with its source's mark in front. */
function TicketRef({ row }: { row: TicketRow }) {
  return (
    <span className={`bd-num ${row.source}`}>
      <span className="bd-source">
        {row.source === "github" ? (
          <Github size={12} aria-hidden="true" />
        ) : (
          <TrackerIcon tracker={row.source} size={12} />
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
