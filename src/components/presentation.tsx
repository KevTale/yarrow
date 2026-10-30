import {
  AppWindow,
  Captions,
  CaptionsOff,
  Github,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  SquareTerminal,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  chapterMs,
  cueAt,
  presentationSchema,
  type Presentation as Timeline,
} from "@/core/presentation";
import type { StoredArtifact } from "@/core/review";
import { JiraIcon } from "./brand-icons";

const evidence = (key: string) => `/evidence/${key}`;

/** Timelines never change under their key: one fetch per page. */
const timelines = new Map<string, Promise<Timeline | null>>();
export function loadPresentation(key: string): Promise<Timeline | null> {
  let pending = timelines.get(key);
  if (!pending) {
    pending = fetch(evidence(key))
      .then((response) => (response.ok ? response.json() : null))
      .then((raw) => {
        const parsed = presentationSchema.safeParse(raw);
        return parsed.success ? parsed.data : null;
      })
      .catch(() => null);
    timelines.set(key, pending);
    // A failed load is tried again next time.
    void pending.then((timeline) => timeline || timelines.delete(key));
  }
  return pending;
}

const VOICE_KEY = "yarrow.presentation.voice";
const CAPTIONS_KEY = "yarrow.presentation.captions";
function saved(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}
function save(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // Private window: the choice lasts the page.
  }
}

const clockTime = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/**
 * The agent's screen, as it presented its pull request: one clip and one
 * voice line per chapter, under the tab it was in. The clip holds its last
 * frame while the voice finishes, and the voice waits for the clip.
 */
export function Presentation({ artifact }: { artifact: StoredArtifact }) {
  const [timeline, setTimeline] = useState<Timeline | null | undefined>();
  useEffect(() => {
    let live = true;
    void loadPresentation(artifact.key).then(
      (loaded) => live && setTimeline(loaded),
    );
    return () => {
      live = false;
    };
  }, [artifact.key]);
  if (timeline === null) return null;
  return (
    <Player
      timeline={timeline}
      poster={artifact.poster ? evidence(artifact.poster) : null}
    />
  );
}

function Player({
  timeline,
  poster,
}: {
  timeline: Timeline | undefined;
  poster: string | null;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  // The timeline loads in the browser: the button never renders on the server.
  const [voice, setVoice] = useState(() => saved(VOICE_KEY));
  const [captions, setCaptions] = useState(() => saved(CAPTIONS_KEY));
  const [full, setFull] = useState(false);
  // The controls hide while it plays and the pointer rests.
  const [awake, setAwake] = useState(true);
  const rest = useRef(0);
  // A tap on a phone first brings the controls back.
  const tapped = useRef(false);
  // Each start of a chapter, a jump back to it included.
  const [take, setTake] = useState(0);
  // Where the chapter is, and where its voice is (they drift while it loads).
  const [time, setTime] = useState({ at: 0, spoken: 0 });
  const elapsed = time.at;
  // The chapter's clock: what ran before the last pause, and since when.
  const clock = useRef({ before: 0, since: 0 });

  useEffect(() => {
    if (audio.current) audio.current.muted = !voice;
  }, [voice]);

  const chapters = timeline?.chapters ?? [];
  const chapter = chapters[index];
  const length = chapter ? chapterMs(chapter) : 0;

  const now = () =>
    clock.current.before +
    (clock.current.since ? performance.now() - clock.current.since : 0);

  const playMedia = useCallback(() => {
    const clip = video.current;
    const voiceLine = audio.current;
    if (clip && !clip.ended) void clip.play().catch(() => {});
    if (voiceLine && voiceLine.src && !voiceLine.ended)
      void voiceLine.play().catch(() => {});
  }, []);

  // A new chapter: its clip from where its page had loaded, its voice line.
  useEffect(() => {
    const clip = video.current;
    const voiceLine = audio.current;
    if (!chapter || !clip || !voiceLine) return;
    clock.current = { before: 0, since: 0 };
    setTime({ at: 0, spoken: 0 });
    if (chapter.video) {
      const start = chapter.video.startMs / 1000;
      clip.src = evidence(chapter.video.key);
      clip.onloadedmetadata = () => {
        clip.currentTime = start;
      };
    } else clip.removeAttribute("src");
    if (chapter.audio) voiceLine.src = evidence(chapter.audio.key);
    else voiceLine.removeAttribute("src");
    // The next chapter's clip starts loading now.
    const next = chapters[index + 1];
    if (next?.video) void fetch(evidence(next.video.key)).catch(() => {});
    // Only a chapter's start changes the media; playing is read when it starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter, take]);

  // Playing: media and clock run together; paused, both stop.
  useEffect(() => {
    if (!chapter) return;
    if (!playing) {
      clock.current = { before: now(), since: 0 };
      video.current?.pause();
      audio.current?.pause();
      return;
    }
    clock.current.since = performance.now();
    playMedia();
    let frame = 0;
    let done = false;
    const tick = () => {
      if (done) return;
      const at = now();
      const voiceLine = audio.current;
      // A voice line refused or broken stops counting: the clock goes on.
      const speaking = Boolean(
        voiceLine?.src &&
        !voiceLine.ended &&
        !voiceLine.paused &&
        !voiceLine.error,
      );
      setTime({
        at,
        spoken: speaking ? voiceLine!.currentTime * 1000 : at,
      });
      if (at >= length && !speaking) {
        done = true;
        if (index + 1 < chapters.length) setIndex(index + 1);
        else {
          setPlaying(false);
          setFinished(true);
        }
        return;
      }
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    // Frames stop in a hidden tab while the voice goes on: the chapters too.
    const timer = setInterval(tick, 250);
    return () => {
      done = true;
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, chapter, take, length]);

  // The media keep going once the chapter changed under a playing player.
  useEffect(() => {
    if (!playing) return;
    const clip = video.current;
    const onReady = () => playMedia();
    clip?.addEventListener("seeked", onReady);
    return () => clip?.removeEventListener("seeked", onReady);
  }, [playing, playMedia]);

  useEffect(() => {
    const onChange = () =>
      setFull(document.fullscreenElement === screen.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(
    () => () => {
      video.current?.pause();
      audio.current?.pause();
      clearTimeout(rest.current);
    },
    [],
  );

  const wake = () => {
    setAwake(true);
    clearTimeout(rest.current);
    rest.current = window.setTimeout(() => setAwake(false), 2500);
  };

  const toggle = () => {
    if (!timeline) return;
    if (finished) {
      jump(0);
      return;
    }
    wake();
    setStarted(true);
    setPlaying((on) => !on);
  };
  function jump(to: number) {
    wake();
    setFinished(false);
    setStarted(true);
    setIndex(to);
    setTake((n) => n + 1);
    setPlaying(true);
  }
  const flipVoice = () =>
    setVoice((on) => {
      save(VOICE_KEY, !on);
      return !on;
    });
  const flipCaptions = () =>
    setCaptions((on) => {
      save(CAPTIONS_KEY, !on);
      return !on;
    });
  const flipFull = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void screen.current?.requestFullscreen().catch(() => {});
  };

  const cue = chapter ? cueAt(chapter.cues, time.spoken) : null;
  const lengths = chapters.map(chapterMs);
  const total = lengths.reduce((sum, ms) => sum + ms, 0);
  const played =
    lengths.slice(0, index).reduce((sum, ms) => sum + ms, 0) +
    (finished ? length : Math.min(elapsed, length));
  const idle = playing && !awake;

  return (
    <div className="pv">
      <div className={`pv-screen ${full ? "full" : ""}`} ref={screen}>
        <div
          className={`pv-view ${idle ? "idle" : ""}`}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse") wake();
          }}
          onPointerDown={(event) => {
            tapped.current = event.pointerType !== "mouse" && idle;
            wake();
          }}
          onFocus={wake}
        >
          <video ref={video} muted playsInline preload="auto" />
          <audio ref={audio} preload="auto" />
          <button
            type="button"
            className="pv-hit"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => {
              if (!tapped.current) toggle();
            }}
          />
          {started && timeline && chapter && (
            <span key={`${index}-${take}`} className="pv-where">
              {chapter.before && <em>Before</em>}
              {where(timeline, chapter)}
            </span>
          )}
          {!started && (
            <button
              type="button"
              className="pv-start"
              onClick={toggle}
              aria-label="Play the presentation"
            >
              {poster && <img src={poster} alt="" />}
              <span className="pv-big">
                <Play size={26} aria-hidden="true" />
              </span>
            </button>
          )}
          <div className="pv-overlay">
            <p className="pv-caption" aria-live="polite">
              {captions && started && cue?.text && <span>{cue.text}</span>}
            </p>
            {timeline && (
              <div className="pv-controls">
                <div className="pv-chapters">
                  {chapters.map((item, i) => (
                    <button
                      key={i}
                      type="button"
                      className={`pv-chapter ${i === index ? "now" : ""}`}
                      style={{ flexGrow: lengths[i] }}
                      onClick={() => jump(i)}
                      aria-current={i === index ? "step" : undefined}
                      aria-label={item.title}
                      data-title={item.title}
                    >
                      <i>
                        <b
                          style={{
                            width:
                              i < index || (finished && i === index)
                                ? "100%"
                                : i === index
                                  ? `${Math.min(100, (elapsed / (length || 1)) * 100)}%`
                                  : "0%",
                          }}
                        />
                      </i>
                    </button>
                  ))}
                </div>
                <div className="pv-bar">
                  <button
                    type="button"
                    className="pv-icon"
                    onClick={toggle}
                    aria-label={
                      finished ? "Play again" : playing ? "Pause" : "Play"
                    }
                  >
                    {finished ? (
                      <RotateCcw size={18} aria-hidden="true" />
                    ) : playing ? (
                      <Pause size={18} aria-hidden="true" />
                    ) : (
                      <Play size={18} aria-hidden="true" />
                    )}
                  </button>
                  <span className="pv-time">
                    {clockTime(played)} / {clockTime(total)}
                  </span>
                  <span className="pv-now">{chapter?.title}</span>
                  <button
                    type="button"
                    className="pv-icon"
                    onClick={flipCaptions}
                    aria-pressed={captions}
                    aria-label="Captions"
                  >
                    {captions ? (
                      <Captions size={18} aria-hidden="true" />
                    ) : (
                      <CaptionsOff size={18} aria-hidden="true" />
                    )}
                  </button>
                  {chapters.some((item) => item.audio) && (
                    <button
                      type="button"
                      className="pv-icon"
                      onClick={flipVoice}
                      aria-pressed={voice}
                      aria-label="Voice"
                    >
                      {voice ? (
                        <Volume2 size={18} aria-hidden="true" />
                      ) : (
                        <VolumeX size={18} aria-hidden="true" />
                      )}
                    </button>
                  )}
                  {document.fullscreenEnabled && (
                    <button
                      type="button"
                      className="pv-icon"
                      onClick={flipFull}
                      aria-label={full ? "Exit full screen" : "Full screen"}
                    >
                      {full ? (
                        <Minimize size={18} aria-hidden="true" />
                      ) : (
                        <Maximize size={18} aria-hidden="true" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Where the chapter was filmed: the app's address, the ticket, a terminal. */
function where(timeline: Timeline, chapter: Timeline["chapters"][number]) {
  if (chapter.tab === "app")
    return (
      <>
        <AppWindow size={13} aria-hidden="true" />
        <span>{chapter.url ?? chapter.page ?? "App"}</span>
      </>
    );
  if (chapter.tab === "ticket") {
    const url = timeline.ticket.url;
    const key =
      url.match(/\/(?:issues|pull)\/(\d+)/)?.[1] ??
      url.match(/[A-Z][A-Z0-9]+-\d+/)?.[0];
    return (
      <>
        {timeline.ticket.source === "jira" ? (
          <JiraIcon size={13} />
        ) : (
          <Github size={13} aria-hidden="true" />
        )}
        <span>{key ? (/^\d+$/.test(key) ? `#${key}` : key) : "Ticket"}</span>
      </>
    );
  }
  return (
    <>
      <SquareTerminal size={13} aria-hidden="true" />
      <span>Terminal</span>
    </>
  );
}
