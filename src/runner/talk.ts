import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { addUsage, type ChatUsage } from "../core/chat";
import type { StageState } from "../core/stage";
import type { ChatContext } from "../db/chat";
import { CHAT_TOOLS, runChatTool, type ChatSources } from "./chat";
import {
  isStageTool,
  runStageTool,
  SHOW_CHAPTER,
  STAGE_TOOLS,
  stageNote,
  stageStepName,
  type StageHands,
} from "./stage-tools";
import {
  isTalkModel,
  OPUS_FAST_RATE,
  TALK_MODELS,
  talkStep,
  type TalkModelName,
} from "./talk-models";

export { stageNote };

/**
 * The live review's agent: a member talks to it over the stage, by voice.
 * ElevenLabs hears them and speaks its words (src/runner/voice/agent.ts);
 * each turn of theirs reaches the brain as a chat completion, answered
 * here by Claude, which reads the code and acts on the stage meanwhile.
 * Yarrow pays for it, as for the written conversation.
 */

/** Who answers: quick back and forth, aloud. The others: talk-models.ts. */
export const TALK_MODEL = "claude-opus-5-5";
export const TALK_EFFORT = "low";
export const DEFAULT_TALK_MODEL: TalkModelName = "opus";
/** Tool calls one answer may make before it must answer with what it has. */
const TALK_MAX_STEPS = 10;

/** What the turn knows of the pull request, kept for the call by the stage. */
export interface TalkContext {
  /** The pull request, its ticket, its review, the film, the diff. */
  text: string;
  project: ChatContext["project"];
  pullRequest: ChatContext["pullRequest"];
}

const INSTRUCTIONS = `You are Yarrow's agent, on a live call with a member of the project about a pull request Yarrow's agents opened. Everything you write is spoken aloud by a voice; they hear it, they do not read it.

They watch the stage with you: the app of the pull request's branch running on a desktop, in a browser (the app as it is on the branch, and when there is one, the app as it was before the change in a second tab), and a terminal in the branch's checkout (/workspace/repo). The change's presentation played there first, your recorded voice over live gestures. It stopped for good when they spoke: from then on, you lead it.

How you talk:
- Spoken words only: no markdown, lists, headings, code, file paths or symbols read out. One to three short sentences, as a colleague on a call. In the language they speak.
- Before a tool that takes a while, a few words so they are not left in silence: what they are about to see, or what you check ("Look.", "I'll check in the code."). Then say little until you have the answer.
- Never describe your own gestures ("I click on To do", "I'm looking at the screen", "done"): they see them. Talk about what the app shows and why it matters.
- Never guess how the code or the app behaves: read the code, or try it on the stage.

The stage:
- When seeing it helps, show it: look at the screen, then act on it. They see the pointer move and click as you do it.
- What a look returns names the page's elements with refs (e12, f5e16): act on them by those refs, from your latest look only.
- What you do in the app is real (its database is a test one) and stays until the stage restarts: nothing destructive unless they ask.

The presentation, once they spoke:
- Go on only when they want it to: when they say so, or say yes when you offer once their question is answered. Never on your own.
- Then carry on from where the talk left things, not from where the recording stopped: one sentence linking to what was just said, then what is left, one chapter at a time with show_chapter. Skip what they already saw, and what the talk already covered.
- Your words before show_chapter are heard while it plays: say what it shows in your own words, not the recorded ones, and not the gestures. Then the next chapter, or a word on what it showed first if that helps.
- When nothing is left, say so in a sentence and ask if they have questions.

The conversation:
- Beside the stage, the pull request's conversation: what was written and said before this call is below, and each turn of this call joins it.
- You never change code yourself. When they ask for a change to this pull request, or say yes to one you suggested, call propose_change: it shows as a card in the conversation, and they make it with one click. Then say in one sentence that it is there, without reading it out.
- The card says what will change for the people using the app, in plain words, never code or file names; the app's labels quoted as it shows them, untranslated. Do not propose a change they did not ask for.`;

const TOOLS: Anthropic.Beta.BetaTool[] = [
  // The code, the tickets and the changes, as in the written conversation.
  ...CHAT_TOOLS,
  ...STAGE_TOOLS,
  SHOW_CHAPTER,
].map((tool) => ({ ...tool, eager_input_streaming: true }));

/** What was written and said before the call, as the agent reads it. */
export function conversationSoFar(history: ChatContext["history"]): string {
  if (history.length === 0)
    return "Nothing was written or said before this call.";
  const lines = history
    .slice(-30)
    .map(
      (message) =>
        `${message.author === "builder" ? "Member" : "You"}: ${message.body.length > 1500 ? `${message.body.slice(0, 1500)} […]` : message.body}`,
    );
  return `The conversation before this call, written or said:\n${lines.join("\n")}`;
}

/** One message of the call as ElevenLabs sends it (chat completions). */
const incomingSchema = z
  .object({
    role: z.string(),
    content: z
      .union([
        z.string(),
        z.array(z.object({ type: z.string(), text: z.string().optional() })),
        z.null(),
      ])
      .optional(),
  })
  .passthrough();

/** The body of ElevenLabs' request to the brain, as a chat completion. */
export const talkRequestSchema = z
  .object({
    messages: z.array(incomingSchema),
    elevenlabs_extra_body: z.unknown().optional(),
    custom_llm_extra_body: z.unknown().optional(),
  })
  .passthrough();
export type TalkRequest = z.infer<typeof talkRequestSchema>;

/**
 * Dev only (TALK_BENCH): a turn of the bench (scripts/talk-bench.ts) names
 * who answers and whether the screen comes with the member's words, starts
 * from a page of the app, and stays out of the thread.
 */
export const talkBenchSchema = z.object({
  model: z.enum(
    Object.keys(TALK_MODELS) as [TalkModelName, ...TalkModelName[]],
  ),
  screen: z.boolean(),
  reset: z.string().max(200).optional(),
});
export type TalkBench = z.infer<typeof talkBenchSchema>;

/** The call's pass the page gave ElevenLabs, carried in its requests. */
export function talkGrantOf(request: TalkRequest): string | null {
  for (const extra of [
    request.elevenlabs_extra_body,
    request.custom_llm_extra_body,
  ]) {
    const grant = (extra as { yarrow?: unknown } | undefined)?.yarrow;
    if (typeof grant === "string") return grant;
  }
  return null;
}

/**
 * Dev only (TALK_BENCH): who answers this call, as the stage's page asks
 * (?brain=spark&screen=1), to try each by voice.
 */
export function talkBrainOf(request: TalkRequest): {
  model?: TalkModelName;
  screen?: boolean;
} {
  for (const extra of [
    request.elevenlabs_extra_body,
    request.custom_llm_extra_body,
  ]) {
    const brain = (extra as { brain?: unknown } | undefined)?.brain as
      { model?: unknown; screen?: unknown } | undefined;
    if (!brain || typeof brain !== "object") continue;
    return {
      ...(isTalkModel(brain.model) ? { model: brain.model } : {}),
      ...(typeof brain.screen === "boolean" ? { screen: brain.screen } : {}),
    };
  }
  return {};
}

const textOf = (content: z.infer<typeof incomingSchema>["content"]) =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();

type Said = Anthropic.Beta.BetaMessageParam;

const blocks = (
  content: Said["content"],
): Anthropic.Beta.BetaContentBlockParam[] =>
  typeof content === "string"
    ? [{ type: "text", text: content }]
    : ((content ?? []) as Anthropic.Beta.BetaContentBlockParam[]);

/**
 * The call so far, as Claude reads it: what the member said and what was
 * said back, the words alone. ElevenLabs' own prompt and the stage's tools
 * stay out: each turn looks at the stage afresh. A turn of the member's
 * with no word in it (a noise heard as one) goes.
 */
export function talkMessages(messages: TalkRequest["messages"]): Said[] {
  const said: Said[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const words = textOf(message.content).trim();
    const text =
      message.role === "user" && !/[\p{L}\p{N}]/u.test(words) ? "" : words;
    if (!text) continue;
    const last = said.at(-1);
    if (last?.role === message.role)
      last.content =
        typeof last.content === "string"
          ? `${last.content}\n${text}`
          : [...last.content, { type: "text", text }];
    else said.push({ role: message.role, content: text });
  }
  // The call opens with the member: anything said before them goes.
  while (said[0]?.role === "assistant") said.shift();
  return said;
}

/** What the member just said: their last turn, their words alone. */
export function memberWords(messages: Said[]): string {
  const last = messages.at(-1);
  if (last?.role !== "user") return "";
  return blocks(last.content)
    .map((block) => (block.type === "text" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * Whether ElevenLabs asks because the member spoke. After a tool of its
 * own it asks again with the tool's result last: answering the member's
 * words again would say it all twice.
 */
export function memberSpoke(request: TalkRequest): boolean {
  return (
    request.messages.at(-1)?.role === "user" &&
    talkMessages(request.messages).at(-1)?.role === "user"
  );
}

/**
 * ElevenLabs drops the call when its LLM says nothing for 15 s (its
 * cascade timeout, 15 s at most; an empty chunk does not count), and the
 * stage can take longer: past this, the brain says one of these.
 */
export const TALK_SILENCE_MS = 8000;
const FILLERS: Record<string, string[]> = {
  fr: ["Une seconde.", "J'y suis presque.", "Encore un instant."],
  en: ["One moment.", "Almost there.", "Just a second."],
};

/**
 * How words said before a tool end: ElevenLabs speaks a sentence once
 * what follows its end comes, a space at least; else "Regarde." waits for
 * the answer after the tool. Words cut short get their full stop.
 */
export function untilTool(words: string): string {
  return /[.!?…]$/.test(words.trimEnd()) ? " " : ". ";
}

/**
 * How long a chapter shown by the agent plays: as long as its words before
 * it take to say (about 15 characters a second), within reason.
 */
export function pointMs(words: string): number {
  return Math.round(Math.min(12_000, Math.max(3000, words.length * 65)));
}

/** What fills the nth silence of a turn, in the member's language. */
export function talkFiller(language: string, nth: number): string {
  const fillers = FILLERS[language.slice(0, 2)] ?? FILLERS.en!;
  return `${fillers[nth % fillers.length]} `;
}

export interface TalkAnswer {
  /** What the agent said, kept in the conversation's thread. */
  words: string;
  /** The change it proposed: a card in the thread, made only from there. */
  change: string | null;
  usage: ChatUsage;
  /** The first words, from the request: ms. */
  firstWordMs: number | null;
  /** Where the turn's time went: each answer of Claude's, each tool. */
  steps: { what: string; ms: number }[];
}

/**
 * The agent's answer to the member's last turn, its words given to `say`
 * as they come. Tools run on the way: the code and the tickets, and the
 * stage, through `stage`.
 */
export async function talkTurn(input: {
  client: Anthropic;
  /** Meta's key, when Muse answers. */
  meta?: string;
  model?: TalkModelName;
  context: TalkContext;
  messages: Anthropic.Beta.BetaMessageParam[];
  state: StageState | null;
  /** The screen as the member spoke, as a look returns it: no look first. */
  screen?: string | null;
  sources: ChatSources;
  stage: StageHands;
  say: (text: string) => void;
  started?: number;
}): Promise<TalkAnswer> {
  const { client, context, sources, stage, say } = input;
  const model = input.model ?? DEFAULT_TALK_MODEL;
  const started = input.started ?? Date.now();
  let firstWordMs: number | null = null;
  let words = "";
  let change: string | null = null;
  const speak = (text: string) => {
    if (!text) return;
    if (firstWordMs === null) firstWordMs = Date.now() - started;
    words += text;
    say(text);
  };
  const answer = (): TalkAnswer => ({
    words: words.trim(),
    change,
    usage,
    firstWordMs,
    steps,
  });
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: INSTRUCTIONS },
    { type: "text", text: context.text, cache_control: { type: "ephemeral" } },
  ];
  const messages = input.messages.map((message) => ({ ...message }));
  const last = messages.at(-1);
  const note = input.screen
    ? `${stageNote(input.state)}\n[The screen as they spoke, as a look returns it: act on its refs without looking first.]\n${input.screen}`
    : stageNote(input.state);
  if (last?.role === "user")
    last.content =
      typeof last.content === "string"
        ? `${last.content}\n\n${note}`
        : [...last.content, { type: "text", text: note }];
  const steps: TalkAnswer["steps"] = [];
  let usage: ChatUsage = {
    model: model === "opus-fast" ? OPUS_FAST_RATE : TALK_MODELS[model].id,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  for (let step = 0; ; step++) {
    const asked = Date.now();
    // Spoken as it is written; a space between two runs of words.
    let wrote = false;
    // This answer's words: a chapter it shows plays as long as they last.
    let stepWords = "";
    const response = await talkStep({
      model,
      clients: { anthropic: client, meta: input.meta },
      system,
      tools: TOOLS,
      messages,
      last: step >= TALK_MAX_STEPS,
      onText: (delta) => {
        wrote = true;
        stepWords += delta;
        speak(delta);
      },
      // Words before a tool or thinking end there, and are heard then.
      onBreak: () => {
        if (!wrote) return;
        wrote = false;
        speak(untilTool(words));
      },
    });
    steps.push({
      what: TALK_MODELS[model].provider === "meta" ? "muse" : "claude",
      ms: Date.now() - asked,
    });
    usage = addUsage(usage, response.usage);
    if (wrote) speak(" ");
    const { calls } = response;
    if (!response.toolUse) return answer();
    messages.push({ role: "assistant", content: response.content });
    // One move on the stage at a time, in the order asked.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const ran = Date.now();
      const shown: StageHands = (hand) =>
        stage(
          hand.action === "point" ? { ...hand, ms: pointMs(stepWords) } : hand,
        );
      const result: { text: string; error?: boolean; change?: string } = await (
        isStageTool(call.name)
          ? runStageTool(call, shown)
          : runChatTool(call, context, sources)
      ).catch((error: Error) => ({
        text: `That failed: ${error.message.slice(0, 200)}`,
        error: true,
      }));
      if (result.change) change = result.change;
      steps.push({ what: stageStepName(call), ms: Date.now() - ran });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: result.text,
        ...(result.error ? { is_error: true } : {}),
      });
    }
    const content: Anthropic.Beta.BetaContentBlockParam[] = [...results];
    if (step + 1 >= TALK_MAX_STEPS)
      content.push({ type: "text", text: "Answer now with what you have." });
    messages.push({ role: "user", content });
  }
}

/**
 * The chat completion stream ElevenLabs reads: the words as they come, a
 * call to ElevenLabs' skip_turn when the turn was not the member's, the end.
 * https://elevenlabs.io/docs/agents-platform/customization/llm/custom-llm
 */
export const completion = {
  words(id: string, text: string): string {
    return chunk(id, { content: text }, null);
  },
  skip(id: string): string {
    return toolCall(id, "skip_turn");
  },
  end(id: string): string {
    return `${chunk(id, {}, "stop")}data: [DONE]\n\n`;
  },
  done: "data: [DONE]\n\n",
};

function toolCall(id: string, name: string): string {
  return (
    chunk(
      id,
      {
        tool_calls: [
          {
            index: 0,
            id: `call_${id}`,
            type: "function",
            function: { name, arguments: "{}" },
          },
        ],
      },
      null,
    ) + chunk(id, {}, "tool_calls")
  );
}

function chunk(
  id: string,
  delta: Record<string, unknown>,
  finish: string | null,
): string {
  return `data: ${JSON.stringify({
    id: `chatcmpl-${id}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: TALK_MODEL,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}
