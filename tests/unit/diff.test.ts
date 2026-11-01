import { describe, expect, it } from "vitest";
import { parsePatch } from "../../src/core/diff";

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
});
