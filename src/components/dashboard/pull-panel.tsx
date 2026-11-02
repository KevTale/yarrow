import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  FileText,
  GitCommitHorizontal,
  Play,
  Plus,
  X,
} from "lucide-react";
import {
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { chatParts } from "@/core/chat";
import { groupFiles } from "@/core/changed-files";
import { money } from "@/core/packs";
import { modelShortName } from "@/core/pipeline";
import { splitNote, spottedTicket } from "@/core/pull-notes";
import { formatSeconds } from "@/core/tickets";
import {
  askChatFn,
  getPullFilesFn,
  getPullPanelFn,
  requestChangeFn,
} from "@/functions/builder.functions";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { LiveCall, useLiveStage } from "@/components/live-stage";
import {
  loadPresentation,
  Presentation,
  type FilmControl,
} from "@/components/presentation";
import { Spinner } from "@/components/navigation-feedback";
import { Markdown, Rich } from "@/components/markdown";
import { DraftTicket } from "./new-ticket";

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
 * A pull request's panel: what it showed last at once, then Yarrow's side
 * again; followed while an answer is written or a change is on its way.
 * `refresh` gives what it read, or undefined when it could not.
 */
export function usePullPanel(projectId: string, rowKey: string) {
  const [panel, setPanel] = useState<Panel | null | undefined>(() =>
    panels.get(cacheKey(projectId, rowKey)),
  );
  const refresh = useCallback(
    () =>
      fetchPanel(projectId, rowKey)
        .then((fresh) => {
          setPanel(fresh);
          return fresh;
        })
        // A failed refresh keeps what is shown.
        .catch(() => {
          setPanel((shown) => shown ?? null);
          return undefined;
        }),
    [projectId, rowKey],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A correction on its way: follow it until its commit lands. An answer
  // being written, sooner.
  const answering = panel?.messages.some(
    (message) => message.status === "pending",
  );
  const busy =
    panel &&
    (answering ||
      panel.working !== null ||
      panel.corrections.some(
        (correction) =>
          correction.status === "queued" || correction.status === "working",
      ));
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => void refresh(), answering ? 3_000 : 5_000);
    return () => clearInterval(timer);
  }, [busy, answering, refresh]);
  return { panel, setPanel, refresh };
}

/**
 * A ticket's row, opened: what the agents did, what to watch and the files
 * changed on the left, the conversation on the right; a change asked from
 * there goes to the pull request. Who paid is on the row's line. The film
 * plays first; the member calls the agent from it, and the pull request's
 * stage takes its place, the app live where the film was paused, until the
 * film plays on.
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
  const { panel, setPanel, refresh } = usePullPanel(projectId, rowKey);
  useEffect(() => {
    void loadFiles(projectId, rowKey).catch(() => {});
  }, [projectId, rowKey]);

  // The stage comes up as the row opens, for an open pull request on a
  // window wide enough, for a call from the film; on a phone, the call
  // alone.
  const [wide] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 761px)").matches,
  );
  const play = useRef<FilmControl | null>(null);
  const stage = useLiveStage({
    projectId,
    rowKey,
    start: Boolean(
      wide &&
      panel?.pullRequest?.state === "open" &&
      panel.screens.some((screen) => screen.kind === "presentation"),
    ),
    messages: panel?.messages.length ?? 0,
    refresh,
    onResume: (chapter) => play.current?.(chapter),
  });

  // Cinema: the film fills the window beside the conversation, which goes
  // with it; the page under it held where it was.
  const [cinema, setCinema] = useState(false);
  const [slot, setSlot] = useState(0);
  const [draft, setDraft] = useState("");
  const theater = useRef<HTMLDialogElement>(null);
  const seek = useRef<((ms: number) => void) | null>(null);
  useLayoutEffect(() => {
    const dialog = theater.current;
    if (!dialog) return;
    if (cinema && !dialog.open) {
      dialog.showModal();
      // The column only has its height once the dialog is modal: the
      // latest message in view again.
      const thread = dialog.querySelector(".pp-talk-thread");
      if (thread) thread.scrollTop = thread.scrollHeight;
    }
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
  const size = live
    ? `${live.additions}:${live.deletions}:${live.changedFiles}`
    : "";
  const presentation = panel.screens.find(
    (screen) => screen.kind === "presentation",
  );
  // Up: what is written in the conversation acts on it.
  const onStage = stage.phase === "ready";
  // On a call from the film, once the stage is where it was paused.
  const onCall = Boolean(presentation && stage.reached && stage.talk !== "off");
  // The film from a moment: the call ends.
  const toFilm = (ms: number) => {
    stage.endTalk();
    seek.current?.(ms);
  };
  // The conversation, the panel's right column, beside the film in cinema;
  // beside the stage, the agent acts on it.
  const talk = (
    <Conversation
      panel={panel}
      projectId={projectId}
      rowKey={rowKey}
      draft={draft}
      onDraft={setDraft}
      onPanel={setPanel}
      onRefresh={refresh}
      onSeek={presentation ? toFilm : null}
      onMade={() => {
        void refresh();
        onChanged();
      }}
      stage={onStage}
      turn={stage.turn}
      onAsking={stage.hold}
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
                  {/* Up, its screen already drawn behind the film. */}
                  {onStage && (
                    <LiveCall
                      stage={stage}
                      shown={onCall}
                      cinema={cinema}
                      onCinema={flipCinema}
                      onFilm={() => play.current?.(null)}
                    />
                  )}
                  {/* Kept behind the stage, paused where the call began. */}
                  <div className="pp-take" hidden={onCall}>
                    <Presentation
                      artifact={presentation}
                      cinema={cinema}
                      onCinema={flipCinema}
                      seekRef={seek}
                      playRef={play}
                      // A call only where the stage can take the film's
                      // place: a film recorded with its live steps.
                      call={
                        stage.status?.live
                          ? {
                              state: stage.talk,
                              onCall: (at) => void stage.callFrom(at),
                              onHangUp: () => stage.endTalk(),
                              onWarm: () => stage.warm(),
                            }
                          : undefined
                      }
                    />
                  </div>
                </div>
                {cinema && talk}
              </dialog>
            </>
          )}
          {panel.implementation?.ask && (
            <TicketAsk ask={panel.implementation.ask} />
          )}
          {panel.implementation && (
            <Changed
              implementation={panel.implementation}
              review={panel.review}
              screens={panel.screens}
            />
          )}

          {panel.implementation && panel.implementation.spotted.length > 0 && (
            <Suggested
              projectId={projectId}
              rowKey={rowKey}
              onMade={() => void refresh()}
              pullRequestUrl={pullRequest?.url ?? null}
              by={panel.implementation.by}
              lines={panel.implementation.spotted}
            />
          )}

          {pullRequest && (
            <ChangedFiles
              projectId={projectId}
              rowKey={rowKey}
              size={size}
              url={pullRequest.url}
            />
          )}
        </div>

        {!cinema && talk}
      </div>
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

/**
 * A pull request's costs over all its ticket's runs, for the row's Paid by
 * card: what is kept shows at once, otherwise read once.
 */
export function PullCosts({
  projectId,
  rowKey,
}: {
  projectId: string;
  rowKey: string;
}) {
  const id = cacheKey(projectId, rowKey);
  const [panel, setPanel] = useState(() => panels.get(id));
  useEffect(() => {
    if (panels.has(id)) return;
    let live = true;
    fetchPanel(projectId, rowKey)
      .then((next) => live && next && setPanel(next))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [id, projectId, rowKey]);
  if (!panel || panel.models.length === 0) return null;
  return <Costs panel={panel} />;
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
 * What the ticket asks, in the implementer's words for the owner: the need,
 * never the solution. Pull requests delivered before it have none, their
 * summary saying it in its first sentence.
 */
function TicketAsk({ ask }: { ask: string }) {
  return (
    <section className="pp-section">
      <h3>What the ticket asks</h3>
      <Markdown source={ask} className="pp-text" />
    </section>
  );
}

/**
 * What the pull request does now, read by a product manager as well as a
 * developer, in a few lines and one voice: the reviewer tells what it does,
 * how it is known to work, what to do before merging or what is still
 * wrong. Before it did, the implementer's words then the reviewer's own.
 * The criteria, the checks and the suggestions are the conversation's.
 */
function Changed({
  implementation,
  review,
  screens,
}: {
  implementation: NonNullable<Panel["implementation"]>;
  review: Panel["review"];
  screens: Panel["screens"];
}) {
  const shots = screens.filter((screen) => screen.kind !== "presentation");
  return (
    <section className="pp-section">
      <h3>What changed</h3>
      {review?.changed ? (
        <Markdown source={review.changed} className="pp-text" />
      ) : (
        <>
          <Markdown source={implementation.summary} className="pp-text" />
          {review && <Markdown source={review.summary} className="pp-text" />}
        </>
      )}
      {shots.length > 0 && <Screens screens={shots} />}
    </section>
  );
}

/**
 * What the agents noticed outside the ticket and left alone, under the
 * review: a small card each in everyday words, the whole card a ticket to
 * write, its words drafted (its technical pointer goes in the ticket).
 */
function Suggested({
  projectId,
  rowKey,
  onMade,
  pullRequestUrl,
  by,
  lines: listed,
}: {
  projectId: string;
  rowKey: string;
  /** A suggestion was made a ticket: the panel reads it gone. */
  onMade: () => void;
  pullRequestUrl: string | null;
  /** The implementer, named in the drafted ticket. */
  by: string;
  lines: string[];
}) {
  const draft = useContext(DraftTicket);
  // Gone at once, before the panel is read again.
  const [made, setMade] = useState<string[]>([]);
  const lines = listed.filter((line) => !made.includes(line));
  if (lines.length === 0) return null;
  return (
    <section className="pp-section">
      <h3>
        {lines.length === 1
          ? "1 suggested ticket"
          : `${lines.length} suggested tickets`}
      </h3>
      <ul className="pp-ideas">
        {lines.map((line) => {
          const { plain } = splitNote(line);
          const ticket = spottedTicket(line, by, pullRequestUrl);
          return (
            <li key={line}>
              {draft ? (
                <button
                  type="button"
                  className="pp-idea"
                  aria-label={`Make it a ticket: ${ticket.title}`}
                  onClick={() =>
                    draft(
                      projectId,
                      { ...ticket, from: { key: rowKey, note: line } },
                      () => {
                        setMade((shown) => [...shown, line]);
                        onMade();
                      },
                    )
                  }
                >
                  <span>
                    <Rich text={plain} />
                  </span>
                  <span className="pp-idea-go">
                    <Plus size={13} aria-hidden="true" />
                    Make it a ticket
                  </span>
                </button>
              ) : (
                <span className="pp-idea">
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

type Message = Panel["messages"][number];
type Correction = Panel["corrections"][number];

/** A question shown at once, and its answer's place, before the brain has them. */
const local = (
  id: string,
  author: Message["author"],
  body: string,
  at: number,
): Message => ({
  id,
  author,
  body,
  status: author === "agent" ? "pending" : "done",
  change: null,
  correctionRequestId: null,
  createdAt: new Date(at).toISOString(),
});

/**
 * The conversation, oldest first: the questions and their answers, and the
 * changes asked elsewhere (on GitHub, before the conversation) where they
 * fall. A change made from an answer's card shows under that answer.
 */
type Line =
  | { kind: "message"; at: string; message: Message }
  | { kind: "correction"; at: string; correction: Correction };

function lines(panel: Panel): Line[] {
  const made = new Set(panel.messages.map((m) => m.correctionRequestId));
  return [
    ...panel.messages.map((message) => ({
      kind: "message" as const,
      at: message.createdAt,
      message,
    })),
    ...panel.corrections
      .filter((correction) => !made.has(correction.id))
      .map((correction) => ({
        kind: "correction" as const,
        at: correction.askedAt,
        correction,
      })),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

/** A line of the thread, as the brain keeps it. */
export type ThreadMessage = Message;

/**
 * The pull request's conversation: questions, answers, the changes asked,
 * then the box to ask the next one. Beside the film in the panel; beside
 * the live stage on its page, where the agent may act on the stage and
 * `turn` is the live call's turn under way, until the thread has it.
 */
export function Conversation({
  panel,
  projectId,
  rowKey,
  draft,
  onDraft,
  onPanel,
  onRefresh,
  onSeek,
  onMade,
  stage = false,
  turn = [],
  onAsking,
}: {
  panel: Panel;
  projectId: string;
  rowKey: string;
  draft: string;
  onDraft: (text: string) => void;
  onPanel: (
    update: (shown: Panel | null | undefined) => Panel | null | undefined,
  ) => void;
  onRefresh: () => Promise<unknown>;
  /** Plays the film from a moment; null without a film. */
  onSeek: ((ms: number) => void) | null;
  onMade: () => void;
  /** Asked beside the stage: the agent may act on it. */
  stage?: boolean;
  /** Last, pending: the member's words as the call hears them. */
  turn?: Message[];
  /** A question is on its way. */
  onAsking?: () => void;
}) {
  const { live, pullRequest } = panel;
  if (!pullRequest) return null;
  const open = pullRequest.state === "open" && live?.open !== false;
  const answering = panel.messages.some(
    (message) => message.status === "pending",
  );
  return (
    <aside className="pp-talk" aria-label="Conversation">
      <div className="pp-talk-thread">
        <Thread
          panel={
            turn.length
              ? { ...panel, messages: [...panel.messages, ...turn] }
              : panel
          }
          projectId={projectId}
          rowKey={rowKey}
          open={open}
          onSeek={onSeek}
          onMade={onMade}
        />
      </div>
      <Ask
        projectId={projectId}
        rowKey={rowKey}
        text={draft}
        onText={onDraft}
        waiting={answering}
        stage={stage}
        onSending={(question) => {
          onAsking?.();
          onPanel((shown) => {
            if (!shown) return shown;
            const at = Date.now();
            return {
              ...shown,
              messages: [
                ...shown.messages,
                local(`q${at}`, "builder", question, at),
                local(`a${at}`, "agent", "", at + 1),
              ],
            };
          });
        }}
        onSettled={() => void onRefresh()}
      />
    </aside>
  );
}

/** The builder's words in a bubble on the right, the agent's as text on the left. */
function Thread({
  panel,
  projectId,
  rowKey,
  open,
  onSeek,
  onMade,
}: {
  panel: Panel;
  projectId: string;
  rowKey: string;
  /** The pull request can still change. */
  open: boolean;
  /** Plays the film from a moment; null without a film. */
  onSeek: ((ms: number) => void) | null;
  onMade: () => void;
}) {
  const shown = lines(panel);
  const working = workingText(panel);
  const list = useRef<HTMLOListElement>(null);
  const last = shown.at(-1);
  const latest = `${shown.length}:${last?.kind === "message" ? last.message.status : ""}`;
  // The latest in view, the page left where it is: the column scrolls.
  useLayoutEffect(() => {
    const box = list.current?.parentElement;
    if (box) box.scrollTop = box.scrollHeight;
  }, [latest]);
  if (shown.length === 0) return null;
  return (
    <ol className="pp-chat" ref={list}>
      {shown.map((line) =>
        line.kind === "correction" ? (
          <Fragment key={line.correction.id}>
            <li className="pp-me">
              <p className="pp-bubble">{line.correction.instruction}</p>
            </li>
            <li className="pp-it">
              <ChangeState correction={line.correction} working={working} />
            </li>
          </Fragment>
        ) : line.message.author === "builder" ? (
          <li
            key={line.message.id}
            className={
              line.message.status === "pending" ? "pp-me pp-hearing" : "pp-me"
            }
          >
            <p className="pp-bubble">
              {line.message.body ||
                (line.message.status === "pending" && (
                  <span className="pp-dots" aria-label="Listening">
                    <i />
                    <i />
                    <i />
                  </span>
                ))}
            </p>
          </li>
        ) : (
          <li key={line.message.id} className="pp-it">
            <Answer
              message={line.message}
              correction={panel.corrections.find(
                (correction) =>
                  correction.id === line.message.correctionRequestId,
              )}
              working={working}
              open={open}
              projectId={projectId}
              rowKey={rowKey}
              onSeek={onSeek}
              onMade={onMade}
            />
          </li>
        ),
      )}
    </ol>
  );
}

function Answer({
  message,
  correction,
  working,
  open,
  projectId,
  rowKey,
  onSeek,
  onMade,
}: {
  message: Message;
  correction: Correction | undefined;
  working: string | null;
  open: boolean;
  projectId: string;
  rowKey: string;
  onSeek: ((ms: number) => void) | null;
  onMade: () => void;
}) {
  if (message.status === "pending")
    return (
      <p className="pp-say">
        <TextShimmer>Thinking</TextShimmer>
      </p>
    );
  if (message.status === "failed")
    return <p className="pp-say muted">No answer this time.</p>;
  return (
    <>
      <Markdown
        source={message.body}
        className="pp-say"
        inline={(text) =>
          chatParts(text).map((part, j) =>
            part.kind === "text" ? (
              <Rich key={j} text={part.text} />
            ) : onSeek ? (
              <button
                key={j}
                type="button"
                className="pp-at"
                aria-label={`Play from ${part.label}`}
                onClick={() => onSeek(part.ms)}
              >
                <Play size={9} fill="currentColor" aria-hidden="true" />
                {part.label}
              </button>
            ) : (
              part.label
            ),
          )
        }
      />
      {message.change &&
        (message.correctionRequestId ? (
          <ChangeState correction={correction} working={working} />
        ) : (
          <Proposal
            message={message}
            open={open}
            projectId={projectId}
            rowKey={rowKey}
            onMade={onMade}
          />
        ))}
    </>
  );
}

/** Where a change asked stands: queued, being written, made, stopped. */
function ChangeState({
  correction,
  working,
}: {
  correction: Correction | undefined;
  working: string | null;
}) {
  switch (correction?.status) {
    case undefined:
    case "queued":
      return (
        <div className="pp-meta">
          <CircleDashed size={14} aria-hidden="true" />
          Queued
        </div>
      );
    case "working":
      return (
        <div className="pp-meta live">
          <TextShimmer>{working ?? "Writing the change"}</TextShimmer>
        </div>
      );
    case "stopped":
      return (
        <div className="pp-meta stopped">
          <X size={14} aria-hidden="true" />
          Stopped
        </div>
      );
    case "done":
      return (
        <>
          <div className="pp-meta">
            <GitCommitHorizontal size={14} className="ok" aria-hidden="true" />
            Changed
          </div>
          {correction.summary && (
            <Markdown source={correction.summary} className="pp-say" />
          )}
        </>
      );
  }
}

/**
 * A change the agent proposes, in the words of what the app will do: one
 * click adds it to this pull request. Something else is asked in the
 * conversation, and the agent proposes again.
 */
function Proposal({
  message,
  open,
  projectId,
  rowKey,
  onMade,
}: {
  message: Message;
  open: boolean;
  projectId: string;
  rowKey: string;
  onMade: () => void;
}) {
  const make = useServerFn(requestChangeFn);
  const [pending, setPending] = useState(false);
  const [made, setMade] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (pending) return;
    setError("");
    setPending(true);
    try {
      const result = await make({
        data: { projectId, key: rowKey, messageId: message.id },
      });
      if (result.ok) {
        setMade(true);
        onMade();
      } else setError(result.error);
    } catch {
      setError("That did not go through. Try again.");
    } finally {
      setPending(false);
    }
  }

  if (made) return <ChangeState correction={undefined} working={null} />;
  return (
    <div className="pp-proposal">
      <div className="pp-proposal-head">
        <GitCommitHorizontal size={15} aria-hidden="true" />
        Change
      </div>
      <p>
        <Rich text={message.change ?? ""} />
      </p>
      {open && (
        <div className="pp-proposal-foot">
          <button
            type="button"
            className="pp-send"
            aria-disabled={pending}
            onClick={() => void submit()}
          >
            Make this change {pending && <Spinner />}
          </button>
          {error && (
            <span className="pp-error" role="alert">
              {error}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The question box, one line as in any chat, growing with what is typed:
 * Enter sends, Shift+Enter goes to the next line. Send shows once there is
 * something to send.
 */
function Ask({
  projectId,
  rowKey,
  text,
  onText: setText,
  waiting,
  stage,
  onSending,
  onSettled,
}: {
  projectId: string;
  rowKey: string;
  text: string;
  onText: (text: string) => void;
  /** An answer is being written: the next question waits for it. */
  waiting: boolean;
  stage: boolean;
  /** The question shows in the thread before the brain has it. */
  onSending: (question: string) => void;
  onSettled: () => void;
}) {
  const ask = useServerFn(askChatFn);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const area = box.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${area.scrollHeight}px`;
  }, [text]);
  const blocked = pending || waiting;

  async function submit() {
    const question = text.trim();
    if (!question || blocked) return;
    setError("");
    setPending(true);
    setText("");
    onSending(question);
    try {
      const result = await ask({
        data: {
          projectId,
          key: rowKey,
          text: question,
          ...(stage ? { stage } : {}),
        },
      });
      if (!result.ok) {
        setText(question);
        setError(result.error);
      }
    } catch {
      setText(question);
      setError("That did not go through. Try again.");
    } finally {
      setPending(false);
      onSettled();
    }
  }

  return (
    <div className="pp-asking">
      <form
        className="pp-input"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <textarea
          ref={box}
          aria-label="Ask about this pull request"
          placeholder="Ask about this pull request…"
          rows={1}
          value={text}
          maxLength={4000}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        {text.trim() && (
          <button
            type="submit"
            className="pp-go"
            aria-label="Send"
            aria-disabled={blocked}
          >
            {pending ? <Spinner /> : <ArrowUp size={17} strokeWidth={2.2} />}
          </button>
        )}
      </form>
      {error && (
        <p className="pp-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * The files a pull request changed, last in the panel: how many and their
 * lines, then a quiet line per file in the order a builder reads them (the
 * code, its tests, its documentation, what tools generated, the assets).
 * A file opens on its changes over the page, its header's arrows and the
 * keyboard's going from one file to the next, so the panel and its
 * conversation never move.
 */
function ChangedFiles({
  projectId,
  rowKey,
  size,
  url,
}: {
  projectId: string;
  rowKey: string;
  /** Lines and files changed: a different size is a new commit. */
  size: string;
  url: string;
}) {
  const files = usePullFiles(projectId, rowKey, size);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  useEffect(() => {
    if (open !== null && !dialog.current?.open) dialog.current?.showModal();
  }, [open]);

  if (files === undefined) return <FilesSkeleton />;
  if (files === null)
    return (
      <section className="pp-section">
        <p className="pp-none">
          <a href={`${url}/files`} target="_blank" rel="noopener">
            See the changes on GitHub
          </a>
        </p>
      </section>
    );
  // One list, the code first: the groups' order without their names.
  const ordered = groupFiles(files).flatMap((group) => group.files);
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);
  const shown = open === null ? null : ordered[open];
  // The previous or next file, round the list.
  const go = (step: number) => {
    if (ordered.length < 2) return;
    setOpen((at) =>
      at === null ? at : (at + step + ordered.length) % ordered.length,
    );
  };
  return (
    <section className="pp-section">
      <h3>
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
      </h3>
      <ul className="pp-filelist">
        {ordered.map((file, i) => {
          const slash = file.path.lastIndexOf("/");
          return (
            <li key={file.path}>
              <button
                type="button"
                className="pp-fileline"
                title={file.path}
                onClick={() => setOpen(i)}
              >
                <FileText size={13} aria-hidden="true" />
                <b>{file.path.slice(slash + 1)}</b>
                {slash > 0 && <span>{file.path.slice(0, slash)}</span>}
                <span className="pp-count">
                  <span className="add">+{file.additions}</span>{" "}
                  <span className="del">−{file.deletions}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <dialog
        ref={dialog}
        className="pp-diffs"
        aria-label={shown?.path ?? "Changes"}
        onClose={() => setOpen(null)}
        // A click beside the changes closes them.
        onClick={(event) => {
          if (event.target === event.currentTarget) dialog.current?.close();
        }}
        onKeyDown={(event) => {
          const step =
            event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          if (step) go(step);
        }}
      >
        {shown && (
          <div className="pp-diffs-box">
            <div className="pp-diffs-head">
              <span className="pp-path">
                {shown.path.slice(0, shown.path.lastIndexOf("/") + 1)}
                <b>{shown.path.slice(shown.path.lastIndexOf("/") + 1)}</b>
              </span>
              <span className="pp-count">
                <span className="add">+{shown.additions}</span>{" "}
                <span className="del">−{shown.deletions}</span>
              </span>
              {ordered.length > 1 && (
                <span className="pp-diffs-at">
                  <button
                    type="button"
                    className="tix-icon-btn"
                    aria-label="Previous file"
                    onClick={() => go(-1)}
                  >
                    <ChevronLeft size={15} />
                  </button>
                  {open! + 1} / {ordered.length}
                  <button
                    type="button"
                    className="tix-icon-btn"
                    aria-label="Next file"
                    onClick={() => go(1)}
                  >
                    <ChevronRight size={15} />
                  </button>
                </span>
              )}
              <button
                type="button"
                className="tix-icon-btn"
                aria-label="Close"
                onClick={() => dialog.current?.close()}
              >
                <X size={15} />
              </button>
            </div>
            {/* Keyed: each file opens at its top. */}
            <div key={shown.path} className="pp-diffs-body">
              {shown.lines ? (
                <div className="pp-diff" role="table" aria-label={shown.path}>
                  {shown.lines.map((line, i) =>
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
              )}
            </div>
          </div>
        )}
      </dialog>
    </section>
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
        </div>
        <div className="pp-talk" aria-hidden="true">
          <div className="pp-talk-thread" />
          <span className="sk sk-ask" />
        </div>
      </div>
    </div>
  );
}

/** The files' shape while GitHub answers: the title, then their lines. */
function FilesSkeleton() {
  return (
    <section
      className="pp-section"
      aria-busy="true"
      aria-label="Loading the changes"
    >
      <span className="sk sk-title" style={{ width: "26%" }} />
      {["36%", "48%", "30%"].map((width, i) => (
        <span key={i} className="sk" style={{ width }} />
      ))}
    </section>
  );
}
