import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modelDisplayName } from "../../src/core/pipeline";
import { SANDBOX_PACKAGES } from "../../src/runner/anthropic";
import {
  addCalls,
  metaUsage,
  museActivity,
  museCommand,
  museCostCents,
  museFailure,
} from "../../src/runner/muse";

// Shapes from a real `muse exec --json` run of Muse Code 1.4.13 (2026-10-26).
const event = (sequence: number, type: string, payload: object) =>
  JSON.stringify({
    schema_version: 1,
    sequence,
    record_type: "event",
    payload_type: type,
    payload,
  });
const tool = (
  sequence: number,
  name: string,
  outcome: "success" | "failure",
  extra: object,
) =>
  event(sequence, "tool.result", {
    call_id: `call_${sequence}`,
    correlation_facts: { outcome, tool_name: name },
    kind: "tool_result",
    ...extra,
  });
const bash = (sequence: number, command: string, exit: number, output = "") =>
  tool(sequence, "bash", "success", {
    text: JSON.stringify(
      { command, exit_code: exit, output, terminal_status: "completed" },
      null,
      2,
    ),
  });
/** Each line as the container's wrapper writes it: the time, then the event. */
const log = (...events: string[]) =>
  events
    .map((line, index) => `${1_790_000_000_000 + index} ${line}`)
    .join("\n");

describe("Muse Code's feed", () => {
  it("makes Claude's lines from Muse's events", () => {
    const lines = museActivity(
      log(
        tool(1, "read_file", "success", {
          text: "Read text file `/workspace/repo/src/views.js`.\n1|import x",
        }),
        tool(2, "read_file", "failure", {
          text: 'tool failed: No such file or directory; requested relative path "AGENTS.md"',
        }),
        tool(3, "edit_file", "success", {
          edit_facts: {
            added: 45,
            path: "test/views.test.js",
            removed: 1,
            tool_name: "edit_file",
          },
          text: "edited",
        }),
        tool(4, "write_file", "success", {
          edit_facts: { added: 12, path: "src/filters.js", removed: 0 },
        }),
        tool(5, "write_todos", "success", { text: '{"items":3,"ok":true}' }),
        bash(
          6,
          "cd /workspace/repo && npm test",
          0,
          "# tests 6\n# pass 6\n# fail 0",
        ),
        bash(7, "pnpm vitest run", 1, "Tests  2 failed | 40 passed (42)"),
        bash(8, "ls -la", 0, "total 84"),
        event(9, "run.output.delta", { text: '{"not' }),
        event(10, "run.terminal.completed", { text: '{"status": "done"}' }),
      ),
      1,
    );
    expect(lines.map((line) => [line.kind, line.detail])).toEqual([
      ["read", { path: "src/views.js" }],
      ["edit", { path: "test/views.test.js", added: 45, removed: 1 }],
      ["write", { path: "src/filters.js", lines: 12 }],
      ["test", { command: "npm test", ok: true, passed: 6, failed: 0 }],
      [
        "test",
        { command: "pnpm vitest run", ok: false, passed: 40, failed: 2 },
      ],
      ["command", { command: "ls -la", ok: true }],
    ]);
    expect(lines[0]).toMatchObject({
      externalId: "call_1",
      actor: "implementer",
      at: new Date(1_790_000_000_000).toISOString(),
    });
  });

  it("says why a turn failed, and keeps prose as a note", () => {
    const failed = log(
      event(1, "run.terminal.failed", {
        reason: "model stream failed after 10 attempts",
      }),
    );
    expect(museFailure(failed)).toBe("model stream failed after 10 attempts");
    expect(museActivity(failed, 2)).toMatchObject([
      {
        externalId: "muse:2:1",
        kind: "error",
        detail: { text: "model stream failed after 10 attempts" },
      },
    ]);
    expect(
      museActivity(
        log(event(4, "run.terminal.completed", { text: "Nothing to change." })),
        1,
      ),
    ).toMatchObject([{ kind: "note", detail: { text: "Nothing to change." } }]);
    expect(museFailure(log(bash(1, "ls", 0)))).toBeNull();
  });
});

describe("Muse Code's meter", () => {
  it("reads each completed answer's tokens from Meta's stream", () => {
    const completed = (model: string, input: number, cached: number) =>
      `event: response.completed\ndata: ${JSON.stringify({
        type: "response.completed",
        response: {
          model,
          usage: {
            input_tokens: input,
            input_tokens_details: { cached_tokens: cached },
            output_tokens: 300,
            output_tokens_details: { reasoning_tokens: 120 },
          },
        },
      })}\n\n`;
    const stream = [
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"response.completed"}\n\n',
      completed("muse-wonder-1.0", 40_000, 36_000),
    ].join("");
    expect(metaUsage(stream)).toEqual([
      { model: "muse-wonder-1.0", input: 40_000, cached: 36_000, output: 300 },
    ]);
    // A whole answer, and what is no answer at all.
    expect(
      metaUsage(
        JSON.stringify({
          model: "muse-spark-1.3",
          usage: { input_tokens: 900, output_tokens: 40 },
        }),
      ),
    ).toEqual([{ model: "muse-spark-1.3", input: 900, cached: 0, output: 40 }]);
    expect(metaUsage('{"data":[{"id":"muse-wonder-1.0"}]}')).toEqual([]);
    expect(metaUsage("data: {cut")).toEqual([]);
  });

  it("prices a session at Meta's list prices, with the container", () => {
    const models = addCalls(
      addCalls({}, [
        {
          model: "muse-wonder-1.0",
          input: 600_000,
          cached: 500_000,
          output: 6_000,
        },
        { model: "muse-spark-1.3", input: 100_000, cached: 0, output: 2_000 },
      ]),
      [
        {
          model: "muse-wonder-1.0",
          input: 400_000,
          cached: 300_000,
          output: 4_000,
        },
      ],
    );
    expect(models["muse-wonder-1.0"]).toEqual({
      input: 1_000_000,
      cached: 800_000,
      output: 10_000,
      calls: 2,
    });
    // Wonder: 200k fresh × $4 + 800k cached × $0.20 + 10k out × $20 = $1.16.
    // Spark: 100k × $1.25 + 2k × $4.25 → 14 cents. The container, 10
    // minutes at 0.0061 cents a second → 4 cents.
    expect(
      museCostCents({
        model: "muse-wonder-1.0",
        effort: "high",
        models,
        agentSeconds: 420,
        containerSeconds: 600,
      }),
    ).toBe(116 + 14 + 4);
  });
});

describe("Muse Code's command and machine", () => {
  it("runs headless through the relay, never in contributor mode", () => {
    const command = museCommand({
      model: "muse-wonder-1.0",
      effort: "high",
      session: "8a1c",
      promptFile: "/var/yarrow/prompt-1.md",
    }).join(" ");
    expect(command).toMatch(/^muse exec --json /);
    expect(command).toContain("--contributor-mode off");
    expect(command).toContain("--base-url http://api.meta.ai/v1");
    expect(command).toContain("--session-id 8a1c");
    expect(command).toContain("--prompt-file /var/yarrow/prompt-1.md");
  });

  it("has the recorder's desktop, like Claude's sandbox", () => {
    const dockerfile = readFileSync("workers/muse/Dockerfile", "utf8");
    for (const name of SANDBOX_PACKAGES)
      expect(dockerfile).toContain(` ${name}`);
  });

  it("names Muse Wonder whatever its effort", () => {
    expect(modelDisplayName("muse-wonder-1.0:high")).toBe("Muse Wonder");
    expect(modelDisplayName("muse-wonder-1.0")).toBe("Muse Wonder");
  });
});
