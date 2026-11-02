import type { Language } from "@elevenlabs/client";
import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Conversation,
  usePullPanel,
  type ThreadMessage,
} from "@/components/dashboard/pull-panel";
import { loadPresentation } from "@/components/presentation";
import {
  cueAt,
  estimateSpeechMs,
  wordsSaid,
  type Presentation,
  type PresentationChapter,
} from "@/core/presentation";
import type { StageCueResult } from "@/core/stage";
import {
  stageCueFn,
  stageFn,
  stageTalkFn,
  type StageView,
} from "@/functions/stage.functions";

/**
 * A pull request's stage, its app live on Yarrow's desktop (workers/stage.ts),
 * and its presentation played on it: the voice here, the gestures there.
 * The member talks to the agent over it (src/runner/talk.ts), or writes
 * to it in the pull request's conversation beside it: either holds the
 * presentation, the agent answers and shows on the stage, and the thread
 * keeps what was said as what was written.
 * Not linked from the dashboard yet: the live review, step by step.
 */
export const Route = createFileRoute("/stage/$projectId/$key")({
  loader: ({ params }) => stageFn({ data: { ...params, action: "status" } }),
  head: () => ({ meta: [{ title: "Stage · Yarrow" }] }),
  component: StagePage,
});

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const evidence = (key: string) => `/evidence/${key}`;

/** Where the live presentation is: its chapter and how far its voice went. */
interface Show {
  index: number;
  spokenMs: number;
}

/** A line of the call, as it was heard, until the thread has it. */
interface Line {
  who: "member" | "agent";
  text: string;
  at: number;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Cue = Parameters<typeof stageCueFn>[0]["data"]["cue"];

/** What the page asks of the call (an ElevenLabs conversation). */
interface Call {
  endSession(): Promise<void>;
}

function StagePage() {
  const { projectId, key } = Route.useParams();
  const [status, setStatus] = useState<StageView>(Route.useLoaderData());
  const [asking, setAsking] = useState(false);
  const [timeline, setTimeline] = useState<Presentation | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [talk, setTalk] = useState<"off" | "starting" | "on">("off");
  const [held, setHeld] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState("");
  const { panel, setPanel, refresh } = usePullPanel(projectId, key);
  const screen = useRef<HTMLDivElement>(null);
  const voice = useRef<HTMLAudioElement | null>(null);
  const stopped = useRef(false);
  /** Ends the voice playing now. */
  const hush = useRef<(() => void) | null>(null);
  /** Holds the voice playing now, and lets it go on. */
  const voiceHold = useRef<{ pause(): void; resume(): void } | null>(null);
  const showing = useRef(false);
  /** Held while the member talks: the next chapter waits for it. */
  const holding = useRef<{ release(): void; resumed: Promise<void> } | null>(
    null,
  );
  const conversation = useRef<Call | null>(null);
  const calling = useRef(false);
  /** The agent's voice is on. */
  const speaking = useRef(false);
  /** The agent asked to go on: once its voice is done. */
  const goOnAsked = useRef(false);
  /** The thread's length when the call's turn under way began. */
  const before = useRef<number | null>(null);
  const known = useRef(0);
  known.current = panel?.messages.length ?? 0;

  const cue = useCallback(
    (data: Cue) =>
      stageCueFn({ data: { projectId, key, cue: data } }).catch(
        (error: Error): StageCueResult => ({
          ok: false,
          problems: [error.message],
        }),
      ),
    [projectId, key],
  );

  const call = useCallback(
    (action: "open" | "status" | "close", fresh = false) =>
      stageFn({ data: { projectId, key, action, fresh } }).then(setStatus),
    [projectId, key],
  );

  // Looked at every second while it comes up.
  const phase = status.phase;
  useEffect(() => {
    if (phase !== "booting") return;
    const timer = setInterval(() => void call("status"), 1000);
    return () => clearInterval(timer);
  }, [phase, call]);

  const presentation = status.presentation;
  useEffect(() => {
    if (!presentation) return;
    let gone = false;
    void loadPresentation(presentation).then((loaded) => {
      if (!gone) setTimeline(loaded);
    });
    return () => {
      gone = true;
    };
  }, [presentation]);

  // The screen, once up: VNC over the page's WebSocket, watched only.
  useEffect(() => {
    if (phase !== "ready" || !screen.current) return;
    let rfb: { disconnect(): void } | null = null;
    let gone = false;
    void import("@novnc/novnc").then(({ default: RFB }) => {
      if (gone || !screen.current) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const client = new RFB(
        screen.current,
        `${protocol}//${location.host}/stage-screen/${projectId}/${key}`,
        { wsProtocols: ["binary"] },
      );
      client.viewOnly = true;
      client.scaleViewport = true;
      client.background = "transparent";
      client.addEventListener("disconnect", () => {
        if (!gone) void call("status");
      });
      rfb = client;
    });
    return () => {
      gone = true;
      rfb?.disconnect();
    };
  }, [phase, projectId, key, call]);

  // The call ends with the page.
  useEffect(
    () => () => {
      void conversation.current?.endSession();
    },
    [],
  );

  const act = async (action: "open" | "close", fresh = false) => {
    setAsking(true);
    try {
      await call(action, fresh);
    } finally {
      setAsking(false);
    }
  };

  /** The member speaks: the presentation waits for them. */
  const hold = () => {
    if (!showing.current || holding.current) return;
    let release = () => {};
    const resumed = new Promise<void>((resolve) => (release = resolve));
    holding.current = { release, resumed };
    setHeld(true);
    voiceHold.current?.pause();
    void cue({ action: "pause" });
  };

  /** On again: the screen as the talk found it, then the voice from its sentence. */
  const goOn = async () => {
    const holdNow = holding.current;
    goOnAsked.current = false;
    if (!holdNow) return;
    const result = await cue({ action: "resume" });
    if (result.problems.length)
      setProblems((now) => [...now, ...result.problems]);
    holding.current = null;
    setHeld(false);
    voiceHold.current?.resume();
    holdNow.release();
  };

  /**
   * The turn is over: the brain kept it in the thread before it ended.
   * Read back, its lines go; a turn kept with no words (going on) too.
   */
  const settle = useCallback(async () => {
    const from = before.current ?? known.current;
    const begun = Date.now();
    for (let attempt = 0; attempt < 6; attempt++) {
      const fresh = await refresh();
      if (fresh && fresh.messages.length > from) break;
      await sleep(2000);
    }
    before.current = null;
    setLines((now) => now.filter((line) => line.at > begun));
  }, [refresh]);

  /** The call: the member's voice to the agent, the agent's back. */
  const startTalk = async () => {
    if (calling.current) return;
    calling.current = true;
    setTalk("starting");
    try {
      const language = (navigator.language || "en").slice(0, 2).toLowerCase();
      const pass = await stageTalkFn({ data: { projectId, key, language } });
      if (!pass.ok) throw new Error(pass.reason);
      const eleven = await import("@elevenlabs/client");
      conversation.current = await eleven.Conversation.startSession({
        conversationToken: pass.conversationToken,
        connectionType: "webrtc",
        overrides: { agent: { language: language as Language } },
        customLlmExtraBody: { yarrow: pass.grant },
        clientTools: {
          resume_presentation: () => {
            goOnAsked.current = true;
            if (!speaking.current) void goOn();
            void settle();
          },
        },
        // Their first words, still being heard, already hold it.
        onIncomingEvent: (event: {
          type?: string;
          tentative_user_transcription_event?: { user_transcript?: string };
        }) => {
          const heard =
            event.tentative_user_transcription_event?.user_transcript ?? "";
          if (
            event.type === "tentative_user_transcript" &&
            /\p{L}/u.test(heard)
          )
            hold();
        },
        onMessage: ({ source, message }) => {
          if (source === "user") hold();
          const text = message.trim();
          if (!text) return;
          before.current ??= known.current;
          setLines((now) => [
            ...now,
            {
              who: source === "user" ? "member" : "agent",
              text,
              at: Date.now(),
            },
          ]);
          if (source !== "user") void settle();
        },
        onModeChange: ({ mode }) => {
          speaking.current = mode === "speaking";
          if (!speaking.current && goOnAsked.current) void goOn();
        },
        onDisconnect: () => {
          conversation.current = null;
          calling.current = false;
          setTalk("off");
        },
        onError: (message) =>
          setProblems((now) => [...now, `call: ${message}`]),
      });
      setTalk("on");
    } catch (error) {
      calling.current = false;
      setTalk("off");
      setProblems((now) => [...now, `call: ${(error as Error).message}`]);
    }
  };

  const endTalk = () => {
    void conversation.current?.endSession();
    conversation.current = null;
    calling.current = false;
    setTalk("off");
  };

  /**
   * The chapter's voice, its words as they are said; none (or one that
   * cannot play): its length in silence. It ends with the voice, the
   * frames only show the words: a hidden tab gets none. Held, it waits.
   */
  const speak = (chapter: PresentationChapter, index: number) =>
    new Promise<void>((resolve) => {
      const length = chapter.audio?.durationMs ?? estimateSpeechMs(chapter.say);
      let started = performance.now();
      let pausedAt: number | null = null;
      let frame = 0;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        cancelAnimationFrame(frame);
        clearTimeout(timer);
        hush.current = null;
        voiceHold.current = null;
        resolve();
      };
      hush.current = done;
      const silent = () => {
        clearTimeout(timer);
        if (pausedAt === null)
          timer = setTimeout(done, length - (performance.now() - started));
      };
      let audio: HTMLAudioElement | null = null;
      if (chapter.audio) {
        audio = voice.current ?? new Audio();
        voice.current = audio;
        audio.onended = done;
        audio.onerror = silent;
        audio.src = evidence(chapter.audio.key);
        void audio.play().catch(silent);
      } else silent();
      const playing = audio;
      voiceHold.current = {
        pause: () => {
          if (pausedAt !== null) return;
          pausedAt = performance.now();
          clearTimeout(timer);
          playing?.pause();
        },
        resume: () => {
          if (pausedAt === null) return;
          started += performance.now() - pausedAt;
          pausedAt = null;
          if (playing && !playing.error) {
            // From the start of its sentence: the thread picks up where it broke.
            const sentence = cueAt(chapter.cues, playing.currentTime * 1000);
            if (sentence) playing.currentTime = sentence.startMs / 1000;
            void playing.play().catch(silent);
          } else silent();
        },
      };
      const tick = () => {
        const spokenMs =
          audio && !audio.error
            ? audio.currentTime * 1000
            : (pausedAt ?? performance.now()) - started;
        setShow({ index, spokenMs });
        frame = requestAnimationFrame(tick);
      };
      frame = requestAnimationFrame(tick);
    });

  const play = async () => {
    if (!timeline) return;
    stopped.current = false;
    showing.current = true;
    setProblems([]);
    setNotes([]);
    setShow({ index: 0, spokenMs: 0 });
    // The member can stop it by speaking from the first word.
    if (!conversation.current) void startTalk();
    const heard = (at: string, result: StageCueResult) =>
      setNotes((now) => [
        ...now,
        ...(result.notes ?? []).map((note) => `${at}: ${note}`),
      ]);
    const opening = await cue({ action: "set" });
    heard("opening", opening);
    const found = [...opening.problems];
    if (opening.ok)
      for (const [index, chapter] of timeline.chapters.entries()) {
        while (holding.current && !stopped.current)
          await holding.current.resumed;
        if (stopped.current) break;
        const voiceMs =
          chapter.audio?.durationMs ?? estimateSpeechMs(chapter.say);
        // The next voice waits for this chapter's gestures.
        const [played] = await Promise.all([
          cue({ action: "chapter", index, voiceMs }),
          speak(chapter, index),
        ]);
        found.push(...played.problems);
        heard(`${index + 1}`, played);
      }
    showing.current = false;
    setProblems((now) => [...now, ...found]);
    setShow(null);
  };

  const stop = () => {
    stopped.current = true;
    voice.current?.pause();
    hush.current?.();
    // The presenter lets its chapter end; the page waits no more.
    const holdNow = holding.current;
    if (holdNow) {
      holding.current = null;
      setHeld(false);
      void cue({ action: "resume" });
      holdNow.release();
    }
  };

  const up = phase === "ready" || phase === "booting";
  const chapter = show ? timeline?.chapters[show.index] : null;
  const caption = chapter ? cueAt(chapter.cues, show!.spokenMs) : null;
  const said = caption ? wordsSaid(caption, show!.spokenMs) : 0;
  return (
    <main id="main" className="container page-main stage-page">
      <header className="stage-head">
        <h1>{chapter ? chapter.title : "Stage"}</h1>
        <div className="stage-actions">
          {phase === "ready" && held && (
            <button
              type="button"
              className="button button-primary button-small"
              onClick={() => void goOn()}
            >
              Resume
            </button>
          )}
          {phase === "ready" &&
            status.live &&
            timeline &&
            (show ? (
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={stop}
              >
                Stop presenting
              </button>
            ) : (
              <button
                type="button"
                className="button button-primary button-small"
                onClick={() => void play()}
              >
                Present
              </button>
            ))}
          {phase === "ready" &&
            (talk === "off" ? (
              <button
                type="button"
                className="button button-secondary button-small"
                onClick={() => void startTalk()}
              >
                Talk
              </button>
            ) : (
              <button
                type="button"
                className="button button-secondary button-small"
                disabled={talk === "starting"}
                onClick={endTalk}
              >
                Hang up
              </button>
            ))}
          {up ? (
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={asking}
              onClick={() => {
                stop();
                endTalk();
                void act("close");
              }}
            >
              Stop
            </button>
          ) : (
            <>
              <button
                type="button"
                className="button button-primary button-small"
                disabled={asking}
                onClick={() => void act("open")}
              >
                Start
              </button>
              <button
                type="button"
                className="button button-secondary button-small"
                disabled={asking}
                onClick={() => void act("open", true)}
              >
                Start fresh
              </button>
            </>
          )}
        </div>
      </header>
      <div className="stage-body">
        <div className="stage-main">
          <div className="stage-view">
            <div
              className="stage-screen"
              ref={screen}
              data-phase={phase ?? "off"}
            />
            <p className="pv-caption stage-caption" aria-live="polite">
              {caption?.text &&
                (caption.words.length ? (
                  caption.words.map((word, i) => (
                    <span key={i} className={`w ${i < said ? "said" : ""}`}>
                      {word.text}
                      {i < caption.words.length - 1 ? " " : ""}
                    </span>
                  ))
                ) : (
                  <span>{caption.text}</span>
                ))}
            </p>
          </div>
          {problems.length > 0 && (
            <pre className="stage-error">{problems.join("\n")}</pre>
          )}
          {notes.length > 0 && (
            <ol className="stage-events">
              {notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ol>
          )}
          {status.events.length > 0 && (
            <ol className="stage-events">
              {status.events.map((event, i) => (
                <li key={i}>
                  <span>{seconds(event.ms)}</span>
                  {event.label}
                </li>
              ))}
              {status.warm && <li className="stage-warm">From the snapshot</li>}
            </ol>
          )}
          {status.error && <pre className="stage-error">{status.error}</pre>}
        </div>
        {panel && (
          <Conversation
            panel={panel}
            projectId={projectId}
            rowKey={key}
            draft={draft}
            onDraft={setDraft}
            onPanel={setPanel}
            onRefresh={refresh}
            onSeek={null}
            onMade={() => void refresh()}
            stage={phase === "ready"}
            turn={lines.map((line, i): ThreadMessage => ({
              id: `call${line.at}${i}`,
              author: line.who === "member" ? "builder" : "agent",
              body: line.text,
              status: "done",
              change: null,
              correctionRequestId: null,
              createdAt: new Date(line.at).toISOString(),
            }))}
            onAsking={hold}
          />
        )}
      </div>
    </main>
  );
}
