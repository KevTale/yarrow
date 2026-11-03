import { describe, expect, it } from "vitest";
import { TITLE_MAX } from "../../src/core/new-ticket";
import {
  agentNotes,
  firstSentence,
  criterionMarkdown,
  splitNote,
  spottedTicket,
} from "../../src/core/pull-notes";
import { implementationResultSchema } from "../../src/runner/prompts";

describe("pull request notes", () => {
  it("splits a note's everyday words from its pointer", () => {
    expect(
      splitNote(
        "Adding a task brings you back to All — `POST /tasks` redirects to `/`",
      ),
    ).toEqual({
      plain: "Adding a task brings you back to All",
      detail: "`POST /tasks` redirects to `/`",
    });
    // Written before the pointer had its place: one line, read as is.
    expect(splitNote("POST /tasks redirects to /")).toEqual({
      plain: "POST /tasks redirects to /",
      detail: "",
    });
  });

  it("ticks a criterion in the description, why only when not met", () => {
    expect(
      criterionMarkdown({
        criterion: "A reload keeps the filter",
        status: "met",
        proof: "app",
      }),
    ).toBe("- ✅ A reload keeps the filter");
    expect(
      criterionMarkdown({
        criterion: "Works on a phone",
        status: "unchecked",
        proof: "none",
        note: "no phone browser here",
      }),
    ).toBe("- ⬜ Works on a phone _(not checked: no phone browser here)_");
  });

  it("reads the agent's criteria without ever costing the run", () => {
    const base = { status: "done", summary: "s" };
    const parsed = implementationResultSchema.parse({
      ...base,
      criteria: [
        { criterion: "Filters above the list", status: "met", proof: "app" },
        // "met" with nothing shown is only unchecked.
        { criterion: "All is the default", status: "met" },
        { criterion: "Odd statuses", status: "maybe", proof: "eyes" },
        { status: "met" },
        "not an object",
      ],
    });
    expect(parsed.criteria).toEqual([
      { criterion: "Filters above the list", status: "met", proof: "app" },
      { criterion: "All is the default", status: "unchecked", proof: "none" },
      { criterion: "Odd statuses", status: "unchecked", proof: "none" },
    ]);
    expect(
      implementationResultSchema.parse({ ...base, criteria: "oops" }).criteria,
    ).toEqual([]);
    expect(implementationResultSchema.parse(base).criteria).toEqual([]);
  });

  it("tells what is left to the owner, in everyday words, and nothing else", () => {
    expect(
      agentNotes({
        blocking: [{ body: "A reload loses the filter. — `useState` only" }],
        criteria: [
          { criterion: "Filters show", status: "met", proof: "app" },
          {
            criterion: "Counts",
            status: "unmet",
            proof: "none",
            note: "off by one",
          },
          { criterion: "Odd statuses", status: "unchecked", proof: "none" },
        ],
        risks: ["Run the migration first. — `db/003.sql`"],
        notVerified: [
          "Tried at iPhone size, not on a real iPhone. — no device",
          "Run the migration first.",
        ],
      }),
    ).toEqual([
      "A reload loses the filter.",
      "Not met: Counts (off by one)",
      "Run the migration first.",
      "Tried at iPhone size, not on a real iPhone.",
      "Not checked: Odd statuses",
    ]);
    expect(
      agentNotes({ blocking: [], criteria: [], risks: [], notVerified: [] }),
    ).toEqual([]);
  });

  it("leaves out what GitHub's check has shown once it passed", () => {
    const input = {
      blocking: [],
      criteria: [
        {
          criterion: "The tests run on each pull request",
          status: "unchecked" as const,
          proof: "none" as const,
          note: "Only GitHub can show it",
        },
      ],
      risks: ["Forks get no secrets"],
      notVerified: [],
    };
    expect(agentNotes(input)).toEqual([
      "Forks get no secrets",
      "Not checked: The tests run on each pull request (Only GitHub can show it)",
    ]);
    expect(agentNotes({ ...input, checked: true })).toEqual([
      "Forks get no secrets",
    ]);
  });

  it("says what changed in its first sentence, whole numbers kept", () => {
    expect(firstSentence("Tasks have a priority. Old ones stay normal.")).toBe(
      "Tasks have a priority",
    );
    expect(firstSentence("Node 20.1 is required now")).toBe(
      "Node 20.1 is required now",
    );
  });

  it("drafts a ticket from what was noticed, its first sentence the title", () => {
    const line =
      "Adding a task brings you back to All. Someone working through Doing loses their place. — `POST /tasks` redirects to `/`";
    expect(
      spottedTicket(
        line,
        "Claude Opus 5.5",
        "https://github.com/acme/app/pull/19",
      ),
    ).toEqual({
      title: "Adding a task brings you back to All",
      body: `${line}\n\nNoticed by Claude Opus 5.5 while working on https://github.com/acme/app/pull/19.`,
    });
    const long = spottedTicket("x".repeat(TITLE_MAX + 40), "GPT", null);
    expect(long.title).toHaveLength(TITLE_MAX);
    expect(long.body.endsWith("Noticed by GPT.")).toBe(true);
  });
});
