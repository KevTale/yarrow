import {
  ArrowUpRight,
  Captions,
  FileText,
  GitMerge,
  GitPullRequest,
  Maximize,
  Mic,
  Pause,
  Volume2,
} from "lucide-react";

const tasks = [
  ["Fix the export to CSV", "Doing", "Léa Martin", "Urgent"],
  ["Write the onboarding email", "Doing", "Sam Okafor", "High"],
  ["Answer the pricing question from Acme", "To do", "Léa Martin", "Urgent"],
  ["Plan the October release", "To do", "Sam Okafor", ""],
  ["Update the team page", "To do", "Nobody", ""],
  ["Review the design for settings", "Done", "Léa Martin", ""],
] as const;

/**
 * A picture of the product, in HTML so it stays sharp: a ticket to review,
 * its demo stopped at a moment, the conversation beside it, the merge at its
 * foot. Nothing in it moves or answers.
 */
export function LandingRoom() {
  return (
    <figure
      className="lr"
      role="img"
      aria-label="A ticket to review: its demo beside the conversation with the agent, and a slide to merge"
    >
      <div className="lr-row" aria-hidden="true">
        <GitPullRequest size={14} />
        <span className="mono">#137</span>
        <b>Tasks need a priority</b>
      </div>
      <div className="lr-meet" aria-hidden="true">
        <div className="lr-film">
          <div className="lr-browser">
            <i />
            <i />
            <i />
            <span className="mono">localhost:3000</span>
          </div>
          <div className="lr-app">
            <p className="lr-app-title">
              Tasks <span>6 open</span>
            </p>
            <div className="lr-table">
              {tasks.map(([task, status, who, priority]) => (
                <div className="lr-task" key={task}>
                  <span className="lr-task-name">
                    {task}
                    {priority && (
                      <em className={`lr-tag ${priority.toLowerCase()}`}>
                        {priority}
                      </em>
                    )}
                  </span>
                  <span className={`lr-state s-${status.replace(" ", "")}`}>
                    {status}
                  </span>
                  <span className="lr-who">{who}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="lr-controls">
            <span className="lr-control">
              <Pause size={15} />
            </span>
            <span className="lr-control mono">0:41 / 0:58</span>
            <span className="lr-track">
              <span />
            </span>
            <span className="lr-control">
              1× <Captions size={15} /> <Volume2 size={15} />{" "}
              <Maximize size={14} />
            </span>
          </div>
        </div>
        <div className="lr-talk">
          <div className="lr-thread">
            <p>
              Tasks now have a priority, from the new task form to the list.
            </p>
            <p>
              Urgent and high tasks now carry a tag in the list. You can see it
              next to the CSV export <span className="lr-time">0:41</span>
            </p>
            <p className="lr-me">What is the default priority?</p>
            <p>
              Normal, in the database and in the form. Normal tasks show no tag.
            </p>
          </div>
          <div className="lr-box">
            Ask about this ticket…
            <Mic size={15} />
          </div>
        </div>
      </div>
      <div className="lr-foot" aria-hidden="true">
        <span className="lr-files">
          <FileText size={14} /> 6 files changed <b className="add">+44</b>{" "}
          <b className="del">−6</b>
        </span>
        <span className="lr-open">
          Open the app <ArrowUpRight size={13} />
        </span>
        <span className="lr-merge">
          <i>
            <GitMerge size={14} />
          </i>
          Slide to merge
        </span>
      </div>
    </figure>
  );
}
