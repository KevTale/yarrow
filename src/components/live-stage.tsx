import type { Language } from "@elevenlabs/client";
import type RFB from "@novnc/novnc";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { ThreadMessage } from "@/components/dashboard/pull-panel";
import { CallSpeech, type SpeechTiming } from "@/components/call-speech";
import { asCall, micLine, onLine } from "@/components/call-voice";
import { loadPresentation, saved, VOICE_KEY } from "@/components/presentation";
import {
  cueAt,
  estimateSpeechMs,
  wordsSaid,
  type Presentation,
  type PresentationChapter,
} from "@/core/presentation";
import {
  CALL_GREETING,
  SLIP,
  withoutBeats,
  type StageCueResult,
} from "@/core/stage";
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

/** No microphone, nothing said this long: the call hangs up, it costs by the minute. */
const QUIET_CALL_MS = 60_000;
/** How often the page looks where the film is, the stage following it. */
const FOLLOW_MS = 1500;
/** How often the agent's words catch up with its voice. */
const WORDS_MS = 80;
/** None of the voice's timing this long: its words show all the same. */
const VOICE_LOST_MS = 2500;
/** A gesture leaves this long before its word: on its way, then the pointer's. */
const GESTURE_LEAD_MS = 650;
/** Gestures failed in a row the agent tries to put right, before it lets go. */
const SLIPS_MAX = 2;

/** How often the page looks whether the agent is showing something. */
const SHOW_LOOK_MS = 700;
/** How long it looks, a question's answer never coming. */
const ANSWER_MS = 90_000;
/** Asked again this often while the member has control; past a few, it ends. */
const CONTROL_MS = 15_000;
/** X's numbers for the keys of Ctrl+V. */
const X_CONTROL = 0xffe3;
const X_V = 0x76;

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
  setVolume(options: { volume: number }): void;
}

/** A voice in the microphone: ElevenLabs' VAD score past this. */
const VOICED = 0.9;
/** Heard this long, the presentation holds before any word. */
const VOICED_MS = 300;
/** Held for a voice, it still talks while the score is past this. */
const STILL_VOICED = 0.4;
/** No word of it, and quiet this long: the presentation goes on. */
const UNVOICED_MS = 2000;

/** Where the demo was as they spoke; `playing`, it had to be stopped. */
type Interrupted = { index: number; part: number; playing?: boolean };

const voiceMs = (chapter: PresentationChapter) =>
  chapter.audio?.durationMs ?? estimateSpeechMs(chapter.say);

export type LiveStage = ReturnType<typeof useLiveStage>;

/**
 * A pull request's stage, its app live on Yarrow's desktop (workers/stage.ts),
 * and the member's call to the agent over it (src/runner/talk.ts): one call
 * for what they write (`write`, no microphone asked for) and what they say
 * (`openCall`, their microphone plugged into it, `muteMic` out of it). The
 * stage follows the film behind it; they speak or send (`onVoice`): the film
 * stops and the stage takes its place, or the call is by voice alone while
 * the stage is not up (no recipe yet, still coming up, a phone). The agent's
 * words show as they are said and its gestures happen on them, by the voice's
 * own timing. Played on (`toDemo`, `onResume`), the call stays, quiet, for the
 * next time they speak; with no microphone, it hangs up a minute later and
 * opens again as they write. Or the presentation played live on it, the voice
 * here, the gestures there: their first words end it there. Should no call
 * start, what they write goes the written way (`ask`): the demo pauses, the
 * stage goes there behind it, and its screen takes the demo's place the
 * moment the agent shows something. The thread keeps what was said as what
 * was written. Or they try the app
 * themselves, the agent only watching until the demo plays on. The call and
 * the voice end with the stage, and with the page or the panel.
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
  answering = false,
  refresh,
  onResume,
  onVoice,
  onMoment,
}: {
  projectId: string;
  rowKey: string;
  /** Where it stood when the page was made. */
  initial?: StageView;
  /** Brought up once, if its presentation can be played on it. */
  start?: boolean;
  /** How long the thread is now. */
  messages: number;
  /** An answer is being written. */
  answering?: boolean;
  /** The thread read again: what it read, or undefined when it could not. */
  refresh: () => Promise<{ messages: readonly unknown[] } | null | undefined>;
  /**
   * The agent plays the film on, from a chapter (from 0) or where it was
   * paused (null), once its voice is done; the call has ended. Without it,
   * the presentation plays live again from that chapter.
   */
  onResume?: (chapter: number | null) => void;
  /** They spoke or sent over the film: it stops, and says where. */
  onVoice?: () => Interrupted | null;
  /** Where the film is now, for the stage to follow. */
  onMoment?: () => Interrupted | null;
}) {
  const [status, setStatus] = useState<StageView | null>(initial ?? null);
  const [timeline, setTimeline] = useState<Presentation | null>(null);
  const [show, setShow] = useState<Show | null>(null);
  const [played, setPlayed] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [talk, setTalk] = useState<"off" | "starting" | "on">("off");
  const [talkSince, setTalkSince] = useState(0);
  /** Their own microphone on the call. */
  const [mic, setMic] = useState<"off" | "starting" | "on">("off");
  /** The thread up to here, while the call's lines stand for what follows. */
  const [threadUpTo, setThreadUpTo] = useState<number | null>(null);
  /** Called from the film: the stage is where the film was paused. */
  const [reached, setReached] = useState(false);
  const [held, setHeld] = useState(false);
  /** The member spoke: the agent leads; the chapter it was in when they did. */
  const [led, setLed] = useState<number | null>(null);
  /** What the microphone hears of the member, as they say it. */
  const [hearing, setHearing] = useState("");
  /** The agent's words as they come, until the call has them whole. */
  const [writing, setWriting] = useState("");
  /** They said it, no word of the agent's yet. */
  const [thinking, setThinking] = useState(false);
  /** A voice in the microphone, no word of it heard yet. */
  const [voicing, setVoicing] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [screen, setScreen] = useState<HTMLDivElement | null>(null);
  /** The member's mouse and keyboard on the app: asked for, or there. */
  const [control, setControl] = useState<"off" | "asking" | "on">("off");
  /** The film's moment they took control from. */
  const controlFrom = useRef<{ index: number; part: number } | null>(null);
  /** The agent showed something in writing: the screen is in the film's place. */
  const [agentShows, setAgentShows] = useState(false);
  /** A question written beside the film, from its moment, being answered. */
  const [asked, setAsked] = useState<{
    at: { index: number; part: number } | null;
    wasUp: boolean;
  } | null>(null);
  /** The moment the stage is at: a next question from it does not go back. */
  const reachedAt = useRef<string | null>(null);
  const answer = useRef(answering);
  const [viewer, setViewer] = useState<RFB | null>(null);
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
  /** The call's microphone line, and whether theirs is plugged into it. */
  const wire = useRef<ReturnType<typeof micLine> | null>(null);
  const micOn = useRef(false);
  /** Hangs up the call that has said nothing for a while. */
  const quiet = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Each call in turn: the end of an earlier one is not this one's. */
  const calls = useRef(0);
  /** What the agent is saying, as the voice's timing has it. */
  const speech = useRef(new CallSpeech());
  /** Its words catching up with its voice. */
  const wordsNow = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Its answer whole, waiting for the voice to finish saying it. */
  const spoken = useRef<{ text: string; greeted: boolean } | null>(null);
  /** Its voice cut (they spoke, or the demo plays on): the rest is not shown. */
  const voiceCut = useRef(false);
  /** Gestures on their way to their word. */
  const beats = useRef(new Set<ReturnType<typeof setTimeout>>());
  /** What failed of them, for the agent once its voice is done. */
  const slips = useRef<string[]>([]);
  const slipped = useRef(0);
  /** The moment the stage followed the film to, and one on its way there. */
  const followed = useRef<string | null>(null);
  const following = useRef(false);
  const transcription = useRef<Transcription | null>(null);
  /** The call's token for their words as they say them, until it is used. */
  const scribeToken = useRef<string | null>(null);
  /** Their words of this turn already done (Scribe commits each pause). */
  const heardSoFar = useRef("");
  const calling = useRef(false);
  /** The call on its way, or the last one. */
  const starting = useRef<Promise<void> | null>(null);
  /** The agent's voice is heard now. */
  const speaking = useRef(false);
  /** The agent asked for the film, heard once its voice is done. */
  const resumeAsked = useRef<{ chapter: number | null } | null>(null);
  /** The call's handlers, made once, reach these as they are now. */
  const latest = useRef<{
    onResume?: (chapter: number | null) => void;
    onVoice?: () => Interrupted | null;
    play: (opened?: (ok: boolean) => void, from?: number) => Promise<void>;
    interrupt: (words?: boolean) => void;
    follow: () => void;
  }>({
    onResume,
    onVoice,
    play: async () => {},
    interrupt: () => {},
    follow: () => {},
  });
  /** The film and the member: on, stopped by a voice, stopped for their words. */
  const heardOver = useRef<"no" | "voice" | "words">("no");
  /** Where it stopped for them. */
  const stoppedAt = useRef<Interrupted | null>(null);
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
  /** The next call's pass, asked for before the click, over the stage or not. */
  const pass = useRef<{
    at: number;
    stage: boolean;
    made: ReturnType<typeof stageTalkFn>;
  } | null>(null);
  /** Up, its presentation playable: a call can be made. */
  const up = useRef(false);
  const known = useRef(0);
  useEffect(() => {
    known.current = messages;
  }, [messages]);
  useEffect(() => {
    answer.current = answering;
  }, [answering]);

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

  // A boot that ended asleep (the one after delivery, made for later):
  // asked up again, once.
  const lastPhase = useRef(phase);
  const reopened = useRef(false);
  useEffect(() => {
    const before = lastPhase.current;
    lastPhase.current = phase;
    if (!start || reopened.current || before !== "booting" || phase !== "off")
      return;
    reopened.current = true;
    void call("open", false, true);
  }, [phase, start, call]);

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
    let rfb: RFB | null = null;
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
      setViewer(client);
    });
    return () => {
      gone = true;
      setViewer(null);
      setControl("off");
      setAgentShows(false);
      rfb?.disconnect();
    };
  }, [phase, screen, projectId, rowKey, call]);

  /**
   * The member takes control of the app, from the film's moment `at` when
   * there is one: the stage comes up if it is not, and goes where the film
   * was paused, before its screen takes their hands.
   */
  const takeControl = (at: { index: number; part: number } | null = null) => {
    if (control !== "off") return;
    if (showing.current) stop();
    controlFrom.current = at;
    setControl("asking");
    if (phase === "ready" || phase === "booting") return;
    setStatus(null);
    void call("open");
  };

  /** The screen is only watched again: the film, unless a call goes on. */
  const giveBack = () => {
    setControl("off");
    if (talk === "off") setReached(false);
  };

  /**
   * Back to the demo: whatever the screen was doing ends there. A call goes
   * on, the agent not heard over it until they speak.
   */
  const toDemo = () => {
    setControl("off");
    setAgentShows(false);
    setAsked(null);
    setReached(false);
    reachedAt.current = null;
    followed.current = null;
    heardOver.current = "no";
    conversation.current?.setVolume({ volume: 0 });
    slips.current = [];
    voiceDone(true);
    setWriting("");
    setThinking(false);
  };

  /**
   * A question written beside the demo, paused at `at`: the stage woken if
   * it slept, and looked at until the answer is there.
   */
  const ask = (at: { index: number; part: number } | null) => {
    hold();
    if (control !== "off" || agentShows || reached) return;
    if (phase !== "ready" && phase !== "booting")
      void call("open", false, true);
    setAsked({ at, wasUp: up.current });
  };

  useEffect(() => {
    if (!asked) return;
    let gone = false;
    void (async () => {
      const until = Date.now() + ANSWER_MS;
      while (!gone && !up.current && Date.now() < until) await sleep(500);
      if (gone) return;
      if (!up.current) {
        setAsked(null);
        return;
      }
      // The agent's moves wait for it there (the presenter's hands).
      const { at, wasUp } = asked;
      const moment = at && (at.index > 0 || at.part > 0) ? at : null;
      const key = moment && `${moment.index}:${moment.part}`;
      if (moment && key !== reachedAt.current) {
        reachedAt.current = key;
        void cue({ action: "reach", ...moment });
      }
      const base = wasUp
        ? ((await cue({ action: "state" })).state?.showing ?? 0)
        : 0;
      let began = false;
      while (!gone && Date.now() < until) {
        await sleep(SHOW_LOOK_MS);
        if (answer.current) began = true;
        else if (began) break;
        const now = await cue({ action: "state" });
        if ((now.state?.showing ?? 0) > base) {
          setAgentShows(true);
          break;
        }
      }
      if (!gone) setAsked(null);
    })();
    return () => {
      gone = true;
    };
  }, [asked, cue]);

  const replayable = Boolean(status?.live);
  useEffect(() => {
    if (control !== "asking") return;
    if (phase === "failed") {
      setControl("off");
      return;
    }
    if (phase !== "ready") return;
    let gone = false;
    void (async () => {
      const at = controlFrom.current;
      if (at && replayable) {
        reachedAt.current = `${at.index}:${at.part}`;
        const there = await cue({ action: "reach", ...at });
        if (gone) return;
        if (there.ok) setReached(true);
      }
      const given = await cue({ action: "control", on: true });
      if (gone) return;
      if (!given.ok) setProblems((now) => [...now, ...given.problems]);
      setControl(given.ok ? "on" : "off");
    })();
    return () => {
      gone = true;
    };
  }, [control, phase, replayable, cue]);

  // Theirs: the screen takes their hands and their clipboard, asked again
  // while the page is here.
  useEffect(() => {
    if (control !== "on" || !viewer || !screen) return;
    viewer.viewOnly = false;
    viewer.focus();
    const lease = setInterval(
      () => void cue({ action: "control", on: true }),
      CONTROL_MS,
    );
    const pasteThere = () => {
      viewer.sendKey(X_CONTROL, "ControlLeft", true);
      viewer.sendKey(X_V, "KeyV");
      viewer.sendKey(X_CONTROL, "ControlLeft", false);
    };
    // What they copied goes first: Ctrl+V there pastes it.
    const paste = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "v" || event.altKey) return;
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void navigator.clipboard
        .readText()
        .then((text) => viewer.clipboardPasteFrom(text))
        .catch(() => {})
        .finally(pasteThere);
    };
    const copied = (event: Event) =>
      void navigator.clipboard
        .writeText((event as CustomEvent<{ text: string }>).detail.text)
        .catch(() => {});
    screen.addEventListener("keydown", paste, { capture: true });
    viewer.addEventListener("clipboard", copied);
    return () => {
      clearInterval(lease);
      screen.removeEventListener("keydown", paste, { capture: true });
      viewer.removeEventListener("clipboard", copied);
      viewer.viewOnly = true;
      void cue({ action: "control", on: false });
    };
  }, [control, viewer, screen, cue]);

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
      let read = base;
      for (let attempt = 0; attempt < 20; attempt++) {
        const fresh = await refresh();
        read = fresh?.messages.length ?? read;
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
      // The thread has it: only a turn begun since stays out of it.
      const next = turns.current.get(turnNow.current);
      if (turnNow.current === turn || !next) setThreadUpTo(null);
      else {
        next.base = read;
        setThreadUpTo(read);
      }
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
      unheard();
      return;
    }
    if (speaking.current || score < VOICED) return;
    if (!heard) voicedOnCall.current = { since: now, last: now };
    else if (now - heard.since >= VOICED_MS) {
      setVoicing(true);
      if (unvoiced.current < 3) latest.current.interrupt(false);
    }
  };

  /**
   * They speak or send over the film: it stops at once, for a voice alone
   * (`words` false) before any word of it. Once there are words, the agent is
   * heard again and the stage takes the film's place where it stopped.
   */
  const interrupt = (words = true) => {
    const was = heardOver.current;
    if (was === "words" || (was === "voice" && !words)) return;
    if (was === "no") stoppedAt.current = latest.current.onVoice?.() ?? null;
    heardOver.current = words ? "words" : "voice";
    if (!words) return;
    audible();
    const at = stoppedAt.current;
    // In the member's hands, the stage stays as they have it.
    if (control !== "off") setReached(true);
    else if (at && up.current)
      void cue({ action: "reach", ...at }).then((result) => {
        if (result.problems.length)
          setProblems((now) => [...now, ...result.problems]);
        if (result.ok && calling.current && heardOver.current === "words")
          setReached(true);
      });
  };

  /** The agent is heard: on their microphone always, else as the demo is. */
  const audible = () =>
    conversation.current?.setVolume({
      volume: micOn.current || saved(VOICE_KEY) ? 1 : 0,
    });

  /** The film plays: the stage goes after it, there before they speak. */
  const follow = () => {
    if (!up.current || control !== "off" || following.current) return;
    const at = onMoment?.();
    if (!at?.playing) return;
    const gestures = timeline?.chapters[at.index]?.live?.actions.length ?? 0;
    const moment = `${at.index}:${Math.round(gestures * at.part)}`;
    if (moment === followed.current) return;
    following.current = true;
    void cue({ action: "reach", index: at.index, part: at.part }).then(
      (result) => {
        following.current = false;
        if (result.ok) followed.current = moment;
      },
    );
  };
  useEffect(() => {
    const timer = setInterval(() => latest.current.follow(), FOLLOW_MS);
    return () => clearInterval(timer);
  }, []);

  /**
   * Stopped for a voice no word came of, quiet now: the film goes on. Past a
   * few, the film's own echo: words only.
   */
  const unheard = () => {
    if (heardOver.current !== "voice") return;
    heardOver.current = "no";
    unvoiced.current += 1;
    if (stoppedAt.current?.playing) latest.current.onResume?.(null);
  };

  /**
   * The call's pass (its ElevenLabs token and the brain's grant), and the
   * client: asked for before the click, so the call starts at once. Over
   * the stage once it is up, by voice alone before.
   */
  const language = () => (navigator.language || "en").slice(0, 2).toLowerCase();
  const warm = () => {
    void import("@elevenlabs/client");
    const stage = up.current;
    const kept = pass.current;
    if (kept && kept.stage === stage && Date.now() - kept.at < PASS_MS) return;
    const made = stageTalkFn({
      data: { projectId, key: rowKey, language: language(), stage },
    });
    made.catch(() => {
      if (pass.current?.made === made) pass.current = null;
    });
    pass.current = { at: Date.now(), stage, made };
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

  /** Something was said: a call with no microphone stays a while longer. */
  const stillTalking = () => {
    clearTimeout(quiet.current);
    if (!calling.current) return;
    quiet.current = setTimeout(() => {
      if (micOn.current || speaking.current || wordsNow.current) stillTalking();
      else hangUp();
    }, QUIET_CALL_MS);
  };

  /** The agent's words caught up with its voice, its line once it said it. */
  const showWords = () => {
    const now = performance.now();
    const said = speech.current.textAt(now);
    if (said) {
      setThinking(false);
      setWriting(said);
    }
    const whole = spoken.current;
    if (!whole || !speech.current.over(now)) return;
    const heard =
      plain(speech.current.text()).length + 2 >= plain(whole.text).length;
    if (heard || now - speech.current.last > VOICE_LOST_MS) voiceDone();
  };
  const runWords = () => {
    wordsNow.current ??= setInterval(showWords, WORDS_MS);
  };

  /** The voice's timing of a piece: its gestures leave in time for their word. */
  const hearVoice = (timing: SpeechTiming) => {
    if (voiceCut.current) return;
    const now = performance.now();
    for (const { n, at } of speech.current.add(timing, now)) {
      const beat = setTimeout(
        () => {
          beats.current.delete(beat);
          void cue({ action: "beat", n }).then(gestureDone);
        },
        Math.max(0, at - now - GESTURE_LEAD_MS),
      );
      beats.current.add(beat);
    }
    runWords();
  };

  /**
   * The voice said it, or was cut (`cut`: nothing more of it is shown and
   * what it had left to do goes): its line takes the words' place.
   */
  const voiceDone = (cut = false) => {
    if (wordsNow.current) clearInterval(wordsNow.current);
    wordsNow.current = null;
    for (const beat of beats.current) clearTimeout(beat);
    beats.current.clear();
    speech.current = new CallSpeech();
    voiceCut.current = cut;
    const whole = spoken.current;
    spoken.current = null;
    setWriting("");
    if (whole) addLine("agent", whole.text, whole.greeted);
    stillTalking();
    if (cut) return;
    if (up.current) void cue({ action: "beat", n: null }).then(gestureDone);
    tellSlips();
  };

  const gestureDone = (result: StageCueResult) => {
    slips.current.push(...result.problems);
    tellSlips();
  };

  /**
   * A gesture written in its words failed: the agent hears it once its voice
   * is done, as a turn no member said, and puts it right.
   */
  const tellSlips = () => {
    if (!slips.current.length || wordsNow.current || voiceCut.current) return;
    const failed = slips.current.splice(0).join("; ");
    const session = conversation.current;
    if (!session || slipped.current >= SLIPS_MAX) return;
    slipped.current += 1;
    turnNow.current += 1;
    turns.current.set(turnNow.current, { base: known.current, said: "" });
    lastWho.current = "member";
    setThreadUpTo((now) => now ?? known.current);
    session.sendUserMessage(`${SLIP} ${failed}`);
  };

  /** The agent asked for the film: it plays on, the call staying, or ending. */
  const resumeNow = () => {
    const asked = resumeAsked.current;
    if (!asked) return;
    resumeAsked.current = null;
    setAgentShows(false);
    reachedAt.current = null;
    const { onResume, play } = latest.current;
    if (onResume) onResume(asked.chapter);
    else {
      endTalk();
      void play(undefined, asked.chapter ?? saying.current);
    }
  };

  /** A line of the call: one bubble a turn, until the thread has the turn. */
  const addLine = (who: Line["who"], text: string, greeted = false) => {
    if (who === "agent" && !greeted) {
      setWriting("");
      setThinking(false);
    }
    if (who === "member") {
      // Over the agent's voice: what it had left to say goes.
      voiceDone(true);
      voiceCut.current = false;
      slipped.current = 0;
      unvoiced.current = 0;
      latest.current.interrupt();
      takeOver();
      setThinking(/\p{L}/u.test(text));
      if (up.current) void cue({ action: "stir" });
      if (lastWho.current !== "member") {
        turnNow.current += 1;
        turns.current.set(turnNow.current, {
          base: known.current,
          said: "",
        });
        setThreadUpTo((now) => now ?? known.current);
      }
      const now = turns.current.get(turnNow.current)!;
      if (!plain(now.said).includes(plain(text)))
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
  };

  /**
   * The call: the member's voice to the agent, the agent's back; its
   * first words `greeting`, when there are some.
   */
  const startTalk = (greeting?: string) => {
    if (!calling.current) starting.current = openTalk(greeting);
    return starting.current;
  };
  const openTalk = async (greeting?: string) => {
    calling.current = true;
    const call = ++calls.current;
    resumeAsked.current = null;
    speaking.current = false;
    unvoiced.current = 0;
    voiceCut.current = false;
    setTalk("starting");
    try {
      const line = (wire.current ??= micLine());
      const [given, eleven] = await Promise.all([
        passNow(),
        import("@elevenlabs/client"),
      ]);
      if (!given.ok) throw new Error(given.reason);
      const session = await onLine(line.stream, () =>
        eleven.Conversation.startSession({
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
                  Number.isInteger(chapter) && chapter >= 1
                    ? chapter - 1
                    : null,
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
            if (event.type === "interruption") voiceDone(true);
            if (event.type !== "tentative_user_transcript") return;
            const heard =
              event.tentative_user_transcription_event?.user_transcript ?? "";
            setHearing(heard.trim());
            if (!/\p{L}/u.test(heard)) return;
            unvoiced.current = 0;
            latest.current.interrupt();
            hold();
          },
          onAudioAlignment: hearVoice,
          onMessage: ({ source, message }) => {
            const who = source === "user" ? "member" : "agent";
            if (who === "member") {
              setHearing("");
              setVoicing(false);
              voicedOnCall.current = null;
              heardSoFar.current = "";
            }
            const text = withoutBeats(message).trim();
            if (!text || text.startsWith(SLIP)) return;
            // The greeting is the page's own: the thread never has it.
            const greeted = who === "agent" && text === greeting;
            if (who === "member" || voiceCut.current) {
              addLine(who, text, greeted);
              return;
            }
            // Its voice comes after its words: the line waits for it.
            const before = spoken.current?.text ?? "";
            spoken.current = {
              text: plain(text).includes(plain(before))
                ? text
                : `${before} ${text}`,
              greeted,
            };
            speech.current.last = performance.now();
            runWords();
          },
          onDisconnect: () => {
            if (calls.current !== call) return;
            conversation.current = null;
            hangUp();
          },
          onError: (message) =>
            setProblems((now) => [...now, `call: ${message}`]),
        }),
      );
      // Hung up while it was starting.
      if (calls.current !== call) {
        void session.endSession();
        return;
      }
      conversation.current = session;
      scribeToken.current = given.transcriptionToken ?? null;
      if (heardOver.current === "words") audible();
      setTalk("on");
      setTalkSince(Date.now());
      stillTalking();
    } catch (error) {
      hangUp();
      setProblems((now) => [...now, `call: ${(error as Error).message}`]);
    }
  };

  /** Their microphone on the call, and their words as they say them. */
  const plugMic = async () => {
    setMic("starting");
    try {
      wire.current ??= micLine();
      await wire.current.plug();
      micOn.current = true;
      setMic("on");
      if (heardOver.current === "words") audible();
      await starting.current;
      if (!micOn.current) return;
      const token =
        scribeToken.current ??
        (await passNow().then((given) =>
          given.ok ? given.transcriptionToken : null,
        ));
      scribeToken.current = null;
      if (!token || !micOn.current) return;
      transcribe(await import("@elevenlabs/client"), token);
    } catch (error) {
      if (micOn.current) return;
      setMic("off");
      setProblems((now) => [...now, `call: ${(error as Error).message}`]);
    }
  };

  /** Their microphone off: the call stays a while, for what they write. */
  const muteMic = () => {
    wire.current?.unplug();
    micOn.current = false;
    setMic("off");
    untranscribe();
    setHearing("");
    setVoicing(false);
    voicedOnCall.current = null;
    stillTalking();
  };

  /** The call ends, what is on the screen staying. */
  const hangUp = () => {
    calls.current += 1;
    clearTimeout(quiet.current);
    untranscribe();
    void conversation.current?.endSession();
    conversation.current = null;
    calling.current = false;
    resumeAsked.current = null;
    wire.current?.close();
    wire.current = null;
    micOn.current = false;
    voiceDone(true);
    if (!settling.current.size) setThreadUpTo(null);
    setMic("off");
    setTalk("off");
    setHearing("");
    setVoicing(false);
    setThinking(false);
    voicedOnCall.current = null;
    lastWho.current = null;
    setLines((now) => now.filter((line) => line.turn !== -1));
    // The next call's pass, the stage up: a pass is for one call. Without
    // it, the phone's hover asks for one.
    if (up.current) warm();
  };

  const endTalk = () => {
    hangUp();
    heardOver.current = "no";
    setReached(false);
  };

  /**
   * The member calls: the agent greets them at once (`greeted`; if not, it
   * listens, the film playing on until they speak).
   */
  const openCall = (greeted = true) => {
    const talking = startTalk(greeted ? CALL_GREETING : undefined);
    void plugMic();
    // In the member's hands, the stage stays as they have it.
    if (control !== "off") setReached(true);
    return talking;
  };

  /** They are writing: the call is up by the time they send. */
  const expect = () => {
    if (!calling.current) void startTalk();
  };

  /**
   * Their words written: heard as if said, on the call, opened for them if it
   * is not. False with no call to hear them.
   */
  const write = async (text: string) => {
    if (!up.current && live && phase !== "ready" && phase !== "booting")
      void call("open", false, true);
    const talking = startTalk();
    addLine("member", text);
    await talking;
    const session = conversation.current;
    if (session) {
      session.sendUserMessage(text);
      return true;
    }
    // The written way hears it instead.
    const turn = turnNow.current;
    setLines((now) => now.filter((line) => line.turn !== turn));
    setThreadUpTo(null);
    setThinking(false);
    lastWho.current = null;
    return false;
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
    void plugMic();
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
    latest.current = { onResume, onVoice, play, interrupt, follow };
  });
  useEffect(() => {
    const was = up.current;
    up.current = phase === "ready" && live;
    if (up.current) {
      // Up: the call's pass asked for now, so the click starts it at once.
      ending.current.warm();
      return;
    }
    // A call by voice alone goes on while the stage comes up, or never does.
    if (phase === "ready" || !was) return;
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
    talkSince,
    mic,
    muteMic,
    threadUpTo,
    control,
    takeControl,
    giveBack,
    toDemo,
    ask,
    agentShows,
    reached,
    hearing,
    problems,
    notes,
    /**
     * The call's lines the thread does not have yet, the agent's words as
     * they come, then the member's as they are heard (pending, last), a
     * voice before any word.
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
      ...(writing || thinking
        ? [
            {
              id: "writing",
              author: "agent",
              body: writing,
              status: writing ? "done" : "pending",
              change: null,
              correctionRequestId: null,
              createdAt: "9999-12-31T23:59:59.998Z",
            } satisfies ThreadMessage,
          ]
        : []),
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
    openCall,
    expect,
    write,
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
 * The stage on the demo's canvas, what happens now on one screen: the agent
 * showing something, on a call or in writing, or the member trying the app.
 * The demo's controls stay over it, and play the demo on where it paused.
 */
export function LiveCall({
  stage,
  shown,
}: {
  stage: LiveStage;
  /** Off: behind the demo, its screen drawn, ready to take its place. */
  shown: boolean;
}) {
  const { setScreen } = stage;
  const controlled = stage.control === "on";
  return (
    <div
      className={`pv pv-on ${shown ? "" : "pv-behind"}`}
      aria-hidden={!shown}
    >
      <div className="pv-screen">
        <div className="pv-view desktop">
          <div
            className="pv-window desktop"
            style={{ "--ratio": 1440 / 900 } as CSSProperties}
          >
            <div className="pv-glass">
              <div
                className="pv-live"
                ref={setScreen}
                data-control={controlled || undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
