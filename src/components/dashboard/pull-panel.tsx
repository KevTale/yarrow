import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUp,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  FileDiff,
  GitMerge,
  GitPullRequest,
  TriangleAlert,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { money } from "@/core/packs";
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

type Panel = NonNullable<Awaited<ReturnType<typeof getPullPanelFn>>>;
type Files = NonNullable<Awaited<ReturnType<typeof getPullFilesFn>>>;

const domain = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

const working = {
  writing: "Writing the change",
  reviewing: "Reviewing the change",
  delivering: "Adding the commit",
} as const;

/**
 * A ticket's row, opened: what the agents did and what to watch on the
 * left, the decisions on the right (merge, ready for review, the changes,
 * GitHub), who paid and what it cost; a change asked from here goes to
 * the pull request. The changes open under it, on demand.
 */
export function PullPanel({
  projectId,
  rowKey,
  onChanged,
}: {
  projectId: string;
  rowKey: string;
  /** The table's row moved (merged, a correction started). */
  onChanged: () => void;
}) {
  const load = useServerFn(getPullPanelFn);
  const [panel, setPanel] = useState<Panel | null | undefined>(undefined);
  const [showChanges, setShowChanges] = useState(false);

  const refresh = useCallback(
    () =>
      load({ data: { projectId, key: rowKey } })
        .then(setPanel)
        .catch(() => setPanel(null)),
    [load, projectId, rowKey],
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

  if (panel === undefined)
    return (
      <div className="pp pp-loading" role="status">
        <Spinner />
      </div>
    );
  if (panel === null)
    return <p className="pp pp-none muted">Nothing to show for this ticket</p>;

  const { live, pullRequest } = panel;
  const open = pullRequest?.state === "open" && live?.open !== false;
  return (
    <div className="pp">
      <div className="pp-grid">
        <div className="pp-main">
          {panel.implementation && (
            <section className="pp-section">
              <h3>
                What changed <span>by {panel.implementation.by}</span>
              </h3>
              <p className="pp-text">
                <Rich text={panel.implementation.summary} />
              </p>
              {panel.implementation.evidence.length > 0 && (
                <ul className="pp-list">
                  {panel.implementation.evidence.map((line) => (
                    <li key={line}>
                      <CircleCheck
                        size={15}
                        className="ok"
                        aria-hidden="true"
                      />
                      <span>
                        <Rich text={line} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {panel.corrections.length > 0 && (
            <section className="pp-section">
              <h3>Changes asked</h3>
              <ul className="pp-corrections">
                {panel.corrections.map((correction, i) => (
                  <li key={i}>
                    <p>
                      <b>{correction.requestedBy}</b> {correction.instruction}
                    </p>
                    {correction.status === "queued" && (
                      <span className="pp-state">Queued</span>
                    )}
                    {correction.status === "working" && panel.working && (
                      <span className="pp-state live">
                        <TextShimmer>{working[panel.working]}</TextShimmer>
                      </span>
                    )}
                    {correction.status === "done" && correction.summary && (
                      <p className="pp-text">
                        <Rich text={correction.summary} />
                      </p>
                    )}
                    {correction.status === "stopped" && (
                      <span className="pp-state stopped">Stopped</span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
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

          {live && live.risks.length > 0 && (
            <section className="pp-section">
              <h3>Watch out</h3>
              <ul className="pp-list">
                {live.risks.map((risk) => (
                  <li key={risk}>
                    <TriangleAlert
                      size={15}
                      className="warn"
                      aria-hidden="true"
                    />
                    <span>
                      <Rich text={risk} />
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {open && pullRequest && (
            <Composer
              projectId={projectId}
              rowKey={rowKey}
              number={pullRequest.number}
              onSent={() => {
                void refresh();
                onChanged();
              }}
            />
          )}
        </div>

        <aside className="pp-aside">
          {pullRequest && (
            <Decisions
              projectId={projectId}
              rowKey={rowKey}
              open={open}
              draft={live?.draft ?? false}
              merged={pullRequest.state === "merged" || live?.merged === true}
              url={pullRequest.url}
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
                <div key={i} className="pp-sponsor">
                  <Logo
                    name={sponsor.name}
                    url={sponsor.logoUrl}
                    size="small"
                  />
                  <div>
                    <strong>{sponsor.name ?? "Anonymous sponsor"}</strong>
                    {sponsor.description && <span>{sponsor.description}</span>}
                    {sponsor.websiteUrl && (
                      <span className="pp-site">
                        {domain(sponsor.websiteUrl)}
                      </span>
                    )}
                  </div>
                </div>
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
        <Changes projectId={projectId} rowKey={rowKey} url={pullRequest?.url} />
      )}
    </div>
  );
}

/** Merge, Ready for review, the changes and GitHub: the builder's decisions. */
function Decisions({
  projectId,
  rowKey,
  open,
  draft,
  merged,
  url,
  changes,
  showChanges,
  onChanges,
  onDone,
}: {
  projectId: string;
  rowKey: string;
  open: boolean;
  draft: boolean;
  merged: boolean;
  url: string;
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
    if (pending) return;
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
      <a className="pp-github" href={url} target="_blank" rel="noopener">
        Open on GitHub <ArrowUpRight size={14} aria-hidden="true" />
      </a>
      {error && (
        <p className="pp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Ask for another change: written on the PR, then taken by Claude. */
function Composer({
  projectId,
  rowKey,
  number,
  onSent,
}: {
  projectId: string;
  rowKey: string;
  number: number;
  onSent: () => void;
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
    try {
      const result = await send({
        data: { projectId, key: rowKey, instruction },
      });
      if (result.ok) {
        setText("");
        onSent();
      } else setError(result.error);
    } catch {
      setError("That did not go through. Try again.");
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
        <span>To #{number}</span>
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
}: {
  projectId: string;
  rowKey: string;
  url?: string;
}) {
  const load = useServerFn(getPullFilesFn);
  const [files, setFiles] = useState<Files | null | undefined>(undefined);
  const [folded, setFolded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    load({ data: { projectId, key: rowKey } })
      .then((result) => {
        if (!live) return;
        setFiles(result);
        // Long changes open on their first file only.
        const lines = (result ?? []).reduce(
          (sum, file) => sum + (file.lines?.length ?? 0),
          0,
        );
        if (result && lines > 400)
          setFolded(new Set(result.slice(1).map((file) => file.path)));
      })
      .catch(() => live && setFiles(null));
    return () => {
      live = false;
    };
  }, [load, projectId, rowKey]);

  if (files === undefined)
    return (
      <div className="pp-files pp-loading" role="status">
        <Spinner />
      </div>
    );
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
