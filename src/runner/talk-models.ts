import Anthropic from "@anthropic-ai/sdk";
import type { ChatUsage } from "../core/chat";

/**
 * Who can answer on the live call (src/runner/talk.ts): Claude, tuned for
 * a quick spoken turn, or Meta's Muse through its Chat Completions API,
 * the only one of Meta's that lets reasoning go down to "minimal". Each
 * answer comes back as Claude's would, so the turn's loop is the same.
 */

export const TALK_MODELS = {
  /** Opus 5.5 at low effort: its thinking cannot be turned off. */
  opus: { provider: "anthropic", id: "claude-opus-5-5" },
  /** The same, in fast mode: quicker output, twice the price. */
  "opus-fast": { provider: "anthropic", id: "claude-opus-5-5" },
  sonnet: { provider: "anthropic", id: "claude-sonnet-5-5" },
  /** Haiku 5.5 without thinking. */
  haiku: { provider: "anthropic", id: "claude-haiku-5-5" },
  wonder: { provider: "meta", id: "muse-wonder-1.0" },
  spark: { provider: "meta", id: "muse-spark-1.3" },
} as const;
export type TalkModelName = keyof typeof TALK_MODELS;

export const isTalkModel = (name: unknown): name is TalkModelName =>
  typeof name === "string" && Object.hasOwn(TALK_MODELS, name);

/** Fast mode is priced apart: its usage is counted under this name. */
export const OPUS_FAST_RATE = "claude-opus-5-5:fast";

const META_COMPLETIONS = "https://api.meta.ai/v1/chat/completions";

export interface TalkClients {
  anthropic: Anthropic;
  /** Meta's key, for Muse. */
  meta?: string;
  fetch?: typeof fetch;
}

export interface TalkStep {
  content: Anthropic.Beta.BetaContentBlockParam[];
  calls: Anthropic.Beta.BetaToolUseBlock[];
  /** It asked for its tools; else it is done. */
  toolUse: boolean;
  usage: ChatUsage;
}

/** One answer of the model, its words given to `onText` as they come. */
export async function talkStep(input: {
  model: TalkModelName;
  clients: TalkClients;
  system: Anthropic.Beta.BetaTextBlockParam[];
  tools: Anthropic.Beta.BetaTool[];
  messages: Anthropic.Beta.BetaMessageParam[];
  /** The last one: words only, no more tools. */
  last: boolean;
  onText: (delta: string) => void;
}): Promise<TalkStep> {
  return TALK_MODELS[input.model].provider === "meta"
    ? museStep(input)
    : claudeStep(input);
}

async function claudeStep(
  input: Parameters<typeof talkStep>[0],
): Promise<TalkStep> {
  const { model, clients, system, tools, messages, last, onText } = input;
  const fast = model === "opus-fast";
  const stream = clients.anthropic.beta.messages.stream({
    model: TALK_MODELS[model].id,
    max_tokens: 4000,
    // Haiku has no server-side fallback, and its thinking can go.
    ...(model === "haiku"
      ? { thinking: { type: "disabled" as const } }
      : {
          betas: [
            "server-side-fallback-2026-07-01",
            ...(fast ? ["fast-mode-2026-02-01"] : []),
          ],
          fallbacks: "default" as const,
          ...(fast ? { speed: "fast" as const } : {}),
        }),
    output_config: { effort: "low" },
    system,
    tools,
    tool_choice: last ? { type: "none" } : { type: "auto" },
    messages,
  });
  stream.on("text", onText);
  const response = await stream.finalMessage();
  const calls = response.content.filter(
    (block): block is Anthropic.Beta.BetaToolUseBlock =>
      block.type === "tool_use",
  );
  return {
    content: response.content,
    calls,
    toolUse: response.stop_reason === "tool_use" && calls.length > 0,
    usage: {
      model: model === "opus-fast" ? OPUS_FAST_RATE : response.model,
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    },
  };
}

/** A message of Chat Completions, as Muse reads it. */
type Completion =
  | { role: "system" | "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

const textOfResult = (
  content: Anthropic.Beta.BetaToolResultBlockParam["content"],
): string =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .map((part) => (part.type === "text" ? part.text : ""))
        .join("\n");

/** The conversation, Claude's way, as Chat Completions messages. */
export function asCompletions(
  system: Anthropic.Beta.BetaTextBlockParam[],
  messages: Anthropic.Beta.BetaMessageParam[],
): Completion[] {
  const out: Completion[] = [
    { role: "system", content: system.map((block) => block.text).join("\n\n") },
  ];
  for (const message of messages) {
    const content: Anthropic.Beta.BetaContentBlockParam[] =
      typeof message.content === "string"
        ? [{ type: "text", text: message.content }]
        : (message.content ?? []);
    const text = content
      .map((block) => (block.type === "text" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
    if (message.role === "assistant") {
      const calls = content.filter(
        (block): block is Anthropic.Beta.BetaToolUseBlockParam =>
          block.type === "tool_use",
      );
      out.push({
        role: "assistant",
        content: text || null,
        ...(calls.length
          ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.input ?? {}),
                },
              })),
            }
          : {}),
      });
      continue;
    }
    // A tool's results answer the call before the member's words.
    for (const block of content)
      if (block.type === "tool_result")
        out.push({
          role: "tool",
          tool_call_id: block.tool_use_id,
          content: textOfResult(block.content),
        });
    if (text) out.push({ role: "user", content: text });
  }
  return out;
}

interface CompletionChunk {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
}

async function museStep(
  input: Parameters<typeof talkStep>[0],
): Promise<TalkStep> {
  const { model, clients, system, tools, messages, last, onText } = input;
  if (!clients.meta) throw new Error("Muse needs META_API_KEY.");
  const response = await (clients.fetch ?? fetch)(META_COMPLETIONS, {
    method: "POST",
    headers: {
      authorization: `Bearer ${clients.meta}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: TALK_MODELS[model].id,
      messages: asCompletions(system, messages),
      tools: tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.input_schema,
        },
      })),
      tool_choice: last ? "none" : "auto",
      reasoning_effort: "minimal",
      max_completion_tokens: 4000,
      stream: true,
      stream_options: { include_usage: true },
    }),
  });
  if (!response.ok || !response.body)
    throw new Error(
      `Muse ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  let text = "";
  const pending: { id: string; name: string; args: string }[] = [];
  let finish: string | null = null;
  let usage: CompletionChunk["usage"] = null;
  const read = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const chunk = JSON.parse(data) as CompletionChunk;
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) return;
    if (choice.finish_reason) finish = choice.finish_reason;
    const words = choice.delta?.content;
    if (words) {
      text += words;
      onText(words);
    }
    for (const part of choice.delta?.tool_calls ?? []) {
      const index = part.index ?? pending.length;
      const call = (pending[index] ??= {
        id: part.id ?? `call_${index}`,
        name: "",
        args: "",
      });
      if (part.id) call.id = part.id;
      if (part.function?.name) call.name += part.function.name;
      if (part.function?.arguments) call.args += part.function.arguments;
    }
  };
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) read(line);
  }
  read(buffer);
  const calls: Anthropic.Beta.BetaToolUseBlock[] = pending
    .filter((call) => call?.name)
    .map((call) => {
      let parsed: unknown = {};
      try {
        parsed = call.args ? JSON.parse(call.args) : {};
      } catch {
        // Left empty: the tool says the call was invalid.
      }
      return { type: "tool_use", id: call.id, name: call.name, input: parsed };
    });
  const spent = usage as CompletionChunk["usage"];
  const cached = spent?.prompt_tokens_details?.cached_tokens ?? 0;
  return {
    content: [...(text ? [{ type: "text" as const, text }] : []), ...calls],
    calls,
    toolUse: calls.length > 0 && finish !== "length",
    usage: {
      model: TALK_MODELS[model].id,
      input: (spent?.prompt_tokens ?? 0) - cached,
      output: spent?.completion_tokens ?? 0,
      cacheRead: cached,
      cacheWrite: 0,
    },
  };
}
