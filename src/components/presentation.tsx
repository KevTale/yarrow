import {
  Github,
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
function savedVoice(): boolean {
  try {
    return localStorage.getItem(VOICE_KEY) !== "off";
  } catch {
    return true;
  }
}

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
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  // The timeline loads in the browser: the button never renders on the server.
  const [voice, setVoice] = useState(savedVoice);
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

  useEffect(
    () => () => {
      video.current?.pause();
      audio.current?.pause();
    },
    [],
  );

  const toggle = () => {
    if (!timeline) return;
    if (finished) {
      jump(0);
      return;
    }
    setStarted(true);
    setPlaying((on) => !on);
  };
  function jump(to: number) {
    setFinished(false);
    setStarted(true);
    setIndex(to);
    setTake((n) => n + 1);
    setPlaying(true);
  }
  const flipVoice = () =>
    setVoice((on) => {
      try {
        localStorage.setItem(VOICE_KEY, on ? "off" : "on");
      } catch {
        // Private window: the choice lasts the page.
      }
      return !on;
    });

  const cue = chapter ? cueAt(chapter.cues, time.spoken) : null;
  const tabs = timeline ? screenTabs(timeline) : [];
  const address =
    chapter?.tab === "terminal"
      ? null
      : chapter?.tab === "ticket"
        ? timeline?.ticket.url
        : chapter?.url;

  return (
    <div className="pv">
      <div className="pv-screen">
        <div className="pv-tabs" aria-hidden="true">
          {tabs.map((tab) => (
            <span
              key={tab.tab}
              className={`pv-tab ${chapter?.tab === tab.tab ? "on" : ""}`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </span>
          ))}
        </div>
        <div className="pv-url" aria-hidden="true">
          {chapter?.before && <em>Before</em>}
          <span>{address ?? (chapter ? "Terminal" : "")}</span>
        </div>
        <div className="pv-view">
          <video ref={video} muted playsInline preload="auto" />
          <audio ref={audio} preload="auto" />
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
        </div>
      </div>
      <div className="pv-player">
        <button
          type="button"
          className="pv-round solid"
          onClick={toggle}
          aria-label={finished ? "Play again" : playing ? "Pause" : "Play"}
        >
          {finished ? (
            <RotateCcw size={16} aria-hidden="true" />
          ) : playing ? (
            <Pause size={16} aria-hidden="true" />
          ) : (
            <Play size={16} aria-hidden="true" />
          )}
        </button>
        <div className="pv-chapters">
          {chapters.map((item, i) => (
            <button
              key={i}
              type="button"
              className={`pv-chapter ${i === index ? "now" : ""}`}
              onClick={() => jump(i)}
              aria-current={i === index ? "step" : undefined}
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
              <span>{item.title}</span>
            </button>
          ))}
        </div>
        {chapters.some((item) => item.audio) && (
          <button
            type="button"
            className="pv-round"
            onClick={flipVoice}
            aria-pressed={voice}
            aria-label="Voice"
          >
            {voice ? (
              <Volume2 size={16} aria-hidden="true" />
            ) : (
              <VolumeX size={16} aria-hidden="true" />
            )}
          </button>
        )}
      </div>
      <p className="pv-say" aria-live="polite">
        {started ? cue?.text : (timeline?.title ?? "")}
      </p>
    </div>
  );
}

/** The tabs the agent had open, in the order it opened them. */
function screenTabs(timeline: Timeline) {
  const opened = [...new Set(timeline.chapters.map((chapter) => chapter.tab))];
  return opened.map((tab) => {
    if (tab === "app") {
      const app = timeline.chapters.find((chapter) => chapter.tab === "app")!;
      const label = app.page || app.url?.split("/")[0] || "App";
      return {
        tab,
        label,
        icon: (
          <span className="pv-site">{label.slice(0, 1).toUpperCase()}</span>
        ),
      };
    }
    if (tab === "ticket") {
      const number = timeline.ticket.url.match(/\/(?:issues|pull)\/(\d+)/)?.[1];
      return {
        tab,
        label: `${number ? `#${number} ` : ""}${timeline.ticket.title}`,
        icon:
          timeline.ticket.source === "jira" ? (
            <JiraIcon size={14} />
          ) : (
            <Github size={14} aria-hidden="true" />
          ),
      };
    }
    return {
      tab,
      label: "Terminal",
      icon: <SquareTerminal size={14} aria-hidden="true" />,
    };
  });
}
