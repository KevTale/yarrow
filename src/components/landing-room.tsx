import { ArrowLeft, GitCommitHorizontal, GitMerge } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { ChatWords } from "@/components/dashboard/chat-words";
import { FilesChanged } from "@/components/dashboard/files-changed";
import { SlideGo } from "@/components/dashboard/slide-go";
import { askSample, SampleBox } from "@/components/landing-agent";
import { Presentation, type FilmMoment } from "@/components/presentation";
import { chatParts } from "@/core/chat";
import type { DraftLine } from "@/core/new-ticket";
import {
  readAnswer,
  TRY_FIRST_WORDS,
  TRY_TURNS,
  TRY_WORDS,
} from "@/core/try-ticket";
import type { StoredArtifact } from "@/core/review";
import type { PullFile } from "@/server/github/pulls.server";

const FILM: StoredArtifact = {
  kind: "presentation",
  key: "/demo/presentation.json",
  label: "Demo",
  contentType: "application/json",
  poster: "/demo/poster.jpg",
};
const FIRST_ASK = "Can urgent tasks drop down once they're done?";

interface Line extends DraftLine {
  change?: string | null;
}

/** The rooms of the page: one voice at a time. */
let sounding: (() => void) | null = null;

/**
 * The room of a ticket to review, as a real one: the real player on a real
 * run's film and the real chat, a question ready in its box. Its agent answers
 * fast and takes the film where it talks about; what it would change stays a
 * card, and the slide merges nothing.
 */
export function SampleRoom({
  cta,
  merged,
  onMerged,
}: {
  cta: ReactNode;
  merged: boolean;
  onMerged: () => void;
}) {
  const [said, setSaid] = useState<Line[]>([]);
  const [words, setWords] = useState<string | null>(null);
  const [text, setText] = useState(FIRST_ASK);
  const [enough, setEnough] = useState(false);
  const [files, setFiles] = useState<PullFile[] | null>(null);
  const [cinema, setCinema] = useState(false);
  const [slot, setSlot] = useState(0);
  const room = useRef<HTMLDivElement>(null);
  const theater = useRef<HTMLDialogElement>(null);
  const tray = useRef<HTMLElement>(null);
  const thread = useRef<HTMLDivElement>(null);
  const seek = useRef<((ms: number, play?: boolean) => void) | null>(null);
  const pause = useRef<(() => FilmMoment) | null>(null);

  useEffect(() => {
    let live = true;
    void fetch("/demo/files.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((list) => live && setFiles(list as PullFile[] | null))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    const here = room.current;
    const hush = () => void pause.current?.();
    const onPlay = () => {
      if (sounding !== hush) sounding?.();
      sounding = hush;
    };
    // Media events do not bubble: caught on their way down.
    here?.addEventListener("play", onPlay, true);
    return () => {
      here?.removeEventListener("play", onPlay, true);
      if (sounding === hush) sounding = null;
    };
  }, []);

  useLayoutEffect(() => {
    const box = thread.current;
    if (box && said.length) box.scrollTop = box.scrollHeight;
  }, [said, words]);

  useLayoutEffect(() => {
    const dialog = theater.current;
    if (!dialog) return;
    if (cinema && !dialog.open) dialog.showModal();
    if (!cinema && dialog.open) dialog.close();
  }, [cinema]);
  const flipCinema = () => {
    if (!cinema) setSlot(theater.current?.offsetHeight ?? 0);
    setCinema(!cinema);
  };

  async function send() {
    const line = text.trim().slice(0, TRY_WORDS);
    if (!line || words !== null) return;
    const moment = pause.current?.();
    setText("");
    const lines: Line[] = [...said, { author: "builder", body: line }];
    setSaid(lines);
    if (lines.filter((one) => one.author === "builder").length > TRY_TURNS) {
      setEnough(true);
      return;
    }
    setWords("");
    let answer = readAnswer("");
    let moved = 0;
    try {
      const answered = await askSample(
        {
          kind: "review",
          said: lines.map(({ author, body }) => ({ author, body })),
          chapter: moment?.index ?? 0,
        },
        (raw) => {
          answer = readAnswer(raw);
          // The film goes where the words go, and waits there.
          const moments = chatParts(answer.text).filter(
            (part) => part.kind === "moment",
          );
          for (const next of moments.slice(moved))
            seek.current?.(next.ms, false);
          moved = moments.length;
          setWords(answer.text);
        },
      );
      if (!answered) {
        setEnough(true);
        return;
      }
      if (!answer.text) throw new Error("no answer");
      const { text: body, change } = answer;
      setSaid((all) => [...all, { author: "agent", body, change }]);
    } catch {
      setSaid((all) => [
        ...all,
        { author: "agent", body: "I lost my words there. Try again." },
      ]);
    } finally {
      setWords(null);
    }
  }

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
              artifact={FILM}
              cinema={cinema}
              onCinema={flipCinema}
              seekRef={seek}
              pauseRef={pause}
              demo={{
                onBack: () => {},
                waiting: false,
                onCall: false,
                live: null,
                liveNow: false,
                hands: false,
                end: (
                  <button
                    type="button"
                    className="pp-act"
                    onClick={() =>
                      tray.current?.querySelector("textarea")?.focus()
                    }
                  >
                    Ask for a change
                  </button>
                ),
              }}
            />
          </div>
          <aside ref={tray} className="pp-tray" aria-label="Conversation">
            <div className="pp-talk-thread" ref={thread}>
              <ol className="pp-chat">
                <li className="pp-it">
                  <ChatWords body={TRY_FIRST_WORDS} onSeek={null} />
                </li>
                {said.map((line, i) =>
                  line.author === "builder" ? (
                    <li className="pp-me" key={i}>
                      <p className="pp-bubble">{line.body}</p>
                    </li>
                  ) : (
                    <li className="pp-it" key={i}>
                      <ChatWords
                        body={line.body}
                        onSeek={(ms) => seek.current?.(ms)}
                      />
                      {line.change && (
                        <div className="pp-proposal">
                          <div className="pp-proposal-head">
                            <GitCommitHorizontal size={15} aria-hidden="true" />
                            Change
                          </div>
                          <p>{line.change}</p>
                          <div className="pp-proposal-foot">{cta}</div>
                        </div>
                      )}
                    </li>
                  ),
                )}
                {words !== null && (
                  <li className="pp-it">
                    {words ? (
                      <ChatWords
                        body={words}
                        onSeek={(ms) => seek.current?.(ms)}
                      />
                    ) : (
                      <p className="pp-say">
                        <TextShimmer>Thinking</TextShimmer>
                      </p>
                    )}
                  </li>
                )}
                {enough && (
                  <li className="pp-it">
                    <p className="pp-say">
                      That is plenty for a sample. Try me on your own tickets.
                    </p>
                  </li>
                )}
              </ol>
            </div>
            <SampleBox
              label="Ask about this ticket"
              placeholder="Ask about this ticket…"
              text={text}
              onText={setText}
              onSend={() => void send()}
              waiting={words !== null}
            />
          </aside>
        </div>
        <div className="pp-foot pp-bar">
          {files?.length ? <FilesChanged files={files} /> : null}
          <span className="pp-foot-away">
            {merged ? (
              cta
            ) : (
              <SlideGo
                label="Merge"
                prompt="Slide to merge"
                tone="dark"
                icon={<GitMerge size={15} aria-hidden="true" />}
                onGo={onMerged}
              />
            )}
          </span>
        </div>
      </dialog>
    </div>
  );
}
