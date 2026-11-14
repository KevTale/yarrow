import Anthropic from "@anthropic-ai/sdk";
import type { ChatUsage } from "../core/chat";

/**
 * Who can answer on the live call (src/runner/talk.ts): Claude, tuned for
 * a quick spoken turn.
 */

export const TALK_MODELS = {
  /** Opus 5.5 at low effort: its thinking cannot be turned off. */
  opus: { id: "claude-opus-5-5" },
  /** The same, in fast mode: quicker output, twice the price. */
  "opus-fast": { id: "claude-opus-5-5" },
  sonnet: { id: "claude-sonnet-5-5" },
  /** Haiku 5.5 without thinking. */
  haiku: { id: "claude-haiku-5-5" },
} as const;
export type TalkModelName = keyof typeof TALK_MODELS;

export const isTalkModel = (name: unknown): name is TalkModelName =>
  typeof name === "string" && Object.hasOwn(TALK_MODELS, name);

/** Fast mode is priced apart: its usage is counted under this name. */
export const OPUS_FAST_RATE = "claude-opus-5-5:fast";

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
  client: Anthropic;
  system: Anthropic.Beta.BetaTextBlockParam[];
  tools: Anthropic.Beta.BetaTool[];
  messages: Anthropic.Beta.BetaMessageParam[];
  /** The last one: words only, no more tools. */
  last: boolean;
  maxTokens?: number;
  onText: (delta: string) => void;
  /** The words stop for something else: a tool (its name), or thinking. */
  onBreak?: (next: string) => void;
}): Promise<TalkStep> {
  const { model, client, system, tools, messages, last, onText } = input;
  const fast = model === "opus-fast";
  const stream = client.beta.messages.stream({
    model: TALK_MODELS[model].id,
    max_tokens: input.maxTokens ?? 4000,
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
    ...(tools.length > 0
      ? {
          tools,
          tool_choice: last
            ? { type: "none" as const }
            : { type: "auto" as const },
        }
      : {}),
    messages,
  });
  stream.on("text", onText);
  stream.on("streamEvent", (event) => {
    if (event.type !== "content_block_start") return;
    const block = event.content_block;
    if (block.type === "tool_use") input.onBreak?.(block.name);
    else if (block.type !== "text") input.onBreak?.(block.type);
  });
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
