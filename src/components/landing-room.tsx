import {
  ArrowUp,
  FileText,
  GitMerge,
  GitPullRequest,
  Pause,
  Play,
  RotateCcw,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SlideGo } from "@/components/dashboard/slide-go";
import { useFlip } from "@/components/live";
import type { DraftLine } from "@/core/new-ticket";
import {
  changeLook,
  LOOK,
  readTags,
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

const film: { moment: Moment; at: number; say: string }[] = [
  { moment: "list", at: 0, say: "Nothing in this list says what comes first." },
  {
    moment: "form",
    at: 5,
    say: "A new task now asks for a priority. Normal, unless you pick another.",
  },
  { moment: "added", at: 11, say: "It lands in the list with its tag." },
  { moment: "sorted", at: 15, say: "Sorted, the urgent work comes first." },
];
const LENGTH = 20;
const rank: Record<Priority, number> = { urgent: 0, high: 1, normal: 2 };
const momentAt = (time: number) =>
  film.filter((step) => step.at <= time).at(-1) ?? film[0]!;
const clock = (time: number) =>
  `0:${String(Math.floor(time)).padStart(2, "0")}`;

/** The demo's small app, as it stands at a moment of the film. */
function TallyApp({ moment, look }: { moment: Moment; look: Look }) {
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
 * A ticket to review, the size of the real one: a drawn demo with its
 * controls, a real agent beside it that answers fast and moves the drawing
 * (`/try-agent`, tags in its words), and a slide that merges. Nothing else
 * is real: no repository behind it.
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
  const [text, setText] = useState("");
  const [enough, setEnough] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const now = useRef(LENGTH);
  const step = momentAt(time);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      now.current = Math.min(LENGTH, now.current + 0.1);
      setTime(now.current);
      if (now.current >= LENGTH) setPlaying(false);
    }, 100);
    return () => clearInterval(timer);
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

  const asked = said.length > 1;
  return (
    <section className="lr" aria-label="A sample ticket to review">
      <div className="lr-row">
        <GitPullRequest size={14} aria-hidden="true" />
        <span className="mono">#137</span>
        <b>Tasks need a priority</b>
        {merged && <span className="lr-state-merged">Merged</span>}
      </div>
      <div className="lr-meet">
        <div className="lr-film">
          <TallyApp moment={step.moment} look={look} />
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
          </div>
        </div>
        <div className="lr-talk">
          <div className="lr-thread" ref={thread}>
            {said.map((line, i) => (
              <p
                key={i}
                className={line.author === "builder" ? "lr-me" : undefined}
              >
                {line.body}
              </p>
            ))}
            {words !== null && (
              <p className={words ? undefined : "lr-thinking"}>
                {words || "Thinking"}
              </p>
            )}
            {enough && (
              <p>That is plenty for a sample. Try me on your own tickets.</p>
            )}
          </div>
          {!asked && (
            <div className="lr-asks">
              {[
                "Make urgent blue",
                "Hide what is done",
                "Why no tag on normal?",
              ].map((ask) => (
                <button type="button" key={ask} onClick={() => void send(ask)}>
                  {ask}
                </button>
              ))}
            </div>
          )}
          <form
            className="lr-box"
            onSubmit={(event) => {
              event.preventDefault();
              void send(text);
            }}
          >
            <input
              aria-label="Ask about this ticket"
              placeholder="Ask anything, or ask for a change…"
              value={text}
              maxLength={TRY_WORDS}
              onChange={(event) => setText(event.target.value)}
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!text.trim() || words !== null}
            >
              <ArrowUp size={15} />
            </button>
          </form>
        </div>
      </div>
      <div className="lr-foot">
        <span className="lr-files">
          <FileText size={14} aria-hidden="true" /> 6 files changed{" "}
          <b className="add">+{44 + changes * 3}</b>{" "}
          <b className="del">−{6 + changes}</b>
        </span>
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
}
