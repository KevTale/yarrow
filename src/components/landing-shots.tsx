import {
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Github,
  Play,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { StageMark } from "@/components/dashboard/stage-mark";
import { Markdown } from "@/components/markdown";
import type { TicketStage } from "@/core/tickets";

export interface SampleTicket {
  number: number;
  title: string;
  who: string;
  when: string;
  work?: string;
  asks: string;
  changed?: string;
  /** What the reviewer says beside it. */
  reviewed?: string;
  files?: { count: number; add: number; del: number };
}

export const toReview: SampleTicket[] = [
  {
    number: 137,
    title: "Tasks need a priority",
    who: "Sam Okafor",
    when: "Nov 1, 09:12",
    asks: `People can't tell what matters first in a long list.

**Done when**
- A task can be urgent, high, normal or low
- The list can be sorted by priority
- Existing tasks stay normal`,
    changed:
      "A priority column, normal by default, so existing tasks stay normal. The new task form has a picker and the list a sort. Urgent and high show a tag, normal shows nothing so the list stays quiet.",
    reviewed:
      "I added a task of each priority and sorted the list. Nothing to change.",
    files: { count: 6, add: 44, del: 6 },
  },
  {
    number: 134,
    title: "Export tasks as CSV",
    who: "Léa Martin",
    when: "Oct 31, 18:40",
    asks: `Teams copy their tasks into a spreadsheet by hand every Friday.

**Done when**
- An Export button sits above the list
- The file follows the filters on screen
- A comma in a title stays in its column`,
    changed:
      "Export sits above the list and downloads what the filters show. Titles are quoted, so a comma stays in its column.",
    reviewed:
      "I exported 2,000 tasks in under a second. Dates are in UTC, you may want them in the viewer's time zone.",
    files: { count: 4, add: 71, del: 2 },
  },
  {
    number: 131,
    title: "Invite a teammate by link",
    who: "Sam Okafor",
    when: "Oct 31, 16:05",
    asks: `Inviting someone takes an email and a wait.

**Done when**
- Settings shows a link to copy
- The link lasts seven days
- It can be revoked`,
    changed:
      "Settings has an invite link that lasts seven days. Revoking makes a new one, and an old one says it expired.",
    reviewed:
      "I opened an expired link in a private window and got the right page. Nothing to change.",
    files: { count: 9, add: 128, del: 14 },
  },
];

const groups: { stage: TicketStage; label: string; rows: SampleTicket[] }[] = [
  { stage: "review", label: "To review", rows: toReview },
  {
    stage: "progress",
    label: "In progress",
    rows: [
      {
        number: 139,
        title: "Filter tasks by due date",
        who: "Léa Martin",
        when: "Nov 1, 10:26",
        work: "Writing the code",
        asks: `People plan their week from the list and can't narrow it down.

**Done when**
- The list filters by today, this week and overdue
- The filter is still there after a reload`,
      },
    ],
  },
  { stage: "stopped", label: "Stopped", rows: [] },
  {
    stage: "done",
    label: "Done",
    rows: [
      {
        number: 129,
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
        number: 126,
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
      {
        number: 124,
        title: "Dark theme",
        who: "Léa Martin",
        when: "Oct 29, 09:31",
        asks: `The app is hard on the eyes at night.

**Done when**
- It follows the system setting
- It can be set by hand`,
        changed:
          "Colors moved to variables. The theme follows the system and can be set by hand in settings.",
        reviewed: "Merged on Oct 29.",
        files: { count: 23, add: 310, del: 287 },
      },
      {
        number: 121,
        title: "Keyboard shortcuts",
        who: "Sam Okafor",
        when: "Oct 28, 15:03",
        asks: `Some people never want to leave the keyboard.

**Done when**
- N opens a new task
- / goes to search
- ? lists the shortcuts`,
        changed:
          "N, / and ? work anywhere except inside a text field. The list of shortcuts opens with ?.",
        reviewed: "Merged on Oct 28.",
        files: { count: 3, add: 58, del: 1 },
      },
    ],
  },
];

const shipped = groups.at(-1)!.rows;

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

function GroupHead({
  stage,
  label,
  count,
}: {
  stage: TicketStage;
  label: string;
  count: number;
}) {
  return (
    <div className="tix-ghead">
      <span className="tix-gtoggle">
        <ChevronDown size={14} className="tix-gchev" aria-hidden="true" />
        <StageMark stage={stage} />
        {label}
        <span className="tix-count">{count}</span>
      </span>
    </div>
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
  children?: React.ReactNode;
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
      {!folded && count > 0 && <ul className="tix-rows">{children}</ul>}
    </section>
  );
}

export function FilesChanged({
  count,
  add,
  del,
}: NonNullable<SampleTicket["files"]>) {
  return (
    <span className="lr-files">
      <FileText size={14} aria-hidden="true" /> {count} files changed{" "}
      <b className="add">+{add}</b> <b className="del">−{del}</b>
    </span>
  );
}

const STEPS = [
  "Reading the code",
  "Writing the change",
  "Reviewing it",
  "Recording the demo",
];

function Steps({ at }: { at: number }) {
  return (
    <ol className="lp-steps">
      {STEPS.map((label, index) => (
        <li
          key={label}
          className={index < at ? "done" : index === at ? "now" : undefined}
        >
          <i aria-hidden="true">
            {index < at && <Check size={11} strokeWidth={3} />}
          </i>
          {index === at ? <TextShimmer>{label}</TextShimmer> : label}
        </li>
      ))}
    </ol>
  );
}

function TicketInside({ ticket }: { ticket: SampleTicket }) {
  return (
    <div className="pp">
      <div className="pp-grid">
        <div className="pp-main">
          <section className="pp-section">
            <h3>What the ticket asks</h3>
            <Markdown source={ticket.asks} className="pp-text" />
          </section>
          {ticket.changed && (
            <section className="pp-section">
              <h3>What changed</h3>
              <Markdown source={ticket.changed} className="pp-text" />
            </section>
          )}
        </div>
        <aside className="pp-aside">
          {ticket.work ? (
            <Steps at={1} />
          ) : (
            <p className="pp-say">{ticket.reviewed}</p>
          )}
          {ticket.files && <FilesChanged {...ticket.files} />}
        </aside>
      </div>
    </div>
  );
}

/** A row of the list that opens; `children` take the place of its text. */
export function TicketRow({
  ticket,
  opened = false,
  merged = false,
  children,
}: {
  ticket: SampleTicket;
  opened?: boolean;
  merged?: boolean;
  children?: React.ReactNode;
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
            {merged && <span className="lr-state-merged">Merged</span>}
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
          <div className="tix-card">
            {children ?? <TicketInside ticket={ticket} />}
          </div>
        </div>
      )}
    </li>
  );
}

/** A project's tickets, on the dashboard's own styles: they open. */
export function DashboardShot() {
  return (
    <div className="lp-dash">
      <div className="lp-dash-head">
        <b>Acme</b>
        <span className="lp-dash-search">
          <Search size={13} aria-hidden="true" /> Search tickets
        </span>
      </div>
      <div className="tix-list">
        {groups.map((group) => (
          <TicketGroup
            key={group.stage}
            stage={group.stage}
            label={group.label}
            count={group.rows.length}
          >
            {group.rows.map((row) => (
              <TicketRow ticket={row} key={row.number} />
            ))}
          </TicketGroup>
        ))}
      </div>
    </div>
  );
}

const STEP_MS = 1900;

const DRAFT_TITLE = "Archive a task";
const DRAFT_BODY = `People want to clear their list without losing anything.

Done when
- A task can be archived from the list
- Archived tasks sit in a tab of their own
- Nothing is deleted`;
const DRAFT_TALK = [
  { me: true, text: "People should be able to archive a task" },
  {
    me: false,
    text: "Should archived tasks stay reachable, or leave for good?",
  },
  { me: true, text: "Stay reachable, in a tab of their own" },
  { me: false, text: "Written. Anything to add before it goes?" },
];
const NEXT_ASK = "Add an undo right after archiving";
const NEXT_ANSWER = "Added, the ticket says so.";
const NEXT_LINE = "- Archiving can be undone for a few seconds";

interface Drafted {
  number: number;
  title: string;
}

function Landed({ tickets }: { tickets: Drafted[] }) {
  return tickets.map((ticket) => (
    <li className="lp-ticket fresh" key={ticket.number}>
      <TicketNumber number={ticket.number} />
      <b>{ticket.title}</b>
    </li>
  ));
}

function Listed({ tickets }: { tickets: SampleTicket[] }) {
  return tickets.map((ticket) => (
    <li className="lp-ticket" key={ticket.number}>
      <TicketNumber number={ticket.number} />
      <b>{ticket.title}</b>
    </li>
  ));
}

/**
 * The real new ticket dialog over the board. A line waits in the agent's box
 * and the ticket can be edited; Start sends it to the right, where it goes
 * through the work and lands to review, Create leaves it in To do. Drawn: the
 * ticket to review further down has the real agent.
 */
export function TicketShot() {
  const [title, setTitle] = useState(DRAFT_TITLE);
  const [body, setBody] = useState(DRAFT_BODY);
  const [said, setSaid] = useState(DRAFT_TALK);
  const [talk, setTalk] = useState<"ready" | "thinking" | "done">("ready");
  const [made, setMade] = useState(0);
  // The step at work; null with no ticket on its way.
  const [step, setStep] = useState<number | null>(null);
  const [working, setWorking] = useState<Drafted>({ number: 0, title: "" });
  const [landed, setLanded] = useState<Drafted[]>([]);
  const [waiting, setWaiting] = useState<Drafted[]>([]);
  const thread = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (step === null) return;
    const timer = setTimeout(() => {
      if (step + 1 < STEPS.length) setStep(step + 1);
      else {
        setLanded((all) => [working, ...all].slice(0, 2));
        setStep(null);
      }
    }, STEP_MS);
    return () => clearTimeout(timer);
  }, [step, working]);

  useEffect(() => {
    if (talk !== "thinking") return;
    const timer = setTimeout(() => {
      setSaid((all) => [...all, { me: false, text: NEXT_ANSWER }]);
      setBody((all) => `${all}\n${NEXT_LINE}`);
      setTalk("done");
    }, 900);
    return () => clearTimeout(timer);
  }, [talk]);

  useEffect(() => {
    const box = thread.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [said]);

  const name = title.trim();
  const draft = () => {
    setMade(made + 1);
    return { number: 141 + made, title: name };
  };
  const start = () => {
    if (!name || step !== null) return;
    setWorking(draft());
    setStep(0);
  };
  const create = () => {
    if (name) setWaiting((all) => [draft(), ...all].slice(0, 2));
  };
  const ask = () => {
    if (talk !== "ready") return;
    setSaid((all) => [...all, { me: true, text: NEXT_ASK }]);
    setTalk("thinking");
  };
  return (
    <div className="lp-compose">
      <div className="lp-flow" aria-live="polite">
        {waiting.length > 0 && (
          <>
            <GroupHead stage="todo" label="To do" count={waiting.length} />
            <ul className="lp-landed">
              <Landed tickets={waiting} />
            </ul>
          </>
        )}
        <GroupHead
          stage="progress"
          label="In progress"
          count={step === null ? 0 : 1}
        />
        {step !== null && (
          <div className="lp-working" key={working.number}>
            <p className="lp-ticket">
              <TicketNumber number={working.number} />
              <b>{working.title}</b>
            </p>
            <Steps at={step} />
          </div>
        )}
        <GroupHead stage="review" label="To review" count={3 + landed.length} />
        <ul className="lp-landed">
          <Landed tickets={landed} />
          <Listed tickets={toReview} />
        </ul>
        <GroupHead stage="done" label="Done" count={shipped.length} />
        <ul className="lp-landed">
          <Listed tickets={shipped} />
        </ul>
      </div>
      <div
        className="nt nt-agent lp-modal"
        role="group"
        aria-label="New ticket"
      >
        <form
          className="nt-card"
          onSubmit={(event) => {
            event.preventDefault();
            start();
          }}
        >
          <div className="nt-head">
            <span className="nt-where">
              <Github size={14} aria-hidden="true" /> GitHub
            </span>
            <ChevronRight size={13} className="nt-sep" aria-hidden="true" />
            <span className="nt-crumb">Acme</span>
          </div>
          <input
            className="nt-title"
            aria-label="Title"
            placeholder="Ticket title"
            value={title}
            maxLength={60}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            className="nt-body"
            aria-label="Description"
            placeholder="Description, in Markdown"
            value={body}
            maxLength={600}
            onChange={(event) => setBody(event.target.value)}
          />
          <div className="nt-foot">
            <button
              type="button"
              className="tix-btn tix-btn-line"
              disabled={!name}
              onClick={create}
            >
              Create
            </button>
            <button
              type="submit"
              className="tix-btn tix-btn-amber"
              disabled={!name || step !== null}
            >
              <Play size={11} fill="currentColor" aria-hidden="true" />
              Start
            </button>
          </div>
        </form>
        <section className="nt-talk" aria-label="The agent">
          <div className="pp-talk-thread" ref={thread}>
            <ol className="pp-chat">
              {said.map((line) =>
                line.me ? (
                  <li className="pp-me" key={line.text}>
                    <p className="pp-bubble">{line.text}</p>
                  </li>
                ) : (
                  <li className="pp-it" key={line.text}>
                    <p className="pp-say">{line.text}</p>
                  </li>
                ),
              )}
              {talk === "thinking" && (
                <li className="pp-it">
                  <TextShimmer className="pp-say">Writing</TextShimmer>
                </li>
              )}
            </ol>
          </div>
          <div className="pp-asking">
            <form
              className="pp-input"
              onSubmit={(event) => {
                event.preventDefault();
                ask();
              }}
            >
              <textarea
                aria-label="Tell the agent what you want"
                placeholder="Tell the agent what you want…"
                rows={1}
                readOnly
                value={talk === "ready" ? NEXT_ASK : ""}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  ask();
                }}
              />
              <button
                type="submit"
                className="pp-go"
                aria-label="Send"
                aria-disabled={talk !== "ready"}
              >
                <ArrowUp size={17} strokeWidth={2.2} />
              </button>
            </form>
          </div>
        </section>
      </div>
    </div>
  );
}
