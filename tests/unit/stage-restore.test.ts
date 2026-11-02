import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import type {
  StageChange,
  StageCueResult,
  StageHand,
} from "../../src/core/stage";
import {
  RESTORE_MAX_STEPS,
  restoreStage,
} from "../../src/runner/stage-restore";

type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

/** Claude answering each round as the script says, as the API sends it. */
function claude(
  script: (round: number) => { stop_reason: string; content: Block[] },
) {
  const requests: Record<string, unknown>[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    requests.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const answer = script(requests.length);
    return Response.json({
      id: `msg_${requests.length}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 10,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      ...answer,
    });
  }) as typeof fetch;
  return {
    requests,
    client: new Anthropic({ apiKey: "test", fetch: fetcher, maxRetries: 0 }),
  };
}

function stage(answers: Partial<Record<StageHand["action"], StageCueResult>>) {
  const hands: StageHand[] = [];
  return {
    hands,
    stage: async (hand: StageHand) => {
      hands.push(hand);
      return answers[hand.action] ?? { ok: true, problems: [] };
    },
  };
}

const signedOut: StageChange = {
  window: "before",
  then: { url: "http://localhost:3001/", screen: '- heading "Tasks"' },
  now: { url: "http://localhost:3001/login", screen: '- textbox "Email"' },
};

describe("the stage put back after a talk", () => {
  it("is told each window as it was and is, and acts until they match", async () => {
    const { client, requests } = claude((round) =>
      round === 1
        ? {
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "show_window",
                input: { window: "before" },
              },
              { type: "tool_use", id: "t2", name: "sign_in", input: {} },
            ],
          }
        : {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Done." }],
          },
    );
    const { stage: hands, hands: asked } = stage({
      "sign-in": { ok: true, problems: [], screen: '- heading "Tasks"' },
    });
    const restored = await restoreStage({
      client,
      changes: [signedOut],
      stage: hands,
    });

    expect(restored.problems).toEqual([]);
    expect(asked).toEqual([
      { action: "window", window: "before" },
      { action: "sign-in" },
    ]);
    expect(restored.steps.map((step) => step.what)).toEqual([
      "claude",
      "show_window",
      "sign_in",
      "claude",
    ]);
    expect(restored.usage).toMatchObject({ input: 200, output: 20 });
    const first = requests[0]!;
    expect(first).toMatchObject({
      model: "claude-opus-5-5",
      output_config: { effort: "low" },
    });
    const told = (first.messages as { content: string }[])[0]!.content;
    expect(told).toContain('Window "before"');
    expect(told).toContain("http://localhost:3001/login");
    expect(told).toContain('- heading "Tasks"');
    const tools = (first.tools as { name: string }[]).map((tool) => tool.name);
    expect(tools).toContain("sign_in");
    expect(tools).not.toContain("run_in_terminal");
    const results = (requests[1]!.messages as { content: unknown }[])[2]!
      .content;
    expect(results).toMatchObject([
      { tool_use_id: "t1" },
      { tool_use_id: "t2", content: '- heading "Tasks"' },
    ]);
  });

  it("lets the presentation go on as it is when it cannot", async () => {
    const { client, requests } = claude(() => ({
      stop_reason: "tool_use",
      content: [
        { type: "tool_use", id: "t", name: "look_at_screen", input: {} },
      ],
    }));
    const restored = await restoreStage({
      client,
      changes: [signedOut],
      stage: stage({}).stage,
    });
    expect(requests).toHaveLength(RESTORE_MAX_STEPS);
    expect(restored.problems).toEqual([
      "the stage was not put back in time: it goes on as it is",
    ]);
  });
});
