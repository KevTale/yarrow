import { describe, expect, it } from "vitest";
import { fileKind, groupFiles } from "../../src/core/changed-files";

describe("changed files", () => {
  it("sorts a path into what a builder reads it as", () => {
    expect(fileKind("apps/rapport-deco/lib/visits.ts")).toBe("implementation");
    expect(fileKind("cloudflare-env.d.ts")).toBe("implementation");
    expect(fileKind("tests/unit/tickets.test.ts")).toBe("tests");
    expect(fileKind("src/text.spec.js")).toBe("tests");
    expect(fileKind("app/__tests__/page.tsx")).toBe("tests");
    expect(fileKind("README.md")).toBe("documentation");
    expect(fileKind("docs/setup.ts")).toBe("documentation");
    expect(fileKind("pnpm-lock.yaml")).toBe("generated");
    expect(fileKind("src/routeTree.gen.ts")).toBe("generated");
    expect(fileKind("drizzle/meta/0019_snapshot.json")).toBe("generated");
    expect(fileKind("public/logo.svg")).toBe("assets");
  });

  it("groups in reading order, keeping each file's place and the sums", () => {
    const groups = groupFiles([
      { path: "README.md", additions: 3, deletions: 1 },
      { path: "src/b.ts", additions: 10, deletions: 2 },
      { path: "src/a.ts", additions: 5, deletions: 0 },
      { path: "src/a.test.ts", additions: 7, deletions: 0 },
    ]);
    expect(groups.map((group) => group.label)).toEqual([
      "Implementation",
      "Tests",
      "Documentation",
    ]);
    expect(groups[0]).toMatchObject({
      files: [{ path: "src/b.ts" }, { path: "src/a.ts" }],
      additions: 15,
      deletions: 2,
    });
  });
});
