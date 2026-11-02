import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { chatCostCents } from "../../src/core/chat";
import { asCompletions, talkStep } from "../../src/runner/talk-models";

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

/** Chat Completions chunks, as Meta streams them. */
const chunks = (...deltas: object[]) =>
  deltas.map((delta) => `data: ${JSON.stringify(delta)}\n\n`).join("") +
  "data: [DONE]\n\n";

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
      clients: { anthropic: client },
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

  it("asks Muse through Chat Completions, its answer read as Claude's", async () => {
    const requests: { url: string; body: Record<string, unknown> }[] = [];
    const meta = (async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(
        chunks(
          { choices: [{ index: 0, delta: { content: "Je " } }] },
          { choices: [{ index: 0, delta: { content: "regarde." } }] },
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_a",
                      function: { name: "look_at_screen", arguments: "" },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [{ index: 0, function: { arguments: "{}" } }],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
          {
            choices: [],
            usage: {
              prompt_tokens: 1200,
              completion_tokens: 30,
              prompt_tokens_details: { cached_tokens: 1000 },
            },
          },
        ),
        { headers: { "content-type": "text/event-stream" } },
      );
    }) as typeof fetch;
    const said: string[] = [];
    const step = await talkStep({
      model: "spark",
      clients: {
        anthropic: new Anthropic({ apiKey: "unused" }),
        meta: "meta-test",
        fetch: meta,
      },
      system,
      tools: [{ ...look, eager_input_streaming: true }],
      messages: [{ role: "user", content: "Montre-moi." }],
      last: false,
      onText: (text) => said.push(text),
    });

    expect(said.join("")).toBe("Je regarde.");
    expect(step.toolUse).toBe(true);
    expect(step.calls).toEqual([
      { type: "tool_use", id: "call_a", name: "look_at_screen", input: {} },
    ]);
    expect(step.content).toEqual([
      { type: "text", text: "Je regarde." },
      { type: "tool_use", id: "call_a", name: "look_at_screen", input: {} },
    ]);
    expect(step.usage).toEqual({
      model: "muse-spark-1.3",
      input: 200,
      output: 30,
      cacheRead: 1000,
      cacheWrite: 0,
    });
    expect(chatCostCents(step.usage)).toBeCloseTo(
      (200 * 1.25 + 30 * 4.25 + 1000 * 0.15) / 10_000,
    );
    expect(requests[0]!.url).toBe("https://api.meta.ai/v1/chat/completions");
    expect(requests[0]!.body).toMatchObject({
      model: "muse-spark-1.3",
      reasoning_effort: "minimal",
      tool_choice: "auto",
      stream: true,
      tools: [
        {
          type: "function",
          function: {
            name: "look_at_screen",
            description: "What the stage shows now.",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });
  });

  it("gives Muse the call with its tools' results, Chat Completions' way", () => {
    expect(
      asCompletions(system, [
        { role: "user", content: "Montre-moi." },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Je regarde." },
            { type: "tool_use", id: "c1", name: "look_at_screen", input: {} },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "c1",
              content: '- link "Done 1" [ref=e5]',
            },
            { type: "text", text: "Answer now with what you have." },
          ],
        },
      ]),
    ).toEqual([
      {
        role: "system",
        content: "You are Yarrow's agent.\n\nPull request #4.",
      },
      { role: "user", content: "Montre-moi." },
      {
        role: "assistant",
        content: "Je regarde.",
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "look_at_screen", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: '- link "Done 1" [ref=e5]' },
      { role: "user", content: "Answer now with what you have." },
    ]);
  });
});
