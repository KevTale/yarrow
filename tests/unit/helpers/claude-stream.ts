import Anthropic from "@anthropic-ai/sdk";

export type Block =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

/** Claude's answer as the stream sends it, a few words per event. */
function sse(
  index: number,
  answer: { stop_reason: string; content: Block[] },
): string {
  const events: object[] = [
    {
      type: "message_start",
      message: {
        id: `msg_${index}`,
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: 100,
          output_tokens: 1,
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 0,
        },
      },
    },
  ];
  answer.content.forEach((block, at) => {
    if (block.type === "text") {
      events.push({
        type: "content_block_start",
        index: at,
        content_block: { type: "text", text: "" },
      });
      for (const word of block.text.match(/\S+\s*/g) ?? [])
        events.push({
          type: "content_block_delta",
          index: at,
          delta: { type: "text_delta", text: word },
        });
    } else {
      events.push({
        type: "content_block_start",
        index: at,
        content_block: { ...block, input: {} },
      });
      events.push({
        type: "content_block_delta",
        index: at,
        delta: {
          type: "input_json_delta",
          partial_json: JSON.stringify(block.input),
        },
      });
    }
    events.push({ type: "content_block_stop", index: at });
  });
  events.push(
    {
      type: "message_delta",
      delta: { stop_reason: answer.stop_reason, stop_sequence: null },
      usage: { output_tokens: 20 },
    },
    { type: "message_stop" },
  );
  return events
    .map(
      (event) =>
        `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join("");
}

export function claude(
  script: (body: Record<string, unknown>) => {
    stop_reason: string;
    content: Block[];
  },
) {
  const requests: { body: Record<string, unknown>; beta: string | null }[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    requests.push({
      body,
      beta: new Headers(init.headers).get("anthropic-beta"),
    });
    return new Response(sse(requests.length, script(body)), {
      headers: { "content-type": "text/event-stream" },
    });
  }) as typeof fetch;
  return {
    requests,
    client: new Anthropic({ apiKey: "test", fetch: fetcher, maxRetries: 0 }),
  };
}
