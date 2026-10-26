import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  activityFromEvent,
  groupActivity,
  reachedStages,
  redactActivity,
  type SessionEvent,
} from "../../src/core/activity";
import { ensureAccount } from "../../src/db/accounts";
import { recordActivity, syncRunActivity } from "../../src/db/activity";
import { createProject } from "../../src/db/projects";
import { runActivityFor } from "../../src/db/queries";
import * as schema from "../../src/db/schema";
import { createTestDatabase } from "./helpers/pglite";

const at = (second: number) =>
  new Date(Date.UTC(2026, 9, 8, 14, 0, second)).toISOString();
const tool = (
  id: string,
  second: number,
  name: string,
  input: Record<string, unknown>,
): SessionEvent => ({
  id,
  type: "agent.tool_use",
  processed_at: at(second),
  name,
  input,
});
const result = (
  id: string,
  second: number,
  toolUseId: string,
  text: string,
  isError = false,
): SessionEvent => ({
  id,
  type: "agent.tool_result",
  processed_at: at(second),
  tool_use_id: toolUseId,
  is_error: isError,
  content: [{ type: "text", text }],
});

describe("reading a session into lines", () => {
  it("names each action in plain terms, relative to the repository", () => {
    expect(
      activityFromEvent(
        tool("e1", 1, "read", { file_path: "/workspace/repo/src/export.ts" }),
      ),
    ).toMatchObject({ kind: "read", detail: { path: "src/export.ts" } });
    expect(
      activityFromEvent(
        tool("e2", 2, "edit", {
          file_path: "/workspace/repo/src/export.ts",
          old_string: "a\nb",
          new_string: "a\nb\nc\nd",
        }),
      ),
    ).toMatchObject({ kind: "edit", detail: { added: 4, removed: 2 } });
    expect(
      activityFromEvent(tool("e3", 3, "bash", { command: "pnpm test export" })),
    ).toMatchObject({ kind: "test", detail: { command: "pnpm test export" } });
    expect(
      activityFromEvent(tool("e4", 4, "bash", { command: "ls -la" })),
    ).toMatchObject({ kind: "command" });
    expect(
      activityFromEvent(result("e5", 5, "e3", "Tests  12 passed | 2 failed")),
    ).toMatchObject({
      detail: { toolUseId: "e3", ok: false, passed: 12, failed: 2 },
    });
    expect(
      activityFromEvent({
        id: "e6",
        type: "agent.message",
        processed_at: at(6),
        content: [{ type: "text", text: "The export breaks on Safari dates." }],
      }),
    ).toMatchObject({ kind: "note" });
    // The final JSON report is not a note.
    expect(
      activityFromEvent({
        id: "e7",
        type: "agent.message",
        processed_at: at(7),
        content: [{ type: "text", text: '{"status":"done"}' }],
      }),
    ).toBeNull();
  });

  it("keeps only kinds and counts for viewers who may not see the code", () => {
    const edit = activityFromEvent(
      tool("e1", 1, "edit", {
        file_path: "/workspace/repo/src/secret.ts",
        old_string: "a",
        new_string: "b",
      }),
    )!;
    expect(redactActivity(edit).detail).toEqual({ added: 1, removed: 1 });
    const note = activityFromEvent({
      id: "e2",
      type: "agent.message",
      processed_at: at(2),
      content: [{ type: "text", text: "Reading the billing module" }],
    })!;
    expect(redactActivity(note).detail).toEqual({});
  });

  it("groups reads, and lights the stages reached", () => {
    const lines = [
      tool("a", 1, "read", { file_path: "a.ts" }),
      tool("b", 2, "read", { file_path: "b.ts" }),
      tool("c", 3, "grep", { pattern: "export" }),
      tool("d", 4, "edit", { file_path: "a.ts", old_string: "x", new_string: "y" }),
    ].map((event) => activityFromEvent(event)!);
    expect(groupActivity(lines).map((group) => [group.kind, group.count])).toEqual([
      ["read", 2],
      ["search", 1],
      ["edit", 1],
    ]);
    expect([...reachedStages(lines, "implementing", "running")]).toEqual([
      "read",
      "write",
    ]);
  });
});

describe("a run's activity feed", async () => {
  const t = await createTestDatabase();
  const { db, raw } = t;
  afterAll(() => t.pg.close());
  beforeEach(() => t.reset());

  const owner = { userId: crypto.randomUUID(), githubLogin: "lea", name: null };
  async function run(visibility: "public" | "listed") {
    const accountId = await ensureAccount(db, owner);
    const projectId = await createProject(db, accountId, owner.userId, {
      repository: `lea/app-${visibility}`,
      description: "",
      productUrl: "",
      visibility,
      categories: ["saas"],
      stacks: [],
      authorizationLabel: "yarrow",
    });
    const [unit] = await raw
      .insert(schema.workUnits)
      .values({
        projectId,
        source: "github",
        externalId: "3",
        title: "Fix export",
        url: "https://github.com/lea/app/issues/3",
        authorized: true,
        status: "running",
      })
      .returning();
    const runId = crypto.randomUUID();
    await raw.insert(schema.agentRuns).values({
      id: runId,
      workUnitId: unit!.id,
      implementer: "claude-opus-5-5:high",
      reviewer: "openai-astra",
      implementerSession: "sesn_1",
    });
    return runId;
  }

  it("reads the session's new events once, merges results, and spaces the reads", async () => {
    const runId = await run("public");
    const pages: SessionEvent[][] = [
      [
        tool("u1", 1, "read", { file_path: "/workspace/repo/src/export.ts" }),
        tool("u2", 2, "bash", { command: "pnpm test" }),
      ],
      [
        // The window overlaps: u2 comes back, with its result.
        tool("u2", 2, "bash", { command: "pnpm test" }),
        result("r2", 9, "u2", "128 passed"),
      ],
    ];
    const asked: (string | null)[] = [];
    const sessions = {
      async listEvents(sessionId: string, after: string | null) {
        expect(sessionId).toBe("sesn_1");
        asked.push(after);
        return pages.shift() ?? [];
      },
    };
    expect(await syncRunActivity(db, sessions, runId, 0)).toBe(true);
    expect(await syncRunActivity(db, sessions, runId, 0)).toBe(true);
    // A viewer right after: within the window, no read.
    expect(await syncRunActivity(db, sessions, runId, 60_000)).toBe(false);
    expect(asked).toEqual([null, new Date(Date.parse(at(2)) - 1000).toISOString()]);

    const feed = await runActivityFor(db, runId, null);
    expect(feed!.lines.map((line) => [line.kind, line.detail])).toEqual([
      ["read", { path: "src/export.ts" }],
      ["test", { command: "pnpm test", ok: true, passed: 128 }],
    ]);
  });

  it("shows a listed project's feed in full to its members only", async () => {
    const runId = await run("listed");
    await recordActivity(db, runId, [
      activityFromEvent(
        tool("u1", 1, "read", { file_path: "/workspace/repo/src/secret.ts" }),
      )!,
      {
        externalId: "outcome",
        at: at(5),
        actor: "yarrow",
        kind: "outcome",
        detail: { phase: "abstained", text: "Out of scope" },
      },
    ]);
    const stranger = await runActivityFor(db, runId, crypto.randomUUID());
    expect(stranger!.detailed).toBe(false);
    expect(stranger!.lines.map((line) => line.detail)).toEqual([
      {},
      { phase: "abstained" },
    ]);
    const member = await runActivityFor(db, runId, owner.userId);
    expect(member!.lines[0]!.detail).toEqual({ path: "src/secret.ts" });
    await raw
      .update(schema.projects)
      .set({ visibility: "hidden" })
      .where(eq(schema.projects.repository, "lea/app-listed"));
    expect(await runActivityFor(db, runId, null)).toBeNull();
  });
});
