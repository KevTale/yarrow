/**
 * The bench's scenarios: a ticket filed on a bench repository, and what
 * Yarrow must make of it. Each one starts from bench/app as it is here.
 */
export interface Scenario {
  name: string;
  /** What it proves, for the report. */
  about: string;
  title: string;
  body: string;
  expect: {
    /** A draft pull request, or an abstention with questions. */
    outcome: "pull_request" | "abstained";
    /** The presentation's screens: the app shown working, a command run. */
    shows?: ("app" | "terminal")[];
    /** Files the change must touch, by path prefix. */
    touches?: string[];
  };
}

export const scenarios: Scenario[] = [
  {
    name: "visible",
    about: "A visible change: presented working in the app, the recipe kept.",
    title: "Make the Save button on Settings green",
    body: "On the Settings page, the Save button is purple like every other button. Make that one green (#1d7a4c) so saving stands out. Leave the other buttons as they are.",
    expect: {
      outcome: "pull_request",
      shows: ["app"],
      touches: ["public/", "src/"],
    },
  },
  {
    name: "filter",
    about: "A UI feature: used in the app on screen, the list changing.",
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
    about: "A UI feature typed into: a search shown live, the list narrowing.",
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
    about: "A visible bug: fixed, tested, shown.",
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
    about: "An API change: a real request run in the terminal as proof.",
    title: "Return each task's due date from /api/tasks",
    body: "GET /api/tasks leaves out the due date. Add it as `dueOn`, an ISO date (YYYY-MM-DD), or null when the task has none.",
    expect: {
      outcome: "pull_request",
      shows: ["terminal"],
      touches: ["src/"],
    },
  },
  {
    name: "unclear",
    about: "A ticket too vague to do: questions, no pull request.",
    title: "Make the app better",
    body: "It could be better.",
    expect: { outcome: "abstained" },
  },
];
