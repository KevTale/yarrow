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
