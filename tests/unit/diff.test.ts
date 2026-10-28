import { describe, expect, it } from "vitest";
import { parsePatch, pullRequestRisks } from "../../src/core/diff";

describe("pull request changes", () => {
  it("numbers each side of a unified diff", () => {
    const lines = parsePatch(
      [
        "@@ -88,4 +88,3 @@ public void AddLifePoint(int lifeInput)",
        "         if (lifeInput <= 0)",
        "-        int newLifePoints = _lifePoint += lifeInput;",
        "-",
        "+        UpdateCastle(lifeInput);",
        "     }",
        "\\ No newline at end of file",
      ].join("\n"),
    );
    expect(lines).toEqual([
      {
        kind: "hunk",
        text: "@@ -88,4 +88,3 @@ public void AddLifePoint(int lifeInput)",
      },
      { kind: "ctx", old: 88, new: 88, text: "        if (lifeInput <= 0)" },
      {
        kind: "del",
        old: 89,
        text: "        int newLifePoints = _lifePoint += lifeInput;",
      },
      { kind: "del", old: 90, text: "" },
      { kind: "add", new: 89, text: "        UpdateCastle(lifeInput);" },
      { kind: "ctx", old: 91, new: 90, text: "    }" },
    ]);
  });

  it("reads the risks Yarrow wrote in the description", () => {
    const body = [
      "Closes #6",
      "",
      "## What changed",
      "",
      "One place.",
      "",
      "## Risks",
      "",
      "- Water still calls `LooseOneLifePoint()`.",
      "- `EndGame()` is still empty.",
      "",
      "Need a change? Comment `@yarrow-run` followed by what to change.",
      "",
      "Implemented by Claude Opus 5.5 · Reviewed by GPT Astra",
    ].join("\r\n");
    expect(pullRequestRisks(body)).toEqual([
      "Water still calls `LooseOneLifePoint()`.",
      "`EndGame()` is still empty.",
    ]);
    expect(pullRequestRisks("## What changed\n\nNothing risky.")).toEqual([]);
    expect(pullRequestRisks(null)).toEqual([]);
  });
});
