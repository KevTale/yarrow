/**
 * The public changelog, newest first, one entry per day.
 * What stands today, on the day it landed in that form: what left the product
 * leaves the page, what was rebuilt sits on the day of its rebuild.
 * Only what a builder or a sponsor sees; real dates only.
 */
export type ChangeTag = "Builders" | "Sponsors";
export type Change = string | { text: string; tag: ChangeTag };

export interface ChangelogEntry {
  /** ISO day, UTC. */
  date: string;
  new?: Change[];
  improved?: Change[];
  fixed?: Change[];
}

const builders = (text: string): Change => ({ text, tag: "Builders" });
const sponsors = (text: string): Change => ({ text, tag: "Sponsors" });

export const changelog: ChangelogEntry[] = [
  {
    date: "2026-11-02",
    new: [
      builders(
        "A demo shows code in a real VS Code on the repository: the file itself, its selected lines and the real pointer.",
      ),
      builders(
        "On a call the agent opens files in that editor as it speaks, on every pull request, even when Yarrow never ran the app.",
      ),
    ],
    improved: [
      builders(
        "Muse Wonder writes your tickets and Claude Opus reviews what it wrote. A project with secrets stays on Claude Opus, reviewed by GPT Astra.",
      ),
      builders(
        "Muse Wonder runs in a machine of Yarrow's own, with no key inside it and no Internet beyond what a run needs.",
      ),
      builders(
        "Muse Spark answers in the chat, on a call and when you write a new ticket.",
      ),
      builders(
        "A ticket's conversation opens on what the agent needs you to know, and on the box alone when there is nothing to say.",
      ),
      builders(
        "A ticket's description reads in the new ticket dialog as its row will show it; a click in it brings the Markdown back to write.",
      ),
      builders("A ticket's row says who wrote it."),
      "Every agent answers in English by default or in the language you use, and what a run delivers follows the ticket's language the same way.",
      "Times follow the hours of your browser: 3:21 PM in the United States, 15:21 in France.",
    ],
    fixed: [
      builders("A question on a call gets one answer."),
      builders(
        "A run names who really works on it from the moment it is reserved.",
      ),
    ],
  },
  {
    date: "2026-11-01",
    new: [
      builders(
        "New ticket is written with the agent, in writing or on a call: it reads the repository and every ticket of the project, says what already exists, asks what neither answers and fills in the title and description as you talk. The ticket opens in GitHub or in a linked Jira project.",
      ),
      builders(
        "Ask the agent for a ticket in a pull request's conversation: a card under its words creates it where the project's tickets go, not started, or opens it in the new ticket dialog.",
      ),
      builders(
        "Connecting GitHub leads to a setup, one step at a time: the repository, where the tickets are, how a linked board's tickets move, then the dashboard.",
      ),
      builders(
        "A new dashboard layout: the list is the only frame, with the project and the search above it on the page.",
      ),
      "A new landing made of the real product: a ticket to review open on its real demo and agent, a real agent writing a ticket, and that ticket's way to review.",
      sponsors(
        "Sponsors has a page of its own, with the board, why it is free and the live tickets.",
      ),
    ],
    improved: [
      builders(
        "Only the repositories you import show on the dashboard, take webhooks and get the yarrow label, however many came with the install.",
      ),
      builders(
        "A ticket In progress has its two columns from the moment it is queued: the ticket on the left, the agents' work on the right.",
      ),
      builders(
        "The line a ticket opened from Yarrow ends with is read in Jira too.",
      ),
      "One header on every page, with hairlines and a darker night across the site.",
      "Signed in, the address opens the dashboard.",
    ],
  },
  {
    date: "2026-10-31",
    new: [
      builders(
        "Every ticket has its demo, whatever the change: the agent presents the context, what changed and the proof, on the app, in the terminal or on the document, and the controls name the part it is in.",
      ),
      builders(
        "A ticket to review is one room: the demo, Play on a click, and the conversation always beside it.",
      ),
      builders(
        "Interrupt the demo as you would a colleague: it stops as you start speaking or send, the agent answers aloud and shows it on the live app, and Play or saying go on takes the demo up from the sentence it cut.",
      ),
      builders(
        "A click in the demo gives you the app itself: your mouse and keyboard reach it.",
      ),
      builders(
        "Full screen takes the demo and its bar to the middle of the window.",
      ),
      builders("Slide to merge, at the end of the bar under the demo."),
    ],
    improved: [
      builders(
        "One call for what is written and what is said: the agent's voice, words and gestures go in step, and your microphone plugs into it when you want.",
      ),
      builders(
        "A row's title is the reviewer's one-line summary of the change, the ticket's title as its tip.",
      ),
      builders(
        "Suggested tickets are a button at the foot that opens the new ticket dialog written already, several listed on its left.",
      ),
      builders(
        "Demos have no dock: each app fills the screen and the demo cuts to the one it needs.",
      ),
    ],
  },
  {
    date: "2026-10-30",
    new: [
      builders(
        "A bar at the foot of an opened ticket: the files changed on the left, what opens elsewhere on the right.",
      ),
    ],
    improved: [
      builders(
        "The changes open at one size in one place, whatever the file, the list of files beside them.",
      ),
      builders(
        "The conversation never moves an opened row: what is said after it opened scrolls inside its column, the latest words in view.",
      ),
      builders(
        "An opened row settles in the middle of the room the page leaves under its header, whole when it fits.",
      ),
      builders("The agent talks about what the page shows and nothing else."),
      builders(
        "On a phone the conversation's box stays at the bottom of the screen the whole way down an opened row.",
      ),
    ],
    fixed: [
      builders("The live app types every accent, the euro included."),
      builders(
        "An app served by Python's http.server answers, where it crashed as its machine started.",
      ),
    ],
  },
  {
    date: "2026-10-29",
    new: [
      builders(
        "An open pull request's app at its own address: the preview, signed in, for the project's members, opening on the page that shows the change.",
      ),
    ],
    improved: [
      builders(
        "A demo always shows something someone who reads no code can judge.",
      ),
      builders(
        "A ticket moves to the group its state says, opened or not, and the group it lands in unfolds.",
      ),
      builders(
        "A documentation change is shown as the document, what it added marked in the margin.",
      ),
      builders(
        "A demo can play a canvas, so a browser game's ticket shows the game played.",
      ),
      builders(
        "Your words show in the conversation as you say them on a call.",
      ),
    ],
  },
  {
    date: "2026-10-28",
    new: [
      builders(
        "A pull request's app runs live in the dashboard, in a machine of Yarrow's own.",
      ),
      builders(
        "Talk to the agent about a pull request: it answers aloud, reads the code and acts on the live app as you watch, clicking with its pointer.",
      ),
      builders(
        "One conversation: what you write acts on the live app too, each turn of a call is kept in the pull request's thread, and the agent proposes a change as a card.",
      ),
    ],
    improved: [
      builders(
        "When Yarrow stops, a ticket goes back to the status it had on your board: Back where it was, the new default, beside Don't move and the statuses.",
      ),
    ],
  },
  {
    date: "2026-10-27",
    improved: [
      builders(
        "Start, Retry and Merge are levers pulled to the right, the confirmation in the gesture.",
      ),
      builders(
        "A stopped ticket is answered from the foot of the right column, as a pull request's conversation.",
      ),
      builders(
        "Rows show the time with the date, and the groups' marks are drawn from Yarrow's flower.",
      ),
    ],
  },
  {
    date: "2026-10-26",
    improved: [
      builders(
        "Ask the agent about the change, the code or the project's tickets in one place: a right column that stays in view as the page scrolls, its box at the foot.",
      ),
      builders("The video of a change you can see opens on the app as it was."),
      builders(
        "The project menu shows beside each project how many pull requests wait for review, in place of the cross-project To review list.",
      ),
      builders(
        "A run's activity names each step and the model at it, and what the agent did sits under it.",
      ),
    ],
  },
  {
    date: "2026-10-25",
    improved: [
      builders(
        "A pull request with a change asked waits in In progress, out of To review's count, Merge hidden, and comes back to To review with its commit.",
      ),
    ],
  },
  {
    date: "2026-10-22",
    fixed: [
      builders(
        "The ticket list no longer slides by itself on a refresh after a ticket was opened.",
      ),
    ],
  },
];

/** What stands from before these days, with no day of its own. */
export const earlier: Change[] = [
  builders(
    "Connect GitHub with no form to fill: your repositories become projects.",
  ),
  builders(
    "Link a Jira project to a repository: its tickets join Yarrow and move across your board as the work goes.",
  ),
  builders(
    "Every ticket in one list, grouped by stage, with a search across all of them: open one, start it, cancel it or close it.",
  ),
  builders(
    "Merge a pull request from Yarrow, or ask for a change, there or with @yarrow-run on GitHub.",
  ),
  sponsors(
    "Sponsors fund the compute: claim a place on the board, pay through Stripe, and the pull requests you fund end with your card.",
  ),
];
