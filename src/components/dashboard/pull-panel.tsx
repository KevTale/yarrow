import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  CircleDashed,
  GitCommitHorizontal,
  Lightbulb,
  Mic,
  MicOff,
  RectangleHorizontal,
  Ticket,
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
  type ReactNode,
} from "react";
import { answerToRead, type ChatTicket } from "@/core/chat";
import { previewHref } from "@/core/preview";
import { money } from "@/core/packs";
import { modelShortName } from "@/core/pipeline";
import { leadProof } from "@/core/proofs";
import { agentNotes, spottedTicket } from "@/core/pull-notes";
import { formatSeconds } from "@/core/tickets";
import {
  askChatFn,
  getPullFilesFn,
  getPullPanelFn,
  requestChangeFn,
} from "@/functions/builder.functions";
import { stageFn } from "@/functions/stage.functions";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { hushAnswer, sayAnswer } from "@/components/answer-voice";
import { LiveCall, useLiveStage } from "@/components/live-stage";
import {
  loadPresentation,
  Presentation,
  saved,
  VOICE_KEY,
  type FilmControl,
  type FilmMoment,
} from "@/components/presentation";
import { Spinner } from "@/components/navigation-feedback";
import { Markdown, Rich } from "@/components/markdown";
import { useOneVoice } from "@/components/one-voice";
import {
  branchFileUrl,
  OpenApp,
  ProofBlock,
  ProofLink,
  Slider,
  type AppLink,
} from "@/components/proofs";
import { ChatWords } from "./chat-words";
import { FilesChanged } from "./files-changed";
import { MergeGo } from "./merge-go";
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
 * The visit's session did not follow to the app (src/core/preview.ts):
 * looked at as the row opens and on coming back to this tab from the app.
 */
function useSessionLost(
  projectId: string,
  rowKey: string,
  watched: boolean,
): boolean {
  const [lost, setLost] = useState(false);
  useEffect(() => {
    if (!watched) return;
    const look = () =>
      stageFn({ data: { projectId, key: rowKey, action: "status" } })
        .then((status) => setLost(status.signedIn === false))
        .catch(() => {});
    void look();
    window.addEventListener("focus", look);
    return () => window.removeEventListener("focus", look);
  }, [projectId, rowKey, watched]);
  return lost;
}

/**
 * A ticket's row, opened. With a demo, one room: the screen centered, its
 * controls on it, Merge in the bar under it. It waits for Play. Then the demo
 * plays or they talk, the conversation always beside it, the screen at one size:
 * it stops as they start speaking or send, not as the microphone opens. The
 * microphone puts the agent on a call: it answers aloud, spoken to or written to,
 * its words in the conversation; written to with no call, the written way, said
 * aloud. Play or asking for it takes the demo up from the sentence it cut, the
 * call staying until the microphone is turned off. The pull request's stage
 * takes the demo's place, the app live where it stopped, during the call or
 * when the member takes the mouse; before it is up, the agent answers by voice
 * alone. Without a demo: what the ticket asks, what changed with the one thing
 * that proves it, the conversation on the right, and at the foot the files and
 * what opens elsewhere.
 */
export function PullPanel({
  projectId,
  rowKey,
  onChanged,
  merging,
  onMerge,
  notMerged,
}: {
  projectId: string;
  rowKey: string;
  /** The table's row moved (merged, a correction started). */
  onChanged: () => void;
  /** Slid to merge, GitHub's answer on its way. */
  merging: boolean;
  /** Nothing once it is slid. */
  onMerge?: () => void;
  /** GitHub's words, when it refused to merge. */
  notMerged?: string;
}) {
  const { panel, setPanel, refresh } = usePullPanel(projectId, rowKey);
  useEffect(() => {
    void loadFiles(projectId, rowKey).catch(() => {});
  }, [projectId, rowKey]);
  // The row reached Done before the merge did: read again once it lands.
  useEffect(() => {
    if (!merging) void refresh();
  }, [merging, refresh]);

  // The stage comes up as the row opens, for an open pull request on a
  // window wide enough, for a call from the film; on a phone, the call
  // alone.
  const [wide] = useState(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(min-width: 761px)").matches,
  );
  const play = useRef<FilmControl | null>(null);
  const pause = useRef<(() => FilmMoment) | null>(null);
  const where = useRef<(() => FilmMoment) | null>(null);
  const room = useRef<HTMLDivElement>(null);
  // Where they stopped it.
  const stopped = useRef<FilmMoment | null>(null);
  const askedHere = useRef(false);
  const resting = useRef(false);
  const stage = useLiveStage({
    projectId,
    rowKey,
    start: Boolean(
      wide &&
      panel?.pullRequest?.state === "open" &&
      panel.screens.some((screen) => screen.kind === "presentation"),
    ),
    messages: panel?.messages.length ?? 0,
    answering: panel?.messages.some((message) => message.status === "pending"),
    refresh,
    onResume: (chapter) => {
      leave();
      play.current?.(chapter);
    },
    onVoice: () => stopHere(),
    onMoment: () => where.current?.() ?? null,
  });
  const speak = useOneVoice(room, () => {
    pause.current?.();
    hushAnswer(rowKey);
    if (stage.talk !== "off") stage.endTalk();
  });
  useEffect(() => {
    if (stage.talk !== "off") speak();
  }, [stage.talk, speak]);
  const lost = useSessionLost(
    projectId,
    rowKey,
    Boolean(panel?.preview?.signIn),
  );

  // Cinema: the demo or the image fills the window, the page under it held
  // where it was.
  const [cinema, setCinema] = useState(false);
  const [slot, setSlot] = useState(0);
  const [draft, setDraft] = useState("");
  const theater = useRef<HTMLDialogElement>(null);
  const seek = useRef<((ms: number) => void) | null>(null);
  const tray = useRef<HTMLElement>(null);
  // They speak or send: the demo stops there.
  const stopHere = () => {
    stopped.current = pause.current?.() ?? null;
    return stopped.current;
  };
  // The demo plays or they talk: it plays, whatever took its place gives it back.
  const leave = () => {
    askedHere.current = false;
    hushAnswer();
    stage.toDemo();
  };
  const answering = Boolean(
    panel?.messages.some((message) => message.status === "pending"),
  );
  useEffect(() => {
    const was = resting.current;
    resting.current = answering;
    if (!was || answering || !askedHere.current) return;
    askedHere.current = false;
    const answer = panel?.messages
      .filter((message) => message.author === "agent")
      .at(-1);
    // Written for want of a call: said all the same, unless it only reads.
    if (
      answer &&
      answer.status !== "failed" &&
      !answerToRead(answer.body, answer.change ?? answer.ticket) &&
      saved(VOICE_KEY)
    ) {
      speak();
      sayAnswer({ projectId, key: rowKey, messageId: answer.id });
    }
    // Only an answer ending moves it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answering]);
  useEffect(() => () => hushAnswer(rowKey), [rowKey]);
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
  const onStage = stage.phase === "ready";
  // One screen: the demo, unless something happens now. On a call, once the
  // stage is where it stopped; the agent showing, or the member trying it.
  const onCall = Boolean(presentation && stage.reached);
  const liveNow =
    onCall ||
    Boolean(
      presentation && (stage.control === "on" || (onStage && stage.agentShows)),
    );
  // What is written beside a demo acts on its stage, woken if it slept.
  const asksStage =
    onStage ||
    Boolean(
      wide &&
      presentation &&
      pullRequest?.state === "open" &&
      stage.status?.live,
    );
  const canTry = wide && panel.preview;
  const tryIt = () => {
    hushAnswer();
    stage.takeControl(pause.current?.() ?? null);
  };
  // The demo again, at a moment.
  const toFilm = (ms: number) => {
    leave();
    seek.current?.(ms);
  };
  // No call to hear it (no microphone, it failed): the written way.
  const sending = (question: string) => {
    hushAnswer();
    askedHere.current = true;
    if (asksStage) stage.ask(stopped.current);
    else stage.hold();
    setPanel(withQuestion(question));
  };
  const app: AppLink | undefined = panel.preview
    ? {
        href: `${previewHref(projectId, rowKey)}${panel.preview.path ? `?path=${encodeURIComponent(panel.preview.path)}` : ""}`,
        signIn: lost ? panel.preview.signIn : null,
      }
    : undefined;
  // The one thing that shows (decided 2026-10-30): the film passes over
  // everything; an image takes its place, cinema mode included.
  const proofs = panel.proofs ?? [];
  const lead = leadProof(proofs);
  const image = !presentation && lead?.kind === "images" ? lead : null;
  const block =
    !presentation && (lead?.kind === "measure" || lead?.kind === "output")
      ? lead
      : null;
  // A document or a check opens elsewhere, whatever else proves the change.
  const linked = proofs.find(
    (proof) => proof.kind === "document" || proof.kind === "check",
  );
  const open = pullRequest?.state === "open" && live?.open !== false;
  const changing =
    panel.working !== null ||
    panel.corrections.some(
      (correction) =>
        correction.status === "queued" || correction.status === "working",
    );
  const away = (
    <span className="pp-foot-away">
      {linked && (
        <ProofLink
          proof={linked}
          document={(file) =>
            branchFileUrl(
              pullRequest?.url ?? null,
              pullRequest?.branch ?? null,
              file,
            )
          }
          checks={panel.checks}
        />
      )}
      {app && <OpenApp app={app} />}
      {open && !changing && onMerge && (
        <MergeGo notMerged={notMerged} onMerge={onMerge} />
      )}
    </span>
  );
  const ideas = (
    <Ideas
      panel={panel}
      projectId={projectId}
      rowKey={rowKey}
      onMade={() => void refresh()}
    />
  );

  if (presentation) {
    const notes = notesOf(panel);
    return (
      <div className="pp pp-roomy" ref={room}>
        {cinema && <div style={{ height: slot }} />}
        <dialog
          ref={theater}
          className="pp-stage pp-room"
          aria-label="Full screen"
          onClose={() => setCinema(false)}
        >
          {cinema && (
            <div className="pp-stage-head">
              <button type="button" className="pp-back" onClick={flipCinema}>
                <ArrowLeft size={16} aria-hidden="true" />
                Back
              </button>
            </div>
          )}
          <div className="pp-meet">
            <div className="pp-film">
              <Presentation
                artifact={presentation}
                cinema={cinema}
                onCinema={flipCinema}
                seekRef={seek}
                playRef={play}
                pauseRef={pause}
                whereRef={where}
                demo={{
                  onBack: leave,
                  onTouch: canTry ? tryIt : undefined,
                  waiting: stage.control === "asking",
                  onCall: stage.mic !== "off",
                  // Up, its screen drawn behind the demo, ready for its canvas.
                  live: onStage && <LiveCall stage={stage} shown={liveNow} />,
                  liveNow,
                  hands: stage.control === "on",
                  end:
                    open || notes.length ? (
                      <>
                        {notes.map((line) => (
                          <p key={line}>
                            <Rich text={line} />
                          </p>
                        ))}
                        {open && (
                          <button
                            type="button"
                            className="pp-act"
                            onClick={() =>
                              tray.current?.querySelector("textarea")?.focus()
                            }
                          >
                            Ask for a change
                          </button>
                        )}
                      </>
                    ) : null,
                }}
              />
            </div>
            {pullRequest && (
              <aside ref={tray} className="pp-tray" aria-label="Conversation">
                <div className="pp-talk-thread">
                  <Thread
                    panel={
                      stage.turn.length
                        ? {
                            ...panel,
                            messages: [
                              ...panel.messages.slice(
                                0,
                                stage.threadUpTo ?? undefined,
                              ),
                              ...stage.turn,
                            ],
                          }
                        : panel
                    }
                    projectId={projectId}
                    rowKey={rowKey}
                    open={open}
                    onSeek={toFilm}
                    onMade={() => {
                      void refresh();
                      onChanged();
                    }}
                  />
                </div>
                <Ask
                  projectId={projectId}
                  rowKey={rowKey}
                  text={draft}
                  onText={setDraft}
                  waiting={answering}
                  stage={asksStage}
                  call={{
                    state: stage.mic,
                    onCall: () => void stage.openCall(false),
                    onHangUp: () => stage.muteMic(),
                    onWarm: () => stage.warm(),
                  }}
                  onTyping={stage.expect}
                  onWrite={(question) => {
                    stopHere();
                    return stage.write(question);
                  }}
                  onSending={sending}
                  onFailed={() => {
                    askedHere.current = false;
                    hushAnswer();
                  }}
                  onSettled={() => void refresh()}
                />
              </aside>
            )}
          </div>
          <div className="pp-foot pp-bar">
            {pullRequest && (
              <ChangedFiles
                projectId={projectId}
                rowKey={rowKey}
                size={size}
                url={pullRequest.url}
              />
            )}
            {ideas}
            {away}
          </div>
        </dialog>
      </div>
    );
  }

  // The conversation, the panel's right column, beside the image in cinema.
  const talk = (
    <Conversation
      panel={panel}
      projectId={projectId}
      rowKey={rowKey}
      draft={draft}
      onDraft={setDraft}
      onPanel={setPanel}
      onRefresh={refresh}
      onSeek={null}
      onMade={() => {
        void refresh();
        onChanged();
      }}
      turn={stage.turn}
      onAsking={stage.hold}
      call={{
        state: stage.mic,
        onCall: () => void stage.openCall(),
        onHangUp: () => stage.endTalk(),
        onWarm: () => stage.warm(),
      }}
    />
  );
  const proven = (
    <>
      {image && (
        <>
          {cinema && <div style={{ height: slot }} />}
          <dialog
            ref={theater}
            className="pp-stage"
            aria-label="Full screen"
            onClose={() => setCinema(false)}
          >
            <div className="pp-film">
              {cinema && (
                <div className="pp-stage-head">
                  <button
                    type="button"
                    className="pp-back"
                    onClick={flipCinema}
                  >
                    <ArrowLeft size={16} aria-hidden="true" />
                    Back
                  </button>
                  {app && <OpenApp app={app} />}
                </div>
              )}
              <Slider
                proof={image}
                tools={
                  !cinema && (
                    <span className="pv-glass-pill pv-tools">
                      <button
                        type="button"
                        className="pv-icon"
                        onClick={flipCinema}
                        aria-label="Full screen"
                        data-tip="Full screen"
                      >
                        <RectangleHorizontal size={18} aria-hidden="true" />
                      </button>
                    </span>
                  )
                }
              />
            </div>
            {cinema && talk}
          </dialog>
        </>
      )}
      {block && <ProofBlock proof={block} />}
    </>
  );
  return (
    <div className="pp">
      <div className="pp-grid">
        <div className="pp-main">
          {panel.implementation?.ask && (
            <TicketAsk ask={panel.implementation.ask} />
          )}
          {panel.implementation ? (
            <Changed
              implementation={panel.implementation}
              review={panel.review}
              screens={panel.proofs ? [] : panel.screens}
            >
              {proven}
            </Changed>
          ) : (
            proven
          )}

          {/* In line with the chat's box: what stays here, what opens elsewhere. */}
          {(pullRequest || app) && (
            <div className="pp-foot">
              {pullRequest && (
                <ChangedFiles
                  projectId={projectId}
                  rowKey={rowKey}
                  size={size}
                  url={pullRequest.url}
                />
              )}
              {ideas}
              {away}
            </div>
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
      return `${model("implementer") ?? "The agent"} is writing the change`;
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
 * developer, in a sentence or two and one voice: the reviewer's. Before it
 * did, the implementer's words then the reviewer's own. The one thing that
 * proves it follows. What to do and what could not be checked are the
 * agent's notes; the criteria and the checks are the conversation's.
 */
function Changed({
  implementation,
  review,
  screens,
  children,
}: {
  implementation: NonNullable<Panel["implementation"]>;
  review: Panel["review"];
  screens: Panel["screens"];
  /** The film or the one proof. */
  children: ReactNode;
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
      {children}
      {shots.length > 0 && <Screens screens={shots} />}
    </section>
  );
}

/** What the agent tells the owner first: what they must know. */
function notesOf(panel: Panel) {
  const { implementation, review } = panel;
  if (!implementation) return [];
  return agentNotes({
    blocking: review?.blocking ?? [],
    criteria: implementation.criteria,
    risks: implementation.risks,
    notVerified: implementation.notVerified,
    checked: panel.checks?.state === "passed",
  });
}

/**
 * What the agent says before any question: what must be done, what could not
 * be checked. With nothing to say, it says nothing.
 */
function Notes({ panel }: { panel: Panel }) {
  const notes = notesOf(panel);
  if (notes.length === 0) return null;
  return (
    <li className="pp-it">
      {notes.map((line) => (
        <p key={line} className="pp-say">
          <Rich text={line} />
        </p>
      ))}
    </li>
  );
}

/**
 * What the agents noticed outside the ticket and left alone, a button at the
 * foot opening the new ticket dialog on them, their words drafted (their
 * technical pointer goes in the ticket).
 */
function Ideas({
  panel,
  projectId,
  rowKey,
  onMade,
}: {
  panel: Panel;
  projectId: string;
  rowKey: string;
  /** A suggestion was made a ticket: the panel reads it gone. */
  onMade: () => void;
}) {
  const tickets = useContext(DraftTicket);
  // Gone at once, before the panel is read again.
  const [made, setMade] = useState<string[]>([]);
  const { implementation, pullRequest } = panel;
  if (!tickets || !implementation) return null;
  const lines = implementation.spotted.filter((line) => !made.includes(line));
  if (lines.length === 0) return null;
  return (
    <button
      type="button"
      className="pp-act"
      onClick={() =>
        tickets.open(
          projectId,
          lines.map((line) => ({
            ...spottedTicket(line, implementation.by, pullRequest?.url ?? null),
            from: { key: rowKey, note: line },
          })),
          ({ from }) => {
            const note = from?.note;
            if (note) setMade((shown) => [...shown, note]);
            onMade();
          },
        )
      }
    >
      <Lightbulb size={15} aria-hidden="true" />
      {lines.length} suggested {lines.length === 1 ? "ticket" : "tickets"}
    </button>
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
  ticket: null,
  ticketKey: null,
  createdAt: new Date(at).toISOString(),
});

const withQuestion =
  (question: string) => (shown: Panel | null | undefined) => {
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
  };

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
 * A ticket's conversation: the agent's notes, questions, answers, the changes
 * asked, then the box to ask the next one. Beside the film in the panel;
 * beside the live stage on its page, where the agent may act on the stage and
 * `turn` is the live call's turn under way, until the thread has it; beside a
 * stopped ticket, with no pull request, under `head`.
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
  call,
  head,
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
  /** The agent can be called from here. */
  call?: ConversationCall;
  /** What it opens on, before anything is said. */
  head?: ReactNode;
}) {
  // The agent's notes set the panel's column (--talk-opened in the styles);
  // what is said after them scrolls inside, so a long conversation neither
  // moves the row nor opens it taller.
  const column = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const aside = column.current;
    const thread = aside?.firstElementChild;
    if (!aside || !thread) return;
    const said = aside.querySelector(".pp-me");
    const notes = said
      ? said.getBoundingClientRect().top -
        thread.getBoundingClientRect().top +
        thread.scrollTop
      : thread.scrollHeight;
    const height = [...aside.children]
      .slice(1)
      .reduce((sum, part) => sum + part.scrollHeight, notes);
    aside.style.setProperty("--talk-opened", `${height}px`);
  }, []);
  const { live, pullRequest } = panel;
  if (!pullRequest && !head) return null;
  const open = pullRequest?.state === "open" && live?.open !== false;
  const answering = panel.messages.some(
    (message) => message.status === "pending",
  );
  return (
    <aside ref={column} className="pp-talk" aria-label="Conversation">
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
          head={head}
        />
      </div>
      <Ask
        projectId={projectId}
        rowKey={rowKey}
        text={draft}
        onText={onDraft}
        waiting={answering}
        stage={stage}
        call={call}
        onSending={(question) => {
          onAsking?.();
          onPanel(withQuestion(question));
        }}
        onSettled={() => void onRefresh()}
      />
    </aside>
  );
}

/** The microphone, in the question box. */
export interface ConversationCall {
  state: "off" | "starting" | "on";
  onCall: () => void;
  onHangUp: () => void;
  onWarm?: () => void;
}

/**
 * The agent's notes first; then the builder's words in a bubble on the
 * right, the agent's as text on the left.
 */
function Thread({
  panel,
  projectId,
  rowKey,
  open,
  onSeek,
  onMade,
  head,
}: {
  panel: Panel;
  projectId: string;
  rowKey: string;
  /** The pull request can still change. */
  open: boolean;
  /** Plays the film from a moment; null without a film. */
  onSeek: ((ms: number) => void) | null;
  onMade: () => void;
  head?: ReactNode;
}) {
  const shown = lines(panel);
  const working = workingText(panel);
  const list = useRef<HTMLOListElement>(null);
  const last = shown.at(-1);
  // A card comes with the thread read back, after the words it goes with.
  const latest = `${shown.length}:${last?.kind === "message" ? `${last.message.status}:${last.message.body.length}:${Boolean(last.message.change ?? last.message.ticket)}` : ""}`;
  // The latest in view as it comes, the page left where it is: the column
  // scrolls. With nothing said yet, the agent's notes from their top.
  const said = shown.length > 0;
  useLayoutEffect(() => {
    const box = list.current?.parentElement;
    if (box && said) box.scrollTop = box.scrollHeight;
  }, [latest, said]);
  return (
    <ol className="pp-chat" ref={list}>
      {head && <li className="pp-it">{head}</li>}
      <Notes panel={panel} />
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
      <ChatWords body={message.body} onSeek={onSeek} />
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
      {message.ticket && (
        <TicketCard
          ticket={message.ticket}
          messageId={message.id}
          ticketKey={message.ticketKey}
          projectId={projectId}
          rowKey={rowKey}
          onMade={onMade}
        />
      )}
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
 * A ticket the agent proposes, once asked: one click creates it where the
 * project's tickets go, not started. Edit opens the new ticket dialog on it,
 * to reword it, send it elsewhere or start it. Created, it links to the
 * ticket; left alone, it stays here.
 */
function TicketCard({
  ticket,
  messageId,
  ticketKey,
  projectId,
  rowKey,
  onMade,
}: {
  ticket: ChatTicket;
  messageId: string;
  ticketKey: string | null;
  projectId: string;
  rowKey: string;
  onMade: () => void;
}) {
  const tickets = useContext(DraftTicket);
  const [pending, setPending] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [error, setError] = useState("");
  const draft = {
    title: ticket.title,
    body: ticket.body,
    from: { key: rowKey, note: ticket.note, messageId },
  };

  async function submit() {
    if (pending || !tickets) return;
    setError("");
    setPending(true);
    try {
      const result = await tickets.create(projectId, draft);
      if (result.ok) {
        setMade(result.key);
        onMade();
      } else setError(result.error);
    } catch {
      setError("That did not go through. Try again.");
    } finally {
      setPending(false);
    }
  }

  const key = made ?? ticketKey;
  if (key)
    return (
      <button
        type="button"
        className="pp-act pp-ticket-made"
        disabled={!tickets}
        onClick={() => tickets?.show(projectId, key)}
      >
        <Ticket size={15} aria-hidden="true" />
        <span>{ticket.title}</span>
        <small>{/^\d+$/.test(key) ? `#${key}` : key}</small>
      </button>
    );
  return (
    <div className="pp-proposal">
      <div className="pp-proposal-head">
        <Ticket size={15} aria-hidden="true" />
        Ticket
      </div>
      <p className="pp-proposal-title">{ticket.title}</p>
      <p>
        <Rich text={ticket.body} />
      </p>
      {tickets && (
        <div className="pp-proposal-foot">
          {error && (
            <span className="pp-error" role="alert">
              {error}
            </span>
          )}
          <button
            type="button"
            className="pp-act"
            onClick={() => tickets.open(projectId, [draft], () => onMade())}
          >
            Edit
          </button>
          <button
            type="button"
            className="pp-send"
            aria-disabled={pending}
            onClick={() => void submit()}
          >
            Create ticket {pending && <Spinner />}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The question box, one line as in any chat, growing with what is typed:
 * Enter sends, Shift+Enter goes to the next line. Send shows once there is
 * something to send; the call until then, its hang up and clock while it is on.
 */
function Ask({
  projectId,
  rowKey,
  text,
  onText: setText,
  waiting,
  stage,
  call,
  onTyping,
  onWrite,
  onSending,
  onFailed,
  onSettled,
}: {
  projectId: string;
  rowKey: string;
  text: string;
  onText: (text: string) => void;
  /** An answer is being written: the next question waits for it. */
  waiting: boolean;
  stage: boolean;
  call?: ConversationCall;
  /** Something is being written. */
  onTyping?: () => void;
  /** A call hears it instead: false with no call. */
  onWrite?: (question: string) => Promise<boolean>;
  /** The question shows in the thread before the brain has it. */
  onSending: (question: string) => void;
  /** It did not go through: nothing will answer it. */
  onFailed?: () => void;
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
    if (await onWrite?.(question)) {
      setPending(false);
      return;
    }
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
        onFailed?.();
      }
    } catch {
      setText(question);
      setError("That did not go through. Try again.");
      onFailed?.();
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
          aria-label="Ask about this ticket"
          placeholder="Ask about this ticket…"
          rows={1}
          value={text}
          maxLength={4000}
          onChange={(event) => {
            setText(event.target.value);
            onTyping?.();
          }}
          onFocus={call?.onWarm}
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
        {call && (call.state !== "off" || !text.trim()) && (
          <button
            type="button"
            className={`pp-call ${call.state === "off" ? "" : call.state === "starting" ? "hang ringing" : "hang"}`}
            onClick={call.state === "off" ? call.onCall : call.onHangUp}
            onPointerEnter={call.onWarm}
            onFocus={call.onWarm}
            aria-pressed={call.state !== "off"}
            aria-label="Microphone"
          >
            {call.state === "off" ? (
              <MicOff size={17} aria-hidden="true" />
            ) : (
              <Mic size={17} aria-hidden="true" />
            )}
          </button>
        )}
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

/** The pull request's files, read when the row opens. */
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
  if (files === undefined)
    return (
      <span
        className="sk"
        style={{ width: 170 }}
        role="status"
        aria-label="Loading the changes"
      />
    );
  if (files === null)
    return (
      <a
        className="pp-act"
        href={`${url}/files`}
        target="_blank"
        rel="noopener"
      >
        See the changes on GitHub
        <ArrowUpRight size={14} aria-hidden="true" />
      </a>
    );
  if (!files.length) return null;
  return <FilesChanged files={files} />;
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
