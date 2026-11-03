import {
  ChevronDown,
  ChevronRight,
  FileText,
  Github,
  Play,
} from "lucide-react";
import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { StageMark } from "@/components/dashboard/stage-mark";
import { askSample, SampleBox } from "@/components/landing-agent";
import { SampleRoom } from "@/components/landing-room";
import { Markdown } from "@/components/markdown";
import { ActivityList, type Crew } from "@/components/run-activity";
import { storyLines, type ActivityLine } from "@/core/activity";
import type { DraftLine } from "@/core/new-ticket";
import type { TicketStage } from "@/core/tickets";
import {
  readTicket,
  TRY_NOT_BUILT,
  TRY_TURNS,
  TRY_WORDS,
} from "@/core/try-ticket";

interface SampleTicket {
  number: number;
  title: string;
  who: string;
  when: string;
  work?: string;
}

interface WrittenTicket extends SampleTicket {
  asks: string;
}

interface ShippedTicket extends WrittenTicket {
  changed: string;
  /** What the reviewer says beside it. */
  reviewed: string;
  files: { count: number; add: number; del: number };
}

const crew: Crew = { implementer: "Claude Opus", reviewer: "GPT Astra" };

/** The ticket to review: the bench's real ticket, its film served with the site. */
const priority: SampleTicket = {
  number: 145,
  title: "Tasks need a priority",
  who: "Sam Okafor",
  when: "Nov 1, 09:12",
};

const filtering: WrittenTicket = {
  number: 147,
  title: "Filter tasks by due date",
  who: "Léa Martin",
  when: "Nov 1, 10:26",
  work: `${crew.implementer} is writing`,
  asks: `People plan their week from the list and can't narrow it down.

**Done when**
- The list filters by today, this week and overdue
- The filter is still there after a reload`,
};

const shipped: ShippedTicket[] = [
  {
    number: 143,
    title: "Comments on tasks",
    who: "Léa Martin",
    when: "Oct 30, 11:48",
    asks: `What is said about a task gets lost in chat.

**Done when**
- Anyone on the task can comment
- A mention sends an email`,
    changed:
      "Comments sit under each task, newest last. A mention sends one email, even when the comment is edited.",
    reviewed: "Merged on Oct 30.",
    files: { count: 11, add: 203, del: 9 },
  },
  {
    number: 141,
    title: "Search across projects",
    who: "Sam Okafor",
    when: "Oct 29, 17:22",
    asks: `Finding a task means opening each project.

**Done when**
- A search box sits in the header
- It looks through every project
- Archived tasks stay out`,
    changed:
      "A search box in the header looks through every project the person can see. Archived tasks stay out.",
    reviewed: "Merged on Oct 29.",
    files: { count: 7, add: 96, del: 12 },
  },
];

type WorkStep = [
  ActivityLine["actor"],
  ActivityLine["kind"],
  ActivityLine["detail"],
];

/** Steps as a run writes them, `gapMs` apart from `from`. */
const asActivity = (steps: WorkStep[], from: number, gapMs: number) =>
  steps.map(([actor, kind, detail], i): ActivityLine => ({
    externalId: String(i),
    at: new Date(from + i * gapMs).toISOString(),
    actor,
    kind,
    detail,
  }));

/** The activity of the ticket at work, so far. */
function workSoFar(): ActivityLine[] {
  const lines: WorkStep[] = [
    ["yarrow", "phase", { phase: "implementing" }],
    ["implementer", "read", { path: "src/views.js", ok: true }],
    ["implementer", "read", { path: "src/db.js", ok: true }],
    ["implementer", "search", { pattern: "due_on", ok: true }],
    [
      "implementer",
      "note",
      {
        text: "The list has no notion of a week yet: the filter goes in the query, so a reload keeps it.",
      },
    ],
    [
      "implementer",
      "edit",
      { path: "src/db.js", added: 14, removed: 3, ok: true },
    ],
    [
      "implementer",
      "edit",
      { path: "src/server.js", added: 9, removed: 1, ok: true },
    ],
    [
      "implementer",
      "edit",
      { path: "src/views.js", added: 26, removed: 4, ok: true },
    ],
  ];
  return asActivity(lines, Date.now() - lines.length * 40_000, 40_000);
}

/** The activity of the archive ticket: the real run's, from the start. */
function archiveWork(gapMs: number): ActivityLine[] {
  return asActivity(ARCHIVE_STEPS, Date.now(), gapMs);
}

const ARCHIVE_STEPS: WorkStep[] = [
  ["yarrow", "phase", { phase: "implementing" }],
  [
    "implementer",
    "edit",
    { path: "src/db.js", added: 15, removed: 7, ok: true },
  ],
  [
    "implementer",
    "write",
    { path: "db/migrations/004_archive.sql", lines: 2, ok: true },
  ],
  [
    "implementer",
    "edit",
    { path: "test/views.test.js", added: 25, removed: 1, ok: true },
  ],
  ["implementer", "test", { passed: 8, failed: 0, ok: true }],
  ["yarrow", "phase", { phase: "reviewing" }],
  ["reviewer", "review", { passed: 0, failed: 0 }],
  ["yarrow", "phase", { phase: "delivering" }],
  ["yarrow", "outcome", { phase: "pull_request" }],
];

function TicketNumber({ number }: { number: number }) {
  return (
    <span className="bd-num github">
      <span className="bd-source">
        <Github size={12} aria-hidden="true" />
      </span>
      #{number}
    </span>
  );
}

/** A group of the list, folded as the real one is. */
export function TicketGroup({
  stage,
  label,
  count,
  children,
}: {
  stage: TicketStage;
  label: string;
  count: number;
  children?: ReactNode;
}) {
  const [folded, setFolded] = useState(false);
  return (
    <section className="tix-group">
      <div className="tix-ghead">
        <button
          type="button"
          className="tix-gtoggle"
          aria-expanded={!folded}
          onClick={() => setFolded(!folded)}
        >
          <ChevronDown
            size={14}
            className={folded ? "tix-gchev folded" : "tix-gchev"}
            aria-hidden="true"
          />
          <StageMark stage={stage} />
          {label}
          <span className="tix-count">{count}</span>
        </button>
      </div>
      {!folded && Children.count(children) > 0 && (
        <ul className="tix-rows">{children}</ul>
      )}
    </section>
  );
}

/** A ticket at work, as the real one reads: the ticket, then the activity. */
function TicketAtWork({ ticket }: { ticket: WrittenTicket }) {
  const [lines] = useState(workSoFar);
  return (
    <div className="pp-grid">
      <section className="pp-main">
        <Markdown source={ticket.asks} />
      </section>
      <aside className="pp-aside">
        <section className="ra-story" aria-label="Activity">
          <ActivityList lines={storyLines(lines)} live crew={crew} />
        </section>
      </aside>
    </div>
  );
}

/** A ticket merged: what it asked and what came of it. */
function TicketShipped({ ticket }: { ticket: ShippedTicket }) {
  return (
    <div className="pp">
      <div className="pp-grid">
        <div className="pp-main">
          <section className="pp-section">
            <h3>What the ticket asks</h3>
            <Markdown source={ticket.asks} className="pp-text" />
          </section>
          <section className="pp-section">
            <h3>What changed</h3>
            <Markdown source={ticket.changed} className="pp-text" />
          </section>
        </div>
        <aside className="pp-aside">
          <p className="pp-say">{ticket.reviewed}</p>
          <span className="lp-files">
            <FileText size={14} aria-hidden="true" /> {ticket.files.count} files
            changed <b className="add">+{ticket.files.add}</b>{" "}
            <b className="del">−{ticket.files.del}</b>
          </span>
        </aside>
      </div>
    </div>
  );
}

/** A row of the list that opens on `children`. */
function TicketRow({
  ticket,
  opened = false,
  merged = false,
  children,
}: {
  ticket: SampleTicket;
  opened?: boolean;
  merged?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(opened);
  return (
    <li className={open ? "tix-item open" : "tix-item"}>
      <div className={open ? "tix-row open" : "tix-row"}>
        <button
          type="button"
          className="tix-open"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <ChevronRight size={14} className="tix-chev" aria-hidden="true" />
          <TicketNumber number={ticket.number} />
          <span className="tix-title">{ticket.title}</span>
        </button>
        <span className="tix-meta">
          <span className="tix-cell">
            {ticket.work && (
              <TextShimmer className="tix-state working">
                {ticket.work}
              </TextShimmer>
            )}
            {merged && <span className="lp-merged">Merged</span>}
          </span>
          <span className="tix-sponsor">
            <span className="tix-paid">Created by</span>
            <span>{ticket.who}</span>
          </span>
          <span className="tix-date">{ticket.when}</span>
        </span>
      </div>
      {open && (
        <div className="tix-opened">
          <div className="tix-card">{children}</div>
        </div>
      )}
    </li>
  );
}

/**
 * A project's tickets, on the dashboard's own styles: they open, and the one
 * to review stands open, the first thing the page shows.
 */
export function DashboardShot({ cta }: { cta: ReactNode }) {
  const [merged, setMerged] = useState(false);
  return (
    <div className="tix-list glass lp-dash">
      <TicketGroup stage="review" label="To review" count={merged ? 0 : 1}>
        <TicketRow ticket={priority} merged={merged} opened>
          <SampleRoom
            sample="priority"
            cta={cta}
            merged={merged}
            onMerged={() => setMerged(true)}
          />
        </TicketRow>
      </TicketGroup>
      <TicketGroup stage="progress" label="In progress" count={1}>
        <TicketRow ticket={filtering}>
          <TicketAtWork ticket={filtering} />
        </TicketRow>
      </TicketGroup>
      <TicketGroup stage="stopped" label="Stopped" count={0} />
      <TicketGroup
        stage="done"
        label="Done"
        count={shipped.length + (merged ? 1 : 0)}
      >
        {shipped.map((ticket) => (
          <TicketRow ticket={ticket} key={ticket.number}>
            <TicketShipped ticket={ticket} />
          </TicketRow>
        ))}
      </TicketGroup>
    </div>
  );
}

const IDEA = "We need a way to archive old tasks";
const LINE_MS = 800;
const WORK = [
  `${crew.implementer} is writing`,
  `${crew.reviewer} is reviewing`,
  "Opening the PR",
];

/** What the section says as the ticket goes. */
const TELLS: Record<Phase, { title: [string, string]; says: string }> = {
  write: {
    title: ["Write your tickets", "with our agents"],
    says: "Bring a rough idea. Think it through with the agent, push back, change your mind. When it feels right the ticket is written.",
  },
  work: {
    title: ["Our agents take it", "from there"],
    says: "One builds it, another checks the work. Follow every step or come back when it is ready.",
  },
  review: {
    title: ["See a live demo", "before you merge"],
    says: "Every ticket comes back with a demo. Ask anything, ask for a change and merge when it looks right.",
  },
};

type Phase = "write" | "work" | "review";

interface Drafted {
  number: number;
  title: string;
  /** Written from the idea the film answers: anything else gets told so. */
  sample?: boolean;
}

/** A ticket on the board beside the dialog, its state under it. */
function BoardRow({
  ticket,
  state,
  fresh = false,
}: {
  ticket: Drafted;
  state?: string;
  fresh?: boolean;
}) {
  return (
    <li className={fresh ? "lp-board-row fresh" : "lp-board-row"}>
      <TicketNumber number={ticket.number} />
      <span className="tix-title">{ticket.title}</span>
      {state && (
        <TextShimmer className="tix-state working">{state}</TextShimmer>
      )}
    </li>
  );
}

function BoardGroup({
  stage,
  label,
  count,
  children,
}: {
  stage: TicketStage;
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="tix-ghead">
        <span className="tix-gtoggle">
          <ChevronDown size={14} className="tix-gchev" aria-hidden="true" />
          <StageMark stage={stage} />
          {label}
          <span className="tix-count">{count}</span>
        </span>
      </div>
      <ul className="lp-board-rows">{children}</ul>
    </section>
  );
}

/**
 * The ticket's way through Yarrow, told in one place: the real new ticket
 * dialog over the board, a rough idea ready in the box, a real agent writing
 * into the form as it answers. Start sends it In progress, the dialog turning
 * into its activity, then To review, into the real room on a real run's film.
 * Merging starts over.
 */
export function TicketSection({ cta }: { cta: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("write");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [said, setSaid] = useState<DraftLine[]>([]);
  const [words, setWords] = useState<string | null>(null);
  const [text, setText] = useState(IDEA);
  const [enough, setEnough] = useState(false);
  const [made, setMade] = useState(0);
  const [ticket, setTicket] = useState<Drafted | null>(null);
  const [lines, setLines] = useState<ActivityLine[]>([]);
  const [seen, setSeen] = useState(0);
  const [done, setDone] = useState<Drafted[]>([]);
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (phase !== "work") return;
    const timer = setTimeout(() => {
      if (seen < lines.length) setSeen(seen + 1);
      else setPhase("review");
    }, LINE_MS);
    return () => clearTimeout(timer);
  }, [phase, seen, lines]);

  useEffect(() => {
    const box = thread.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [said, words, seen]);

  async function send() {
    const line = text.trim().slice(0, TRY_WORDS);
    if (!line || words !== null) return;
    setText("");
    const lines: DraftLine[] = [...said, { author: "builder", body: line }];
    setSaid(lines);
    if (lines.filter((one) => one.author === "builder").length > TRY_TURNS) {
      setEnough(true);
      return;
    }
    setWords("");
    let answer = "";
    try {
      const answered = await askSample(
        { kind: "ticket", said: lines, title, body },
        (raw) => {
          const read = readTicket(raw);
          if (read.ticket) {
            setTitle(read.ticket.title);
            setBody(read.ticket.body);
          }
          answer = read.words;
          setWords(read.words);
        },
      );
      if (!answered) {
        setEnough(true);
        return;
      }
      const words = answer;
      setSaid((all) => [
        ...all,
        { author: "agent", body: words || "Written. Ready to start." },
      ]);
    } catch {
      setSaid((all) => [
        ...all,
        { author: "agent", body: "I lost my words there. Try again." },
      ]);
    } finally {
      setWords(null);
    }
  }

  const name = title.trim();
  const start = () => {
    if (!name || words !== null) return;
    setTicket({
      number: 149 + made,
      title: name,
      sample: said[0]?.body === IDEA,
    });
    setMade(made + 1);
    setLines(archiveWork(LINE_MS));
    setSeen(1);
    setPhase("work");
  };
  const merged = () => {
    if (ticket) setDone((all) => [ticket, ...all].slice(0, 2));
    setTicket(null);
    setTitle("");
    setBody("");
    setSaid([]);
    setText(IDEA);
    setEnough(false);
    setPhase("write");
  };

  const tell = TELLS[phase];
  const where = (
    <div className="nt-head">
      <span className="nt-where">
        <Github size={14} aria-hidden="true" /> GitHub
      </span>
      <ChevronRight size={13} className="nt-sep" aria-hidden="true" />
      <span className="nt-crumb">Acme</span>
    </div>
  );
  return (
    <section className="lp-part">
      <div className="container lp-part-head" key={phase}>
        <h2>
          {tell.title[0]}
          <br />
          {tell.title[1]}
        </h2>
        <p>{tell.says}</p>
      </div>
      <div className="container">
        <div className="lp-compose">
          <div className="lp-flow" aria-live="polite">
            <BoardGroup
              stage="progress"
              label="In progress"
              count={phase === "work" ? 2 : 1}
            >
              {phase === "work" && ticket && (
                <BoardRow
                  ticket={ticket}
                  state={
                    WORK[
                      Math.min(
                        WORK.length - 1,
                        Math.floor((seen / lines.length) * WORK.length),
                      )
                    ]
                  }
                  fresh
                />
              )}
              <BoardRow ticket={filtering} state={filtering.work} />
            </BoardGroup>
            <BoardGroup
              stage="review"
              label="To review"
              count={phase === "review" ? 2 : 1}
            >
              {phase === "review" && ticket && (
                <BoardRow ticket={ticket} fresh />
              )}
              <BoardRow ticket={priority} />
            </BoardGroup>
            {done.length > 0 && (
              <BoardGroup stage="done" label="Done" count={done.length}>
                {done.map((one) => (
                  <BoardRow ticket={one} key={one.number} fresh />
                ))}
              </BoardGroup>
            )}
          </div>
          {phase === "review" ? (
            <div className="lp-reviewing">
              <SampleRoom
                sample="archive"
                lead={ticket?.sample ? undefined : TRY_NOT_BUILT}
                cta={cta}
                merged={false}
                onMerged={merged}
              />
            </div>
          ) : (
            <div
              className="nt nt-agent lp-modal"
              role="group"
              aria-label="New ticket"
            >
              {phase === "work" ? (
                <>
                  <div className="nt-card">
                    {where}
                    <p className="nt-title">{name}</p>
                    <Markdown source={body} className="nt-body" />
                  </div>
                  <section
                    className="nt-talk lp-activity"
                    aria-label="Activity"
                    ref={thread}
                  >
                    <ActivityList
                      lines={storyLines(lines.slice(0, seen))}
                      live
                      crew={crew}
                    />
                  </section>
                </>
              ) : (
                <>
                  <form
                    className="nt-card"
                    onSubmit={(event) => {
                      event.preventDefault();
                      start();
                    }}
                  >
                    {where}
                    <input
                      className="nt-title"
                      aria-label="Title"
                      placeholder="Ticket title"
                      value={title}
                      maxLength={120}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                    <textarea
                      className="nt-body"
                      aria-label="Description"
                      placeholder="Description, in Markdown"
                      value={body}
                      maxLength={1500}
                      onChange={(event) => setBody(event.target.value)}
                    />
                    <div className="nt-foot">
                      <button
                        type="submit"
                        className="tix-btn tix-btn-amber"
                        disabled={!name || words !== null}
                      >
                        <Play
                          size={11}
                          fill="currentColor"
                          aria-hidden="true"
                        />
                        Start
                      </button>
                    </div>
                  </form>
                  <section className="nt-talk" aria-label="The agent">
                    <div className="pp-talk-thread" ref={thread}>
                      <ol className="pp-chat">
                        <li className="pp-it">
                          <p className="pp-say">What are we building?</p>
                        </li>
                        {said.map((line, i) =>
                          line.author === "builder" ? (
                            <li className="pp-me" key={i}>
                              <p className="pp-bubble">{line.body}</p>
                            </li>
                          ) : (
                            <li className="pp-it" key={i}>
                              <Markdown source={line.body} className="pp-say" />
                            </li>
                          ),
                        )}
                        {words !== null && (
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
                        {enough && (
                          <li className="pp-it">
                            <p className="pp-say">
                              That is plenty for a sample. Try me on your own
                              tickets.
                            </p>
                          </li>
                        )}
                      </ol>
                    </div>
                    <SampleBox
                      label="Tell the agent what you want"
                      placeholder="Tell the agent what you want…"
                      text={text}
                      onText={setText}
                      onSend={() => void send()}
                      waiting={words !== null}
                    />
                  </section>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
