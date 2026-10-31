import { describe, expect, it } from "vitest";
import { TITLE_MAX } from "../../src/core/new-ticket";
import {
  checkLabel,
  splitCheck,
  splitNote,
  spottedTicket,
} from "../../src/core/pull-notes";

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

  it("reads a check's label, never a command", () => {
    expect(
      checkLabel(
        "Reload keeps the filter: Playwright, reload on /?status=doing → Doing still selected",
      ),
    ).toBe("Reload keeps the filter");
    // Seen on the bench (2026-10-22): a label a little past a few words.
    expect(
      checkLabel(
        "Counts, filtering and the fallback to All are covered by tests: npm test → 7 passed",
      ),
    ).toBe("Counts, filtering and the fallback to All are covered by tests");
    expect(checkLabel("npm test → 6 tests pass, 0 fail")).toBeNull();
    expect(
      checkLabel("curl /?status=doing: shows the 2 Doing tasks"),
    ).toBeNull();
    expect(
      checkLabel(
        `${"A label far too long to be a few words of plain English".repeat(2)}: x`,
      ),
    ).toBeNull();
  });

  it("lists a check by its label, the check as it ran under it", () => {
    expect(
      splitCheck("Reload keeps the filter: Playwright → Doing selected"),
    ).toEqual({
      label: "Reload keeps the filter",
      detail: "Playwright → Doing selected",
    });
    // Written before checks had labels: listed as it was.
    expect(splitCheck("npm test → 6 pass")).toEqual({
      label: "npm test → 6 pass",
      detail: "",
    });
  });

  it("drafts a ticket from what was noticed, the pointer kept in its body", () => {
    const line =
      "Adding a task brings you back to All. — `POST /tasks` redirects to `/`";
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
