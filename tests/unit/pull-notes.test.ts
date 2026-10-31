import { describe, expect, it } from "vitest";
import { TITLE_MAX } from "../../src/core/new-ticket";
import {
  checkLabel,
  checksLine,
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

  it("folds the checks into their labels, or counts them", () => {
    expect(
      checksLine([
        "Tests pass: npm test → 6 pass",
        "Reload keeps the filter: Playwright → Doing selected",
      ]),
    ).toBe("Tests pass · Reload keeps the filter");
    expect(checksLine(["Tests pass: npm test → 6 pass", "curl / → 200"])).toBe(
      "2 checks passed",
    );
    expect(checksLine(["npm test → 6 pass"])).toBe("1 check passed");
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
