/**
 * The public changelog, newest first, one entry per day as it shipped.
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

export const changelog: ChangelogEntry[] = [
  {
    date: "2026-10-25",
    title: "A change under way",
    improved: [
      builders(
        "A pull request being changed waits in In progress, out of To review's count, and comes back to To review with its commit. An opened row stays where it is until you close it.",
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
