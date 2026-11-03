import { Check, ChevronDown, ChevronRight, Github, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { TextShimmer } from "@/components/arc/text-shimmer/text-shimmer";
import { TrackerIcon } from "@/components/brand-icons";
import { StageMark } from "@/components/dashboard/stage-mark";
import type { TicketStage } from "@/core/tickets";

type Source = "github" | "jira" | "linear" | "trello";
interface Row {
  source: Source;
  ref: string;
  title: string;
  who: string;
  when: string;
  work?: string;
}

const groups: { stage: TicketStage; label: string; rows: Row[] }[] = [
  {
    stage: "review",
    label: "To review",
    rows: [
      {
        source: "github",
        ref: "#137",
        title: "Tasks need a priority",
        who: "Sam Okafor",
        when: "Nov 1, 09:12",
      },
      {
        source: "linear",
        ref: "KEV-31",
        title: "Export tasks as CSV",
        who: "Léa Martin",
        when: "Oct 31, 18:40",
      },
      {
        source: "jira",
        ref: "TAL-52",
        title: "Invite a teammate by link",
        who: "Sam Okafor",
        when: "Oct 31, 16:05",
      },
    ],
  },
  {
    stage: "progress",
    label: "In progress",
    rows: [
      {
        source: "linear",
        ref: "KEV-34",
        title: "Filter tasks by due date",
        who: "Léa Martin",
        when: "Nov 1, 10:26",
        work: "Writing the code",
      },
    ],
  },
  { stage: "stopped", label: "Stopped", rows: [] },
  {
    stage: "done",
    label: "Done",
    rows: [
      {
        source: "github",
        ref: "#129",
        title: "Comments on tasks",
        who: "Léa Martin",
        when: "Oct 30, 11:48",
      },
      {
        source: "trello",
        ref: "hX2kPq",
        title: "Search across projects",
        who: "Sam Okafor",
        when: "Oct 29, 17:22",
      },
      {
        source: "jira",
        ref: "TAL-47",
        title: "Dark theme",
        who: "Léa Martin",
        when: "Oct 29, 09:31",
      },
      {
        source: "github",
        ref: "#121",
        title: "Keyboard shortcuts",
        who: "Sam Okafor",
        when: "Oct 28, 15:03",
      },
    ],
  },
];

function SourceRef({ source, id }: { source: Source; id: string }) {
  return (
    <span className={`bd-num ${source}`}>
      <span className="bd-source">
        {source === "github" ? (
          <Github size={12} aria-hidden="true" />
        ) : (
          <TrackerIcon tracker={source} size={12} />
        )}
      </span>
      {id}
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

/** A project's tickets, drawn from the dashboard's own styles. */
export function DashboardShot() {
  return (
    <div className="lp-dash" role="img" aria-label="A project's tickets">
      <div className="lp-dash-head" aria-hidden="true">
        <b>tally</b>
        <ChevronDown size={14} />
        <span className="lp-dash-search">
          <Search size={13} /> Search tickets
        </span>
      </div>
      <div className="tix-list" aria-hidden="true">
        {groups.map((group) => (
          <section className="tix-group" key={group.stage}>
            <GroupHead
              stage={group.stage}
              label={group.label}
              count={group.rows.length}
            />
            {group.rows.length > 0 && (
              <ul className="tix-rows">
                {group.rows.map((row) => (
                  <li className="tix-item" key={row.ref}>
                    <div className="tix-row">
                      <span className="tix-open">
                        <ChevronRight size={14} className="tix-chev" />
                        <SourceRef source={row.source} id={row.ref} />
                        <span className="tix-title">{row.title}</span>
                      </span>
                      <span className="tix-meta">
                        <span className="tix-cell">
                          {row.work && (
                            <TextShimmer className="tix-state working">
                              {row.work}
                            </TextShimmer>
                          )}
                        </span>
                        <span className="tix-sponsor">
                          <span className="tix-paid">Created by</span>
                          <span>{row.who}</span>
                        </span>
                        <span className="tix-date">{row.when}</span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

const STEPS = [
  "Reading the code",
  "Writing the change",
  "Reviewing it",
  "Recording the demo",
];
const STEP_MS = 1900;

const DRAFT_TITLE = "Archive a task";
const DRAFT_BODY = `People want to clear their list without losing anything.

Done when
- A task can be archived from the list
- Archived tasks sit in a tab of their own
- Nothing is deleted`;

/**
 * A ticket ready to send: its words can be changed, and Create ticket sends
 * it to the right, where it goes through the work and lands to review. No
 * agent behind this one: the ticket to review further down has it.
 */
export function TicketShot() {
  const [title, setTitle] = useState(DRAFT_TITLE);
  const [body, setBody] = useState(DRAFT_BODY);
  // The step at work; null with no ticket on its way.
  const [step, setStep] = useState<number | null>(null);
  const [working, setWorking] = useState({ number: 41, title: "" });
  const [landed, setLanded] = useState<(typeof working)[]>([]);

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

  const name = title.trim();
  return (
    <div className="lp-compose">
      <form
        className="lp-draft"
        onSubmit={(event) => {
          event.preventDefault();
          if (!name || step !== null) return;
          setWorking((last) => ({ number: last.number + 1, title: name }));
          setStep(0);
        }}
      >
        <p className="lp-said me">People should be able to archive a task</p>
        <p className="lp-said">
          Should archived tasks stay reachable, or leave for good?
        </p>
        <p className="lp-said me">Stay reachable, in a tab of their own</p>
        <div className="lp-fields">
          <input
            aria-label="Title"
            value={title}
            maxLength={60}
            onChange={(event) => setTitle(event.target.value)}
          />
          <textarea
            aria-label="Description"
            rows={7}
            value={body}
            maxLength={600}
            onChange={(event) => setBody(event.target.value)}
          />
          <button type="submit" disabled={!name || step !== null}>
            Create ticket
          </button>
        </div>
      </form>
      <div className="lp-flow" aria-live="polite">
        <GroupHead
          stage="progress"
          label="In progress"
          count={step === null ? 0 : 1}
        />
        {step !== null && (
          <div className="lp-working" key={working.number}>
            <p className="lp-ticket">
              <SourceRef source="linear" id={`KEV-${working.number}`} />
              <b>{working.title}</b>
            </p>
            <ol>
              {STEPS.map((label, index) => (
                <li
                  key={label}
                  className={
                    index < step ? "done" : index === step ? "now" : undefined
                  }
                >
                  <i aria-hidden="true">
                    {index < step && <Check size={11} strokeWidth={3} />}
                  </i>
                  {index === step ? <TextShimmer>{label}</TextShimmer> : label}
                </li>
              ))}
            </ol>
          </div>
        )}
        <GroupHead stage="review" label="To review" count={3 + landed.length} />
        <ul className="lp-landed">
          {landed.map((ticket) => (
            <li className="lp-ticket fresh" key={ticket.number}>
              <SourceRef source="linear" id={`KEV-${ticket.number}`} />
              <b>{ticket.title}</b>
            </li>
          ))}
          <li className="lp-ticket">
            <SourceRef source="github" id="#137" />
            <b>Tasks need a priority</b>
          </li>
          <li className="lp-ticket">
            <SourceRef source="linear" id="KEV-31" />
            <b>Export tasks as CSV</b>
          </li>
          <li className="lp-ticket">
            <SourceRef source="jira" id="TAL-52" />
            <b>Invite a teammate by link</b>
          </li>
        </ul>
      </div>
    </div>
  );
}
