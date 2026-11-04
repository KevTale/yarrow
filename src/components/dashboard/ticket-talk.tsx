import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, Mic, MicOff } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { micLine, onLine } from "@/components/call-voice";
import { Markdown } from "@/components/markdown";
import type { DraftLine, DraftText } from "@/core/new-ticket";
import { withoutBeats } from "@/core/stage";
import {
  draftFormFn,
  saveDraftFormFn,
  ticketCallFn,
} from "@/functions/ticket-agent.functions";

/** How long a call stays open with nothing said. */
const QUIET_MS = 60_000;
/** How often a call reads the form back: the agent writes it mid-sentence. */
const FORM_EVERY_MS = 1500;
/** How long a hand's edit waits before it reaches the draft, on a call. */
const SAVE_AFTER_MS = 500;

const sameForm = (a: DraftText, b: DraftText) =>
  a.title === b.title && a.body === b.body;

/** The events of a streamed turn, one JSON object a line. */
async function eachLine(
  body: ReadableStream<Uint8Array>,
  on: (event: { words?: string; ticket?: DraftText; failed?: true }) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let held = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    const lines = (held + decoder.decode(value, { stream: true })).split("\n");
    held = lines.pop() ?? "";
    for (const line of lines) if (line.trim()) on(JSON.parse(line));
  }
}

/** What the page asks of the call (an ElevenLabs conversation). */
interface Session {
  endSession(): Promise<void>;
  sendUserMessage(text: string): void;
}

/**
 * The agent beside the new ticket's form: told what is wanted, written or
 * aloud, it reads the code and the project's tickets, and fills in the form
 * as they talk. Only the member makes the ticket, with the form's buttons.
 */
export function TicketTalk({
  projectId,
  form,
  focused,
  onBegun,
  onWrite,
}: {
  projectId: string;
  form: DraftText;
  /** Takes the focus as the dialog opens. */
  focused: boolean;
  /** Something was said: closing now would lose it. */
  onBegun: () => void;
  onWrite: (text: DraftText) => void;
}) {
  const startCall = useServerFn(ticketCallFn);
  const readForm = useServerFn(draftFormFn);
  const saveForm = useServerFn(saveDraftFormFn);
  const [draftId] = useState(() => crypto.randomUUID());
  const [thread, setThread] = useState<DraftLine[]>([]);
  /** The agent's answer as it comes, null when none is being written. */
  const [words, setWords] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [hearing, setHearing] = useState("");
  const [call, setCall] = useState<"off" | "starting" | "on">("off");
  const [error, setError] = useState("");
  const session = useRef<Session | null>(null);
  const wire = useRef<ReturnType<typeof micLine> | null>(null);
  const calls = useRef(0);
  const quiet = useRef<ReturnType<typeof setTimeout>>(undefined);
  /** The form the draft has: what the page and the agent last agreed on. */
  const synced = useRef(form);
  const said = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const turn = useRef<AbortController | null>(null);
  const thinking =
    words !== null || (call === "on" && thread.at(-1)?.author === "builder");

  useEffect(() => {
    if (focused) box.current?.focus();
  }, [focused]);
  useLayoutEffect(() => {
    const area = box.current;
    if (!area) return;
    area.style.height = "auto";
    // Empty, as the dialog opens, it has no height to measure yet.
    if (text) area.style.height = `${area.scrollHeight}px`;
  }, [text]);
  useLayoutEffect(() => {
    const column = said.current;
    if (column) column.scrollTop = column.scrollHeight;
  }, [thread, words, hearing]);

  const hangUp = () => {
    calls.current++;
    clearTimeout(quiet.current);
    void session.current?.endSession();
    session.current = null;
    wire.current?.close();
    wire.current = null;
    setHearing("");
    setCall("off");
  };
  const stir = () => {
    clearTimeout(quiet.current);
    quiet.current = setTimeout(hangUp, QUIET_MS);
  };
  // The dialog closes: the call ends with it, and a turn is left to finish.
  useEffect(
    () => () => {
      hangUp();
      turn.current?.abort();
    },
    [],
  );

  // On a call the words go through ElevenLabs: the form follows the draft.
  useEffect(() => {
    if (call !== "on") return;
    const follow = async () => {
      const written = await readForm({ data: { projectId, draftId } }).catch(
        () => null,
      );
      if (!written || sameForm(written, synced.current)) return;
      synced.current = written;
      onWrite(written);
    };
    const timer = setInterval(() => {
      if (!document.hidden) void follow();
    }, FORM_EVERY_MS);
    return () => {
      clearInterval(timer);
      void follow();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, draftId, projectId]);
  useEffect(() => {
    if (call !== "on" || sameForm(form, synced.current)) return;
    const timer = setTimeout(() => {
      synced.current = form;
      void saveForm({ data: { projectId, draftId, ...form } }).catch(() => {});
    }, SAVE_AFTER_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, form, draftId, projectId]);

  const heard = (author: DraftLine["author"], body: string) =>
    setThread((all) => {
      const last = all.at(-1);
      if (author === "builder" || last?.author !== "agent")
        return [...all, { author, body }];
      // A turn comes in pieces, or whole again.
      return [
        ...all.slice(0, -1),
        {
          author,
          body: body.includes(last.body) ? body : `${last.body} ${body}`,
        },
      ];
    });

  async function send() {
    const asked = text.trim();
    if (!asked || words !== null || call === "starting") return;
    setError("");
    setText("");
    if (session.current) {
      session.current.sendUserMessage(asked);
      // ElevenLabs gives back only what it heard.
      heard("builder", asked);
      stir();
      return;
    }
    onBegun();
    setThread((all) => [...all, { author: "builder", body: asked }]);
    setWords("");
    const asking = new AbortController();
    turn.current = asking;
    let answer = "";
    try {
      const response = await fetch(`/ticket-agent/${projectId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId, text: asked, ...form }),
        signal: asking.signal,
      });
      if (!response.ok || !response.body) throw new Error("refused");
      await eachLine(response.body, (event) => {
        if (event.failed) throw new Error("failed");
        if (event.ticket) onWrite(event.ticket);
        if (event.words) {
          answer += event.words;
          setWords(answer);
        }
      });
      if (!answer.trim()) throw new Error("no answer");
      setThread((all) => [...all, { author: "agent", body: answer.trim() }]);
    } catch {
      if (asking.signal.aborted) return;
      setThread((all) => all.slice(0, -1));
      setText(asked);
      setError("That did not go through. Try again.");
    } finally {
      setWords(null);
    }
  }

  async function dial() {
    const opened = ++calls.current;
    setError("");
    setCall("starting");
    onBegun();
    synced.current = form;
    try {
      const language = (navigator.language || "en").slice(0, 2).toLowerCase();
      const line = (wire.current = micLine());
      // Asked at once: the call opens on the line, silent until they answer.
      void line
        .plug()
        .catch(
          () =>
            calls.current === opened && setError("The microphone is blocked."),
        );
      const [given, eleven] = await Promise.all([
        startCall({ data: { projectId, draftId, language, ...form } }),
        import("@elevenlabs/client"),
      ]);
      if (!given.ok) throw new Error(given.reason);
      const live = await onLine(line.stream, () =>
        eleven.Conversation.startSession({
          conversationToken: given.conversationToken,
          connectionType: "webrtc",
          overrides: { agent: { language: language as "en" } },
          customLlmExtraBody: { yarrow: given.grant },
          onModeChange: stir,
          onIncomingEvent: (event: {
            type?: string;
            tentative_user_transcription_event?: { user_transcript?: string };
          }) => {
            if (event.type !== "tentative_user_transcript") return;
            stir();
            setHearing(
              event.tentative_user_transcription_event?.user_transcript?.trim() ??
                "",
            );
          },
          onMessage: ({ source, message }) => {
            stir();
            if (source === "user") setHearing("");
            const line = withoutBeats(message).trim();
            if (line) heard(source === "user" ? "builder" : "agent", line);
          },
          onDisconnect: () => {
            if (calls.current === opened) hangUp();
          },
          onError: (message) => console.warn("ticket call", message),
        }),
      );
      // Closed while it was starting.
      if (calls.current !== opened) {
        void live.endSession();
        return;
      }
      session.current = live;
      setCall("on");
      stir();
    } catch (failed) {
      if (calls.current !== opened) return;
      hangUp();
      setError(
        failed instanceof Error && failed.message
          ? failed.message
          : "The call did not start. Try again.",
      );
    }
  }

  return (
    <section className="nt-talk" aria-label="Write it with the agent">
      <div ref={said} className="pp-talk-thread">
        <ol className="pp-chat">
          <li className="pp-it">
            <p className="pp-say">What are we building?</p>
          </li>
          {thread.map((line, i) =>
            line.author === "builder" ? (
              <li key={i} className="pp-me">
                <p className="pp-bubble">{line.body}</p>
              </li>
            ) : (
              <li key={i} className="pp-it">
                <Markdown source={line.body} className="pp-say" />
              </li>
            ),
          )}
          {hearing && (
            <li className="pp-me pp-hearing">
              <p className="pp-bubble">{hearing}</p>
            </li>
          )}
          {thinking && (
            <li className="pp-it">
              {words ? (
                <Markdown source={words} className="pp-say" />
              ) : (
                <p className="pp-say">
                  <TextShimmer>Thinking</TextShimmer>
                </p>
              )}
            </li>
          )}
        </ol>
      </div>
      <div className="pp-asking">
        <form
          className="pp-input"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <textarea
            ref={box}
            aria-label="Tell the agent what you want"
            placeholder="Tell the agent what you want…"
            rows={1}
            value={text}
            maxLength={4000}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          {(call !== "off" || !text.trim()) && (
            <button
              type="button"
              className={`pp-call ${call === "off" ? "" : call === "starting" ? "hang ringing" : "hang"}`}
              onClick={() => (call === "off" ? void dial() : hangUp())}
              aria-pressed={call !== "off"}
              aria-label="Microphone"
            >
              {call === "off" ? (
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
              aria-disabled={words !== null}
            >
              <ArrowUp size={17} strokeWidth={2.2} />
            </button>
          )}
        </form>
        {error && (
          <p className="pp-error" role="alert">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
