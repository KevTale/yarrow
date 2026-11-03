import {
  ArrowUp,
  GitMerge,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SlideGo } from "@/components/dashboard/slide-go";
import {
  FilesChanged,
  TicketGroup,
  TicketRow,
  toReview,
} from "@/components/landing-shots";
import { useFlip } from "@/components/live";
import type { DraftLine } from "@/core/new-ticket";
import {
  changeLook,
  LOOK,
  readTags,
  TRY_FILM,
  TRY_FILM_LENGTH,
  TRY_FIRST_WORDS,
  TRY_TURNS,
  TRY_WORDS,
  type Look,
  type Moment,
} from "@/core/try-ticket";

type Priority = "urgent" | "high" | "normal";
interface Task {
  id: string;
  title: string;
  state: "To do" | "Doing" | "Done";
  who: string;
  priority: Priority;
}

const tasks: Task[] = [
  {
    id: "a",
    title: "Write the onboarding email",
    state: "Doing",
    who: "Sam Okafor",
    priority: "normal",
  },
  {
    id: "b",
    title: "Fix the export to CSV",
    state: "Doing",
    who: "Léa Martin",
    priority: "urgent",
  },
  {
    id: "c",
    title: "Plan the October release",
    state: "To do",
    who: "Sam Okafor",
    priority: "normal",
  },
  {
    id: "d",
    title: "Answer the pricing question",
    state: "To do",
    who: "Léa Martin",
    priority: "high",
  },
  {
    id: "e",
    title: "Review the settings design",
    state: "Done",
    who: "Léa Martin",
    priority: "normal",
  },
];
const added: Task = {
  id: "new",
  title: "Renew the domain",
  state: "To do",
  who: "Sam Okafor",
  priority: "urgent",
};

const film = TRY_FILM;
const LENGTH = TRY_FILM_LENGTH;
const FIRST_ASK = "Can urgent be blue instead of red?";
const rank: Record<Priority, number> = { urgent: 0, high: 1, normal: 2 };
const momentAt = (time: number) =>
  film.filter((step) => step.at <= time).at(-1) ?? film[0]!;
const clock = (time: number) =>
  `0:${String(Math.floor(time)).padStart(2, "0")}`;

/** The demo's small app, as it stands at a moment of the film. */
function AcmeApp({ moment, look }: { moment: Moment; look: Look }) {
  const rows = useMemo(() => {
    const all =
      moment === "added" || moment === "sorted" ? [...tasks, added] : tasks;
    const shown = look.hideDone
      ? all.filter((task) => task.state !== "Done")
      : all;
    return moment === "sorted" && look.sort === "priority"
      ? [...shown].sort((a, b) => rank[a.priority] - rank[b.priority])
      : shown;
  }, [moment, look.hideDone, look.sort]);
  const list = useFlip<HTMLUListElement>(rows);
  const tagged = moment === "added" || moment === "sorted";
  return (
    <div
      className={`lr-app ${look.theme} ${look.shape}`}
      style={
        {
          "--urgent": look.urgentColor,
          "--high": look.highColor,
        } as React.CSSProperties
      }
    >
      <div className="lr-app-head">
        <p>
          Tasks{" "}
          <span>
            {rows.filter((task) => task.state !== "Done").length} open
          </span>
        </p>
        {moment === "sorted" && look.sort === "priority" && (
          <em className="lr-sort">
            Priority
            <i className="lr-pointer" />
          </em>
        )}
      </div>
      <ul className="lr-table" ref={list}>
        {rows.map((task) => (
          <li
            key={task.id}
            data-flip={task.id}
            className={`lr-task ${task.id === "new" && moment === "added" ? "is-new" : ""}`}
          >
            <span className="lr-task-name">
              <span>{task.title}</span>
              {tagged && task.priority !== "normal" && (
                <em className={`lr-tag ${task.priority}`}>
                  {task.priority === "urgent" ? look.urgentName : look.highName}
                </em>
              )}
            </span>
            <span className={`lr-state s-${task.state.replace(" ", "")}`}>
              {task.state}
            </span>
            <span className="lr-who">{task.who}</span>
          </li>
        ))}
      </ul>
      {moment === "form" && (
        <div className="lr-form">
          <span className="lr-field grow">Renew the domain</span>
          <span className="lr-field">Sam Okafor</span>
          <span className="lr-field lr-pick">
            <i className={`lr-tag urgent`}>{look.urgentName}</i>
          </span>
          <span className="lr-add">Add</span>
          <i className="lr-pointer" />
        </div>
      )}
    </div>
  );
}

/**
 * The tickets to review, the first one open at the size of the real one: a
 * drawn demo on white with its voice and controls, a real agent beside it
 * that answers fast and moves the drawing (`/try-agent`, tags in its words),
 * a question ready in its box, and a slide that merges. Nothing else is real:
 * no repository behind it.
 */
export function LandingRoom({ cta }: { cta: React.ReactNode }) {
  const [time, setTime] = useState(LENGTH);
  const [playing, setPlaying] = useState(false);
  const [played, setPlayed] = useState(false);
  const [look, setLook] = useState(LOOK);
  const [changes, setChanges] = useState(0);
  const [merged, setMerged] = useState(false);
  const [said, setSaid] = useState<DraftLine[]>([
    { author: "agent", body: TRY_FIRST_WORDS },
  ]);
  const [words, setWords] = useState<string | null>(null);
  const [text, setText] = useState(FIRST_ASK);
  const [enough, setEnough] = useState(false);
  const [muted, setMuted] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const voice = useRef<HTMLAudioElement>(null);
  const now = useRef(LENGTH);
  const step = momentAt(time);

  useEffect(() => {
    const audio = voice.current;
    if (!playing || !audio) return;
    audio.currentTime = now.current;
    void audio.play().catch(() => {});
    const timer = setInterval(() => {
      // The voice keeps the time; blocked, the clock does.
      const heard = audio.paused ? now.current + 0.1 : audio.currentTime;
      now.current = Math.min(LENGTH, heard);
      setTime(now.current);
      if (now.current >= LENGTH) setPlaying(false);
    }, 100);
    return () => {
      clearInterval(timer);
      audio.pause();
    };
  }, [playing]);

  useEffect(() => {
    const box = thread.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [said, words]);

  const seek = (at: number) => {
    now.current = at;
    setTime(at);
  };
  const play = () => {
    if (now.current >= LENGTH) seek(0);
    setPlayed(true);
    setPlaying((current) => !current);
  };
  const show = (moment: Moment) => {
    setPlaying(false);
    setPlayed(true);
    seek(film.find((one) => one.moment === moment)!.at);
  };

  async function send(asked: string) {
    const line = asked.trim().slice(0, TRY_WORDS);
    if (!line || words !== null) return;
    setPlaying(false);
    setText("");
    const lines: DraftLine[] = [...said, { author: "builder", body: line }];
    setSaid(lines);
    const turns = lines.filter((one) => one.author === "builder").length;
    if (turns > TRY_TURNS) {
      setEnough(true);
      return;
    }
    setWords("");
    let raw = "";
    let done = 0;
    try {
      const response = await fetch("/try-agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ said: lines, moment: step.moment, look }),
      });
      if (response.status === 429) {
        setEnough(true);
        return;
      }
      if (!response.ok || !response.body) throw new Error("refused");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done: ended } = await reader.read();
        if (ended) break;
        raw += decoder.decode(value, { stream: true });
        const read = readTags(raw);
        // The moment before the words that talk about it.
        for (const act of read.acts.slice(done)) {
          if (act.kind === "show") show(act.moment);
          else {
            setLook((current) => changeLook(current, act.change));
            setChanges((count) => count + 1);
            if (momentAt(now.current).at < 11) show("sorted");
          }
        }
        done = read.acts.length;
        setWords(read.text);
      }
      const answer = readTags(raw).text;
      if (!answer) throw new Error("no answer");
      setSaid((all) => [...all, { author: "agent", body: answer }]);
    } catch {
      setSaid((all) => [
        ...all,
        { author: "agent", body: "I lost my words there. Try again." },
      ]);
    } finally {
      setWords(null);
    }
  }

  const [first, ...others] = toReview;
  const room = (
    <section className="lr" aria-label="Tasks need a priority">
      <div className="lr-meet">
        <div className="lr-film">
          <AcmeApp moment={step.moment} look={look} />
          <audio
            ref={voice}
            src="/demo-priority.mp3"
            preload="none"
            muted={muted}
          />
          {played && time < LENGTH && (
            <p className="lr-say" key={step.moment}>
              {step.say}
            </p>
          )}
          {!played && (
            <button
              type="button"
              className="lr-play"
              aria-label="Play the demo"
              onClick={play}
            >
              <Play size={22} />
            </button>
          )}
          <div className="lr-controls">
            <button
              type="button"
              className="lr-control"
              aria-label={playing ? "Pause" : "Play"}
              onClick={play}
            >
              {playing ? (
                <Pause size={15} />
              ) : time >= LENGTH && played ? (
                <RotateCcw size={14} />
              ) : (
                <Play size={15} />
              )}
            </button>
            <span className="lr-time mono">
              {clock(played ? time : 0)} / {clock(LENGTH)}
            </span>
            <div className="lr-track">
              {film.map((one, i) => {
                const end = film[i + 1]?.at ?? LENGTH;
                const done = played
                  ? Math.min(1, Math.max(0, (time - one.at) / (end - one.at)))
                  : 0;
                return (
                  <button
                    type="button"
                    key={one.moment}
                    style={{ flexGrow: end - one.at }}
                    aria-label={`Go to ${one.moment}`}
                    onClick={() => show(one.moment)}
                  >
                    <span style={{ transform: `scaleX(${done})` }} />
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="lr-control"
              aria-label={muted ? "Unmute" : "Mute"}
              onClick={() => setMuted(!muted)}
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
          </div>
        </div>
        <aside className="lr-talk" aria-label="Conversation">
          <div className="pp-talk-thread" ref={thread}>
            <ol className="pp-chat">
              {said.map((line, i) =>
                line.author === "builder" ? (
                  <li className="pp-me" key={i}>
                    <p className="pp-bubble">{line.body}</p>
                  </li>
                ) : (
                  <li className="pp-it" key={i}>
                    <p className="pp-say">{line.body}</p>
                  </li>
                ),
              )}
              {words !== null && (
                <li className="pp-it">
                  <p className={words ? "pp-say" : "pp-say muted"}>
                    {words || "Thinking"}
                  </p>
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
          <div className="pp-asking">
            <form
              className="pp-input"
              onSubmit={(event) => {
                event.preventDefault();
                void send(text);
              }}
            >
              <textarea
                aria-label="Ask about this ticket"
                placeholder="Ask anything, or ask for a change…"
                rows={1}
                value={text}
                maxLength={TRY_WORDS}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey) return;
                  event.preventDefault();
                  void send(text);
                }}
              />
              <button
                type="submit"
                className="pp-go"
                aria-label="Send"
                aria-disabled={!text.trim() || words !== null}
              >
                <ArrowUp size={17} strokeWidth={2.2} />
              </button>
            </form>
          </div>
        </aside>
      </div>
      <div className="lr-foot">
        <FilesChanged
          count={first!.files!.count}
          add={first!.files!.add + changes * 3}
          del={first!.files!.del + changes}
        />
        {merged ? (
          cta
        ) : (
          <SlideGo
            label="Merge"
            prompt="Slide to merge"
            tone="dark"
            icon={<GitMerge size={15} aria-hidden="true" />}
            onGo={() => setMerged(true)}
          />
        )}
      </div>
    </section>
  );
  return (
    <div className="lp-dash lp-review">
      <div className="tix-list">
        <TicketGroup
          stage="review"
          label="To review"
          count={toReview.length - (merged ? 1 : 0)}
        >
          <TicketRow ticket={first!} opened merged={merged}>
            {room}
          </TicketRow>
          {others.map((ticket) => (
            <TicketRow ticket={ticket} key={ticket.number} />
          ))}
        </TicketGroup>
      </div>
    </div>
  );
}
