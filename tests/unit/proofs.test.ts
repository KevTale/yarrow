import { describe, expect, it } from "vitest";
import {
  changedAt,
  foldOutput,
  isAppPath,
  leadProof,
  measureChange,
  outputDiff,
  OUTPUT_CHARS,
  parseAgentProofs,
  proofImages,
  proofsMarkdown,
  pullChecks,
  storedProofs,
  type CheckRun,
  type Proof,
} from "../../src/core/proofs";

describe("parseAgentProofs", () => {
  it("keeps what parses, within the limits, and drops the rest", () => {
    const proofs = parseAgentProofs([
      {
        kind: "images",
        label: "Settings on a phone",
        before: "proof/settings-before.png",
        after: "proof/settings-after.png",
        device: "phone",
      },
      { kind: "images", label: "No after", before: "proof/a.png" },
      { kind: "images", label: "Not an image", after: "proof/notes.txt" },
      { kind: "output", label: "Empty", command: "npm test", after: "  " },
      { kind: "document", file: "README.md" },
      { kind: "app", path: "/settings" },
      { kind: "app", path: "/tasks" },
      { kind: "app", path: "https://evil.example" },
      { kind: "film" },
      "README.md",
    ]);
    expect(proofs).toEqual([
      {
        kind: "images",
        label: "Settings on a phone",
        before: "proof/settings-before.png",
        after: "proof/settings-after.png",
        device: "phone",
      },
      { kind: "document", file: "README.md" },
      // One app page: the first.
      { kind: "app", path: "/settings" },
    ]);
    expect(parseAgentProofs("proofs")).toEqual([]);
    expect(parseAgentProofs(undefined)).toEqual([]);
  });

  it("keeps an output's end, where results print", () => {
    const long = `${"x".repeat(OUTPUT_CHARS)}\r\nTests: 12 passed\r\n`;
    const [proof] = parseAgentProofs([
      {
        kind: "output",
        label: "The tests",
        command: "npm test",
        before: 42,
        after: long,
      },
    ]);
    expect(proof).toMatchObject({ kind: "output", before: null });
    const after = (proof as { after: string }).after;
    expect(after).toHaveLength(OUTPUT_CHARS);
    expect(after.endsWith("x\nTests: 12 passed")).toBe(true);
  });

  it("reads a stray device or before as the default", () => {
    expect(
      parseAgentProofs([
        {
          kind: "images",
          label: "Home",
          before: "https://example.com/a.png",
          after: "proof/home.png",
          device: "tablet",
        },
      ]),
    ).toEqual([
      {
        kind: "images",
        label: "Home",
        before: null,
        after: "proof/home.png",
        device: "desktop",
      },
    ]);
  });
});

describe("stored proofs", () => {
  const agent = parseAgentProofs([
    {
      kind: "images",
      label: "Banner",
      before: "proof/banner-before.png",
      after: "proof/banner-after.png",
    },
    {
      kind: "images",
      label: "Footer",
      before: "proof/banner-before.png",
      after: "proof/footer.png",
    },
    {
      kind: "measure",
      label: "Page load",
      unit: "ms",
      before: 2900,
      after: 140,
      better: "lower",
    },
  ]);

  it("names each image once", () => {
    expect(proofImages(agent)).toEqual([
      "proof/banner-before.png",
      "proof/banner-after.png",
      "proof/footer.png",
    ]);
  });

  it("keys the images it could copy and drops a proof without its after", () => {
    const keys = new Map([
      ["proof/banner-after.png", "runs/r/1-banner-after.png"],
      ["proof/footer.png", "runs/r/2-footer.png"],
    ]);
    expect(storedProofs(agent, keys)).toEqual([
      {
        kind: "images",
        label: "Banner",
        before: null,
        after: "runs/r/1-banner-after.png",
        device: "desktop",
      },
      {
        kind: "images",
        label: "Footer",
        before: null,
        after: "runs/r/2-footer.png",
        device: "desktop",
      },
      agent[2],
    ]);
    expect(storedProofs(agent, new Map())).toEqual([agent[2]]);
  });
});

describe("measureChange", () => {
  const measure = (before: number, after: number, better: "lower" | "higher") =>
    measureChange({
      kind: "measure",
      label: "x",
      unit: "ms",
      before,
      after,
      better,
    });

  it("says how it moved", () => {
    expect(measure(2900, 140, "lower")).toBe("21× better");
    expect(measure(100, 65, "lower")).toBe("35% better");
    expect(measure(100, 250, "lower")).toBe("2.5× worse");
    expect(measure(40, 50, "higher")).toBe("25% better");
    expect(measure(5, 5, "lower")).toBe("unchanged");
    expect(measure(0, 5, "higher")).toBeNull();
  });
});

const links = (shown: boolean) => ({
  image: (key: string) => (shown ? `https://yarrow.run/evidence/${key}` : null),
  document: (file: string) => `https://github.com/o/r/blob/yarrow/42/${file}`,
  app: (path: string) =>
    `https://yarrow.run/preview/p/42?path=${encodeURIComponent(path)}`,
  runUrl: "https://yarrow.run/runs/r",
});

describe("proofsMarkdown", () => {
  const proofs: Proof[] = [
    {
      kind: "images",
      label: "Home [new]",
      before: null,
      after: "runs/r/home.png",
      device: "desktop",
    },
    {
      kind: "images",
      label: "Menu",
      before: "runs/r/a.png",
      after: "runs/r/b.png",
      device: "phone",
    },
    {
      kind: "output",
      label: "Example",
      command: "node `x`.js",
      before: null,
      after: "```js\nok\n```",
    },
    {
      kind: "measure",
      label: "List load",
      unit: "ms",
      before: 900,
      after: 300,
      better: "lower",
    },
    { kind: "document", file: "docs/setup.md" },
  ];

  it("shows a public project's images, each proof marked", () => {
    const text = proofsMarkdown(proofs, links(true));
    expect(text).toMatch(
      /^<!-- yarrow:proof images -->\n\*\*Home \[new\]\*\*\n\n!\[Home new\]\(https:\/\/yarrow\.run\/evidence\/runs\/r\/home\.png\)/,
    );
    expect(text).toContain(
      "| Before | After |\n| --- | --- |\n| ![Before](https://yarrow.run/evidence/runs/r/a.png) | ![After](https://yarrow.run/evidence/runs/r/b.png) |",
    );
    // A fence the output cannot close.
    expect(text).toContain("`node 'x'.js`\n\n````\n```js\nok\n```\n````");
    expect(text).toContain("**List load**: 900 ms → 300 ms (3× better)");
    expect(text).toContain(
      "[docs/setup.md](https://github.com/o/r/blob/yarrow/42/docs/setup.md), as it reads on this branch",
    );
    expect(text.match(/<!-- yarrow:proof [\w ]+ -->/g)).toEqual([
      "<!-- yarrow:proof images -->",
      // The menu's screens are a phone's.
      "<!-- yarrow:proof images phone -->",
      "<!-- yarrow:proof output -->",
      "<!-- yarrow:proof measure -->",
      "<!-- yarrow:proof document -->",
    ]);
  });

  it("counts a private project's images, seen in Yarrow", () => {
    const text = proofsMarkdown(proofs, links(false));
    expect(text).not.toContain("evidence");
    expect(text).toContain("[3 images](https://yarrow.run/runs/r), in Yarrow");
    expect(text.match(/<!-- yarrow:proof images( phone)? -->/g)).toHaveLength(
      2,
    );
  });

  it("links the app, and is empty without proofs", () => {
    expect(
      proofsMarkdown([{ kind: "app", path: "/settings" }], links(true)),
    ).toBe(
      "<!-- yarrow:proof app -->\n[Try it in the app](https://yarrow.run/preview/p/42?path=%2Fsettings)",
    );
    expect(proofsMarkdown([], links(true))).toBe("");
  });
});

describe("an output read without a terminal", () => {
  it("marks the lines that changed, the one gone first", () => {
    expect(outputDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
    // Trailing spaces are no change, nor a comma before a new line.
    expect(outputDiff("ok  ", "ok")).toEqual([{ kind: "same", text: "ok" }]);
    expect(outputDiff('"a": 1', '"a": 1,\n"b": 2')).toEqual([
      { kind: "same", text: '"a": 1,' },
      { kind: "added", text: '"b": 2' },
    ]);
    // Every line changed: each as it was right above it as it is.
    expect(outputDiff("x 1\ny 1", "x 2\ny 2").map((line) => line.text)).toEqual(
      ["x 1", "x 2", "y 1", "y 2"],
    );
  });

  it("folds the unchanged lines away from a change", () => {
    const after = Array.from({ length: 12 }, (_, i) => `line ${i}`);
    const before = after.map((line, i) => (i === 9 ? "old" : line));
    const shown = foldOutput(
      outputDiff(before.join("\n"), after.join("\n")).filter(
        (line) => line.kind !== "removed",
      ),
    );
    expect(shown).toEqual([
      { folded: 7 },
      { kind: "same", text: "line 7" },
      { kind: "same", text: "line 8" },
      { kind: "added", text: "line 9" },
      { kind: "same", text: "line 10" },
      { kind: "same", text: "line 11" },
    ]);
    // Nothing changed: its first lines.
    const same = after.concat(after).map((text) => ({
      kind: "same" as const,
      text,
    }));
    expect(foldOutput(same)).toEqual([...same.slice(0, 10), { folded: 14 }]);
  });

  it("is green and red in the description, once when nothing moved", () => {
    const output = (before: string | null, after: string) =>
      proofsMarkdown(
        [
          {
            kind: "output",
            label: "Tests",
            command: "npm test",
            before,
            after,
          },
        ],
        links(true),
      );
    expect(output("1 failed\nok a", "ok a\nok b")).toContain(
      "```diff\n- 1 failed\n  ok a\n+ ok b\n```",
    );
    expect(output("same", "same")).toContain("`npm test`\n\n```\nsame\n```");
    expect(output(null, "7 passed")).toContain("```\n7 passed\n```");
  });
});

describe("the one thing shown", () => {
  const measure: Proof = {
    kind: "measure",
    label: "Load",
    unit: "ms",
    before: 900,
    after: 40,
    better: "lower",
  };
  const output: Proof = {
    kind: "output",
    label: "The answer",
    command: "curl /api",
    before: null,
    after: "{}",
  };
  const image: Proof = {
    kind: "images",
    label: "Settings",
    before: "a.png",
    after: "b.png",
    device: "desktop",
  };

  it("takes the most telling, whatever the order", () => {
    const app: Proof = { kind: "app", path: "/" };
    expect(leadProof([output, measure, app, image])).toBe(image);
    expect(leadProof([output, app, measure])).toBe(measure);
    expect(leadProof([{ kind: "check" }, output])).toBe(output);
    expect(leadProof([{ kind: "check" }])).toEqual({ kind: "check" });
  });

  it("is nothing for the app's page alone, or no proof", () => {
    expect(leadProof([{ kind: "app", path: "/" }])).toBeNull();
    expect(leadProof([])).toBeNull();
  });

  it("keeps a check as the agent lists it", () => {
    expect(parseAgentProofs([{ kind: "check" }])).toEqual([{ kind: "check" }]);
  });
});

describe("changedAt", () => {
  /** A strip of grey pixels, with some columns painted. */
  const strip = (width: number, painted: number[] = []) => {
    const pixels = new Uint8ClampedArray(width * 2 * 4).fill(120);
    for (const column of painted)
      for (const row of [0, 1]) pixels[(row * width + column) * 4] = 255;
    return pixels;
  };

  it("opens on the middle of what changed", () => {
    expect(changedAt(strip(100), strip(100, [59, 60]), 100)).toBe(60);
    expect(changedAt(strip(100), strip(100, [20, 39]), 100)).toBe(30);
  });

  it("is null when nothing moved, faint noise included", () => {
    const noisy = strip(100);
    noisy[40] = 130;
    expect(changedAt(strip(100), noisy, 100)).toBeNull();
  });

  it("keeps the grip inside the frame", () => {
    expect(changedAt(strip(100), strip(100, [0]), 100)).toBe(6);
    expect(changedAt(strip(100), strip(100, [99]), 100)).toBe(94);
  });
});

describe("pullChecks", () => {
  const url = "https://github.com/o/r/pull/9";
  const run = (overrides: Partial<CheckRun> = {}): CheckRun => ({
    name: "test",
    status: "completed",
    conclusion: "success",
    started_at: "2026-10-30T10:00:00Z",
    completed_at: "2026-10-30T10:00:06Z",
    html_url: "https://github.com/o/r/runs/1",
    ...overrides,
  });

  it("says one check with its time and its page", () => {
    expect(pullChecks([run()], url)).toEqual({
      name: "test",
      count: 1,
      state: "passed",
      seconds: 6,
      url: "https://github.com/o/r/runs/1",
    });
  });

  it("counts several, any failure or run under way showing", () => {
    const lint = run({ name: "lint" });
    expect(pullChecks([run(), lint], url)).toMatchObject({
      count: 2,
      state: "passed",
      seconds: null,
      url: `${url}/checks`,
    });
    expect(
      pullChecks([run(), run({ name: "lint", conclusion: "failure" })], url)
        ?.state,
    ).toBe("failed");
    expect(
      pullChecks(
        [run(), run({ name: "lint", status: "in_progress", conclusion: null })],
        url,
      )?.state,
    ).toBe("running");
  });

  it("reads a re-run as the check, and none as nothing", () => {
    const failed = run({ conclusion: "failure" });
    expect(pullChecks([run(), failed], url)?.state).toBe("passed");
    expect(pullChecks([], url)).toBeNull();
  });
});

describe("isAppPath", () => {
  it("is a page of the app, never another site", () => {
    for (const path of ["/", "/tasks?status=doing", "/a/b#c"])
      expect(isAppPath(path)).toBe(true);
    for (const path of [
      "",
      "tasks",
      "//evil.example",
      "/\\evil.example",
      "/a\\b",
      "/a b",
      "https://evil.example",
      `/${"a".repeat(500)}`,
    ])
      expect(isAppPath(path)).toBe(false);
  });
});
