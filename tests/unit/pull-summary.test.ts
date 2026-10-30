import { describe, expect, it } from "vitest";
import { pullRequestNow } from "../../src/db/pull-panel";
import { implementationResultSchema } from "../../src/runner/prompts";
import {
  BLOCK_END,
  BLOCK_START,
  pullRequestBlock,
  pullRequestBody,
  replaceBlock,
} from "../../src/runner/pull-request";

const input = {
  ticket: {
    title: "Add truncate",
    url: "https://github.com/a/b/issues/10",
    source: "github",
    number: 10,
  },
  summary: "Adds truncate.",
  verification: ["npm test → 10 pass"],
  notVerified: ["npm run build: no network for Google Fonts"],
  risks: [],
  spotted: ["README links to a page that moved"],
  review: null,
  evidence: [],
};

describe("the pull request's summary", () => {
  it("puts each kind of note in its own section, Yarrow's part marked", () => {
    const body = pullRequestBody({
      ...input,
      roles: { implementer: "claude-opus-5-5", reviewer: "openai-astra" },
      sponsors: [],
      runUrl: "https://yarrow.run/runs/1",
      appSlug: "yarrow-run",
    });
    expect(body.startsWith(BLOCK_START)).toBe(true);
    expect(body).toContain("## Not verified\n\n- npm run build");
    expect(body).toContain("## Spotted outside this ticket");
    expect(body).not.toContain("## Before merging");
    expect(body.indexOf(BLOCK_END)).toBeLessThan(
      body.indexOf("Need a change?"),
    );
  });

  it("shows a public project's screenshots, and only counts a private one's", () => {
    const shot = {
      kind: "screenshot" as const,
      label: "Truncated title",
      url: "https://yarrow.run/evidence/runs/1/ab-title.png",
    };
    const open = pullRequestBlock({ ...input, evidence: [shot] });
    expect(open).toContain(
      "## Screenshots\n\n**Truncated title**\n\n![Truncated title](https://yarrow.run/evidence/runs/1/ab-title.png)",
    );
    const hidden = pullRequestBlock({
      ...input,
      evidenceInYarrow: { count: 2, url: "https://yarrow.run/runs/1" },
    });
    expect(hidden).not.toContain("## Screenshots");
    expect(hidden).not.toContain("/evidence/");
    expect(hidden).toContain(
      "- npm test → 10 pass\n- [2 screenshots](https://yarrow.run/runs/1), in Yarrow",
    );
  });

  it("reads the recipe the agent found, and drops one that does not parse", () => {
    const base = { status: "done", summary: "Done." };
    const found = implementationResultSchema.parse({
      ...base,
      recipe: {
        mode: "dev",
        steps: ["pnpm install", "pnpm dev &"],
        url: "http://localhost:5173",
        sign_in: null,
      },
    });
    expect(found.recipe).toEqual({
      mode: "dev",
      steps: ["pnpm install", "pnpm dev &"],
      url: "http://localhost:5173",
      signIn: null,
      notes: [],
    });
    const broken = implementationResultSchema.parse({
      ...base,
      recipe: { mode: "somehow", steps: [] },
    });
    expect(broken.recipe).toBeUndefined();
    expect(broken.status).toBe("done");
  });

  it("rewrites only Yarrow's part, keeping what people wrote around it", () => {
    const before = `Notes from Marie.\n\n${pullRequestBlock(input)}\n\nNeed a change? Comment @yarrow-run\n\nImplemented by Claude`;
    const after = replaceBlock(
      before,
      pullRequestBlock({ ...input, summary: "Adds truncate with an ending." }),
    )!;
    expect(after.startsWith("Notes from Marie.")).toBe(true);
    expect(after).toContain("Adds truncate with an ending.");
    expect(after).not.toContain("Adds truncate.\n");
    expect(after.endsWith("Implemented by Claude")).toBe(true);
  });

  it("rewrites an older description up to its correction line", () => {
    const older =
      "Closes #10\n\n## What changed\n\nOld.\n\nNeed a change? Comment @yarrow-run\n\nImplemented by Claude";
    const after = replaceBlock(older, pullRequestBlock(input))!;
    expect(after).not.toContain("Old.");
    expect(after).toContain("Need a change?");
    expect(replaceBlock("Rewritten by hand.", "x")).toBeNull();
  });

  it("follows the corrections that rewrote the whole summary", () => {
    const implementation = {
      kind: "implementation" as const,
      outcome: "pull_request" as const,
      summary: "Adds truncate.",
      evidence: ["npm test → 10 pass"],
      details: { notVerified: [], risks: [], spotted: ["a"] },
    };
    expect(pullRequestNow([implementation])).toMatchObject({
      summary: "Adds truncate.",
      spotted: ["a"],
      legacy: false,
    });
    const now = pullRequestNow([
      implementation,
      {
        kind: "correction",
        outcome: "pull_request",
        summary: "Adds the ending.",
        evidence: ["npm test → 13 pass"],
        details: {
          pullRequestSummary: "Adds truncate with an ending.",
          notVerified: [],
          risks: [],
          spotted: [],
        },
      },
      // Delivered without a whole summary: what came before stands.
      {
        kind: "correction",
        outcome: "pull_request",
        summary: "Renames a test.",
        evidence: [],
        details: null,
      },
      {
        kind: "correction",
        outcome: "abstained",
        summary: "x",
        evidence: [],
        details: null,
      },
    ]);
    expect(now).toMatchObject({
      summary: "Adds truncate with an ending.",
      verification: ["npm test → 13 pass"],
      spotted: [],
    });
  });

  it("keeps at most three short lines per list, whatever the model wrote", () => {
    const result = implementationResultSchema.parse({
      status: "done",
      summary: "s",
      risks: [" a ", "", "b", "c", "d"],
    });
    expect(result.risks).toEqual(["a", "b", "c"]);
    expect(result.not_verified).toEqual([]);
    expect(result.spotted).toEqual([]);
  });
});
