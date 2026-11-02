import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { addUsage, type ChatUsage } from "../core/chat";
import { liveActionSchema } from "../core/presentation";
import type { StageCueResult, StageHand, StageState } from "../core/stage";
import type { ChatContext } from "../db/chat";
import { CHAT_TOOLS, runChatTool, type ChatSources } from "./chat";

/**
 * The live review's agent: a member talks to it over the stage, by voice.
 * ElevenLabs hears them and speaks its words (src/runner/voice/agent.ts);
 * each turn of theirs reaches the brain as a chat completion, answered
 * here by Claude, which reads the code and acts on the stage meanwhile.
 * Yarrow pays for it, as for the written conversation.
 */

/** Who answers: quick back and forth, aloud. */
export const TALK_MODEL = "claude-opus-5-5";
export const TALK_EFFORT = "low";
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

They watch the stage with you: the app of the pull request's branch running on a desktop, in a browser (the app as it is on the branch, and when there is one, the app as it was before the change in a second tab), and a terminal in the branch's checkout (/workspace/repo). The change's presentation plays there, your recorded voice over live gestures, and stops while they talk to you.

How you talk:
- Spoken words only: no markdown, lists, headings, code, file paths or symbols read out. One to three short sentences, as a colleague on a call. In the language they speak.
- Before your first tool call, say a few words first ("Let me show you.", "I'll check the code."): they hear you while you work. Then say little until you have the answer.
- Never guess how the code or the app behaves: read the code, or try it on the stage.

The stage:
- When seeing it helps, show it: look at the screen, then act on it. They see the pointer move and click as you do it.
- What a look returns names the page's elements with refs (e12): act on them by those refs, from your latest look only.
- What you do in the app is real (its database is a test one) and stays until the stage restarts: nothing destructive unless they ask.
- The presentation goes on only when they want it to: when they say to go on, or agree when you offer once their question is answered, call resume_presentation. Never on your own.

You never change code. When they ask for a change, say in a sentence what would change, and that they can ask for it in the pull request's conversation on the dashboard.`;

const STAGE_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "look_at_screen",
    description:
      "What the stage shows now: the window in front (the app as it is, the app as it was, or the terminal), its address, and the page's elements with their refs, or the terminal's last lines.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "act_on_screen",
    description:
      "Do these on the browser window in front, one after the other, with the pointer the member sees, as a person would. Returns the screen after. Stops at the first that fails.",
    input_schema: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          minItems: 1,
          maxItems: 12,
          items: {
            type: "object",
            properties: {
              do: {
                type: "string",
                enum: [
                  "point",
                  "circle",
                  "click",
                  "fill",
                  "select",
                  "press",
                  "scroll",
                  "goto",
                  "reload",
                  "wait",
                ],
                description:
                  "point at or circle an element to show it; click; fill a field with text; select an option's value; press a key; scroll (an element into view, or the page by y pixels); goto a path of the app; reload; wait ms.",
              },
              target: {
                type: "string",
                description:
                  "The element: its ref from the latest look (e12), else a Playwright selector.",
              },
              text: { type: "string", description: "For fill." },
              value: { type: "string", description: "For select." },
              key: { type: "string", description: "For press, e.g. Enter." },
              path: { type: "string", description: "For goto, e.g. /tasks." },
              y: { type: "number", description: "For scroll without target." },
              ms: { type: "number", description: "For wait, at most 8000." },
            },
            required: ["do"],
            additionalProperties: false,
          },
        },
      },
      required: ["actions"],
      additionalProperties: false,
    },
  },
  {
    name: "show_window",
    description:
      "Bring a window in front: the app as it is on the branch (after), the app as it was before the change (before, when the stage has it), or the terminal. Returns the screen after.",
    input_schema: {
      type: "object",
      properties: {
        window: { type: "string", enum: ["after", "before", "terminal"] },
      },
      required: ["window"],
      additionalProperties: false,
    },
  },
  {
    name: "run_in_terminal",
    description:
      "Type a command in the stage's terminal and run it, as the member watches (the tests, a script). Returns its output. Stopped after two minutes.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        cwd: {
          type: "string",
          description: "Where to run it; the branch's checkout when absent.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  },
  {
    name: "resume_presentation",
    description:
      "The presentation goes on from where the member stopped it. Only when they want it to.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

const TOOLS: Anthropic.Beta.BetaTool[] = [
  // Reading the code and the tickets, as in the written conversation.
  ...CHAT_TOOLS.filter((tool) => tool.name !== "propose_change"),
  ...STAGE_TOOLS,
].map((tool) => ({ ...tool, eager_input_streaming: true }));

const stageInputs = {
  look_at_screen: z.object({}),
  act_on_screen: z.object({
    actions: z.array(liveActionSchema).min(1).max(12),
  }),
  show_window: z.object({ window: z.enum(["after", "before", "terminal"]) }),
  run_in_terminal: z.object({
    command: z.string().min(1).max(2000),
    cwd: z.string().max(500).optional(),
  }),
  resume_presentation: z.object({}),
};

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

const textOf = (content: z.infer<typeof incomingSchema>["content"]) =>
  typeof content === "string"
    ? content
    : (content ?? [])
        .map((part) => part.text ?? "")
        .join("")
        .trim();

/**
 * The call so far, as Claude reads it: what the member said and what was
 * said back, the words alone. ElevenLabs' own prompt, tool calls and
 * results stay out: each turn looks at the stage afresh.
 */
export function talkMessages(
  messages: TalkRequest["messages"],
): Anthropic.Beta.BetaMessageParam[] {
  const said: Anthropic.Beta.BetaMessageParam[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = textOf(message.content).trim();
    if (!text) continue;
    const last = said.at(-1);
    if (last?.role === message.role)
      last.content = `${last.content as string}\n${text}`;
    else said.push({ role: message.role, content: text });
  }
  // The call opens with the member: anything said before them goes.
  while (said[0]?.role === "assistant") said.shift();
  return said;
}

/** Where the presentation stands, said to the agent with the member's turn. */
export function stageNote(state: StageState | null): string {
  if (!state) return "[The stage does not answer right now.]";
  if (state.chapter)
    return `[On the stage: the presentation is ${state.held ? "stopped" : "playing"} in chapter ${state.chapter.index + 1} of ${state.chapters}, "${state.chapter.title}".]`;
  return state.held
    ? "[On the stage: the presentation is stopped between two chapters.]"
    : "[On the stage: the presentation is not playing.]";
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

/** What fills the nth silence of a turn, in the member's language. */
export function talkFiller(language: string, nth: number): string {
  const fillers = FILLERS[language.slice(0, 2)] ?? FILLERS.en!;
  return `${fillers[nth % fillers.length]} `;
}

export interface TalkAnswer {
  /** The agent asked for the presentation to go on (a tool of the page). */
  resume: boolean;
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
  context: TalkContext;
  messages: Anthropic.Beta.BetaMessageParam[];
  state: StageState | null;
  sources: ChatSources;
  stage: (hand: StageHand) => Promise<StageCueResult>;
  say: (text: string) => void;
  started?: number;
}): Promise<TalkAnswer> {
  const { client, context, sources, stage, say } = input;
  const started = input.started ?? Date.now();
  let firstWordMs: number | null = null;
  const speak = (text: string) => {
    if (!text) return;
    if (firstWordMs === null) firstWordMs = Date.now() - started;
    say(text);
  };
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: INSTRUCTIONS },
    { type: "text", text: context.text, cache_control: { type: "ephemeral" } },
  ];
  const messages = input.messages.map((message) => ({ ...message }));
  const last = messages.at(-1);
  if (last?.role === "user")
    last.content = `${last.content as string}\n\n${stageNote(input.state)}`;
  const steps: TalkAnswer["steps"] = [];
  let usage: ChatUsage = {
    model: TALK_MODEL,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  for (let step = 0; ; step++) {
    const asked = Date.now();
    const stream = client.beta.messages.stream({
      model: TALK_MODEL,
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: TALK_EFFORT },
      system,
      tools: TOOLS,
      tool_choice: step >= TALK_MAX_STEPS ? { type: "none" } : { type: "auto" },
      messages,
    });
    // Spoken as it is written; a space between two runs of words.
    let wrote = false;
    stream.on("text", (delta) => {
      wrote = true;
      speak(delta);
    });
    const response = await stream.finalMessage();
    steps.push({ what: "claude", ms: Date.now() - asked });
    usage = addUsage(usage, {
      model: response.model,
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      cacheRead: response.usage.cache_read_input_tokens ?? 0,
      cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
    });
    if (wrote) speak(" ");
    const calls = response.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock =>
        block.type === "tool_use",
    );
    if (response.stop_reason !== "tool_use" || calls.length === 0)
      return { resume: false, usage, firstWordMs, steps };
    if (calls.some((call) => call.name === "resume_presentation"))
      return { resume: true, usage, firstWordMs, steps };
    messages.push({ role: "assistant", content: response.content });
    // One move on the stage at a time, in the order asked.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const ran = Date.now();
      const result = await runTalkTool(call, context, sources, stage).catch(
        (error: Error) => ({
          text: `That failed: ${error.message.slice(0, 200)}`,
          error: true,
        }),
      );
      steps.push({ what: call.name, ms: Date.now() - ran });
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

async function runTalkTool(
  call: Anthropic.Beta.BetaToolUseBlock,
  context: TalkContext,
  sources: ChatSources,
  stage: (hand: StageHand) => Promise<StageCueResult>,
): Promise<{ text: string; error?: boolean }> {
  if (!(call.name in stageInputs)) return runChatTool(call, context, sources);
  const parsed = stageInputs[call.name as keyof typeof stageInputs].safeParse(
    call.input,
  );
  if (!parsed.success)
    return { text: `Invalid call to ${call.name}.`, error: true };
  const hand: StageHand =
    call.name === "act_on_screen"
      ? {
          action: "act",
          actions: (parsed.data as z.infer<typeof stageInputs.act_on_screen>)
            .actions,
        }
      : call.name === "show_window"
        ? {
            action: "window",
            window: (parsed.data as z.infer<typeof stageInputs.show_window>)
              .window,
          }
        : call.name === "run_in_terminal"
          ? {
              action: "run",
              ...(parsed.data as z.infer<typeof stageInputs.run_in_terminal>),
            }
          : { action: "look" };
  const result = await stage(hand);
  const problems = result.problems.length
    ? `Failed: ${result.problems.join("; ")}\n`
    : "";
  return {
    text: `${problems}${result.screen ?? ""}`.trim() || "Done.",
    error: !result.ok || (result.problems.length > 0 && !result.screen),
  };
}

/**
 * The chat completion stream ElevenLabs reads: the words as they come,
 * a call to the page's resume_presentation tool, the end.
 * https://elevenlabs.io/docs/agents-platform/customization/llm/custom-llm
 */
export const completion = {
  words(id: string, text: string): string {
    return chunk(id, { content: text }, null);
  },
  resume(id: string): string {
    return (
      chunk(
        id,
        {
          tool_calls: [
            {
              index: 0,
              id: `call_${id}`,
              type: "function",
              function: { name: "resume_presentation", arguments: "{}" },
            },
          ],
        },
        null,
      ) + chunk(id, {}, "tool_calls")
    );
  },
  end(id: string): string {
    return `${chunk(id, {}, "stop")}data: [DONE]\n\n`;
  },
  done: "data: [DONE]\n\n",
};

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
