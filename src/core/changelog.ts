/**
 * The public changelog, newest first, one entry per day as it landed on main.
 * Only what a builder or a sponsor sees; real dates only.
 */
export type ChangeTag = "Builders" | "Sponsors";
export type Change = string | { text: string; tag: ChangeTag };

export interface ChangelogEntry {
  /** ISO day, UTC. */
  date: string;
  title: string;
  new?: Change[];
  improved?: Change[];
  fixed?: Change[];
}

const builders = (text: string): Change => ({ text, tag: "Builders" });
const sponsors = (text: string): Change => ({ text, tag: "Sponsors" });

/** The hackathon's first day: the page folds the days before it. */
export const HACKATHON_START = "2026-10-26";

export const changelog: ChangelogEntry[] = [
  {
    date: "2026-11-02",
    title: "Meta's models at work",
    new: [
      builders(
        "A demo shows code in a real VS Code on the repository: its diff, its selected lines and the real pointer.",
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
    title: "Write a ticket with the agent",
    new: [
      builders(
        "New ticket is written with the agent, in writing or on a call: it reads the repository and every ticket of the project, says what already exists, asks what neither answers and fills in the title and description as you talk.",
      ),
      builders(
        "Ask the agent for a ticket in a pull request's conversation: a card under its words creates it where the project's tickets go, not started, or opens it in the new ticket dialog.",
      ),
      builders(
        "Connecting GitHub leads to a setup, one step at a time: the repository, where the tickets are, how a linked board's tickets move, then the dashboard.",
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
        "A ticket not yet paid for says who wrote it on its row, in the Paid by column.",
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
    title: "One room for a ticket",
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
      builders("Full screen centers the demo and its bar in the window."),
    ],
  },
  {
    date: "2026-10-30",
    title: "One thing at a time",
    new: [
      builders(
        "Take control of a pull request's app from its ticket: your mouse and keyboard reach the app itself.",
      ),
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
    title: "What proves a change",
    new: [
      builders(
        "An open pull request's app at its own address: the preview, signed in, for the project's members.",
      ),
      builders(
        "Each pull request proves itself with what fits the change: screens before and after, what a command printed, a measure, the document or the app's page.",
      ),
    ],
    improved: [
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
        "What a command printed reads without a terminal: the lines that changed marked, the rest folded until asked for.",
      ),
      builders(
        "Your words show in the conversation as you say them on a call.",
      ),
    ],
  },
  {
    date: "2026-10-28",
    title: "The app itself, on a call",
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
    title: "Levers and plain words",
    improved: [
      builders(
        "A pull request's panel reads What the ticket asks, then What changed, one text by one agent, the reviewer, the last to look. GitHub's description says the same.",
      ),
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
    title: "The conversation in one place",
    improved: [
      builders(
        "A pull request's conversation has one place: a right column that stays in view as the page scrolls, its box at the foot.",
      ),
      builders(
        "Who paid shows in full on hovering a row's Paid by, with each model's time and cost and the total.",
      ),
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
    title: "A change under way",
    improved: [
      builders(
        "A pull request being changed waits in In progress, out of To review's count, and comes back to To review with its commit. An opened row stays where it is until you close it.",
      ),
      builders(
        "Summaries, reviews, the agent's answers and ticket descriptions read their Markdown: italics, struck text, emphasis inside emphasis.",
      ),
      builders(
        "A pull request's summary and review say it in a few lines, set larger and easier to read. Ask the conversation for the details.",
      ),
    ],
    fixed: [
      builders(
        "A suggested ticket leaves the pull request's sidebar once you make it a ticket.",
      ),
    ],
  },
  {
    date: "2026-10-24",
    title: "Ask the agent",
    new: [
      builders(
        "A pull request's conversation, under the review and beside the film in cinema mode: ask the agent about the change, the code or the project's tickets. It reads the code to answer, points to moments of the presentation, and proposes a change you make in one click.",
      ),
    ],
    improved: [
      builders(
        "The changes asked on GitHub show in the conversation, where they fall.",
      ),
    ],
  },
  {
    date: "2026-10-23",
    title: "Cinema mode",
    new: [
      builders(
        "Cinema mode: a pull request's presentation fills the window beside the conversation, the changes asked and the box to ask for one; Back returns to the pull request.",
      ),
      builders("The arrow keys move a presentation three seconds back or on."),
    ],
    improved: [
      builders(
        "In a presentation the dock is a thin strip and each app takes the rest of the screen, with square corners.",
      ),
      builders(
        "A presentation's controls sit on a light rounded shade, readable over any page, each with its tip, and the film carries no Before or After label nor amber outline: the voice and the agent's pointer say it.",
      ),
      builders(
        "A pull request's lint, tests and build fold into one line, Technical checks pass, that opens on each of them. The review drops its Changes requested tag: its words say it.",
      ),
    ],
    fixed: [
      builders(
        "After the reviewer sends a change back, a pull request's summary still tells the whole ticket, and the review says what it found first and that it was fixed, or names what still fails.",
      ),
      builders(
        "A presentation no longer shows a page's text selected after the agent's first click.",
      ),
      builders(
        "When a presentation's controls hide, its captions drop to the foot of the film instead of hanging over the app.",
      ),
    ],
  },
  {
    date: "2026-10-22",
    title: "Pull requests in plain words",
    new: [
      builders(
        "Every pull request lists the ticket's acceptance criteria, each ticked once it was shown working.",
      ),
      builders(
        "What the agents noticed outside a ticket shows as a suggested ticket beside its pull request: one click and the new ticket opens written, ready to send.",
      ),
    ],
    improved: [
      builders(
        "A pull request's summary says what the ticket asked, then what was done. Its review reads like a colleague's: what the reviewer checked, then everything that works, the ticket's criteria and the tests in plain words, then what to keep an eye on.",
      ),
      builders(
        "In a pull request's presentation the app fills the screen and reads larger, the dock no longer looks like the player's buttons, and each chapter ends with its words instead of a silence.",
      ),
    ],
    fixed: [
      builders(
        "On a phone, tickets keep their line and scroll sideways, and an opened ticket's text no longer runs past the screen.",
      ),
      builders(
        "The ticket list no longer slides by itself on a refresh after a ticket was opened.",
      ),
    ],
  },
  {
    date: "2026-10-19",
    title: "Screenshots",
    new: [
      builders(
        "A pull request that changes what people see comes with screenshots of the changed screens, in its panel and, for public projects, in its description.",
      ),
    ],
  },
  {
    date: "2026-10-14",
    title: "Tickets, one list",
    new: [
      builders(
        "Open a ticket on the dashboard to read it as written in GitHub or Jira, then start it, cancel it or review its pull request in place.",
      ),
      builders(
        '"+" on To do or In progress writes a new ticket in a dialog; C opens it too.',
      ),
      builders(
        "When the agents stop with questions, answer them under the ticket: the answer is written on the ticket and it starts again.",
      ),
      builders(
        'Close a ticket, or only its pull request, from the "…" of its row.',
      ),
    ],
    improved: [
      builders(
        "Tickets and Sponsoring are two links in the header; Changelog moved to the avatar menu.",
      ),
      builders(
        "Every ticket in one list, grouped by stage: To review, In progress, To do, Stopped, Done. Each shows the day it was written.",
      ),
      builders("Switch projects or add one from the project's name."),
      builders(
        "Done shows the last two weeks; older tickets are one click away.",
      ),
      builders("The agents read a Jira ticket's comments, as on GitHub."),
    ],
  },
  {
    date: "2026-10-13",
    title: "Write tickets in Yarrow",
    new: [
      builders(
        "New ticket on the dashboard: write it once, it opens in GitHub or in a linked Jira project, queued at once or left to queue.",
      ),
      builders(
        "A yarrow label set in Jira itself queues the ticket in seconds.",
      ),
    ],
    improved: [
      builders(
        "Tickets opened, renamed or closed in GitHub or Jira show on the dashboard in seconds.",
      ),
    ],
  },
  {
    date: "2026-10-12",
    title: "One account, and a way in for sponsors",
    new: [
      sponsors(
        "A Sponsors link in the header takes you straight to the board.",
      ),
      "This changelog.",
    ],
    improved: [
      "Signing in with GitHub after signing in by email adds GitHub to the same account, so your projects and your sponsoring stay together.",
      builders(
        "Back from GitHub without the repository of the issue you pasted, the dashboard says so and takes you back to add it.",
      ),
      builders(
        "An organization member who asks its admins to install Yarrow sees that the request went out.",
      ),
      "The landing says it plainly: free pull requests from frontier AI. No API key, no card, no subscription.",
      sponsors("The board shows what the smallest amount funds."),
    ],
  },
  {
    date: "2026-10-11",
    title: "Manage pull requests without leaving Yarrow",
    new: [
      builders(
        "Open a pull request's row to read what changed, its checks, the review and the risks, then merge it, mark it ready or ask for a change.",
      ),
      builders(
        "Comment @yarrow-run on a pull request, followed by what to change, and it comes back with a correction.",
      ),
      builders(
        "Paid by: every ticket shows the sponsors whose money went into it, largest share first.",
      ),
      sponsors(
        "Your card takes your website's icon when you have not uploaded a logo.",
      ),
    ],
    improved: [
      builders(
        "Your avatar counts the pull requests waiting for your review, and the dashboard opens on them.",
      ),
      "Pull request descriptions put each note in its place: what it does, what could not be checked, what you need to act on.",
      "Share a run's public page from its row.",
    ],
    fixed: [
      "When an AI provider refuses a run for lack of credit on Yarrow's side, the ticket goes back to the queue in its place instead of stopping.",
    ],
  },
  {
    date: "2026-10-10",
    title: "Live tickets, and why it's free",
    new: [
      "Live tickets on the landing: the latest work, moving only when the work does.",
      "Why is it free? A pull request sketched in place, with the sponsors' card at its foot.",
      builders(
        "Or connect your backlog, under the ticket field, for when you have no issue at hand.",
      ),
      builders(
        "The Terms, sponsors' card included, are ticked once before connecting GitHub.",
      ),
    ],
    improved: [
      "Shorter pull requests, with GPT Astra's review inside the description.",
      "A queued ticket starts within seconds instead of waiting for the next minute.",
      "Runs can change files under .github/workflows.",
      sponsors(
        "“Funds ≈N PRs” follows what pull requests actually cost over the last 90 days.",
      ),
      "Smoother controls: the source picker, the Today / All time switch, rolling totals, and an amount field you can hold to repeat.",
    ],
    fixed: [
      "A stopped run names its real cause: GitHub refusing the change, an AI provider, or Yarrow itself.",
    ],
  },
  {
    date: "2026-10-09",
    title: "The sponsors' card in every pull request",
    new: [
      sponsors(
        "Every pull request ends with its sponsors' card: logo, name, what you do and your website, with clicks counted.",
      ),
      sponsors(
        "Claim a place on the board right in your own row, then pay through Stripe.",
      ),
      sponsors("One board, Today and All time, ranked by money paid."),
      "Run pages tell what the agents did, for people: files read and edited, tests and their results, the review.",
      "An Account page: change your email, get your invoices, delete your account.",
      "Link previews and a share image.",
    ],
    improved: [
      sponsors(
        "Every sponsor row reads in three lines: name and amount, what they do, website with clicks and merged PRs.",
      ),
      "Ticket cards keep their titles whole on phones.",
    ],
  },
  {
    date: "2026-10-08",
    title: "Jira, and a dashboard for your tickets",
    new: [
      builders(
        "Paste a Jira ticket: link its project to a repository and it joins the queue.",
      ),
      builders(
        "Jira tickets move across your board when Yarrow starts, opens the pull request and merges, to the statuses you choose.",
      ),
      "Live run activity: what Claude Opus and GPT Astra are doing, as they do it.",
      builders(
        "To review: every draft pull request across your projects in one list.",
      ),
      "Logo uploads for sponsors and projects.",
    ],
    improved: [
      "Statuses name the pull request: Queued, Writing, Reviewing, PR #12, merged or closed.",
      builders("Ticket stages with counts, and a search across all of them."),
      builders(
        "A stopped ticket has its own stage, with the agents' questions.",
      ),
      builders(
        "Project settings hold Connections and Visibility only, saved as you change them.",
      ),
    ],
  },
  {
    date: "2026-10-07",
    title: "Builders and sponsors, live",
    new: [
      builders("Paste an issue link on the landing to get a pull request."),
      builders(
        "Connect GitHub with no form to fill: your repositories become projects when you install the app.",
      ),
      sponsors("Pay without GitHub, then sign in from a link in your email."),
      "A dashboard with Builder and Sponsor tabs, updated live.",
      sponsors(
        "A thank-you email, confetti, and an invoice for every payment.",
      ),
      "Legal notice, Terms and Privacy pages.",
    ],
    improved: [
      "Loading states everywhere: a progress bar, skeletons and spinners.",
    ],
  },
  {
    date: "2026-10-06",
    title: "Yarrow",
    new: [
      "Sponsors fund the compute; frontier AI turns your tickets into pull requests.",
      "Claude Opus writes every pull request, and GPT Astra reviews it.",
    ],
  },
];
