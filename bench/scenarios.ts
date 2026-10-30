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
    /** Screenshots of the changed screens, or none (an API, internals). */
    screenshots?: "some" | "none";
    /** Files the change must touch, by path prefix. */
    touches?: string[];
  };
}

export const scenarios: Scenario[] = [
  {
    name: "screenshots",
    about:
      "A visible change: screenshots of the changed screen, the recipe kept.",
    title: "Make the Save button on Settings green",
    body: "On the Settings page, the Save button is purple like every other button. Make that one green (#1d7a4c) so saving stands out. Leave the other buttons as they are.",
    expect: {
      outcome: "pull_request",
      screenshots: "some",
      touches: ["public/", "src/"],
    },
  },
  {
    name: "bugfix",
    about: "A visible bug: fixed, tested, shown.",
    title: "Done tasks show as overdue",
    body: 'In the task list, a task that is done but had a due date in the past shows "Overdue · <date>" in red. A done task is not late: show its date plainly.',
    expect: {
      outcome: "pull_request",
      screenshots: "some",
      touches: ["src/"],
    },
  },
  {
    name: "api",
    about: "An API change: a real request as proof, no screenshot.",
    title: "Return each task's due date from /api/tasks",
    body: "GET /api/tasks leaves out the due date. Add it as `dueOn`, an ISO date (YYYY-MM-DD), or null when the task has none.",
    expect: {
      outcome: "pull_request",
      screenshots: "none",
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
