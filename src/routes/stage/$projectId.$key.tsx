import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadPresentation } from "@/components/presentation";
import {
  cueAt,
  estimateSpeechMs,
  wordsSaid,
  type Presentation,
  type PresentationChapter,
} from "@/core/presentation";
import {
  stageCueFn,
  stageFn,
  type StageView,
} from "@/functions/stage.functions";

/**
 * A pull request's stage, its app live on Yarrow's desktop (workers/stage.ts),
 * and its presentation played on it: the voice here, the gestures there.
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

function StagePage() {
  const { projectId, key } = Route.useParams();
  const [status, setStatus] = useState<StageView>(Route.useLoaderData());
  const [asking, setAsking] = useState(false);
  const [timeline, setTimeline] = useState<Presentation | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const screen = useRef<HTMLDivElement>(null);
  const voice = useRef<HTMLAudioElement | null>(null);
  const stopped = useRef(false);

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

  const act = async (action: "open" | "close", fresh = false) => {
    setAsking(true);
    try {
      await call(action, fresh);
    } finally {
      setAsking(false);
    }
  };

  /** The chapter's voice, its words as they are said; none: its length in silence. */
  const speak = (chapter: PresentationChapter, index: number) =>
    new Promise<void>((resolve) => {
      const length = chapter.audio?.durationMs ?? estimateSpeechMs(chapter.say);
      const started = performance.now();
      let audio: HTMLAudioElement | null = null;
      if (chapter.audio) {
        audio = voice.current ?? new Audio();
        voice.current = audio;
        audio.src = evidence(chapter.audio.key);
        void audio.play().catch(() => {});
      }
      const tick = () => {
        const spokenMs = audio
          ? audio.currentTime * 1000
          : performance.now() - started;
        const over = audio ? audio.ended : spokenMs >= length;
        if (stopped.current || over) return resolve();
        setShow({ index, spokenMs });
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

  const play = async () => {
    if (!timeline) return;
    stopped.current = false;
    setProblems([]);
    setShow({ index: 0, spokenMs: 0 });
    const cue = (data: Parameters<typeof stageCueFn>[0]["data"]["cue"]) =>
      stageCueFn({ data: { projectId, key, cue: data } }).catch(
        (error: Error) => ({ ok: false, problems: [error.message] }),
      );
    const opening = await cue({ action: "set" });
    const found = [...opening.problems];
    if (opening.ok)
      for (const [index, chapter] of timeline.chapters.entries()) {
        if (stopped.current) break;
        const voiceMs =
          chapter.audio?.durationMs ?? estimateSpeechMs(chapter.say);
        // The next voice waits for this chapter's gestures.
        const [played] = await Promise.all([
          cue({ action: "chapter", index, voiceMs }),
          speak(chapter, index),
        ]);
        found.push(...played.problems);
      }
    setProblems(found);
    setShow(null);
  };

  const stop = () => {
    stopped.current = true;
    voice.current?.pause();
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
          {up ? (
            <button
              type="button"
              className="button button-secondary button-small"
              disabled={asking}
              onClick={() => {
                stop();
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
    </main>
  );
}
