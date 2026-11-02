import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { branchFileUrl, Proofs } from "../../src/components/proofs";
import type { Proof } from "../../src/core/proofs";

const render = (proofs: Proof[]) =>
  renderToStaticMarkup(
    createElement(Proofs, {
      proofs,
      document: (file: string) =>
        branchFileUrl("https://github.com/o/r/pull/9", "yarrow/9-readme", file),
    }),
  );

describe("Proofs", () => {
  it("shows each screen before and after, a phone's narrower", () => {
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
        label: "New page",
        before: null,
        after: "runs/r/c.png",
        device: "desktop",
      },
    ]);
    expect(html).toContain('class="pf-phone"');
    expect(html).toContain('src="/evidence/runs/r/a.png"');
    expect(html).toContain(">Before<");
    expect(html).toContain(">After<");
    expect(html).toContain('class="pf-pair pf-one"');
    expect(html).toContain("<span>New page</span>");
  });

  it("shows what a command printed, now first", () => {
    const html = render([
      {
        kind: "output",
        label: "The tests",
        command: "npm test",
        before: "1 failed",
        after: "7 passed",
      },
    ]);
    expect(html).toContain('<span class="pf-command">npm test</span>');
    expect(html).toContain("7 passed");
    expect(html).not.toContain("1 failed");
    expect(html).toContain('aria-pressed="true">After<');
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
    expect(html).toContain('class="pf-better">22× better<');
  });

  it("links a document on the branch", () => {
    expect(render([{ kind: "document", file: "docs/API guide.md" }])).toContain(
      'href="https://github.com/o/r/blob/yarrow/9-readme/docs/API%20guide.md"',
    );
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
