import { useServerFn } from "@tanstack/react-start";
import {
  ArrowUp,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleDashed,
  Eye,
  ChevronsUpDown,
  FileText,
  GitCommitHorizontal,
  Info,
  ScanSearch,
  TriangleAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { groupFiles } from "@/core/changed-files";
import { money } from "@/core/packs";
import { modelShortName } from "@/core/pipeline";
import { formatSeconds } from "@/core/tickets";
import {
  getPullFilesFn,
  getPullPanelFn,
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

const filesInflight = new Map<string, Promise<Files | null>>();

/** What GitHub counts for a pull request: added, deleted, files. */
const sizeOf = (files: Files) =>
  `${files.reduce((sum, file) => sum + file.additions, 0)}:${files.reduce((sum, file) => sum + file.deletions, 0)}:${files.length}`;

/**
 * The pull request's files, once per size: a new commit reads them again.
 * Without a size (the row is opening) whatever is kept will do.
 */
function loadFiles(
  projectId: string,
  key: string,
  size?: string,
): Promise<Files | null> {
  const id = cacheKey(projectId, key);
  const kept = changes.get(id);
  if (kept && (size === undefined || kept.size === size))
    return Promise.resolve(kept.files);
  const pending = filesInflight.get(id);
  if (pending) return pending;
  const request = getPullFilesFn({ data: { projectId, key } })
    .then((files) => {
      if (files) changes.set(id, { size: sizeOf(files), files });
      return files;
    })
    .finally(() => filesInflight.delete(id));
  filesInflight.set(id, request);
  return request;
}

function usePullFiles(
  projectId: string,
  key: string,
  size: string,
): Files | null | undefined {
  const kept = changes.get(cacheKey(projectId, key));
  // No size when GitHub's side could not be read: what is kept will do.
  const fresh = size || undefined;
  const [files, setFiles] = useState<Files | null | undefined>(
    kept && (!fresh || kept.size === fresh) ? kept.files : undefined,
  );
  useEffect(() => {
    let live = true;
    loadFiles(projectId, key, fresh)
      .then((next) => live && setFiles(next))
      .catch(() => live && setFiles(null));
    return () => {
      live = false;
    };
  }, [projectId, key, fresh]);
  return files;
}

function fetchPanel(projectId: string, key: string): Promise<Panel | null> {
  const id = cacheKey(projectId, key);
  const pending = inflight.get(id);
  if (pending) return pending;
  const request = getPullPanelFn({ data: { projectId, key } })
    .then((panel) => {
      if (panel) {
        panels.set(id, panel);
        warmScreens(panel.screens);
      }
      return panel;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, request);
  return request;
}

/** The screenshots start loading with the panel, not once it shows. */
const warmed = new Set<string>();
function warmScreens(screens: Panel["screens"]): void {
  for (const screen of screens)
    if (screen.kind === "screenshot" && !warmed.has(screen.key)) {
      warmed.add(screen.key);
      new Image().src = `/evidence/${screen.key}`;
    }
}

/**
 * Reads a row before it opens (hover, focus, To review on arrival): Yarrow's
 * side and the changes at once, the screenshots as soon as they are known.
 */
export function prefetchPullPanel(projectId: string, key: string): void {
  if (!panels.has(cacheKey(projectId, key)))
    void fetchPanel(projectId, key).catch(() => {});
  void loadFiles(projectId, key).catch(() => {});
}

/**
 * A ticket's row, opened: what the agents did and what to watch on the
 * left, the decisions on the right (the changes, merge), who paid and what it cost; a change asked from here goes to
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
  const id = cacheKey(projectId, rowKey);
  const [panel, setPanel] = useState<Panel | null | undefined>(() =>
    panels.get(id),
  );
  // The file whose changes show under the panel, picked in the sidebar.
  const [focus, setFocus] = useState<string | null>(null);

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
    void loadFiles(projectId, rowKey).catch(() => {});
  }, [refresh, projectId, rowKey]);

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
  const size = live
    ? `${live.additions}:${live.deletions}:${live.changedFiles}`
    : "";
  return (
    <div className="pp">
      <div className="pp-grid">
        <div className="pp-main">
          {panel.implementation && (
            <Implementation
              implementation={panel.implementation}
              legacyRisks={live?.risks ?? []}
              screens={panel.screens}
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
          {panel.paidBy.length > 0 ? (
            <div className="pp-paid">
              <div className="pp-paid-head">
                <span className="pp-label">Paid by</span>
                {panel.models.length > 0 && <CostInfo panel={panel} />}
              </div>
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
          ) : (
            panel.models.length > 0 && <Costs panel={panel} />
          )}

          {pullRequest && (
            <ChangedFiles
              projectId={projectId}
              rowKey={rowKey}
              size={size}
              url={pullRequest.url}
              focus={focus}
              onOpen={(path) =>
                setFocus((shown) => (shown === path ? null : path))
              }
            />
          )}
        </aside>
      </div>

      {focus && (
        <Changes
          // Each file picked opens alone, scrolled to.
          key={focus}
          projectId={projectId}
          rowKey={rowKey}
          url={pullRequest?.url}
          size={size}
          focus={focus}
          onClose={() => setFocus(null)}
        />
      )}
    </div>
  );
}

/** Who wrote and who reviewed, their time and cost, then the total. */
function Costs({ panel }: { panel: Panel }) {
  return (
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
  );
}

/** "i" in the Paid by card: the costs show on hover, focus or tap. */
function CostInfo({ panel }: { panel: Panel }) {
  return (
    <span className="pp-info">
      <button type="button" className="pp-info-btn" aria-label="Costs">
        <Info size={14} aria-hidden="true" />
      </button>
      <span className="pp-info-card" role="tooltip">
        <Costs panel={panel} />
      </span>
    </span>
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
  screens,
}: {
  implementation: NonNullable<Panel["implementation"]>;
  /** Pull requests delivered before these were apart: their Risks. */
  legacyRisks: string[];
  screens: Panel["screens"];
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
      {screens.length > 0 && <Screens screens={screens} />}
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
 * What the change looks like: the implementer's screenshots, opened full
 * size in the browser's modal dialog (a click or Escape closes it, the
 * arrows go from one to the next).
 */
function Screens({ screens }: { screens: Panel["screens"] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const images = screens.filter((screen) => screen.kind === "screenshot");
  useEffect(() => {
    if (open !== null && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);
  const shown = open === null ? null : images[open];
  return (
    <>
      <ul className="pp-shots">
        {screens.map((screen) => (
          <li key={screen.key}>
            {screen.kind === "video" ? (
              <video
                src={`/evidence/${screen.key}`}
                controls
                preload="metadata"
                aria-label={screen.label}
              />
            ) : (
              <button
                type="button"
                aria-label={`${screen.label}, full size`}
                onClick={() => setOpen(images.indexOf(screen))}
              >
                <img
                  src={`/evidence/${screen.key}`}
                  alt={screen.label}
                />
              </button>
            )}
            <span>{screen.label}</span>
          </li>
        ))}
      </ul>
      <dialog
        ref={dialog}
        className="pp-shot"
        aria-label={shown?.label ?? "Screenshot"}
        onClose={() => setOpen(null)}
        onClick={() => dialog.current?.close()}
        onKeyDown={(event) => {
          if (open === null || images.length < 2) return;
          const step =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (step) setOpen((open + step + images.length) % images.length);
        }}
      >
        {shown && (
          <figure>
            {/* Keyed: the caption never sits under the previous image. */}
            <img
              key={shown.key}
              src={`/evidence/${shown.key}`}
              alt={shown.label}
            />
            <figcaption>
              {shown.label}
              {images.length > 1 && (
                <span>
                  {open! + 1} / {images.length}
                </span>
              )}
            </figcaption>
          </figure>
        )}
      </dialog>
    </>
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

/**
 * The files a pull request changed, in the sidebar the way a builder reads
 * them: the code, its tests, its documentation, what tools generated, the
 * assets. The code opens first; picking a file shows its changes below.
 */
function ChangedFiles({
  projectId,
  rowKey,
  size,
  url,
  focus,
  onOpen,
}: {
  projectId: string;
  rowKey: string;
  size: string;
  url: string;
  focus: string | null;
  onOpen: (path: string) => void;
}) {
  const files = usePullFiles(projectId, rowKey, size);
  const [unfolded, setUnfolded] = useState<Set<string>>(
    () => new Set(["implementation"]),
  );
  const [whole, setWhole] = useState<Set<string>>(() => new Set());
  if (files === undefined)
    return (
      <div className="pf" aria-busy="true" aria-label="Loading the changes">
        {["46%", "78%", "70%", "62%", "74%"].map((width, i) => (
          <span key={i} className="sk" style={{ width }} />
        ))}
      </div>
    );
  if (files === null)
    return (
      <p className="pf pf-none">
        <a href={`${url}/files`} target="_blank" rel="noopener">
          See the changes on GitHub
        </a>
      </p>
    );
  const groups = groupFiles(files);
  const flip = (set: Set<string>, value: string) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    return next;
  };
  return (
    <section className="pf" aria-label="Files changed">
      <p className="pf-head">
        {files.length} {files.length === 1 ? "file" : "files"} changed
      </p>
      {groups.map((group) => {
        const open = unfolded.has(group.kind);
        const shown = whole.has(group.kind)
          ? group.files
          : group.files.slice(0, 6);
        const more = group.files.length - shown.length;
        return (
          <div key={group.kind} className="pf-group">
            <button
              type="button"
              className="pf-ghead"
              aria-expanded={open}
              onClick={() => setUnfolded((set) => flip(set, group.kind))}
            >
              <b>{group.label}</b>
              <span className="pf-n">{group.files.length}</span>
              <ChevronRight
                size={13}
                className={`pf-chev ${open ? "open" : ""}`}
                aria-hidden="true"
              />
              <span className="pp-count">
                <span className="add">+{group.additions}</span>
                {group.deletions > 0 && (
                  <>
                    {" "}
                    <span className="del">−{group.deletions}</span>
                  </>
                )}
              </span>
            </button>
            {open && (
              <ul className="pf-files">
                {shown.map((file) => {
                  const slash = file.path.lastIndexOf("/");
                  return (
                    <li key={file.path}>
                      <button
                        type="button"
                        className="pf-file"
                        aria-pressed={focus === file.path}
                        title={file.path}
                        onClick={() => onOpen(file.path)}
                      >
                        <FileText size={13} aria-hidden="true" />
                        <b>{file.path.slice(slash + 1)}</b>
                        {slash > 0 && <span>{file.path.slice(0, slash)}</span>}
                      </button>
                    </li>
                  );
                })}
                {more > 0 && (
                  <li>
                    <button
                      type="button"
                      className="pf-file pf-more"
                      onClick={() => setWhole((set) => flip(set, group.kind))}
                    >
                      <ChevronsUpDown size={13} aria-hidden="true" />
                      {more} more {more === 1 ? "file" : "files"}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}

/**
 * The changes, under the panel: every file, the one picked in the sidebar
 * open and scrolled to, the others folded.
 */
function Changes({
  projectId,
  rowKey,
  url,
  size,
  focus,
  onClose,
}: {
  projectId: string;
  rowKey: string;
  url?: string;
  /** Lines and files changed: a different size is a new commit. */
  size: string;
  focus: string;
  onClose: () => void;
}) {
  const files = usePullFiles(projectId, rowKey, size);
  const [opened, setOpened] = useState<Set<string>>(() => new Set([focus]));
  const root = useRef<HTMLDivElement>(null);
  const ready = files !== undefined;
  useEffect(() => {
    if (!ready) return;
    root.current
      ?.querySelector(`[data-path="${CSS.escape(focus)}"]`)
      ?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [ready, focus]);

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
    <div className="pp-files" ref={root}>
      <div className="pp-files-head">
        <span>Changes</span>
        <button
          type="button"
          className="tix-icon-btn"
          aria-label="Hide changes"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      {files.map((file) => {
        const isOpen = opened.has(file.path);
        const slash = file.path.lastIndexOf("/");
        return (
          <div key={file.path} className="pp-file" data-path={file.path}>
            <button
              type="button"
              className="pp-file-head"
              aria-expanded={isOpen}
              onClick={() =>
                setOpened((current) => {
                  const next = new Set(current);
                  if (next.has(file.path)) next.delete(file.path);
                  else next.add(file.path);
                  return next;
                })
              }
            >
              {isOpen ? (
                <ChevronDown size={15} aria-hidden="true" />
              ) : (
                <ChevronRight size={15} aria-hidden="true" />
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
            {isOpen &&
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
