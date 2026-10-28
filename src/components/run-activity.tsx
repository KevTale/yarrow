import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowRight,
  Ban,
  FilePlus2,
  FileText,
  Flag,
  FlaskConical,
  GitPullRequest,
  Globe,
  ListChecks,
  MessageSquareText,
  Pencil,
  Search,
  Terminal,
} from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import {
  groupActivity,
  milestone,
  reachedStages,
  shortCommand,
  stages,
  storyLines,
  type ActivityGroup as Group,
  type ActivityLine,
  type Stage,
} from "@/core/activity";
import { modelDisplayName } from "@/core/pipeline";
import type { RunActivity } from "@/db/queries";
import { getRunActivityFn } from "@/functions/public.functions";
import { Spinner } from "@/components/navigation-feedback";

const phaseLabel: Record<string, string> = {
  implementing: "Claude Opus is working on it",
  "checking clarity": "GPT Astra checks the ticket",
  reviewing: "GPT Astra reviews the change",
  "re-reviewing": "GPT Astra reviews the fixes",
  fixing: "Claude Opus fixes what the review found",
  delivering: "Opening the pull request",
};

const icons: Record<ActivityLine["kind"], ReactNode> = {
  read: <FileText size={14} />,
  search: <Search size={14} />,
  edit: <Pencil size={14} />,
  write: <FilePlus2 size={14} />,
  command: <Terminal size={14} />,
  test: <FlaskConical size={14} />,
  web: <Globe size={14} />,
  note: <MessageSquareText size={14} />,
  error: <AlertTriangle size={14} />,
  phase: <Flag size={14} />,
  review: <ListChecks size={14} />,
  outcome: <GitPullRequest size={14} />,
};

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** A script shows as its first line. */
const oneLine = (command: string) => shortCommand(command).split("\n")[0];

function Code({ children }: { children: ReactNode }) {
  return <code className="ra-code">{children}</code>;
}

const markdownLink = /^\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)$/;
const bareUrl = /^https?:\/\//;

/** A link the agents wrote, opened in a new tab. */
function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a className="rich-link" href={href} target="_blank" rel="noopener">
      {children}
    </a>
  );
}

/**
 * The agents write Markdown: `code`, **bold** and [links](https://…) read
 * as such, and a bare https:// address is a link too.
 */
export function Rich({ text }: { text: string }) {
  return text
    .split(
      /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s<>()`]+)/,
    )
    .map((part, i) => {
      if (/^`.+`$/.test(part)) return <code key={i}>{part.slice(1, -1)}</code>;
      if (/^\*\*.+\*\*$/.test(part))
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      const link = markdownLink.exec(part);
      if (link)
        return (
          <External key={i} href={link[2]!}>
            {link[1]}
          </External>
        );
      if (bareUrl.test(part)) {
        // A sentence's last stop is not part of the address.
        const url = part.replace(/[.,;:!?'"]+$/, "");
        return (
          <Fragment key={i}>
            <External href={url}>{url}</External>
            {part.slice(url.length)}
          </Fragment>
        );
      }
      return part;
    });
}

const image = /\.(png|jpe?g|webp|gif)$/i;

/** One line of the feed, in plain words. */
function Describe({ group, live }: { group: Group; live: boolean }) {
  const { detail } = group;
  const result =
    detail.ok === undefined ? (
      live ? (
        <Spinner />
      ) : null
    ) : (
      <span className={`ra-result ${detail.ok ? "ok" : "ko"}`}>
        {detail.passed !== undefined || detail.failed !== undefined
          ? [
              detail.passed !== undefined && `${detail.passed} passed`,
              detail.failed && `${detail.failed} failed`,
            ]
              .filter(Boolean)
              .join(" · ")
          : detail.ok
            ? "done"
            : "failed"}
      </span>
    );
  switch (group.kind) {
    case "read":
      if (group.count === 1 && detail.path && image.test(detail.path))
        return (
          <>
            Looked at the screenshot{" "}
            <Code>{detail.path.split("/").at(-1)}</Code>
          </>
        );
      return (
        <>
          {group.count > 1 ? `Read ${plural(group.count, "file")}` : "Read"}
          {detail.path && <Code>{detail.path}</Code>}
        </>
      );
    case "search":
      return (
        <>
          {group.count > 1 ? `Searched ${group.count} times` : "Searched"}
          {detail.pattern && <Code>{detail.pattern}</Code>}
        </>
      );
    case "edit":
      return (
        <>
          Edited {detail.path ? <Code>{detail.path}</Code> : "a file"}
          <span className="ra-diff">
            <span className="add">+{detail.added ?? 0}</span>
            <span className="del">−{detail.removed ?? 0}</span>
          </span>
        </>
      );
    case "write":
      return (
        <>
          Created {detail.path ? <Code>{detail.path}</Code> : "a file"}
          {detail.lines !== undefined && (
            <span className="ra-diff">
              <span className="add">+{detail.lines}</span>
            </span>
          )}
        </>
      );
    case "test":
      return (
        <>
          <span title={detail.command && oneLine(detail.command)}>
            Ran the tests
          </span>
          {result}
        </>
      );
    case "command":
      return (
        <>
          Ran{" "}
          {detail.command ? (
            <Code>{oneLine(detail.command)}</Code>
          ) : (
            "a command"
          )}
          {detail.ok === false && result}
        </>
      );
    case "web":
      return (
        <>
          Looked up{" "}
          {(detail.url ?? detail.text) ? (
            <Code>{detail.url ?? detail.text}</Code>
          ) : (
            "the web"
          )}
        </>
      );
    case "note":
      return detail.text ? (
        <span className="ra-note">
          <Rich text={detail.text} />
        </span>
      ) : (
        <>Wrote a note</>
      );
    case "error":
      return (
        <span className="ra-error">
          {detail.text ?? "The session hit an error"}
        </span>
      );
    case "phase":
      return <strong>{phaseLabel[detail.phase ?? ""] ?? detail.phase}</strong>;
    case "review":
      return (
        <>
          GPT Astra reviewed:{" "}
          {detail.failed
            ? `${plural(detail.failed, "point")} to fix`
            : "nothing blocking"}
          {detail.passed ? `, ${plural(detail.passed, "suggestion")}` : ""}
        </>
      );
    case "outcome":
      return (
        <strong>
          {detail.phase === "pull_request"
            ? "Pull request opened"
            : "Yarrow stopped"}
        </strong>
      );
  }
}

function time(at: string) {
  return new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityList({
  lines,
  live,
}: {
  lines: ActivityLine[];
  live: boolean;
}) {
  const shown = groupActivity(lines);
  return (
    <ol className="ra-list">
      {shown.map((group, i) => (
        <li
          key={group.externalId}
          className={`ra-line k-${group.kind} ${group.kind === "outcome" && group.detail.phase === "abstained" ? "stopped" : ""}`}
        >
          <span className="ra-icon" aria-hidden="true">
            {group.kind === "outcome" && group.detail.phase === "abstained" ? (
              <Ban size={14} />
            ) : (
              icons[group.kind]
            )}
          </span>
          <span className="ra-text">
            <Describe group={group} live={live && i === shown.length - 1} />
          </span>
          <time className="ra-time" dateTime={group.at}>
            {time(group.at)}
          </time>
        </li>
      ))}
    </ol>
  );
}

const stageLabel: Record<Stage, string> = {
  read: "Read",
  write: "Write",
  test: "Test",
  review: "Review",
  pr: "PR",
};

/** Read → Write → Test → Review → PR, lit as the run gets there. */
export function StageBar({ activity }: { activity: RunActivity }) {
  const reached = reachedStages(
    activity.lines,
    activity.phase,
    activity.outcome === "pull_request" ? "pull_request" : activity.status,
  );
  const current = [...stages].reverse().find((stage) => reached.has(stage));
  const running = activity.status === "running";
  return (
    <div className="ra-stages">
      {stages.map((stage) => (
        <span
          key={stage}
          className={`ra-stage ${reached.has(stage) ? "on" : ""} ${running && stage === current ? "now" : ""}`}
        >
          {stageLabel[stage]}
        </span>
      ))}
    </div>
  );
}

// Runs before questions were stored one per line.
const legacyUnclear =
  "Implementer and reviewer both found the ticket unclear: ";
const asLines = (summary: string) =>
  (summary.startsWith(legacyUnclear)
    ? summary
        .slice(legacyUnclear.length)
        .split(/(?<=\?)\s+/)
        .map((question) => `- ${question}`)
    : summary.split("\n")
  ).map((line) => line.trim());

const stopTitle: Record<string, string> = {
  ticket_unclear: "The ticket needs more detail",
  provider_error: "An AI provider failed",
  provider_out_of_credit: "Back in the queue",
  github_refused: "GitHub refused the change",
  platform_error: "Yarrow failed",
};

/**
 * Why the agents stopped, in their words when the viewer may read them.
 * Their questions ("- …" lines) show as a list; the card keeps two.
 */
export function StopReason({
  reason,
  summary,
  compact = false,
}: {
  reason: string | null;
  summary: string | null;
  compact?: boolean;
}) {
  const lines = asLines(summary ?? "");
  const questions = lines
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));
  const text = lines.filter((line) => line && !line.startsWith("- ")).join(" ");
  const shown = compact ? questions.slice(0, 2) : questions;
  return (
    <div className={`ra-stop ${compact ? "compact" : ""}`} role="status">
      <strong>
        <Ban size={14} aria-hidden="true" />
        {stopTitle[reason ?? ""] ?? "Yarrow stopped"}
      </strong>
      {text && <p>{text}</p>}
      {shown.length > 0 && (
        <ul>
          {shown.map((question) => (
            <li key={question}>{question}</li>
          ))}
        </ul>
      )}
      {shown.length < questions.length && (
        <span className="ra-stop-more">
          +{plural(questions.length - shown.length, "more question")}
        </span>
      )}
    </div>
  );
}

/** Polls the feed while it is open and the run works. */
export function useRunActivity(runId: string | null, every = 5_000) {
  const load = useServerFn(getRunActivityFn);
  const [activity, setActivity] = useState<RunActivity | null>(null);
  const [failed, setFailed] = useState(false);
  const running = activity?.status === "running";
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const next = await load({ data: { runId } });
        if (stopped) return;
        setActivity(next);
        if (next.status === "running") timer = setTimeout(tick, every);
      } catch {
        if (!stopped) setFailed(true);
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [runId, load, every]);
  return { activity, failed, running };
}

/**
 * Hovering a ticket's status opens its last actions; the card links to the
 * run's page for the whole story.
 */
export function RunHover({
  runId,
  children,
  link = true,
}: {
  runId: string;
  children: ReactNode;
  /** False inside a row that is already a link (no link in a link). */
  link?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const timers = useRef<{ show?: number; hide?: number }>({});
  const show = () => {
    clearTimeout(timers.current.hide);
    timers.current.show = window.setTimeout(() => setOpen(true), 250);
  };
  const hide = () => {
    clearTimeout(timers.current.show);
    timers.current.hide = window.setTimeout(() => setOpen(false), 200);
  };
  useEffect(() => {
    const current = timers.current;
    return () => {
      clearTimeout(current.show);
      clearTimeout(current.hide);
    };
  }, []);
  return (
    <span
      className="ra-hover"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {open && <RunCard runId={runId} link={link} />}
    </span>
  );
}

/**
 * The run at a glance: its milestones, what the agent does right now while
 * it works, and once the PR is open, its summary.
 */
function glance(activity: RunActivity, running: boolean) {
  const story = storyLines(activity.lines);
  const last = story.map(milestone).lastIndexOf(true);
  const now = running ? story.slice(last + 1).slice(-3) : [];
  return [...story.slice(0, last + 1).filter(milestone), ...now];
}

/** The implementer's summary, a few lines, signed by its model. */
function Summary({ activity }: { activity: RunActivity }) {
  if (activity.outcome !== "pull_request" || !activity.summary) return null;
  return (
    <div className="ra-summary">
      <span>{modelDisplayName(activity.implementer)}</span>
      <p>
        <Rich text={activity.summary} />
      </p>
    </div>
  );
}

function RunCard({ runId, link }: { runId: string; link: boolean }) {
  const { activity, failed, running } = useRunActivity(runId);
  const total = activity ? groupActivity(storyLines(activity.lines)).length : 0;
  return (
    <div className="ra-card" role="dialog" aria-label="Run activity">
      {!activity ? (
        failed ? (
          <p className="muted ra-empty">The activity could not be read.</p>
        ) : (
          <p className="muted ra-empty">
            <Spinner /> Reading the activity…
          </p>
        )
      ) : (
        <>
          <StageBar activity={activity} />
          {activity.outcome === "abstained" && (
            <StopReason
              reason={activity.abstentionReason}
              summary={activity.summary}
              compact
            />
          )}
          {activity.lines.length === 0 ? (
            <p className="muted ra-empty">
              {running ? "The agent is starting." : "No activity was recorded."}
            </p>
          ) : (
            <ActivityList lines={glance(activity, running)} live={running} />
          )}
          <Summary activity={activity} />
          {link && (
            <Link to="/runs/$runId" params={{ runId }} className="ra-more">
              {`View all · ${plural(total, "step")}`}
              <ArrowRight size={13} />
            </Link>
          )}
        </>
      )}
    </div>
  );
}

/** The run page's whole feed, live while the run works. */
export function RunFeed({ runId }: { runId: string }) {
  const { activity, failed, running } = useRunActivity(runId);
  if (!activity)
    return (
      <section className="panel ra-feed">
        <p className="eyebrow">ACTIVITY</p>
        <p className="muted">
          {failed ? "The activity could not be read." : "Reading the activity…"}
        </p>
      </section>
    );
  return (
    <section className="panel ra-feed">
      <div className="ra-feed-head">
        <p className="eyebrow">ACTIVITY</p>
        {running && (
          <span className="ra-live">
            <span className="live-dot" aria-hidden="true" /> Live
          </span>
        )}
      </div>
      <StageBar activity={activity} />
      {activity.lines.length === 0 ? (
        <p className="muted">
          {running
            ? "The agent is starting."
            : "No activity was recorded for this run."}
        </p>
      ) : (
        <ActivityList lines={storyLines(activity.lines)} live={running} />
      )}
      {!activity.detailed && (
        <p className="ra-private">
          This project is listed: its files, commands and notes stay private.
        </p>
      )}
    </section>
  );
}
