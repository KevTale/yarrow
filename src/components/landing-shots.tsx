import { ChevronDown, ChevronRight, Github, Play, Ticket } from "lucide-react";
import { useReducedMotion } from "motion/react";
import {
  Children,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { SlideGo } from "@/components/dashboard/slide-go";
import { StageMark } from "@/components/dashboard/stage-mark";
import { TicketBody } from "@/components/dashboard/ticket-body";
import { TicketReady } from "@/components/dashboard/ticket-ready";
import { askSample, SampleBox } from "@/components/landing-agent";
import {
  SampleRoom,
  type RoomChat,
  type RoomLine,
} from "@/components/landing-room";
import { useFlip } from "@/components/live";
import { Markdown } from "@/components/markdown";
import { ActivityList, type Crew } from "@/components/run-activity";
import { clockTime } from "@/components/ui";
import { storyLines, type ActivityLine } from "@/core/activity";
import { asksBack, type DraftLine } from "@/core/new-ticket";
import { firstSentence } from "@/core/pull-notes";
import type { TicketStage } from "@/core/tickets";
import {
  readTicket,
  TRY_NOT_BUILT,
  TRY_SAMPLES,
  TRY_TURNS,
  TRY_WORDS,
  type TrySampleName,
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

const crew: Crew = { implementer: "Muse Wonder", reviewer: "Claude Opus" };

/** Where a ticket of the first list stands. */
type ListStage = Extract<TicketStage, "todo" | "review" | "progress" | "done">;

interface ListTicket extends WrittenTicket {
  stage: ListStage;
  /** The film its room opens on. */
  sample: TrySampleName;
  /** Said first in its room: a ticket written here gets another's film. */
  lead?: string;
}

/** A bench ticket as the list holds it, its film served with the site. */
function benchTicket(
  sample: TrySampleName,
  stage: ListStage,
  ticket: Pick<SampleTicket, "number" | "who" | "when">,
): ListTicket {
  const { ticket: text } = TRY_SAMPLES[sample];
  const title = firstSentence(text);
  return {
    ...ticket,
    title,
    asks: text.slice(title.length + 2),
    stage,
    sample,
  };
}

/** The ticket that stands open as the page loads. */
const FIRST_OPEN = 145;

const BOARD: ListTicket[] = [
  benchTicket("filter", "todo", {
    number: 147,
    who: "Léa Martin",
    when: "Nov 1, 10:26",
  }),
  benchTicket("priority", "review", {
    number: FIRST_OPEN,
    who: "Sam Okafor",
    when: "Nov 1, 09:12",
  }),
];

const STAGES: { stage: ListStage; label: string }[] = [
  { stage: "todo", label: "To do" },
  { stage: "review", label: "To review" },
  { stage: "progress", label: "In progress" },
  { stage: "done", label: "Done" },
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

/** The activity of the archive ticket: the real run's, from the start. */
function archiveWork(gapMs: number): ActivityLine[] {
  return asActivity(ARCHIVE_STEPS, Date.now(), gapMs);
}

/** A ticket started on the first list: the filter run's, from the start. */
const filterWork = (gapMs: number) =>
  asActivity(FILTER_STEPS, Date.now(), gapMs);

const FILTER_STEPS: WorkStep[] = [
  ["yarrow", "phase", { phase: "implementing" }],
  ["implementer", "read", { path: "src/views.js", ok: true }],
  ["implementer", "read", { path: "src/server.js", ok: true }],
  [
    "implementer",
    "edit",
    { path: "src/views.js", added: 16, removed: 3, ok: true },
  ],
  [
    "implementer",
    "edit",
    { path: "src/server.js", added: 1, removed: 1, ok: true },
  ],
  [
    "implementer",
    "edit",
    { path: "public/style.css", added: 20, removed: 0, ok: true },
  ],
  [
    "implementer",
    "edit",
    { path: "test/views.test.js", added: 26, removed: 0, ok: true },
  ],
  ["implementer", "test", { passed: 8, failed: 0, ok: true }],
  ["yarrow", "phase", { phase: "reviewing" }],
  ["reviewer", "review", { passed: 0, failed: 0 }],
  ["yarrow", "phase", { phase: "delivering" }],
  ["yarrow", "outcome", { phase: "pull_request" }],
];

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
  holdsOpen = false,
  children,
}: {
  stage: TicketStage;
  label: string;
  count: number;
  /** The row open is here now: the group unfolds, so it stays in view. */
  holdsOpen?: boolean;
  children?: ReactNode;
}) {
  const [folded, setFolded] = useState(false);
  const [held, setHeld] = useState(holdsOpen);
  if (held !== holdsOpen) {
    setHeld(holdsOpen);
    if (holdsOpen) setFolded(false);
  }
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
function TicketAtWork({
  asks,
  lines,
  live = true,
}: {
  asks: string;
  lines: ActivityLine[];
  live?: boolean;
}) {
  return (
    <div className="pp-grid lp-work">
      <section className="pp-main">
        <Markdown source={asks} />
      </section>
      <aside className="pp-aside">
        <section className="ra-story" aria-label="Activity">
          <ActivityList lines={storyLines(lines)} live={live} crew={crew} />
        </section>
      </aside>
    </div>
  );
}

/** A row of the list that opens on `children`. */
function TicketRow({
  ticket,
  opened = false,
  open: held,
  onToggle,
  stage,
  note,
  go,
  children,
}: {
  ticket: SampleTicket;
  opened?: boolean;
  /** Open as the list says, when it keeps one open at a time. */
  open?: boolean;
  onToggle?: () => void;
  stage?: ListStage;
  /** Where it ended up, in place of its state. */
  note?: string;
  /** What to do with it now, on its line. */
  go?: ReactNode;
  children: ReactNode;
}) {
  const [own, setOwn] = useState(opened);
  const open = held ?? own;
  return (
    <li className={open ? "tix-item open" : "tix-item"}>
      <div
        data-flip={ticket.number}
        data-flip-value={stage}
        className={open ? "tix-row open" : "tix-row"}
      >
        <button
          type="button"
          className="tix-open"
          aria-expanded={open}
          onClick={onToggle ?? (() => setOwn(!own))}
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
            {note && <span className="lp-merged">{note}</span>}
            {go}
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

/** What is at work on a ticket, `seen` of its `total` steps in. */
const workAt = (seen: number, total: number) =>
  WORK[
    Math.min(
      WORK.length - 1,
      Math.floor((seen / Math.max(total, 1)) * WORK.length),
    )
  ];

/** A ticket started on the first list: its run's steps, then To review. */
function RowAtWork({
  ticket,
  open,
  onToggle,
  onBuilt,
}: {
  ticket: ListTicket;
  open: boolean;
  onToggle: () => void;
  onBuilt: (number: number) => void;
}) {
  const [lines] = useState(() => filterWork(STEP_MS));
  const [seen, setSeen] = useState(1);
  useEffect(() => {
    const timer = setTimeout(
      () => (seen < lines.length ? setSeen(seen + 1) : onBuilt(ticket.number)),
      STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [seen, lines, ticket.number, onBuilt]);
  return (
    <TicketRow
      ticket={{ ...ticket, work: workAt(seen, lines.length) }}
      stage={ticket.stage}
      open={open}
      onToggle={onToggle}
    >
      <TicketAtWork asks={ticket.asks} lines={lines.slice(0, seen)} />
    </TicketRow>
  );
}

/**
 * A project's tickets, on the dashboard's own styles, the whole way through:
 * one to review stands open, the first thing the page shows, and merges to
 * Done; one to do starts, works in front of the visitor, comes back on its film
 * and merges in turn; what the agent proposes in a room is created in To do.
 * One row open at a time, as on the real list.
 */
export function DashboardShot({ cta }: { cta: ReactNode }) {
  const reduced = useReducedMotion();
  const [tickets, setTickets] = useState(BOARD);
  const [opened, setOpened] = useState<number | null>(FIRST_OPEN);
  const [chats, setChats] = useState<Record<number, RoomLine[]>>({});
  const [follow, setFollow] = useState<{ number: number } | null>(null);
  const list = useFlip<HTMLDivElement>(tickets);

  const moveTo = useCallback(
    (number: number, stage: ListStage) =>
      setTickets((all) =>
        all.map((ticket) =>
          ticket.number === number ? { ...ticket, stage } : ticket,
        ),
      ),
    [],
  );
  // Built with the visitor watching: it stays in view on its way up.
  const toReview = useCallback(
    (number: number) => {
      const box = list.current
        ?.querySelector(`[data-flip="${number}"]`)
        ?.getBoundingClientRect();
      moveTo(number, "review");
      if (box && box.bottom > 0 && box.top < window.innerHeight)
        setFollow({ number });
    },
    [list, moveTo],
  );

  // The row an act just moved stays in view, whatever folded above it.
  useEffect(() => {
    if (!follow) return;
    list.current
      ?.querySelector(`[data-flip="${follow.number}"]`)
      ?.closest(".tix-item")
      ?.scrollIntoView({
        block: "nearest",
        behavior: reduced ? "auto" : "smooth",
      });
  }, [follow, list, reduced]);

  const start = (number: number) => {
    moveTo(number, "progress");
    setOpened(number);
    setFollow({ number });
  };
  const merge = (number: number) => {
    moveTo(number, "done");
    setOpened(null);
    setFollow({ number });
  };
  const createTicket = (title: string, asks: string) => {
    const number = Math.max(...tickets.map((ticket) => ticket.number)) + 1;
    setTickets((all) => [
      ...all,
      {
        number,
        title,
        who: "You",
        when: today(),
        asks,
        stage: "todo",
        sample: "filter",
        lead: TRY_NOT_BUILT,
      },
    ]);
    setFollow({ number });
    return number;
  };
  const openTicket = (number: number) => {
    setOpened(number);
    setFollow({ number });
  };

  const chatOf = (number: number): RoomChat => [
    chats[number] ?? [],
    (next) =>
      setChats((all) => {
        const now = all[number] ?? [];
        return {
          ...all,
          [number]: typeof next === "function" ? next(now) : next,
        };
      }),
  ];

  const row = (ticket: ListTicket) => {
    const { number, stage } = ticket;
    const open = opened === number;
    const onToggle = () => setOpened(open ? null : number);
    if (stage === "progress")
      return (
        <RowAtWork
          key={number}
          ticket={ticket}
          open={open}
          onToggle={onToggle}
          onBuilt={toReview}
        />
      );
    if (stage === "todo")
      return (
        <TicketRow
          key={number}
          ticket={ticket}
          stage={stage}
          open={open}
          onToggle={onToggle}
          go={
            <SlideGo
              label="Start"
              icon={<Play size={10} fill="currentColor" aria-hidden="true" />}
              onGo={() => start(number)}
            />
          }
        >
          <section className="pp-main">
            <Markdown source={ticket.asks} />
          </section>
        </TicketRow>
      );
    return (
      <TicketRow
        key={number}
        ticket={ticket}
        stage={stage}
        open={open}
        onToggle={onToggle}
        note={stage === "done" ? "Merged" : undefined}
      >
        <SampleRoom
          sample={ticket.sample}
          lead={ticket.lead}
          cta={cta}
          merged={stage === "done"}
          onMerged={() => merge(number)}
          chat={chatOf(number)}
          onTicket={createTicket}
          onOpenTicket={openTicket}
        />
      </TicketRow>
    );
  };

  return (
    <div className="tix-list glass lp-dash" ref={list}>
      {STAGES.map(({ stage, label }) => {
        const here = tickets
          .filter((ticket) => ticket.stage === stage)
          .sort((a, b) => b.number - a.number);
        return (
          <TicketGroup
            key={stage}
            stage={stage}
            label={label}
            count={here.length}
            holdsOpen={here.some((ticket) => ticket.number === opened)}
          >
            {here.map(row)}
          </TicketGroup>
        );
      })}
    </div>
  );
}

const IDEA = "We need a way to archive old tasks";
const LINE_MS = 800;
/** A step of a ticket at work on the first list: ten seconds in all. */
const STEP_MS = 10_000 / FILTER_STEPS.length;
const WORK = [
  `${crew.implementer} is writing`,
  `${crew.reviewer} is reviewing`,
  "Opening the PR",
];

/** What each step says. */
const TELLS: Record<Step, { title: [string, string]; says: string }> = {
  write: {
    title: ["1. Write your tickets", "with our agents"],
    says: "Bring a rough idea. Think it through with the agent, push back, change your mind. When it feels right the ticket is written.",
  },
  work: {
    title: ["2. Our agents take it", "from there"],
    says: "One builds it, another checks the work. Follow every step or come back when it is ready.",
  },
  review: {
    title: ["3. See a live demo", "before you merge"],
    says: "Every ticket comes back with a demo. Ask anything, ask for a change and merge when it looks right.",
  },
};

type Step = "write" | "work" | "review";

interface Drafted extends WrittenTicket {
  /** Written from the idea the film answers: anything else gets told so. */
  sample?: boolean;
}

const archiveTitle = firstSentence(TRY_SAMPLES.archive.ticket);
/** The film's own ticket, at work for whoever sent none. */
const SAMPLE: Drafted = {
  number: 149,
  title: archiveTitle,
  who: "Léa Martin",
  when: "Nov 1, 11:40",
  asks: TRY_SAMPLES.archive.ticket.slice(archiveTitle.length + 2),
  sample: true,
};

const today = () => {
  const now = new Date();
  const day = now.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  return `${day}, ${clockTime(now)}`;
};

function StepHead({ step }: { step: Step }) {
  const { title, says } = TELLS[step];
  return (
    <div className="container lp-part-head">
      <h2>
        {title[0]}
        <br />
        {title[1]}
      </h2>
      <p>{says}</p>
    </div>
  );
}

/**
 * A ticket's way through Yarrow, in three steps taken at the visitor's pace.
 * The real new ticket dialog, a rough idea ready in the box, a real agent
 * writing into the form and offering to start it; the list's In progress with
 * that ticket open, a real run's activity starting as it comes into view, on
 * the film's own ticket for whoever sent none; To review with it open on the
 * real room, on that run's film.
 */
export function TicketSteps({ cta }: { cta: ReactNode }) {
  const reduced = useReducedMotion();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [said, setSaid] = useState<DraftLine[]>([]);
  const [words, setWords] = useState<string | null>(null);
  const [text, setText] = useState(IDEA);
  const [enough, setEnough] = useState(false);
  const [made, setMade] = useState(0);
  const [ticket, setTicket] = useState(SAMPLE);
  const [lines, setLines] = useState<ActivityLine[]>([]);
  const [seen, setSeen] = useState(0);
  const [merged, setMerged] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const work = useRef<HTMLElement>(null);

  useEffect(() => {
    const step = work.current;
    if (!step) return;
    const watch = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        watch.disconnect();
        setLines((now) => (now.length ? now : archiveWork(LINE_MS)));
        setSeen((now) => now || 1);
      },
      { threshold: 0.4 },
    );
    watch.observe(step);
    return () => watch.disconnect();
  }, []);

  useEffect(() => {
    if (seen === 0 || seen >= lines.length) return;
    const timer = setTimeout(() => setSeen(seen + 1), LINE_MS);
    return () => clearTimeout(timer);
  }, [seen, lines]);

  useEffect(() => {
    const box = thread.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [said, words]);

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

  const toWork = () =>
    work.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth" });
  const name = title.trim();
  const start = () => {
    setTicket({
      number: 150 + made,
      title: name,
      who: "You",
      when: today(),
      asks: body,
      sample: said[0]?.body === IDEA,
    });
    setMade(made + 1);
    setMerged(false);
    setLines(archiveWork(LINE_MS));
    setSeen(1);
    toWork();
  };

  const last = said.at(-1);
  const started =
    ticket !== SAMPLE && ticket.title === name && ticket.asks === body;
  const ready =
    Boolean(name) &&
    words === null &&
    (enough || (last?.author === "agent" && !asksBack(last.body)));
  const built = seen > 0 && seen >= lines.length;
  const state = workAt(seen, lines.length);
  return (
    <>
      <section className="lp-part">
        <StepHead step="write" />
        <div className="container">
          <div
            className="nt nt-agent lp-modal"
            role="group"
            aria-label="New ticket"
          >
            <div className="nt-card">
              <input
                className="nt-title"
                aria-label="Title"
                placeholder="Ticket title"
                value={title}
                maxLength={120}
                onChange={(event) => setTitle(event.target.value)}
              />
              <TicketBody value={body} maxLength={1500} onChange={setBody} />
            </div>
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
                        That is plenty for a sample. Try me on your own tickets.
                      </p>
                    </li>
                  )}
                  {ready && (
                    <li className="pp-it">
                      {started ? (
                        <button
                          type="button"
                          className="pp-act pp-ticket-made"
                          onClick={toWork}
                        >
                          <Ticket size={15} aria-hidden="true" />
                          <span>{ticket.title}</span>
                          <small>#{ticket.number}</small>
                        </button>
                      ) : (
                        <TicketReady
                          title={name}
                          label="Start the ticket"
                          onGo={start}
                        />
                      )}
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
          </div>
        </div>
      </section>
      <section className="lp-part" ref={work}>
        <StepHead step="work" />
        <div className="container">
          <div className="tix-list glass lp-dash">
            <TicketGroup stage="progress" label="In progress" count={1}>
              <TicketRow
                ticket={{ ...ticket, work: built ? undefined : state }}
                note={built ? "Ready to review" : undefined}
                opened
              >
                <TicketAtWork
                  asks={ticket.asks}
                  lines={lines.slice(0, seen)}
                  live={!built}
                />
              </TicketRow>
            </TicketGroup>
          </div>
        </div>
      </section>
      <section className="lp-part">
        <StepHead step="review" />
        <div className="container">
          <div className="tix-list glass lp-dash">
            <TicketGroup
              stage="review"
              label="To review"
              count={merged ? 0 : 1}
            >
              <TicketRow
                ticket={ticket}
                note={merged ? "Merged" : undefined}
                opened
              >
                <SampleRoom
                  key={ticket.number}
                  sample="archive"
                  lead={ticket.sample ? undefined : TRY_NOT_BUILT}
                  cta={cta}
                  merged={merged}
                  onMerged={() => setMerged(true)}
                />
              </TicketRow>
            </TicketGroup>
          </div>
        </div>
      </section>
    </>
  );
}
