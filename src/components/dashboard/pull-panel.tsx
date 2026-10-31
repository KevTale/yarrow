import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  Eye,
  ChevronsUpDown,
  FileText,
  GitCommitHorizontal,
  Info,
  Plus,
  ScanSearch,
  TriangleAlert,
  X,
} from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { groupFiles } from "@/core/changed-files";
import { money } from "@/core/packs";
import { modelShortName } from "@/core/pipeline";
import { splitNote, spottedTicket } from "@/core/pull-notes";
import { formatSeconds } from "@/core/tickets";
import {
  getPullFilesFn,
  getPullPanelFn,
  requestChangeFn,
} from "@/functions/builder.functions";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { Logo } from "@/components/boards";
import { loadPresentation, Presentation } from "@/components/presentation";
import { Spinner } from "@/components/navigation-feedback";
import { Rich } from "@/components/run-activity";
import { timeAgo } from "@/components/ui";
import { DraftTicket } from "./new-ticket";
import { SponsorLink } from "./paid-by";
import { shortSite } from "@/core/pr-card";

type Panel = NonNullable<Awaited<ReturnType<typeof getPullPanelFn>>>;
type PanelComment = NonNullable<Panel["review"]>["suggestions"][number];
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

/** The screenshots, and the presentation's still and timeline, start loading with the panel, not once it shows. */
const warmed = new Set<string>();
function warmScreens(screens: Panel["screens"]): void {
  for (const screen of screens) {
    if (warmed.has(screen.key)) continue;
    warmed.add(screen.key);
    if (screen.kind === "screenshot")
      new Image().src = `/evidence/${screen.key}`;
    if (screen.kind === "presentation") {
      void loadPresentation(screen.key);
      if (screen.poster) new Image().src = `/evidence/${screen.poster}`;
    }
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

  // Cinema: the film fills the window beside the conversation, the page
  // under it held where it was. The draft is the same in both.
  const [cinema, setCinema] = useState(false);
  const [slot, setSlot] = useState(0);
  const [draft, setDraft] = useState("");
  const theater = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = theater.current;
    if (!dialog) return;
    if (cinema && !dialog.open) dialog.showModal();
    if (!cinema && dialog.open) dialog.close();
  }, [cinema]);
  const flipCinema = () => {
    if (!cinema) setSlot(theater.current?.offsetHeight ?? 0);
    setCinema(!cinema);
  };

  if (panel === undefined) return <PanelSkeleton />;
  if (panel === null)
    return <p className="pp pp-none muted">Nothing to show for this ticket</p>;

  const { live, pullRequest } = panel;
  const open = pullRequest?.state === "open" && live?.open !== false;
  const size = live
    ? `${live.additions}:${live.deletions}:${live.changedFiles}`
    : "";
  const presentation = panel.screens.find(
    (screen) => screen.kind === "presentation",
  );
  // The conversation: the changes asked, then the box to ask for another.
  const thread = panel.corrections.length > 0 && (
    <ChangesAsked
      // A new change asked opens alone, the others shut.
      key={panel.corrections.length}
      corrections={panel.corrections}
      working={workingText(panel)}
    />
  );
  const composer = open && pullRequest && (
    <Composer
      projectId={projectId}
      rowKey={rowKey}
      text={draft}
      onText={setDraft}
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
  );
  return (
    <div className="pp">
      <div className="pp-grid">
        <div className="pp-main">
          {presentation && (
            <>
              {cinema && <div style={{ height: slot }} />}
              <dialog
                ref={theater}
                className="pp-stage"
                aria-label="Cinema mode"
                onClose={() => setCinema(false)}
              >
                {cinema && (
                  <button
                    type="button"
                    className="pp-back"
                    onClick={flipCinema}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    Back
                  </button>
                )}
                <div className="pp-film">
                  <Presentation
                    artifact={presentation}
                    cinema={cinema}
                    onCinema={flipCinema}
                  />
                </div>
                {cinema && (
                  <aside className="pp-talk">
                    <div className="pp-talk-thread">{thread}</div>
                    {composer}
                  </aside>
                )}
              </dialog>
            </>
          )}
          {panel.implementation && (
            <Summary
              implementation={panel.implementation}
              screens={panel.screens}
            />
          )}

          <Review
            implementation={panel.implementation}
            review={panel.review}
            legacyRisks={live?.risks ?? []}
          />

          {thread}
          {composer}
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

          {panel.implementation && panel.implementation.spotted.length > 0 && (
            <Suggested
              projectId={projectId}
              pullRequestUrl={pullRequest?.url ?? null}
              by={panel.implementation.by}
              lines={panel.implementation.spotted}
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
 * What the pull request does now, in the implementer's words, read by a
 * product manager as well as a developer: what the ticket asked, then
 * what was done. What was checked and what to watch sit in the review.
 */
function Summary({
  implementation,
  screens,
}: {
  implementation: NonNullable<Panel["implementation"]>;
  screens: Panel["screens"];
}) {
  const shots = screens.filter((screen) => screen.kind !== "presentation");
  return (
    <section className="pp-section">
      <h3>Summary</h3>
      <p className="pp-text">
        <Rich text={implementation.summary} />
      </p>
      {shots.length > 0 && <Screens screens={shots} />}
    </section>
  );
}

/**
 * The review, said as a colleague would: the reviewer's words, then what
 * works, each ticked (the ticket's acceptance criteria, then the technical
 * checks folded into one line), then what to keep an eye on: what the fix
 * round left broken, what could not run, what to do before merging, the
 * reviewer's suggestions. No verdict tag: the words say it.
 */
function Review({
  implementation,
  review,
  legacyRisks,
}: {
  implementation: Panel["implementation"];
  review: Panel["review"];
  /** Pull requests delivered before notes were apart: their Risks. */
  legacyRisks: string[];
}) {
  const criteria = implementation?.criteria ?? [];
  const checks = implementation?.verification ?? [];
  const watch = [
    ...(implementation?.notVerified ?? []).map((line) => ({ kind: "n", line })),
    ...(implementation?.legacy ? legacyRisks : []).map((line) => ({
      kind: "l",
      line,
    })),
    ...(implementation?.risks ?? []).map((line) => ({ kind: "r", line })),
  ];
  const blocking = review?.blocking ?? [];
  const suggestions = review?.suggestions ?? [];
  if (!review && criteria.length + checks.length + watch.length === 0)
    return null;
  return (
    <section className="pp-section">
      <h3>{review ? "Review" : "Checked"}</h3>
      {review && (
        <p className="pp-text">
          <Rich text={review.summary} />
        </p>
      )}
      {criteria.length + checks.length > 0 && (
        <ul className="pp-list pp-checked">
          {criteria.map((item) => {
            return (
              <li key={`a${item.criterion}`}>
                {item.status === "met" ? (
                  <Check size={15} className="ok" aria-label="Met" />
                ) : item.status === "unmet" ? (
                  <X size={15} className="bad" aria-label="Not met" />
                ) : (
                  <CircleDashed size={15} aria-label="Not checked" />
                )}
                <span className="pp-note">
                  <Rich text={item.criterion} />
                  {item.status !== "met" && (
                    <small className="pp-detail">
                      {item.status === "unmet" ? "Not met" : "Not checked"}
                      {item.note ? `: ${item.note}` : ""}
                    </small>
                  )}
                </span>
              </li>
            );
          })}
          {checks.length > 0 && <TechnicalChecks checks={checks} />}
        </ul>
      )}
      {blocking.length + watch.length + suggestions.length > 0 && (
        <ul className="pp-list">
          {blocking.map((comment, i) => (
            <li key={`b${i}`} className="pp-risk">
              <TriangleAlert size={15} className="warn" aria-hidden="true" />
              <Note line={comment.body} where={commentPlace(comment)} />
            </li>
          ))}
          {watch.map(({ kind, line }) => (
            <li
              key={`${kind}${line}`}
              className={kind === "r" ? "pp-risk" : ""}
            >
              {kind === "n" ? (
                <CircleDashed size={15} aria-label="Not run" />
              ) : kind === "l" ? (
                <Eye size={15} aria-hidden="true" />
              ) : (
                <TriangleAlert size={15} className="warn" aria-hidden="true" />
              )}
              <Note line={line} />
            </li>
          ))}
          {suggestions.map((suggestion, i) => (
            <li key={`s${i}`}>
              <ChevronRight size={15} aria-hidden="true" />
              <Note line={suggestion.body} where={commentPlace(suggestion)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const commentPlace = (comment: PanelComment) =>
  comment.path
    ? `${comment.path}${comment.line ? `:${comment.line}` : ""}`
    : null;

/**
 * Lint, tests, build and the like in one ticked line, closed: opened, each
 * check in everyday words with its command under it.
 */
function TechnicalChecks({ checks }: { checks: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="pp-tech">
      <Check size={15} className="ok" aria-hidden="true" />
      <div className="pp-note">
        <button
          type="button"
          className="pp-tech-head"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          Technical checks pass
          <span className="pp-num">{checks.length}</span>
          {open ? (
            <ChevronDown size={14} aria-hidden="true" />
          ) : (
            <ChevronRight size={14} aria-hidden="true" />
          )}
        </button>
        {open && (
          <ul className="pp-list pp-tech-list">
            {checks.map((line) => (
              <li key={line}>
                <Note line={line} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/**
 * What the agents noticed outside the ticket and left alone, in the
 * sidebar: a row each in everyday words, the whole row a ticket to write,
 * its words drafted (its technical pointer goes in the ticket, not here).
 */
function Suggested({
  projectId,
  pullRequestUrl,
  by,
  lines,
}: {
  projectId: string;
  pullRequestUrl: string | null;
  /** The implementer, named in the drafted ticket. */
  by: string;
  lines: string[];
}) {
  const draft = useContext(DraftTicket);
  return (
    <section className="pf" aria-label="Suggested tickets">
      <p className="pf-head">
        {lines.length === 1
          ? "1 suggested ticket"
          : `${lines.length} suggested tickets`}
      </p>
      <ul className="pf-files">
        {lines.map((line) => {
          const { plain } = splitNote(line);
          const ticket = spottedTicket(line, by, pullRequestUrl);
          return (
            <li key={line}>
              {draft ? (
                <button
                  type="button"
                  className="pf-row pf-suggest"
                  aria-label={`Make it a ticket: ${ticket.title}`}
                  data-tip="Make it a ticket"
                  onClick={() => draft(projectId, ticket)}
                >
                  <ScanSearch size={13} aria-hidden="true" />
                  <span>
                    <Rich text={plain} />
                  </span>
                  <Plus size={14} className="pf-add" aria-hidden="true" />
                </button>
              ) : (
                <span className="pf-row pf-suggest">
                  <ScanSearch size={13} aria-hidden="true" />
                  <span>
                    <Rich text={plain} />
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** A note's everyday words, then, smaller, where it comes from in the code. */
function Note({ line, where = null }: { line: string; where?: string | null }) {
  const { plain, detail } = splitNote(line);
  return (
    <span className="pp-note">
      <Rich text={plain} />
      {(detail || where) && (
        <small className="pp-detail">
          {where && <code>{where}</code>}
          {where && detail ? " " : ""}
          {detail && <Rich text={detail} />}
        </small>
      )}
    </span>
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
                <img src={`/evidence/${screen.key}`} alt={screen.label} />
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
  text,
  onText: setText,
  onSending,
  onSent,
  onFailed,
}: {
  projectId: string;
  rowKey: string;
  text: string;
  onText: (text: string) => void;
  /** The change shows in the thread before GitHub answers. */
  onSending: (instruction: string) => void;
  onSent: () => void;
  onFailed: () => void;
}) {
  const send = useServerFn(requestChangeFn);
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
 * The files a pull request changed, in the sidebar: how many and their
 * lines over one list, in the order a builder reads them (the code, its
 * tests, its documentation, what tools generated, the assets), six then
 * the rest on demand. Picking a file shows its changes below.
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
  const [whole, setWhole] = useState(false);
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
  // One list, the code first: the groups' order without their names.
  const ordered = groupFiles(files).flatMap((group) => group.files);
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const shown = whole ? ordered : ordered.slice(0, FILES_SHOWN);
  const more = ordered.length - FILES_SHOWN;
  return (
    <section className="pf" aria-label="Files changed">
      <p className="pf-head">
        {files.length} {files.length === 1 ? "file" : "files"} changed
        <span className="pp-count">
          <span className="add">+{additions}</span>
          {deletions > 0 && (
            <>
              {" "}
              <span className="del">−{deletions}</span>
            </>
          )}
        </span>
      </p>
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
              aria-expanded={whole}
              onClick={() => setWhole((value) => !value)}
            >
              <ChevronsUpDown size={13} aria-hidden="true" />
              {whole
                ? "Show fewer"
                : `Show ${more} more ${more === 1 ? "file" : "files"}`}
            </button>
          </li>
        )}
      </ul>
    </section>
  );
}

/** Files listed before "Show N more". */
const FILES_SHOWN = 6;

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
