import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Eye,
  FileDiff,
  GitCommitHorizontal,
  GitMerge,
  GitPullRequest,
  Link2,
  ScanSearch,
  Ticket,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { money } from "@/core/packs";
import { modelShortName } from "@/core/pipeline";
import { formatSeconds } from "@/core/tickets";
import {
  getPullFilesFn,
  getPullPanelFn,
  pullRequestActionFn,
  requestChangeFn,
} from "@/functions/builder.functions";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { Logo } from "@/components/boards";
import { Spinner } from "@/components/navigation-feedback";
import { Rich } from "@/components/run-activity";
import { timeAgo } from "@/components/ui";
import { SponsorLink } from "./paid-by";
import { shortSite } from "@/core/pr-card";

type Panel = NonNullable<Awaited<ReturnType<typeof getPullPanelFn>>>;
type Files = NonNullable<Awaited<ReturnType<typeof getPullFilesFn>>>;

/**
 * What a row showed last, kept for this page's life: it opens at once with
 * it and refreshes behind. The changes are kept by their size, so a new
 * commit reads them again.
 */
const panels = new Map<string, Panel>();
const changes = new Map<string, { size: string; files: Files }>();
const inflight = new Map<string, Promise<Panel | null>>();

const cacheKey = (projectId: string, key: string) => `${projectId}:${key}`;

function fetchPanel(projectId: string, key: string): Promise<Panel | null> {
  const id = cacheKey(projectId, key);
  const pending = inflight.get(id);
  if (pending) return pending;
  const request = getPullPanelFn({ data: { projectId, key } })
    .then((panel) => {
      if (panel) panels.set(id, panel);
      return panel;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, request);
  return request;
}

/** Reads a row before it opens (hover, focus, To review on arrival). */
export function prefetchPullPanel(projectId: string, key: string): void {
  if (panels.has(cacheKey(projectId, key))) return;
  void fetchPanel(projectId, key).catch(() => {});
}

/**
 * A ticket's row, opened: what the agents did and what to watch on the
 * left, the decisions on the right (merge, ready for review, the changes,
 * GitHub), who paid and what it cost; a change asked from here goes to
 * the pull request. The changes open under it, on demand.
 */
export function PullPanel({
  projectId,
  rowKey,
  ticketUrl,
  onChanged,
}: {
  projectId: string;
  rowKey: string;
  /** The ticket in its tracker, beside the pull request's own link. */
  ticketUrl?: string;
  /** The table's row moved (merged, a correction started). */
  onChanged: () => void;
}) {
  const id = cacheKey(projectId, rowKey);
  const [panel, setPanel] = useState<Panel | null | undefined>(() =>
    panels.get(id),
  );
  const [showChanges, setShowChanges] = useState(false);

  const refresh = useCallback(
    () =>
      fetchPanel(projectId, rowKey)
        .then(setPanel)
        // A failed refresh keeps what is shown.
        .catch(() => setPanel((shown) => shown ?? null)),
    [projectId, rowKey],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A correction on its way: follow it until its commit lands.
  const busy =
    panel &&
    (panel.working !== null ||
      panel.corrections.some(
        (correction) =>
          correction.status === "queued" || correction.status === "working",
      ));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void refresh(), 5_000);
    return () => clearInterval(timer);
  }, [busy, refresh]);

  if (panel === undefined) return <PanelSkeleton />;
  if (panel === null)
    return <p className="pp pp-none muted">Nothing to show for this ticket</p>;

  const { live, pullRequest } = panel;
  const open = pullRequest?.state === "open" && live?.open !== false;
  return (
    <div className="pp">
      <div className="pp-grid">
        <div className="pp-main">
          {panel.implementation && (
            <Implementation
              implementation={panel.implementation}
              legacyRisks={live?.risks ?? []}
            />
          )}

          {panel.review && (
            <section className="pp-section">
              <h3>
                Review <span>by {panel.review.by}</span>
                <em className={panel.review.approved ? "ok" : "warn"}>
                  {panel.review.approved ? "Approved" : "Changes requested"}
                </em>
              </h3>
              <p className="pp-text">
                <Rich text={panel.review.summary} />
              </p>
              {panel.review.suggestions.length > 0 && (
                <ul className="pp-list">
                  {panel.review.suggestions.map((suggestion, i) => (
                    <li key={i}>
                      <ChevronRight size={15} aria-hidden="true" />
                      <span>
                        {suggestion.path && (
                          <code>
                            {suggestion.path}
                            {suggestion.line ? `:${suggestion.line}` : ""}
                          </code>
                        )}{" "}
                        <Rich text={suggestion.body} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {panel.corrections.length > 0 && (
            <ChangesAsked
              // A new change asked opens alone, the others shut.
              key={panel.corrections.length}
              corrections={panel.corrections}
              working={workingText(panel)}
            />
          )}

          {open && pullRequest && (
            <Composer
              projectId={projectId}
              rowKey={rowKey}
              onSending={(instruction) =>
                setPanel((shown) =>
                  shown
                    ? {
                        ...shown,
                        corrections: [
                          ...shown.corrections,
                          {
                            instruction,
                            requestedBy: "You",
                            askedAt: new Date().toISOString(),
                            status: "queued",
                            summary: null,
                            approved: null,
                          },
                        ],
                      }
                    : shown,
                )
              }
              onSent={() => {
                void refresh();
                onChanged();
              }}
              onFailed={() => void refresh()}
            />
          )}
        </div>

        <aside className="pp-aside">
          {pullRequest && (
            <Decisions
              projectId={projectId}
              rowKey={rowKey}
              open={open}
              busy={Boolean(busy)}
              draft={live?.draft ?? false}
              merged={pullRequest.state === "merged" || live?.merged === true}
              url={pullRequest.url}
              ticketUrl={ticketUrl}
              runId={panel.runId}
              changes={
                live ? { add: live.additions, del: live.deletions } : null
              }
              showChanges={showChanges}
              onChanges={() => setShowChanges((shown) => !shown)}
              onDone={() => {
                void refresh();
                onChanged();
              }}
            />
          )}

          {panel.paidBy.length > 0 && (
            <div className="pp-paid">
              <span className="pp-label">Paid by</span>
              {panel.paidBy.map((sponsor, i) => (
                <SponsorLink key={i} sponsor={sponsor} className="pp-sponsor">
                  <Logo
                    name={sponsor.name}
                    url={sponsor.logoUrl}
                    size="small"
                  />
                  <span>
                    <strong>{sponsor.name ?? "Anonymous sponsor"}</strong>
                    {sponsor.description && <span>{sponsor.description}</span>}
                    {sponsor.websiteUrl && (
                      <span className="pp-site">
                        {shortSite(sponsor.websiteUrl) ?? sponsor.websiteUrl}
                      </span>
                    )}
                  </span>
                </SponsorLink>
              ))}
            </div>
          )}
          {panel.models.length > 0 && (
            <dl className="pp-facts">
              {panel.models.map((model) => (
                <div key={model.role}>
                  <dt>{model.name}</dt>
                  <dd>
                    {model.seconds !== null &&
                      `${model.secondsExact ? "" : "≈ "}${formatSeconds(model.seconds)} · `}
                    {model.costExact ? "" : "≈ "}
                    {money(model.costCents)}
                  </dd>
                </div>
              ))}
              <div className="pp-total">
                <dt>Total</dt>
                <dd>
                  {panel.totalSeconds !== null &&
                    `${formatSeconds(panel.totalSeconds)} · `}
                  {money(panel.totalCents)}
                </dd>
              </div>
            </dl>
          )}
        </aside>
      </div>

      {showChanges && (
        <Changes
          projectId={projectId}
          rowKey={rowKey}
          url={pullRequest?.url}
          size={
            live
              ? `${live.additions}:${live.deletions}:${live.changedFiles}`
              : ""
          }
        />
      )}
    </div>
  );
}

/** What a change at work is doing, named after its model. */
function workingText(panel: Panel): string | null {
  const model = (role: "implementer" | "reviewer") => {
    const name = panel.models.find(
      (candidate) => candidate.role === role,
    )?.name;
    return name ? modelShortName(name) : null;
  };
  switch (panel.working) {
    case "writing":
      return `${model("implementer") ?? "Claude"} is writing the change`;
    case "reviewing":
      return `${model("reviewer") ?? "The reviewer"} is reviewing the change`;
    case "delivering":
      return "Adding the commit";
    default:
      return null;
  }
}

/**
 * What the pull request does now, in the implementer's words: the summary,
 * what it ran and could not run, what the owner must act on, and what it
 * saw outside the ticket.
 */
function Implementation({
  implementation,
  legacyRisks,
}: {
  implementation: NonNullable<Panel["implementation"]>;
  /** Pull requests delivered before these were apart: their Risks. */
  legacyRisks: string[];
}) {
  const notes = implementation.legacy ? legacyRisks : [];
  return (
    <section className="pp-section">
      <h3>
        Implementation <span>by {implementation.by}</span>
      </h3>
      <p className="pp-text">
        <Rich text={implementation.summary} />
      </p>
      <ul className="pp-list">
        {implementation.verification.map((line) => (
          <li key={`v${line}`}>
            <CircleCheck size={15} className="ok" aria-hidden="true" />
            <span>
              <Rich text={line} />
            </span>
          </li>
        ))}
        {implementation.notVerified.map((line) => (
          <li key={`n${line}`}>
            <CircleDashed size={15} aria-label="Not run" />
            <span>
              <Rich text={line} />
            </span>
          </li>
        ))}
        {notes.map((line) => (
          <li key={`l${line}`}>
            <Eye size={15} aria-hidden="true" />
            <span>
              <Rich text={line} />
            </span>
          </li>
        ))}
        {implementation.risks.map((line) => (
          <li key={`r${line}`} className="pp-risk">
            <TriangleAlert size={15} className="warn" aria-hidden="true" />
            <span>
              <Rich text={line} />
            </span>
          </li>
        ))}
      </ul>
      {implementation.spotted.length > 0 && (
        <div className="pp-spotted">
          <h4>Spotted outside this ticket</h4>
          <ul className="pp-list">
            {implementation.spotted.map((line) => (
              <li key={line}>
                <ScanSearch size={15} aria-hidden="true" />
                <span>
                  <Rich text={line} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Every change asked since the pull request opened, oldest first, above
 * the composer that adds the next one. The latest is open; the others fold
 * to one line and open on a click.
 */
function ChangesAsked({
  corrections,
  working,
}: {
  corrections: Panel["corrections"];
  working: string | null;
}) {
  const last = corrections.length - 1;
  // The ones the builder flipped: the latest starts open, the others shut.
  const [flipped, setFlipped] = useState<Set<number>>(() => new Set());
  return (
    <section className="pp-section">
      <h3>
        Changes asked <span className="pp-num">{corrections.length}</span>
      </h3>
      <ol className="pp-thread">
        {corrections.map((correction, i) => {
          const isOpen = (i === last) !== flipped.has(i);
          const state =
            correction.status === "queued" ? (
              <span className="pp-state">Queued</span>
            ) : correction.status === "working" ? (
              <span className="pp-state live">
                <TextShimmer>{working ?? "Working on it"}</TextShimmer>
              </span>
            ) : correction.status === "stopped" ? (
              <span className="pp-state stopped">Stopped</span>
            ) : null;
          const verdict =
            correction.status === "done" && correction.approved !== null ? (
              <em className={correction.approved ? "ok" : "warn"}>
                {correction.approved ? "Approved" : "Changes requested"}
              </em>
            ) : null;
          const live =
            correction.status === "queued" || correction.status === "working";
          return (
            <li key={i} className={live ? "live" : ""}>
              <span className="pp-node" aria-hidden="true">
                {correction.requestedBy.slice(0, 1).toUpperCase()}
              </span>
              <div className="pp-change">
                <button
                  type="button"
                  className="pp-change-head"
                  aria-expanded={isOpen}
                  onClick={() =>
                    setFlipped((current) => {
                      const next = new Set(current);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                >
                  <b>{correction.requestedBy}</b>
                  {isOpen ? (
                    <span className="pp-grow" />
                  ) : (
                    <span className="pp-ask-line">
                      {correction.instruction}
                    </span>
                  )}
                  {verdict}
                  <time dateTime={correction.askedAt}>
                    {timeAgo(correction.askedAt)}
                  </time>
                  {isOpen ? (
                    <ChevronDown size={14} aria-hidden="true" />
                  ) : (
                    <ChevronRight size={14} aria-hidden="true" />
                  )}
                </button>
                {isOpen && (
                  <>
                    <p className="pp-ask">{correction.instruction}</p>
                    {state}
                    {correction.status === "done" && correction.summary && (
                      <p className="pp-done">
                        <GitCommitHorizontal
                          size={15}
                          className="ok"
                          aria-hidden="true"
                        />
                        <span>
                          <Rich text={correction.summary} />
                        </span>
                      </p>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Merge, Ready for review, the changes and GitHub: the builder's decisions. */
function Decisions({
  projectId,
  rowKey,
  open,
  busy,
  draft,
  merged,
  url,
  ticketUrl,
  runId,
  changes,
  showChanges,
  onChanges,
  onDone,
}: {
  projectId: string;
  rowKey: string;
  open: boolean;
  /** A change at work: merging now would leave its commit out. */
  busy: boolean;
  draft: boolean;
  merged: boolean;
  url: string;
  ticketUrl?: string;
  runId: string | null;
  changes: { add: number; del: number } | null;
  showChanges: boolean;
  onChanges: () => void;
  onDone: () => void;
}) {
  const act = useServerFn(pullRequestActionFn);
  const [pending, setPending] = useState<"ready" | "merge" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  // Merging asks twice: the second click within a few seconds merges.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 4_000);
    return () => clearTimeout(timer);
  }, [confirming]);

  async function run(action: "ready" | "merge") {
    if (pending || (action === "merge" && busy)) return;
    if (action === "merge" && !confirming) return setConfirming(true);
    setConfirming(false);
    setError("");
    setPending(action);
    try {
      const result = await act({ data: { projectId, key: rowKey, action } });
      if (result.ok) onDone();
      else setError(result.error);
    } catch {
      setError("That did not go through. Try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="pp-actions">
      {merged ? (
        <span className="pp-merged">
          <GitMerge size={16} aria-hidden="true" /> Merged
        </span>
      ) : (
        open && (
          <>
            <button
              type="button"
              className={`pp-btn merge ${confirming ? "confirm" : ""}`}
              aria-busy={pending === "merge"}
              aria-disabled={busy}
              onClick={() => void run("merge")}
            >
              {pending === "merge" ? (
                <Spinner />
              ) : (
                <GitMerge size={16} aria-hidden="true" />
              )}
              {confirming ? "Confirm merge" : "Merge"}
            </button>
            {draft && (
              <button
                type="button"
                className="pp-btn"
                aria-busy={pending === "ready"}
                onClick={() => void run("ready")}
              >
                {pending === "ready" ? (
                  <Spinner />
                ) : (
                  <GitPullRequest size={16} aria-hidden="true" />
                )}
                Ready for review
              </button>
            )}
          </>
        )
      )}
      <button
        type="button"
        className={`pp-btn ${showChanges ? "pressed" : ""}`}
        aria-pressed={showChanges}
        onClick={onChanges}
      >
        <FileDiff size={16} aria-hidden="true" />
        {showChanges ? "Hide changes" : "Changes"}
        {changes && (
          <span className="pp-count">
            <span className="add">+{changes.add}</span>{" "}
            <span className="del">−{changes.del}</span>
          </span>
        )}
      </button>
      <div className="pp-links">
        <a className="pp-github" href={url} target="_blank" rel="noopener">
          <GitPullRequest size={14} aria-hidden="true" />
          PR
        </a>
        {ticketUrl && (
          <a
            className="pp-github"
            href={ticketUrl}
            target="_blank"
            rel="noopener"
          >
            <Ticket size={14} aria-hidden="true" />
            Ticket
          </a>
        )}
        {runId && <Share runId={runId} />}
      </div>
      {error && (
        <p className="pp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Copies the run's public page, and says so. */
function Share({ runId }: { runId: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2_000);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={`pp-github pp-share ${copied ? "copied" : ""}`}
      onClick={() => {
        const link = `${window.location.origin}/runs/${runId}`;
        void navigator.clipboard
          .writeText(link)
          .then(() => setCopied(true))
          .catch(() => window.open(link, "_blank", "noopener"));
      }}
    >
      {copied ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <Link2 size={14} aria-hidden="true" />
      )}
      <span aria-live="polite">{copied ? "Link copied" : "Share"}</span>
    </button>
  );
}

/** Ask for another change: written on the PR, then taken by Claude. */
function Composer({
  projectId,
  rowKey,
  onSending,
  onSent,
  onFailed,
}: {
  projectId: string;
  rowKey: string;
  /** The change shows in the thread before GitHub answers. */
  onSending: (instruction: string) => void;
  onSent: () => void;
  onFailed: () => void;
}) {
  const send = useServerFn(requestChangeFn);
  const [text, setText] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const instruction = text.trim();
    if (!instruction || pending) return;
    setError("");
    setPending(true);
    setText("");
    onSending(instruction);
    try {
      const result = await send({
        data: { projectId, key: rowKey, instruction },
      });
      if (result.ok) onSent();
      else {
        setText(instruction);
        setError(result.error);
        onFailed();
      }
    } catch {
      setText(instruction);
      setError("That did not go through. Try again.");
      onFailed();
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="pp-composer"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        aria-label="Ask for a change"
        placeholder="Ask for a change…"
        rows={3}
        value={text}
        maxLength={4000}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void submit();
          }
        }}
      />
      <div className="pp-composer-foot">
        {error && (
          <span className="pp-error" role="alert">
            {error}
          </span>
        )}
        <button
          type="submit"
          className="pp-send"
          aria-disabled={!text.trim() || pending}
        >
          Send {pending ? <Spinner /> : <ArrowUp size={15} strokeWidth={2.2} />}
        </button>
      </div>
    </form>
  );
}

/** The pull request's files, each folding, read from GitHub when opened. */
function Changes({
  projectId,
  rowKey,
  url,
  size,
}: {
  projectId: string;
  rowKey: string;
  url?: string;
  /** Lines and files changed: a different size is a new commit. */
  size: string;
}) {
  const load = useServerFn(getPullFilesFn);
  const id = cacheKey(projectId, rowKey);
  const kept = changes.get(id);
  const [files, setFiles] = useState<Files | null | undefined>(
    kept && kept.size === size ? kept.files : undefined,
  );
  // Long changes open on their first file only.
  const [folded, setFolded] = useState<Set<string>>(() =>
    kept ? foldLong(kept.files) : new Set(),
  );

  useEffect(() => {
    const cached = changes.get(id);
    if (cached && cached.size === size) return;
    let live = true;
    load({ data: { projectId, key: rowKey } })
      .then((result) => {
        if (!live) return;
        setFiles(result);
        if (!result) return;
        changes.set(id, { size, files: result });
        setFolded(foldLong(result));
      })
      .catch(() => live && setFiles(null));
    return () => {
      live = false;
    };
  }, [load, id, projectId, rowKey, size]);

  if (files === undefined) return <FilesSkeleton />;
  if (files === null)
    return (
      <p className="pp-files pp-none muted">
        GitHub did not answer.{" "}
        {url && (
          <a href={`${url}/files`} target="_blank" rel="noopener">
            See the changes on GitHub
          </a>
        )}
      </p>
    );

  return (
    <div className="pp-files">
      {files.map((file) => {
        const isFolded = folded.has(file.path);
        const slash = file.path.lastIndexOf("/");
        return (
          <div key={file.path} className="pp-file">
            <button
              type="button"
              className="pp-file-head"
              aria-expanded={!isFolded}
              onClick={() =>
                setFolded((current) => {
                  const next = new Set(current);
                  if (next.has(file.path)) next.delete(file.path);
                  else next.add(file.path);
                  return next;
                })
              }
            >
              {isFolded ? (
                <ChevronRight size={15} aria-hidden="true" />
              ) : (
                <ChevronDown size={15} aria-hidden="true" />
              )}
              <span className="pp-path">
                {file.path.slice(0, slash + 1)}
                <b>{file.path.slice(slash + 1)}</b>
              </span>
              <span className="pp-count">
                <span className="add">+{file.additions}</span>{" "}
                <span className="del">−{file.deletions}</span>
              </span>
            </button>
            {!isFolded &&
              (file.lines ? (
                <div className="pp-diff" role="table" aria-label={file.path}>
                  {file.lines.map((line, i) =>
                    line.kind === "hunk" ? (
                      <div key={i} className="pp-hunk" role="row">
                        {line.text}
                      </div>
                    ) : (
                      <div
                        key={i}
                        className={`pp-line ${line.kind}`}
                        role="row"
                      >
                        <span className="n">
                          {line.kind === "add" ? "" : line.old}
                        </span>
                        <span className="n">
                          {line.kind === "del" ? "" : line.new}
                        </span>
                        <span className="s">
                          {line.kind === "add"
                            ? "+"
                            : line.kind === "del"
                              ? "−"
                              : ""}
                        </span>
                        <span className="c">{line.text}</span>
                      </div>
                    ),
                  )}
                </div>
              ) : (
                <p className="pp-none muted">No preview for this file</p>
              ))}
          </div>
        );
      })}
    </div>
  );
}

/** Past 400 lines, only the first file opens. */
function foldLong(files: Files): Set<string> {
  const lines = files.reduce((sum, file) => sum + (file.lines?.length ?? 0), 0);
  return lines > 400
    ? new Set(files.slice(1).map((file) => file.path))
    : new Set();
}

/** The opened row's shape while it loads. */
function PanelSkeleton() {
  return (
    <div className="pp" aria-busy="true" aria-label="Loading the pull request">
      <div className="pp-grid">
        <div className="pp-main">
          {[
            ["40%", "96%", "88%", "62%"],
            ["30%", "92%", "54%"],
            ["24%", "80%", "70%"],
          ].map((widths, i) => (
            <div key={i} className="pp-section">
              {widths.map((width, j) => (
                <span
                  key={j}
                  className={`sk ${j === 0 ? "sk-title" : ""}`}
                  style={{ width }}
                />
              ))}
            </div>
          ))}
          <span className="sk sk-composer" />
        </div>
        <div className="pp-aside">
          <span className="sk sk-button" />
          <span className="sk sk-button" />
          <span className="sk sk-button" />
          <span className="sk sk-card" />
        </div>
      </div>
    </div>
  );
}

/** The changes' shape while GitHub answers. */
function FilesSkeleton() {
  return (
    <div className="pp-files" aria-busy="true" aria-label="Loading the changes">
      <div className="pp-file">
        <div className="pp-file-head">
          <span className="sk" style={{ width: "36%" }} />
        </div>
        <div className="sk-diff">
          {["58%", "74%", "40%", "66%", "82%", "48%", "70%", "36%"].map(
            (width, i) => (
              <span key={i} className="sk" style={{ width }} />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
