import type { Language } from "@elevenlabs/client";
import { PhoneOff, Play, RectangleHorizontal } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { ThreadMessage } from "@/components/dashboard/pull-panel";
import { asCall } from "@/components/call-voice";
import { loadPresentation } from "@/components/presentation";
import {
  cueAt,
  estimateSpeechMs,
  wordsSaid,
  type Presentation,
  type PresentationChapter,
} from "@/core/presentation";
import { CALL_GREETING, type StageCueResult } from "@/core/stage";
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

/**
 * A line of the call, as it was heard, until the thread has its turn: the
 * member's words and the agent's answer to them (-1: the page's greeting).
 */
interface Line {
  who: "member" | "agent";
  text: string;
  at: number;
  turn: number;
}

/** The call's pass, fetched before the click, used while this fresh. */
const PASS_MS = 4 * 60_000;

/** Words compared as said, whatever their case and spacing. */
const plain = (text: string) => text.toLowerCase().replace(/\s+/g, " ").trim();

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

type Cue = Parameters<typeof stageCueFn>[0]["data"]["cue"];

/** The member's words as they say them: Scribe realtime on the microphone. */
interface Transcription {
  close(): void;
}

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
 * and the member's call to the agent over it (src/runner/talk.ts). From
 * the film (`callFrom`): the stage brought to where the film was paused,
 * the agent greeting them, until it plays the film on (`onResume`). Or the
 * presentation played live on it, the voice here, the gestures there: their
 * first words end it there. Or they write to it in the pull request's
 * conversation beside it. The thread keeps what was said as what was
 * written. The call and the voice end with the stage, and with the page or
 * the panel.
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
  onResume,
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
  /**
   * The agent plays the film on, from a chapter (from 0) or where it was
   * paused (null), once its voice is done; the call has ended. Without it,
   * the presentation plays live again from that chapter.
   */
  onResume?: (chapter: number | null) => void;
}) {
  const [status, setStatus] = useState<StageView | null>(initial ?? null);
  const [timeline, setTimeline] = useState<Presentation | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [played, setPlayed] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [talk, setTalk] = useState<"off" | "starting" | "on">("off");
  /** Called from the film: the stage is where the film was paused. */
  const [reached, setReached] = useState(false);
  const [held, setHeld] = useState(false);
  /** The member spoke: the agent leads; the chapter it was in when they did. */
  const [led, setLed] = useState<number | null>(null);
  /** What the microphone hears of the member, as they say it. */
  const [hearing, setHearing] = useState("");
  /** A voice in the microphone, no word of it heard yet. */
  const [voicing, setVoicing] = useState(false);
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
  const transcription = useRef<Transcription | null>(null);
  /** Their words of this turn already done (Scribe commits each pause). */
  const heardSoFar = useRef("");
  const calling = useRef(false);
  /** The agent's voice is heard now. */
  const speaking = useRef(false);
  /** The agent asked for the film, heard once its voice is done. */
  const resumeAsked = useRef<{ chapter: number | null } | null>(null);
  /** The call's handlers, made once, reach these as they are now. */
  const latest = useRef<{
    onResume?: (chapter: number | null) => void;
    play: (opened?: (ok: boolean) => void, from?: number) => Promise<void>;
  }>({ onResume, play: async () => {} });
  /** A voice heard over the presentation's, before any word of it. */
  const voiced = useRef<{
    since: number;
    last: number;
    /** Held for it: let go once quiet, no word heard. */
    quiet?: ReturnType<typeof setInterval>;
  } | null>(null);
  /** Pauses on a voice no word came of: past a few, the voice's own echo. */
  const unvoiced = useRef(0);
  /** Since when, and last when, a voice is heard on the call. */
  const voicedOnCall = useRef<{ since: number; last: number } | null>(null);
  /** The call's turns: the one under way, and the line before it. */
  const turnNow = useRef(0);
  const lastWho = useRef<Line["who"] | null>(null);
  /** Each turn: the thread's length when it began, the member's words. */
  const turns = useRef(new Map<number, { base: number; said: string }>());
  /** Turns the thread has (or never will): a late copy of their lines goes. */
  const keptTurns = useRef(new Set<number>());
  const settling = useRef(new Set<number>());
  /** The next call's pass, asked for before the click. */
  const pass = useRef<{
    at: number;
    made: ReturnType<typeof stageTalkFn>;
  } | null>(null);
  /** Up, its presentation playable: a call can be made. */
  const up = useRef(false);
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
   * The turn is answered: the brain kept it in the thread before its voice
   * ended. Read back, the member's words in it, its lines go, and any copy
   * of them heard later; a turn kept with no words (going on) too, in time.
   */
  const settle = useCallback(
    async (turn: number) => {
      if (settling.current.has(turn)) return;
      settling.current.add(turn);
      const { base = known.current, said = "" } = turns.current.get(turn) ?? {};
      const asked = plain(said);
      for (let attempt = 0; attempt < 20; attempt++) {
        const fresh = await refresh();
        const added = (fresh?.messages ?? []).slice(base) as {
          author?: unknown;
          body?: unknown;
        }[];
        const kept = added.some(
          (message) =>
            message.author === "builder" &&
            plain(String(message.body ?? "")).includes(asked),
        );
        // Their words heard otherwise than kept: an answer after them does.
        const answered =
          attempt >= 3 && added.some((message) => message.author === "agent");
        if ((kept && added.length >= 2) || answered) break;
        await sleep(750);
      }
      keptTurns.current.add(turn);
      settling.current.delete(turn);
      setLines((now) => now.filter((line) => line.turn !== turn));
    },
    [refresh],
  );

  /**
   * A voice on the call while the agent is quiet: the member's bubble shows
   * at once, before any word of it, until their turn is heard or they are
   * quiet a while.
   */
  const sense = (score: number) => {
    const now = performance.now();
    const heard = voicedOnCall.current;
    if (heard && score >= STILL_VOICED) heard.last = now;
    if (heard && now - heard.last > 2 * UNVOICED_MS) {
      voicedOnCall.current = null;
      setVoicing(false);
      return;
    }
    if (speaking.current || score < VOICED) return;
    if (!heard) voicedOnCall.current = { since: now, last: now };
    else if (now - heard.since >= VOICED_MS) setVoicing(true);
  };

  /**
   * The call's pass (its ElevenLabs token and the brain's grant), and the
   * client: asked for before the click, so the call starts at once.
   */
  const language = () => (navigator.language || "en").slice(0, 2).toLowerCase();
  const warm = () => {
    if (!up.current) return;
    void import("@elevenlabs/client");
    if (pass.current && Date.now() - pass.current.at < PASS_MS) return;
    const made = stageTalkFn({
      data: { projectId, key: rowKey, language: language() },
    });
    made.catch(() => {
      if (pass.current?.made === made) pass.current = null;
    });
    pass.current = { at: Date.now(), made };
  };
  /**
   * Their words as they say them, in their bubble: shown while their voice
   * is heard (not the agent's, not a late word of a turn already said).
   */
  const transcribe = (
    eleven: typeof import("@elevenlabs/client"),
    token: string,
  ) => {
    const words = eleven.Scribe.connect({
      token,
      modelId: "scribe_v2_realtime",
      commitStrategy: eleven.CommitStrategy.VAD,
      vadSilenceThresholdSecs: 0.5,
      languageCode: language(),
      microphone: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    const show = (text: string) => {
      if (speaking.current || !voicedOnCall.current) return;
      const heard = `${heardSoFar.current} ${text}`.trim();
      if (heard) setHearing(heard);
    };
    words.on(eleven.RealtimeEvents.PARTIAL_TRANSCRIPT, ({ text }) =>
      show(text),
    );
    words.on(eleven.RealtimeEvents.COMMITTED_TRANSCRIPT, ({ text }) => {
      if (speaking.current || !voicedOnCall.current) return;
      show(text);
      heardSoFar.current = `${heardSoFar.current} ${text}`.trim();
    });
    transcription.current = words;
  };
  const untranscribe = () => {
    transcription.current?.close();
    transcription.current = null;
    heardSoFar.current = "";
  };

  /** A pass for one call: the one asked for before, if still fresh. */
  const passNow = () => {
    warm();
    const { made } = pass.current!;
    pass.current = null;
    return made;
  };

  /** The agent asked for the film: the call ends, the film plays on. */
  const resumeNow = () => {
    const asked = resumeAsked.current;
    if (!asked) return;
    resumeAsked.current = null;
    endTalk();
    const { onResume, play } = latest.current;
    if (onResume) onResume(asked.chapter);
    else void play(undefined, asked.chapter ?? saying.current);
  };

  /**
   * The call: the member's voice to the agent, the agent's back; its
   * first words `greeting`, when there are some.
   */
  const startTalk = async (greeting?: string) => {
    if (calling.current) return;
    calling.current = true;
    resumeAsked.current = null;
    speaking.current = false;
    setTalk("starting");
    try {
      const [given, eleven] = await Promise.all([
        passNow(),
        import("@elevenlabs/client"),
      ]);
      if (!given.ok) throw new Error(given.reason);
      const session = await eleven.Conversation.startSession({
        conversationToken: given.conversationToken,
        connectionType: "webrtc",
        overrides: {
          agent: {
            language: language() as Language,
            ...(greeting ? { firstMessage: greeting } : {}),
          },
        },
        // ?brain=spark&screen=1: another brain, heeded on dev only.
        customLlmExtraBody: { yarrow: given.grant, brain: brainAsked() },
        clientTools: {
          resume_presentation: (parameters: { chapter?: unknown }) => {
            const chapter = Number(parameters?.chapter);
            resumeAsked.current = {
              chapter:
                Number.isInteger(chapter) && chapter >= 1 ? chapter - 1 : null,
            };
            if (!speaking.current) resumeNow();
          },
        },
        onModeChange: ({ mode }) => {
          speaking.current = mode === "speaking";
          if (!speaking.current) resumeNow();
        },
        onVadScore: ({ vadScore }) => {
          sense(vadScore);
          listen(vadScore);
        },
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
          const who = source === "user" ? "member" : "agent";
          if (who === "member") {
            setHearing("");
            setVoicing(false);
            voicedOnCall.current = null;
            heardSoFar.current = "";
          }
          const text = message.trim();
          if (!text) return;
          // The greeting is the page's own: the thread never has it.
          const greeted = who === "agent" && text === greeting;
          if (who === "member") {
            takeOver();
            if (lastWho.current !== "member") {
              turnNow.current += 1;
              turns.current.set(turnNow.current, {
                base: known.current,
                said: "",
              });
            }
            const now = turns.current.get(turnNow.current)!;
            now.said = now.said ? `${now.said}\n${text}` : text;
          }
          lastWho.current = who;
          const turn = greeted ? -1 : turnNow.current;
          // The thread has its turn: a copy heard late.
          if (keptTurns.current.has(turn)) return;
          setLines((now) => {
            const last = now.at(-1);
            if (last?.who !== who || last.turn !== turn)
              return [...now, { who, text, at: Date.now(), turn }];
            // One bubble a turn: ElevenLabs may send an answer twice, or
            // again whole, the words said while the agent worked in it.
            if (plain(last.text).includes(plain(text))) return now;
            const joined = plain(text).includes(plain(last.text))
              ? text
              : `${last.text}${who === "member" ? "\n" : " "}${text}`;
            return [...now.slice(0, -1), { ...last, text: joined }];
          });
          if (who === "agent" && !greeted) void settle(turn);
        },
        onDisconnect: () => {
          conversation.current = null;
          calling.current = false;
          untranscribe();
          setHearing("");
          setVoicing(false);
          voicedOnCall.current = null;
          lastWho.current = null;
          setLines((now) => now.filter((line) => line.turn !== -1));
          setReached(false);
          setTalk("off");
          warm();
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
      if (given.transcriptionToken) {
        try {
          transcribe(eleven, given.transcriptionToken);
        } catch {
          // Without it, the bubble shows their voice, then their words.
        }
      }
      setTalk("on");
    } catch (error) {
      calling.current = false;
      setTalk("off");
      setProblems((now) => [...now, `call: ${(error as Error).message}`]);
    }
  };

  const endTalk = () => {
    untranscribe();
    void conversation.current?.endSession();
    conversation.current = null;
    calling.current = false;
    resumeAsked.current = null;
    setReached(false);
    setTalk("off");
    setVoicing(false);
    setLines((now) => now.filter((line) => line.turn !== -1));
    // The next call's pass: a pass is for one call.
    warm();
  };

  /**
   * The member calls from the film, paused in chapter `index`, `part` of it
   * seen: the agent greets them at once, while the stage is brought there;
   * once it is, the stage takes the film's place.
   */
  const callFrom = async (at: { index: number; part: number }) => {
    const talking = startTalk(CALL_GREETING);
    if (phase === "ready" && status?.live) {
      const result = await cue({ action: "reach", ...at });
      if (result.problems.length)
        setProblems((now) => [...now, ...result.problems]);
      if (result.ok && calling.current) setReached(true);
    }
    await talking;
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
  const play = async (opened?: (ok: boolean) => void, from = 0) => {
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
        if (index < from) continue;
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
  const ending = useRef({ stop, endTalk, hangUpVoice, warm });
  const live = Boolean(status?.live);
  useEffect(() => {
    ending.current = { stop, endTalk, hangUpVoice, warm };
    latest.current = { onResume, play };
  });
  useEffect(() => {
    up.current = phase === "ready" && live;
    if (up.current) {
      // Up: the call's pass asked for now, so the click starts it at once.
      ending.current.warm();
      return;
    }
    if (phase === "ready") return;
    ending.current.stop();
    ending.current.endTalk();
  }, [phase, live]);
  useEffect(
    () => () => {
      up.current = false;
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
    reached,
    hearing,
    problems,
    notes,
    /**
     * The call's lines the thread does not have yet, then the member's
     * words as they are heard (pending, last), a voice before any word.
     */
    turn: [
      ...lines.map((line, i): ThreadMessage => ({
        id: `call${line.at}${i}`,
        author: line.who === "member" ? "builder" : "agent",
        body: line.text,
        status: "done",
        change: null,
        correctionRequestId: null,
        createdAt: new Date(line.at).toISOString(),
      })),
      ...(hearing || voicing
        ? [
            {
              id: "heard",
              author: "builder",
              body: hearing,
              status: "pending",
              change: null,
              correctionRequestId: null,
              createdAt: "9999-12-31T23:59:59.999Z",
            } satisfies ThreadMessage,
          ]
        : []),
    ],
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
    callFrom,
    warm,
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
 * The stage in the film's place while the member is on a call from it:
 * the app live, where the film was paused. Play plays the film on there,
 * the call ending; hanging up leaves the film paused.
 */
export function LiveCall({
  stage,
  shown,
  cinema,
  onCinema,
  onFilm,
}: {
  stage: LiveStage;
  /** Off a call: behind the film, its screen drawn, ready to take its place. */
  shown: boolean;
  cinema: boolean;
  onCinema: () => void;
  /** The film on, where it was paused. */
  onFilm: () => void;
}) {
  const { setScreen } = stage;
  return (
    <div className={shown ? "pv" : "pv pv-behind"} aria-hidden={!shown}>
      <div className="pv-screen">
        <div className="pv-view desktop">
          <div
            className="pv-window desktop"
            style={{ "--ratio": 1440 / 900 } as CSSProperties}
          >
            <div className="pv-glass">
              <div className="pv-live" ref={setScreen} />
            </div>
          </div>
          <div className="pv-overlay">
            <p className="pv-caption" />
            <div className="pv-controls">
              <div className="pv-bar">
                <button
                  type="button"
                  className="pv-icon pv-glass-pill pv-play"
                  onClick={() => {
                    stage.endTalk();
                    onFilm();
                  }}
                  aria-label="Play"
                  data-tip="Play"
                >
                  <Play size={18} aria-hidden="true" />
                </button>
                <span className="pv-glass-pill pv-clock">
                  <span className="pv-live-tag">Live</span>
                </span>
                <span className="pv-glass-pill pv-tools">
                  <button
                    type="button"
                    className="pv-icon on"
                    onClick={() => stage.endTalk()}
                    aria-label="Hang up"
                    data-tip="Hang up"
                  >
                    <PhoneOff size={18} aria-hidden="true" />
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
