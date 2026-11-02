import type { Language } from "@elevenlabs/client";
import {
  Captions,
  CaptionsOff,
  Mic,
  Pause,
  PhoneOff,
  Play,
  RectangleHorizontal,
  RotateCcw,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { ThreadMessage } from "@/components/dashboard/pull-panel";
import { asCall } from "@/components/call-voice";
import {
  CAPTIONS_KEY,
  loadPresentation,
  save,
  saved,
} from "@/components/presentation";
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
  sendUserMessage(text: string): void;
}

/** A voice in the microphone: ElevenLabs' VAD score past this. */
const VOICED = 0.9;
/** Heard this long, the presentation holds before any word. */
const VOICED_MS = 300;
/** Held for a voice, it still talks while the score is past this. */
const STILL_VOICED = 0.4;
/** No word of it, and quiet this long: the presentation goes on. */
const UNVOICED_MS = 2000;

const voiceMs = (chapter: PresentationChapter) =>
  chapter.audio?.durationMs ?? estimateSpeechMs(chapter.say);

export type LiveStage = ReturnType<typeof useLiveStage>;

/**
 * A pull request's stage, its app live on Yarrow's desktop (workers/stage.ts),
 * and its presentation played on it: the voice here, the gestures there.
 * The member talks to the agent over it (src/runner/talk.ts): their
 * first words hold the presentation, and once said it ends there, the
 * agent leading the rest in its own words. Or they write to it in the pull
 * request's conversation beside it, which holds it until they go on. The
 * thread keeps what was said as what was written. The call and the voice
 * end with the stage, and with the page or the panel.
 */
/** The brain the address asks for, to try each by voice (dev). */
function brainAsked(): { model?: string; screen?: boolean } {
  const query = new URLSearchParams(window.location.search);
  const model = query.get("brain");
  const screen = query.get("screen");
  return {
    ...(model ? { model } : {}),
    ...(screen !== null ? { screen: screen === "1" } : {}),
  };
}

export function useLiveStage({
  projectId,
  rowKey,
  initial,
  start = false,
  messages,
  refresh,
}: {
  projectId: string;
  rowKey: string;
  /** Where it stood when the page was made. */
  initial?: StageView;
  /** Brought up once, if its presentation can be played on it. */
  start?: boolean;
  /** How long the thread is now. */
  messages: number;
  /** The thread read again: what it read, or undefined when it could not. */
  refresh: () => Promise<{ messages: readonly unknown[] } | null | undefined>;
}) {
  const [status, setStatus] = useState<StageView | null>(initial ?? null);
  const [timeline, setTimeline] = useState<Presentation | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [played, setPlayed] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [talk, setTalk] = useState<"off" | "starting" | "on">("off");
  const [held, setHeld] = useState(false);
  /** The member spoke: the agent leads; the chapter it was in when they did. */
  const [led, setLed] = useState<number | null>(null);
  /** What the microphone hears of the member, as they say it. */
  const [hearing, setHearing] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [screen, setScreen] = useState<HTMLDivElement | null>(null);
  const voice = useRef<HTMLAudioElement | null>(null);
  /** The voice played as a call's, so the microphone does not hear it. */
  const routed = useRef<Promise<() => void> | null>(null);
  const stopped = useRef(false);
  /** Ends the voice playing now. */
  const hush = useRef<(() => void) | null>(null);
  /** Holds the voice playing now, and lets it go on (from its sentence). */
  const voiceHold = useRef<{
    pause(): void;
    resume(fromSentence?: boolean): void;
  } | null>(null);
  const showing = useRef(false);
  /** The chapter whose voice plays, or last played. */
  const saying = useRef(0);
  /** Held while the member talks: the next chapter waits for it. */
  const holding = useRef<{ release(): void; resumed: Promise<void> } | null>(
    null,
  );
  const conversation = useRef<Call | null>(null);
  const calling = useRef(false);
  /** A voice heard over the presentation's, before any word of it. */
  const voiced = useRef<{
    since: number;
    last: number;
    /** Held for it: let go once quiet, no word heard. */
    quiet?: ReturnType<typeof setInterval>;
  } | null>(null);
  /** Pauses on a voice no word came of: past a few, the voice's own echo. */
  const unvoiced = useRef(0);
  /** The thread's length when the call's turn under way began. */
  const before = useRef<number | null>(null);
  const known = useRef(0);
  useEffect(() => {
    known.current = messages;
  }, [messages]);

  const cue = useCallback(
    (data: Cue) =>
      stageCueFn({ data: { projectId, key: rowKey, cue: data } }).catch(
        (error: Error): StageCueResult => ({
          ok: false,
          problems: [error.message],
        }),
      ),
    [projectId, rowKey],
  );

  const call = useCallback(
    (action: "open" | "status" | "close", fresh = false, live = false) =>
      stageFn({
        data: {
          projectId,
          key: rowKey,
          action,
          fresh,
          ...(live ? { live } : {}),
        },
      })
        .then(setStatus)
        .catch((error: Error) =>
          setProblems((now) => [...now, `stage: ${error.message}`]),
        ),
    [projectId, rowKey],
  );

  const opened = useRef(false);
  useEffect(() => {
    if (!start || opened.current) return;
    opened.current = true;
    void call("open", false, true);
  }, [start, call]);

  // Looked at every second while it comes up.
  const phase = status?.phase ?? "off";
  useEffect(() => {
    if (phase !== "booting") return;
    const timer = setInterval(() => void call("status"), 1000);
    return () => clearInterval(timer);
  }, [phase, call]);

  const presentation = status?.presentation;
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
    if (phase !== "ready" || !screen) return;
    let rfb: { disconnect(): void } | null = null;
    let gone = false;
    void import("@novnc/novnc").then(({ default: RFB }) => {
      if (gone) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const client = new RFB(
        screen,
        `${protocol}//${location.host}/stage-screen/${projectId}/${rowKey}`,
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
  }, [phase, screen, projectId, rowKey, call]);

  const unhear = () => {
    clearInterval(voiced.current?.quiet);
    voiced.current = null;
  };

  /**
   * A voice in the microphone, before ElevenLabs hears any word of it: the
   * presentation holds at once, its voice and its gestures, while it talks.
   */
  const listen = (score: number) => {
    if (!showing.current || unvoiced.current >= 3) return;
    const now = performance.now();
    const heard = voiced.current;
    if (heard?.quiet) {
      if (score >= STILL_VOICED) heard.last = now;
      return;
    }
    if (holding.current) return;
    if (score < VOICED) {
      voiced.current = null;
      return;
    }
    if (!heard) {
      voiced.current = { since: now, last: now };
      return;
    }
    if (now - heard.since >= VOICED_MS) hold(true);
  };

  /**
   * Held for a voice no word came of, quiet now: it goes on, the voice
   * from where it stopped. Past a few, the voice's own echo: words only.
   */
  const letGo = () => {
    const holdNow = holding.current;
    unhear();
    if (!holdNow) return;
    unvoiced.current += 1;
    holding.current = null;
    setHeld(false);
    void cue({ action: "resume" });
    voiceHold.current?.resume(false);
    holdNow.release();
  };

  /**
   * The member speaks: the presentation waits for them. For a voice alone
   * (`byVoice`), until it is quiet; once words of it are heard, until their
   * turn is said.
   */
  const hold = (byVoice = false) => {
    unhear();
    if (!showing.current || holding.current) return;
    let release = () => {};
    const resumed = new Promise<void>((resolve) => (release = resolve));
    holding.current = { release, resumed };
    setHeld(true);
    voiceHold.current?.pause();
    void cue({ action: "pause" });
    if (!byVoice) return;
    const now = performance.now();
    const heard: NonNullable<typeof voiced.current> = { since: now, last: now };
    heard.quiet = setInterval(() => {
      if (performance.now() - heard.last > UNVOICED_MS) letGo();
    }, 200);
    voiced.current = heard;
  };

  /**
   * They said it: the recorded presentation ends there, the screen as it
   * is, and the agent leads the rest from what was said (the brain stops
   * the presenter too, as their turn reaches it).
   */
  const takeOver = () => {
    unhear();
    if (!showing.current) return;
    stopped.current = true;
    setLed(saying.current);
    voice.current?.pause();
    hush.current?.();
    const holdNow = holding.current;
    holding.current = null;
    setHeld(false);
    holdNow?.release();
    void cue({ action: "stop" });
  };

  /** The agent led, asked to go on: as if the member said it. */
  const carryOn = () =>
    conversation.current?.sendUserMessage(
      navigator.language.startsWith("fr") ? "Continue." : "Go on.",
    );

  /**
   * On again after a written question: the app put back as the talk found
   * it (the brain's agent undoes what the talk changed), then the voice
   * from its sentence.
   */
  const goOn = async () => {
    const holdNow = holding.current;
    if (!holdNow) return;
    const result = await cue({ action: "resume", restore: true });
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
    let fresh: Awaited<ReturnType<typeof refresh>>;
    for (let attempt = 0; attempt < 6; attempt++) {
      fresh = await refresh();
      if (fresh && fresh.messages.length > from) break;
      await sleep(2000);
    }
    before.current = null;
    // What the thread has now, a line heard twice included, goes.
    const kept = new Set(
      (fresh?.messages ?? []).map((message) =>
        String((message as { body?: unknown }).body ?? "").trim(),
      ),
    );
    setLines((now) =>
      now.filter((line) => line.at > begun && !kept.has(line.text)),
    );
  }, [refresh]);

  /** The call: the member's voice to the agent, the agent's back. */
  const startTalk = async () => {
    if (calling.current) return;
    calling.current = true;
    setTalk("starting");
    try {
      const language = (navigator.language || "en").slice(0, 2).toLowerCase();
      const pass = await stageTalkFn({
        data: { projectId, key: rowKey, language },
      });
      if (!pass.ok) throw new Error(pass.reason);
      const eleven = await import("@elevenlabs/client");
      const session = await eleven.Conversation.startSession({
        conversationToken: pass.conversationToken,
        connectionType: "webrtc",
        overrides: { agent: { language: language as Language } },
        // ?brain=spark&screen=1: another brain, heeded on dev only.
        customLlmExtraBody: { yarrow: pass.grant, brain: brainAsked() },
        onVadScore: ({ vadScore }) => listen(vadScore),
        // Their first words, still being heard, already hold it, and show
        // in the box as they come.
        onIncomingEvent: (event: {
          type?: string;
          tentative_user_transcription_event?: { user_transcript?: string };
        }) => {
          if (event.type !== "tentative_user_transcript") return;
          const heard =
            event.tentative_user_transcription_event?.user_transcript ?? "";
          setHearing(heard.trim());
          if (/\p{L}/u.test(heard)) hold();
        },
        onMessage: ({ source, message }) => {
          if (source === "user") setHearing("");
          const text = message.trim();
          if (!text) return;
          if (source === "user") takeOver();
          before.current ??= known.current;
          const who = source === "user" ? "member" : "agent";
          setLines((now) =>
            // ElevenLabs may send the same answer twice.
            now.at(-1)?.who === who && now.at(-1)?.text === text
              ? now
              : [...now, { who, text, at: Date.now() }],
          );
          if (source !== "user") void settle();
        },
        onDisconnect: () => {
          conversation.current = null;
          calling.current = false;
          setHearing("");
          setTalk("off");
        },
        onError: (message) =>
          setProblems((now) => [...now, `call: ${message}`]),
      });
      // Hung up while it was starting.
      if (!calling.current) {
        void session.endSession();
        return;
      }
      conversation.current = session;
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
      saying.current = index;
      const length = voiceMs(chapter);
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
        routed.current ??= asCall(audio);
        audio.onended = done;
        audio.onerror = silent;
        audio.src = evidence(chapter.audio.key);
        const sound = audio;
        void routed.current.then(() => sound.play()).catch(silent);
      } else silent();
      const playing = audio;
      voiceHold.current = {
        pause: () => {
          if (pausedAt !== null) return;
          pausedAt = performance.now();
          clearTimeout(timer);
          playing?.pause();
        },
        resume: (fromSentence = true) => {
          if (pausedAt === null) return;
          started += performance.now() - pausedAt;
          pausedAt = null;
          if (playing && !playing.error) {
            // From the start of its sentence: the thread picks up where it broke.
            const sentence = fromSentence
              ? cueAt(chapter.cues, playing.currentTime * 1000)
              : null;
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

  /**
   * The presentation, live: the opening, then each chapter's gestures over
   * its voice. `opened` hears whether the opening could be made.
   */
  const play = async (opened?: (ok: boolean) => void) => {
    if (!timeline || showing.current) return;
    stopped.current = false;
    showing.current = true;
    unvoiced.current = 0;
    saying.current = 0;
    setLed(null);
    setPlayed(true);
    setProblems([]);
    setNotes([]);
    setShow({ index: 0, spokenMs: 0 });
    // Its voice ready before its first word, while the click still counts.
    voice.current ??= new Audio();
    routed.current ??= asCall(voice.current);
    // The member can stop it by speaking from the first word: the call is
    // up before it, while the opening is made.
    const talking = conversation.current ? null : startTalk();
    const heard = (at: string, result: StageCueResult) =>
      setNotes((now) => [
        ...now,
        ...(result.notes ?? []).map((note) => `${at}: ${note}`),
      ]);
    const [opening] = await Promise.all([
      cue({ action: "set" }),
      // Not past a microphone prompt left unanswered.
      talking && Promise.race([talking, sleep(8000)]),
    ]);
    heard("opening", opening);
    opened?.(opening.ok);
    const found = [...opening.problems];
    if (opening.ok)
      for (const [index, chapter] of timeline.chapters.entries()) {
        while (holding.current && !stopped.current)
          await holding.current.resumed;
        if (stopped.current) break;
        // The next voice waits for this chapter's gestures.
        const [result] = await Promise.all([
          cue({ action: "chapter", index, voiceMs: voiceMs(chapter) }),
          speak(chapter, index),
        ]);
        found.push(...result.problems);
        heard(`${index + 1}`, result);
      }
    showing.current = false;
    setProblems((now) => [...now, ...found]);
    setShow(null);
  };

  const stop = () => {
    stopped.current = true;
    unhear();
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

  /** The voice's own call hung up, its element with it: a new one next time. */
  const hangUpVoice = () => {
    void routed.current?.then((hangUp) => hangUp());
    routed.current = null;
    voice.current = null;
  };

  // The stage gone, or the page: the voice and the call with it.
  const ending = useRef({ stop, endTalk, hangUpVoice });
  useEffect(() => {
    ending.current = { stop, endTalk, hangUpVoice };
  });
  useEffect(() => {
    if (phase === "ready") return;
    ending.current.stop();
    ending.current.endTalk();
  }, [phase]);
  useEffect(
    () => () => {
      ending.current.stop();
      ending.current.endTalk();
      ending.current.hangUpVoice();
    },
    [],
  );

  const chapter = show ? timeline?.chapters[show.index] : null;
  const caption = chapter ? cueAt(chapter.cues, show!.spokenMs) : null;
  return {
    status,
    phase,
    timeline,
    show,
    chapter,
    caption,
    said: caption ? wordsSaid(caption, show!.spokenMs) : 0,
    /** Played once at least: its start is behind it. */
    played,
    presenting: show !== null,
    held,
    led,
    talk,
    hearing,
    problems,
    notes,
    /** The call's lines the thread does not have yet. */
    turn: lines.map((line, i): ThreadMessage => ({
      id: `call${line.at}${i}`,
      author: line.who === "member" ? "builder" : "agent",
      body: line.text,
      status: "done",
      change: null,
      correctionRequestId: null,
      createdAt: new Date(line.at).toISOString(),
    })),
    /** Where the screen goes. */
    setScreen,
    call,
    play,
    stop,
    hold,
    goOn,
    carryOn,
    startTalk,
    endTalk,
  };
}

/** The voice's words over the screen, word by word as they are said. */
export function LiveCaption({
  stage,
  className,
}: {
  stage: LiveStage;
  className: string;
}) {
  const { caption, said } = stage;
  return (
    <p className={className} aria-live="polite">
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
  );
}

/**
 * The stage in the film's place, as its player: play holds and goes on,
 * the call beside it. The chapters show how far it went; a live
 * presentation cannot be skipped through. `onFilm` is the film again, when
 * the opening cannot be made.
 */
export function LivePlayer({
  stage,
  cinema,
  onCinema,
  onFilm,
}: {
  stage: LiveStage;
  cinema: boolean;
  onCinema: () => void;
  onFilm: () => void;
}) {
  const [captions, setCaptions] = useState(() => saved(CAPTIONS_KEY));
  // The controls hide while it plays and the pointer rests.
  const [awake, setAwake] = useState(true);
  const rest = useRef(0);
  useEffect(() => () => clearTimeout(rest.current), []);
  const wake = () => {
    setAwake(true);
    clearTimeout(rest.current);
    rest.current = window.setTimeout(() => setAwake(false), 2500);
  };

  const {
    timeline,
    show,
    chapter,
    played,
    presenting,
    held,
    led,
    talk,
    setScreen,
  } = stage;
  const playing = presenting && !held;
  const idle = playing && !awake;
  // The agent leads once the member spoke: play asks it to go on.
  const leading = led !== null && !presenting && talk === "on";
  const toggle = () => {
    wake();
    if (leading) stage.carryOn();
    else if (!presenting) void stage.play((ok) => ok || onFilm());
    else if (held) void stage.goOn();
    else stage.hold();
  };
  const flipCaptions = () =>
    setCaptions((on) => {
      save(CAPTIONS_KEY, !on);
      return !on;
    });
  const chapters = timeline?.chapters ?? [];
  // How much of each chapter was said: all of it once played through, up
  // to where the member spoke once the agent leads.
  const filled = (i: number) =>
    !show
      ? led !== null
        ? Number(i < led)
        : Number(played)
      : i < show.index
        ? 1
        : i > show.index
          ? 0
          : Math.min(1, show.spokenMs / (voiceMs(chapters[i]!) || 1));
  const label = presenting
    ? held
      ? "Play"
      : "Pause"
    : leading
      ? "Play"
      : played
        ? "Play again"
        : "Play";

  return (
    <div className="pv">
      <div className="pv-screen">
        <div
          className={`pv-view desktop ${idle ? "idle" : ""}`}
          onPointerMove={(event) => {
            if (event.pointerType === "mouse") wake();
          }}
          onPointerDown={wake}
          onFocus={wake}
        >
          <div
            className="pv-window desktop"
            style={{ "--ratio": 1440 / 900 } as CSSProperties}
          >
            <div className="pv-glass">
              <div className="pv-live" ref={setScreen} />
            </div>
          </div>
          <button
            type="button"
            className="pv-hit"
            tabIndex={-1}
            aria-hidden="true"
            onClick={toggle}
          />
          {!played && (
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
            {captions ? (
              <LiveCaption stage={stage} className="pv-caption" />
            ) : (
              <p className="pv-caption" />
            )}
            <div className="pv-controls">
              <div className="pv-chapters">
                {chapters.map((item, i) => (
                  <span
                    key={i}
                    className="pv-chapter still"
                    style={{ flexGrow: voiceMs(item) }}
                    data-title={item.title}
                  >
                    <i>
                      <b style={{ width: `${filled(i) * 100}%` }} />
                    </i>
                  </span>
                ))}
              </div>
              <div className="pv-bar">
                <button
                  type="button"
                  className="pv-icon pv-glass-pill pv-play"
                  onClick={toggle}
                  aria-label={label}
                  data-tip={label}
                >
                  {playing ? (
                    <Pause size={18} aria-hidden="true" />
                  ) : played && !presenting && !leading ? (
                    <RotateCcw size={18} aria-hidden="true" />
                  ) : (
                    <Play size={18} aria-hidden="true" />
                  )}
                </button>
                <span className="pv-glass-pill pv-clock">
                  <span className="pv-live-tag">Live</span>
                  {chapter?.title && (
                    <span className="pv-now">{chapter.title}</span>
                  )}
                </span>
                <span className="pv-glass-pill pv-tools">
                  <button
                    type="button"
                    className={`pv-icon ${talk === "off" ? "" : "on"}`}
                    disabled={talk === "starting"}
                    onClick={() =>
                      talk === "off" ? void stage.startTalk() : stage.endTalk()
                    }
                    aria-label={talk === "off" ? "Talk" : "Hang up"}
                    data-tip={talk === "off" ? "Talk" : "Hang up"}
                  >
                    {talk === "off" ? (
                      <Mic size={18} aria-hidden="true" />
                    ) : (
                      <PhoneOff size={18} aria-hidden="true" />
                    )}
                  </button>
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
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
