import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { talkStep } from "../../src/runner/talk-models";

const system: Anthropic.Beta.BetaTextBlockParam[] = [
  { type: "text", text: "You are Yarrow's agent." },
  { type: "text", text: "Pull request #4." },
];
const look: Anthropic.Beta.BetaTool = {
  name: "look_at_screen",
  description: "What the stage shows now.",
  input_schema: { type: "object", properties: {} },
};

/** Claude's text answer, as the stream sends it. */
function claudeStream(text: string): string {
  return [
    {
      type: "message_start",
      message: {
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 50, output_tokens: 1 },
      },
    },
    {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "" },
    },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: 8 },
    },
    { type: "message_stop" },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

describe("the live call's models", () => {
  it("asks Haiku without thinking or fallback", async () => {
    const bodies: Record<string, unknown>[] = [];
    const betas: (string | null)[] = [];
    const client = new Anthropic({
      apiKey: "test",
      maxRetries: 0,
      fetch: (async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        betas.push(new Headers(init.headers).get("anthropic-beta"));
        return new Response(claudeStream("Deux tâches."), {
          headers: { "content-type": "text/event-stream" },
        });
      }) as typeof fetch,
    });
    const said: string[] = [];
    const step = await talkStep({
      model: "haiku",
      client,
      system,
      tools: [look],
      messages: [{ role: "user", content: "Combien ?" }],
      last: false,
      onText: (text) => said.push(text),
    });

    expect(said.join("")).toBe("Deux tâches.");
    expect(step.toolUse).toBe(false);
    expect(bodies[0]).toMatchObject({
      model: "claude-haiku-5-5",
      thinking: { type: "disabled" },
      output_config: { effort: "low" },
    });
    expect(bodies[0]).not.toHaveProperty("fallbacks");
    expect(betas[0] ?? "").not.toContain("server-side-fallback");
    expect(step.usage).toMatchObject({
      model: "claude-haiku-5-5",
      input: 50,
      output: 8,
    });
  });
});
