/**
 * The bench's apps and scenarios: a ticket filed on an app's repository,
 * and what Yarrow must make of it, the proofs first (src/core/proofs.ts).
 * Each scenario starts from its app as it is in bench/apps/.
 */

/** A bench app: bench/apps/<name>, pushed to its repository's main. */
export interface BenchApp {
  name: string;
  about: string;
  /** Under the bench's owner (BENCH_OWNER). */
  repository: string;
}

export const apps: BenchApp[] = [
  {
    name: "tally",
    about:
      "A team task list: Express 5 and PostgreSQL, server-rendered, a weekly email",
    repository: "yarrow-bench-app",
  },
  {
    name: "pace",
    about: "A running log on the command line, in Python",
    repository: "yarrow-bench-cli",
  },
  {
    name: "tempo",
    about: "A TypeScript library published on npm",
    repository: "yarrow-bench-lib",
  },
  {
    name: "recap",
    about: "Meeting notes to a recap, by a language model",
    repository: "yarrow-bench-ai",
  },
  {
    name: "starfall",
    about: "A browser game on a canvas",
    repository: "yarrow-bench-game",
  },
  {
    name: "shelf",
    about: "A product catalog: Next.js and PostgreSQL",
    repository: "yarrow-bench-next",
  },
];

/**
 * What a pull request holds, read from its description: a proof's mark
 * (`<!-- yarrow:proof <kind> -->`), "phone" for a phone's screens, "film"
 * for the presentation. Every pull request has its film, the bench checks
 * it on them all (decided 2026-10-31).
 */
export type Shown =
  | "images"
  | "phone"
  | "output"
  | "measure"
  | "document"
  | "check"
  | "app"
  | "film";

export interface Scenario {
  name: string;
  app: string;
  /** The kind of ticket, and what proves it best. */
  about: string;
  title: string;
  body: string;
  expect: {
    /** A draft pull request, or an abstention with questions. */
    outcome: "pull_request" | "abstained";
    /** Every one of these shows. */
    shows?: Shown[];
    /** At least one of these shows. */
    showsOneOf?: Shown[];
    /** None of these shows: noise for this ticket. */
    hides?: Shown[];
    /** Files the change must touch, by path prefix. */
    touches?: string[];
    /** A "Not verified" section says what could not be checked. */
    notVerified?: boolean;
  };
}

export const scenarios: Scenario[] = [
  {
    name: "visible",
    app: "tally",
    about: "A change on one screen: the screen before and after, the app.",
    title: "Make the Save button on Settings green",
    body: "On the Settings page, the Save button is purple like every other button. Make that one green (#1d7a4c) so saving stands out. Leave the other buttons as they are.",
    expect: {
      outcome: "pull_request",
      shows: ["app"],
      touches: ["public/"],
    },
  },
  {
    name: "removal",
    app: "tally",
    about:
      "Something taken away on every page: the film, or one screen with it and without it.",
    title: "Remove the Tally Pro banner",
    body: "Every page shows a purple banner about Tally Pro. Pro was cancelled: remove the banner everywhere. Nothing else changes.",
    expect: {
      outcome: "pull_request",
      shows: ["app"],
      touches: ["src/"],
    },
  },
  {
    name: "phone",
    app: "tally",
    about: "A phone layout: the screen at a phone's size, before and after.",
    title: "On a phone, the Save button on Settings is cut off",
    body: "On my phone (iPhone 13), the Settings page is wider than the screen and the Save button is cut off on the right, so I can't save my name. It should fit the screen like the other pages.",
    expect: {
      outcome: "pull_request",
      shows: ["app"],
      touches: ["public/"],
    },
  },
  {
    name: "filter",
    app: "tally",
    about: "A feature used in several steps: the film alone, and the app.",
    title: "Filter the task list by status",
    body: "The task list shows every task at once. Add filters above it: All, To do, Doing and Done, each with its count. Picking one shows only those tasks, and the choice stays in the address so a reload keeps it. All stays the default.",
    expect: {
      outcome: "pull_request",
      shows: ["app"],
      touches: ["src/"],
    },
  },
  {
    name: "search",
    app: "tally",
    about: "A feature typed into: the film of the list narrowing, the app.",
    title: "Search tasks by title",
    body: "Finding a task means reading the whole list. Add a search field above the task list: typing narrows the list to tasks whose title contains the text, whatever the case, and an empty field shows them all again. When nothing matches, say so.",
    expect: {
      outcome: "pull_request",
      shows: ["app"],
      touches: ["src/"],
    },
  },
  {
    name: "bugfix",
    app: "tally",
    about: "A rule deep in the code that shows on a screen: that screen.",
    title: "Done tasks show as overdue",
    body: 'In the task list, a task that is done but had a due date in the past shows "Overdue · <date>" in red. A done task is not late: show its date plainly.',
    expect: {
      outcome: "pull_request",
      shows: ["app"],
      touches: ["src/"],
    },
  },
  {
    name: "api",
    app: "tally",
    about: "An API change: an example of its answer, what changed marked.",
    title: "Return each task's due date from /api/tasks",
    body: "GET /api/tasks leaves out the due date. Add it as `dueOn`, an ISO date (YYYY-MM-DD), or null when the task has none.",
    expect: {
      outcome: "pull_request",
      touches: ["src/"],
    },
  },
  {
    name: "email",
    app: "tally",
    about: "A job that sends an email: the email as its reader sees it.",
    title: "Put overdue tasks first in the weekly digest",
    body: 'The Monday digest email lists my open tasks in one list, so the overdue ones get lost in the middle. Put the overdue tasks first, under their own heading ("Overdue"), then the rest under "This week and later". If nothing is overdue, no Overdue heading.',
    expect: {
      outcome: "pull_request",
      touches: ["src/digest.js"],
    },
  },
  {
    name: "migration",
    app: "tally",
    about: "A database change behind a feature: the feature, film first.",
    title: "Tasks need a priority",
    body: 'We want to mark some tasks as urgent. Give every task a priority: low, normal or high, normal by default; tasks that exist today become normal. Show high-priority tasks with a small red "High" tag in the list, and add a priority picker to the new-task form. Return it from /api/tasks as `priority`.',
    expect: {
      outcome: "pull_request",
      shows: ["app"],
      touches: ["db/migrations/"],
    },
  },
  {
    name: "perf",
    app: "tally",
    about: "Speed: the number, before and after.",
    title: "The task list is slow for big teams",
    body: "Since we imported our backlog (about 3,000 tasks) the task list takes about a second to load, and it gets worse every week. It should load fast. You can reproduce with `npm run db:seed -- --many`.",
    expect: {
      outcome: "pull_request",
      touches: ["src/"],
    },
  },
  {
    name: "refactor",
    app: "tally",
    about: "Nothing anyone sees: no proof, the sentence says it.",
    title: "One date formatter for the app and the digest",
    body: "src/views.js (formatDue) and src/digest.js (dueLabel) each have their own copy of the due-date wording. Keep one, in its own module, used by both, so they can't drift. No change in what people see.",
    expect: {
      outcome: "pull_request",
      hides: ["app"],
      touches: ["src/"],
    },
  },
  {
    name: "deps",
    app: "tally",
    about: "A dependency upgrade: no proof, the sentence says it.",
    title: "Upgrade pg to the latest 8.x",
    body: "We're on pg 8.11.0, pinned. Upgrade to the latest 8.x and keep it pinned to an exact version.",
    expect: {
      outcome: "pull_request",
      hides: ["app"],
      touches: ["package.json", "package-lock.json"],
    },
  },
  {
    name: "ci",
    app: "tally",
    about: "Continuous integration: GitHub's own checks on the pull request.",
    title: "Run the tests on every pull request",
    body: "Nothing runs our tests when a pull request is opened. Add a GitHub Actions workflow that runs `npm ci` and `npm test` on Node 22 for every pull request and every push to main.",
    expect: {
      outcome: "pull_request",
      shows: ["check"],
      hides: ["app"],
      touches: [".github/workflows/"],
    },
  },
  {
    name: "readme",
    app: "tally",
    about: "A documentation change: the document, nothing else.",
    title: "Document the task API in the README",
    body: "The README says nothing about the API. Add an API section for GET /api/tasks: that it needs a signed-in session, each field it returns, and an example response.",
    expect: {
      outcome: "pull_request",
      shows: ["document"],
      hides: ["app"],
      touches: ["README.md"],
    },
  },
  {
    name: "unclear",
    app: "tally",
    about: "A ticket too vague to do: questions, no pull request.",
    title: "Make the app better",
    body: "It could be better.",
    expect: { outcome: "abstained" },
  },
  {
    name: "cli",
    app: "pace",
    about: "A command line tool: an example of what it prints.",
    title: "`pace list --json` for scripts",
    body: "I want to graph my runs in a notebook. Add `--json` to `pace list`: it prints the runs as a JSON array (date, km, seconds, pace in seconds per km, note), newest first, and still honors `--last`. The table stays the default.",
    expect: {
      outcome: "pull_request",
      hides: ["app"],
      touches: ["pace/"],
    },
  },
  {
    name: "library",
    app: "tempo",
    about: "A library: a short example of the new option, run for real.",
    title: "format(): a `largest` option to round to the biggest units",
    body: 'Durations like "1 hour 30 minutes 30 seconds" are too precise for our UI. Add a `largest` option to `format()`: the number of units kept, starting from the biggest, the last one rounded. `format(5_430_000, { largest: 1 })` gives "2 hours", `{ largest: 2 }` gives "1 hour 31 minutes". Document it in the README.',
    expect: {
      outcome: "pull_request",
      hides: ["app"],
      touches: ["src/"],
    },
  },
  {
    name: "ai",
    app: "recap",
    about:
      "A feature built on a language model: its page or an example of its answers, a stub said plainly.",
    title: "Action items should say who and by when",
    body: 'The recap lists action items as plain sentences. When the notes say who owns an item and by when, show them apart: each item gets its task, its owner and its due date ("Friday", "Nov 5"), the owner and date left empty when the notes don\'t say. Show them as a small table on the page and in /api/recap as {task, owner, due}.',
    expect: {
      outcome: "pull_request",
      touches: ["src/"],
      notVerified: true,
    },
  },
  {
    name: "game",
    app: "starfall",
    about: "A game mechanic: the film of it played, and the game to try.",
    title: "Combos for quick catches",
    body: "Catching stars quickly should pay. Stars caught less than a second apart build a combo: x2 for the second, x3 for the third, up to x5, multiplying the star's points. Show the current combo next to the score while it lasts, and the multiplied points where the star was caught. A miss (a star reaching the ground) or a second without a catch ends the combo.",
    expect: {
      outcome: "pull_request",
      shows: ["app"],
      touches: ["public/"],
    },
  },
  {
    name: "pagination",
    app: "shelf",
    about:
      "A Next.js page changed: the page before and after, or a film, and the app.",
    title: "Paginate the products page",
    body: "All 60 products load on one page. Show 12 per page, with Previous and Next and the page numbers under the grid. The page is in the address (`/?page=2`) so it can be shared; the count at the top still says the total.",
    expect: {
      outcome: "pull_request",
      shows: ["app"],
      touches: ["app/"],
    },
  },
];
