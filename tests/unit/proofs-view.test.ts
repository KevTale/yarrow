import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { branchFileUrl, ProofLink, Proofs } from "../../src/components/proofs";
import type { Proof, PullChecks } from "../../src/core/proofs";

const render = (proofs: Proof[]) =>
  renderToStaticMarkup(
    createElement(Proofs, {
      proofs,
      document: (file: string) =>
        branchFileUrl("https://github.com/o/r/pull/9", "yarrow/9-readme", file),
    }),
  );

describe("Proofs", () => {
  it("shows one image to slide across, a phone's in the stage's middle", () => {
    const html = render([
      {
        kind: "images",
        label: "Settings",
        before: "runs/r/a.png",
        after: "runs/r/b.png",
        device: "phone",
      },
      {
        kind: "images",
        label: "Other page",
        before: null,
        after: "runs/r/c.png",
        device: "desktop",
      },
    ]);
    expect(html).toContain('class="pf-frame pf-tall"');
    expect(html).toContain('src="/evidence/runs/r/a.png"');
    expect(html).toContain('aria-label="Slide between before and after"');
    expect(html).toContain(">Before<");
    expect(html).toContain(">After<");
    expect(html).not.toContain("runs/r/c.png");
  });

  it("shows a new screen alone, nothing to slide", () => {
    const html = render([
      {
        kind: "images",
        label: "New page",
        before: null,
        after: "runs/r/c.png",
        device: "desktop",
      },
    ]);
    expect(html).toContain('class="pf-frame"');
    expect(html).not.toContain('type="range"');
    expect(html).not.toContain(">Before<");
  });

  it("shows an example without its command, what changed marked", () => {
    const html = render([
      {
        kind: "output",
        label: "The tests",
        command: "npm test",
        before: "1 failed",
        after: "7 passed",
      },
    ]);
    expect(html).toContain('<div class="pf-line pf-added">7 passed</div>');
    expect(html).not.toContain("npm test");
    expect(html).not.toContain("1 failed");
  });

  it("shows lines taken away when that is the whole change", () => {
    const html = render([
      {
        kind: "output",
        label: "What it prints",
        command: "pace list",
        before: "kept\ngone",
        after: "kept",
      },
    ]);
    expect(html).toContain('<div class="pf-line pf-removed">gone</div>');
  });

  it("shows a measure and how far it moved", () => {
    const html = render([
      {
        kind: "measure",
        label: "Task list load",
        unit: "ms",
        before: 870,
        after: 40,
        better: "lower",
      },
    ]);
    expect(html).toContain("<b>22× better</b>");
    expect(html).toContain("flex-basis:100%");
    expect(html).toContain(">870 ms<");
  });

  it("marks a measure that got worse", () => {
    const html = render([
      {
        kind: "measure",
        label: "Size",
        unit: "kB",
        before: 1000,
        after: 2500,
        better: "lower",
      },
    ]);
    expect(html).toContain('<b class="pf-down">2.5× worse</b>');
    expect(html).toContain(">2,500 kB<");
  });

  it("links a document on the branch, by its name", () => {
    const html = render([{ kind: "document", file: "docs/API guide.md" }]);
    expect(html).toContain(
      'href="https://github.com/o/r/blob/yarrow/9-readme/docs/API%20guide.md"',
    );
    expect(html).toContain('title="docs/API guide.md"');
    expect(html).toContain(">API guide.md<");
  });

  it("offers no button for a document it cannot link", () => {
    expect(
      renderToStaticMarkup(
        createElement(ProofLink, {
          proof: { kind: "document", file: "README.md" },
          document: () => null,
        }),
      ),
    ).toBe("");
  });

  it("says GitHub's checks when they are there, nothing otherwise", () => {
    const checks: PullChecks = {
      name: "test",
      count: 1,
      state: "passed",
      seconds: 6,
      url: "https://github.com/o/r/runs/1",
    };
    const link = (input: PullChecks | null) =>
      renderToStaticMarkup(
        createElement(ProofLink, {
          proof: { kind: "check" },
          document: () => null,
          checks: input,
        }),
      );
    const html = link(checks);
    expect(html).toContain("test passed");
    expect(html).toContain("<small>6s</small>");
    expect(html).toContain('href="https://github.com/o/r/runs/1"');
    expect(
      link({ ...checks, count: 3, state: "failed", seconds: null }),
    ).toContain("3 checks failed");
    expect(link(null)).toBe("");
  });

  it("shows nothing for the app's page alone: the preview's link is it", () => {
    expect(render([{ kind: "app", path: "/settings" }])).toBe("");
    expect(render([])).toBe("");
  });
});

describe("branchFileUrl", () => {
  it("is null without a GitHub pull request or its branch", () => {
    expect(branchFileUrl(null, "main", "README.md")).toBeNull();
    expect(
      branchFileUrl("https://gitlab.com/o/r/-/merge_requests/1", "b", "x"),
    ).toBeNull();
    expect(
      branchFileUrl("https://github.com/o/r/pull/1", null, "README.md"),
    ).toBeNull();
  });
});
