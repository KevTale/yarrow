import {
  Captions,
  CaptionsOff,
  Pause,
  Phone,
  PhoneOff,
  Play,
  RectangleHorizontal,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import {
  chapterMs,
  cueAt,
  posterChapter,
  presentationSchema,
  urlAt,
  wordsSaid,
  type Presentation as Timeline,
} from "@/core/presentation";
import type { StoredArtifact } from "@/core/review";

const evidence = (key: string) => `/evidence/${key}`;

/** The call to the agent from the film's player: its button, and the film's moment. */
export interface FilmCall {
  state: "off" | "starting" | "on";
  /** Called, the film paused in chapter `index`, `part` of it seen (0 to 1). */
  onCall: (at: { index: number; part: number }) => void;
  onHangUp: () => void;
  /** About to be called: the call made ready. */
  onWarm?: () => void;
}

/** The film played on by the page: from a chapter's start, or where it was. */
export type FilmControl = (chapter: number | null) => void;

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
/** Captions on or off, for the film and the live stage alike. */
export const CAPTIONS_KEY = "yarrow.presentation.captions";
export function saved(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "off";
  } catch {
    return true;
  }
}
export function save(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    // Private window: the choice lasts the page.
  }
}

// ←/→ move the player last used (or the first on the page) this far: the
// films are short.
const SKIP_MS = 3000;
let keyed: object | null = null;

const clockTime = (ms: number) => {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** A mouse click, soft: a press and a lighter release, a few milliseconds of noise each. */
function clickSound(context: AudioContext): AudioBuffer {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, Math.round(rate * 0.1), rate);
  const data = buffer.getChannelData(0);
  for (const [at, level] of [
    [0, 1],
    [0.065, 0.5],
  ] as const) {
    const from = Math.round(at * rate);
    for (let i = 0; i < Math.round(rate * 0.012); i++)
      data[from + i] =
        (data[from + i] ?? 0) +
        (Math.random() * 2 - 1) * level * Math.exp(-i / (rate * 0.0018));
  }
  return buffer;
}

interface Sound {
  context: AudioContext;
  click: AudioBuffer;
}

function playClick(sound: Sound) {
  const { context } = sound;
  const source = context.createBufferSource();
  source.buffer = sound.click;
  const tone = context.createBiquadFilter();
  tone.type = "bandpass";
  tone.frequency.value = 2200;
  tone.Q.value = 1.2;
  const gain = context.createGain();
  gain.gain.value = 0.5;
  source.connect(tone).connect(gain).connect(context.destination);
  source.start();
}

/**
 * The agent's screen, as it presented its pull request: one clip and one
 * voice line per chapter, in a window on a stage (the browser and its
 * address, the terminal, the ticket). The clip holds its last frame while
 * the voice finishes, and the voice waits for the clip.
 */
export function Presentation({
  artifact,
  cinema = false,
  onCinema,
  seekRef,
  playRef,
  phoneRef,
  call,
}: {
  artifact: StoredArtifact;
  /** Filling the window beside the conversation: the page offers it. */
  cinema?: boolean;
  onCinema?: () => void;
  /** Set to play the film from a moment: the conversation's `0:56`. */
  seekRef?: RefObject<((ms: number) => void) | null>;
  /** Set to play the film on: the agent's resume_presentation. */
  playRef?: RefObject<FilmControl | null>;
  /** Set to call (or hang up) as its phone does: the conversation's. */
  phoneRef?: RefObject<(() => void) | null>;
  /** The agent can be called from it. */
  call?: FilmCall;
}) {
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
      cinema={cinema}
      onCinema={onCinema}
      seekRef={seekRef}
      playRef={playRef}
      phoneRef={phoneRef}
      call={call}
    />
  );
}

function Player({
  timeline,
  poster,
  cinema,
  onCinema,
  seekRef,
  playRef,
  phoneRef,
  call,
}: {
  timeline: Timeline | undefined;
  poster: string | null;
  cinema: boolean;
  onCinema?: () => void;
  seekRef?: RefObject<((ms: number) => void) | null>;
  playRef?: RefObject<FilmControl | null>;
  phoneRef?: RefObject<(() => void) | null>;
  call?: FilmCall;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const me = useRef<object>({});
  const video = useRef<HTMLVideoElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  // The timeline loads in the browser: the button never renders on the server.
  const [voice, setVoice] = useState(() => saved(VOICE_KEY));
  const [captions, setCaptions] = useState(() => saved(CAPTIONS_KEY));
  // The controls hide while it plays and the pointer rests.
  const [awake, setAwake] = useState(true);
  const rest = useRef(0);
  // A tap on a phone first brings the controls back.
  const tapped = useRef(false);
  // Each start of a chapter, a jump back to it included.
  const [take, setTake] = useState(0);
  // Where in its chapter the next take starts: a click on the bar.
  const from = useRef(0);
  // Where the chapter is, and where its voice is (they drift while it loads).
  const [time, setTime] = useState({ at: 0, spoken: 0 });
  const elapsed = time.at;
  // The chapter's clock: what ran before the last pause, and since when.
  const clock = useRef({ before: 0, since: 0 });
  // The agent's clicks are heard with the voice, made once a gesture allows sound.
  const sound = useRef<Sound | null>(null);
  const hearing = useRef(voice);

  useEffect(() => {
    if (audio.current) audio.current.muted = !voice;
    hearing.current = voice;
  }, [voice]);

  const chapters = timeline?.chapters ?? [];
  const chapter = chapters[index];
  const length = chapter ? chapterMs(chapter) : 0;
  const lengths = chapters.map(chapterMs);

  const now = () =>
    clock.current.before +
    (clock.current.since ? performance.now() - clock.current.since : 0);

  const playMedia = useCallback(() => {
    const clip = video.current;
    const voiceLine = audio.current;
    if (clip && clip.src && !clip.ended) void clip.play().catch(() => {});
    if (voiceLine && voiceLine.src && !voiceLine.ended)
      void voiceLine.play().catch(() => {});
  }, []);

  // A new take: its clip from where its page had loaded, its voice line,
  // both from where the bar was clicked.
  useEffect(() => {
    const clip = video.current;
    const voiceLine = audio.current;
    if (!chapter || !clip || !voiceLine) return;
    const offset = from.current;
    from.current = 0;
    clock.current = { before: offset, since: 0 };
    setTime({ at: offset, spoken: offset });
    const seek = (media: HTMLMediaElement, seconds: number) => {
      media.currentTime = seconds;
      media.onloadedmetadata = () => {
        if (Math.abs(media.currentTime - seconds) > 0.2)
          media.currentTime = seconds;
      };
    };
    if (chapter.video) {
      const { startMs, durationMs } = chapter.video;
      clip.src = evidence(chapter.video.key);
      seek(clip, (startMs + Math.min(offset, durationMs - 40)) / 1000);
    } else clip.removeAttribute("src");
    // Past its end the voice has said its piece: the subtitles stay.
    if (chapter.audio && offset < chapter.audio.durationMs - 100) {
      voiceLine.src = evidence(chapter.audio.key);
      seek(voiceLine, offset / 1000);
    } else voiceLine.removeAttribute("src");
    // The next chapter's clip starts loading now.
    const next = chapters[index + 1];
    if (next?.video) void fetch(evidence(next.video.key)).catch(() => {});
    // Only a take's start changes the media; playing is read when it starts.
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
    // Where the clip was at the last tick: a click between then and now is heard.
    let seen = clock.current.before;
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
      const clip = video.current;
      const shown =
        chapter.video && clip && clip.readyState >= 2 && !clip.ended
          ? clip.currentTime * 1000 - chapter.video.startMs
          : at;
      if (hearing.current && sound.current)
        for (const mark of chapter.marks)
          if (mark.kind !== "point" && mark.atMs > seen && mark.atMs <= shown)
            playClick(sound.current);
      seen = Math.max(seen, shown);
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
    const self = me.current;
    keyed ??= self;
    return () => {
      if (keyed === self) keyed = null;
    };
  }, []);

  // The arrows skip unless something else on the page takes them.
  const skipping = useRef<(ms: number) => void>(() => {});
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (keyed !== me.current || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, textarea, select, [contenteditable], [role=slider], [role=radiogroup], [role=menu], [role=listbox], [role=tablist]",
        )
      )
        return;
      event.preventDefault();
      skipping.current(event.key === "ArrowLeft" ? -SKIP_MS : SKIP_MS);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(
    () => () => {
      video.current?.pause();
      audio.current?.pause();
      clearTimeout(rest.current);
      void sound.current?.context.close().catch(() => {});
    },
    [],
  );

  const wake = () => {
    keyed = me.current;
    setAwake(true);
    clearTimeout(rest.current);
    rest.current = window.setTimeout(() => setAwake(false), 2500);
  };
  // Browsers allow sound from a gesture on: the first play makes it.
  const allowSound = () => {
    if (!sound.current && typeof AudioContext !== "undefined")
      try {
        const context = new AudioContext();
        sound.current = { context, click: clickSound(context) };
      } catch {
        // No sound here: the clicks stay silent.
      }
    void sound.current?.context.resume().catch(() => {});
  };

  const toggle = () => {
    if (!timeline) return;
    // Played on during a call: the call ends.
    if (!playing && call && call.state !== "off") call.onHangUp();
    if (finished) {
      jump(0);
      return;
    }
    wake();
    allowSound();
    setStarted(true);
    setPlaying((on) => !on);
  };
  // The film paused where it is, the agent called there.
  const phone = () => {
    if (!call) return;
    if (call.state !== "off") {
      call.onHangUp();
      return;
    }
    wake();
    allowSound();
    setPlaying(false);
    call.onCall(
      finished
        ? { index: Math.max(0, chapters.length - 1), part: 1 }
        : { index, part: started ? Math.min(1, elapsed / (length || 1)) : 0 },
    );
  };
  function jump(to: number, offset = 0, play = true) {
    wake();
    allowSound();
    from.current = Math.max(0, Math.min(offset, (lengths[to] ?? 0) - 250));
    setFinished(false);
    setStarted(true);
    setIndex(to);
    setTake((n) => n + 1);
    setPlaying(play);
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

  const cue = chapter ? cueAt(chapter.cues, time.spoken) : null;
  const said = cue ? wordsSaid(cue, time.spoken) : 0;
  const total = lengths.reduce((sum, ms) => sum + ms, 0);
  const played =
    lengths.slice(0, index).reduce((sum, ms) => sum + ms, 0) +
    (finished ? length : Math.min(elapsed, length));
  // A moment of the whole film: its chapter, and where in it.
  const go = (ms: number, play: boolean) => {
    if (!timeline || !lengths.length) return;
    let rest = Math.max(0, Math.min(total - 1, ms));
    let to = 0;
    while (to < lengths.length - 1 && rest >= lengths[to]!) {
      rest -= lengths[to]!;
      to++;
    }
    jump(to, rest, play);
  };
  // Across chapters, playing or paused as it was.
  const skip = (ms: number) => go(played + ms, playing);
  useEffect(() => {
    skipping.current = skip;
    if (seekRef)
      seekRef.current = (ms) => {
        go(ms, true);
        screen.current?.scrollIntoView({
          block: "nearest",
          behavior: "smooth",
        });
      };
    if (playRef)
      playRef.current = (chapter) => {
        if (chapter !== null) jump(Math.min(chapter, chapters.length - 1));
        else if (finished) jump(0);
        else {
          wake();
          setStarted(true);
          setPlaying(true);
        }
      };
    if (phoneRef) phoneRef.current = phone;
  });
  const idle = playing && !awake;
  // Before it starts, the window the poster was taken in, as it ended.
  const framed = started ? chapter : timeline && posterChapter(timeline);
  // A document is a page in the browser, as the app's are.
  const kind = framed?.tab === "document" ? "app" : (framed?.tab ?? "app");
  // Filmed on the agent's desktop: its own windows, edge to edge.
  const desktop = Boolean(framed?.desktop);
  const size = framed?.video ?? { width: 1280, height: 720 };
  const at = started ? elapsed : Infinity;
  const address = framed ? urlAt(framed, at) : null;
  // Each page loaded during the chapter replays the address bar's loading line.
  const loads = started
    ? (framed?.urls.filter((step) => step.atMs <= at).length ?? 0)
    : 0;

  return (
    <div className="pv">
      <div className="pv-screen" ref={screen}>
        <div
          className={`pv-view ${idle ? "idle" : ""} ${desktop ? "desktop" : ""}`}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse") wake();
          }}
          onPointerDown={(event) => {
            tapped.current = event.pointerType !== "mouse" && idle;
            wake();
          }}
          onFocus={wake}
        >
          <div
            className={`pv-window ${desktop ? "desktop" : kind} ${size.width < size.height ? "phone" : ""}`}
            style={{ "--ratio": size.width / size.height } as CSSProperties}
          >
            {kind !== "ticket" && !desktop && (
              <div className="pv-chrome">
                <span className="pv-lights" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {kind === "app" ? (
                  <span
                    key={loads}
                    className={`pv-address ${loads ? "loading" : ""}`}
                  >
                    <span>{address ?? framed?.page ?? ""}</span>
                  </span>
                ) : (
                  <span className="pv-name">Terminal</span>
                )}
              </div>
            )}
            <div className="pv-glass">
              <video ref={video} muted playsInline preload="auto" />
              {!started && poster && <img src={poster} alt="" />}
            </div>
          </div>
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
          {!started && (
            <button
              type="button"
              className="pv-start"
              onClick={toggle}
              aria-label="Play the presentation"
            >
              <span className="pv-big">
                <Play size={26} aria-hidden="true" />
              </span>
            </button>
          )}
          <div className="pv-overlay">
            <p className="pv-caption" aria-live="polite">
              {captions &&
                started &&
                cue?.text &&
                (cue.words.length ? (
                  // Word by word as the voice says them; the line keeps its place.
                  cue.words.map((word, i) => (
                    <span key={i} className={`w ${i < said ? "said" : ""}`}>
                      {word.text}
                      {i < cue.words.length - 1 ? " " : ""}
                    </span>
                  ))
                ) : (
                  <span>{cue.text}</span>
                ))}
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
                      onClick={(event) => {
                        // Where it was clicked; from the keyboard, its start.
                        const box = event.currentTarget.getBoundingClientRect();
                        const at = event.detail
                          ? (event.clientX - box.left) / box.width
                          : 0;
                        jump(i, at * lengths[i]!);
                      }}
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
                {/* On rounded glass, readable over any page, as in YouTube's player. */}
                <div className="pv-bar">
                  <button
                    type="button"
                    className="pv-icon pv-glass-pill pv-play"
                    onClick={toggle}
                    aria-label={
                      finished ? "Play again" : playing ? "Pause" : "Play"
                    }
                    data-tip={
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
                  <span className="pv-glass-pill pv-clock">
                    <span className="pv-time">
                      {clockTime(played)} / {clockTime(total)}
                    </span>
                    {/* Before it starts the poster shows a later chapter: no title over it. */}
                    {started && chapter?.title && (
                      <span className="pv-now">{chapter.title}</span>
                    )}
                  </span>
                  <span className="pv-glass-pill pv-tools">
                    {call && (
                      <button
                        type="button"
                        className={`pv-icon ${call.state === "off" ? "" : call.state === "starting" ? "on ringing" : "on"}`}
                        onClick={phone}
                        onPointerEnter={call.onWarm}
                        onFocus={call.onWarm}
                        aria-label={call.state === "off" ? "Call" : "Hang up"}
                        data-tip={call.state === "off" ? "Call" : "Hang up"}
                      >
                        {call.state === "off" || call.state === "starting" ? (
                          <Phone size={18} aria-hidden="true" />
                        ) : (
                          <PhoneOff size={18} aria-hidden="true" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      className="pv-icon"
                      onClick={flipCaptions}
                      aria-pressed={captions}
                      aria-label="Captions"
                      data-tip={captions ? "Hide captions" : "Show captions"}
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
                        aria-label="Sound"
                        data-tip={voice ? "Mute" : "Unmute"}
                      >
                        {voice ? (
                          <Volume2 size={18} aria-hidden="true" />
                        ) : (
                          <VolumeX size={18} aria-hidden="true" />
                        )}
                      </button>
                    )}
                    {onCinema && (
                      <button
                        type="button"
                        className="pv-icon"
                        onClick={onCinema}
                        aria-pressed={cinema}
                        aria-label={cinema ? "Exit cinema mode" : "Cinema mode"}
                        data-tip={cinema ? "Exit cinema mode" : "Cinema mode"}
                      >
                        <RectangleHorizontal size={18} aria-hidden="true" />
                      </button>
                    )}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
