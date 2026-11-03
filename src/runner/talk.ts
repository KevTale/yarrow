import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { addUsage, type ChatUsage } from "../core/chat";
import {
  beatMark,
  VOICE_PUSH,
  withoutBeats,
  type StageState,
} from "../core/stage";
import type { ChatContext } from "../db/chat";
import { CHAT_TOOLS, runChatTool, type ChatSources } from "./chat";
import { gestureWords } from "./gestures";
import {
  isStageTool,
  runStageTool,
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
export const DEFAULT_TALK_MODEL: TalkModelName = "sonnet";
/** Tool calls one answer may make before it must answer with what it has. */
const TALK_MAX_STEPS = 10;

/** What the turn knows of the pull request, kept for the call by the stage. */
export interface TalkContext {
  /** The pull request, its ticket, its review, what the page shows, the diff. */
  text: string;
  /** The change has a demo: its rules and its tool are the agent's. */
  video: boolean;
  project: ChatContext["project"];
  pullRequest: ChatContext["pullRequest"];
}

/**
 * The agent's rules: over the stage, or by voice alone when it is not up
 * (no recipe yet, still coming up, a phone).
 */
const instructions = (
  onStage: boolean,
  video: boolean,
) => `You are Yarrow's agent, on a live call with a member of the project about a pull request Yarrow's agents opened. Everything you write is spoken aloud by a voice and shows in the conversation beside them as you say it. They speak or write to you, and you answer aloud either way.

${
  onStage
    ? "They were watching the change's demo: the app, your recorded voice over it. They stopped it to ask you something. The demo stands still where they stopped it, and the stage takes its place: the app of the pull request's branch running live on a desktop, as the demo had it there, in a browser (the app as it is on the branch, and when there is one, the app as it was before the change in a second tab), and a terminal in the branch's checkout (/workspace/repo)."
    : video
      ? "They called you from the ticket's page: the change's demo, the app with your recorded voice over it, stands still where they stopped it, if they were watching it. No live app is on this call: you answer from the pull request, its code, its demo and its review, and they see the demo and the conversation."
      : "They called you from the ticket's page, by voice. No live app is on this call: you answer from the pull request, its code and its review, and they see what the page shows and the conversation."
}

How you talk:
- Spoken words only: no markdown, lists, headings, code, file paths or symbols read out. One or two short sentences, as a colleague on a call, more only when they ask for it. In the language they speak.
- What must be read rather than heard (a list, code, file names, steps): call write_down with it, and say one sentence about it, no more.
- Before reading the code or the tickets, a few words of your own on what you are looking for ("Je regarde comment le compteur est calculé."), then the tool: never a generic "one moment", and nothing of the kind before a plain answer.${
  onStage
    ? `
- Talk as someone sharing their screen: what the app shows and why it matters, your gestures on the words that go with them (below). Not every click ("I click on To do", "I type in the field", "done"): they see them.
- Never announce what you do not do at that very moment ("I'll show you", "give me a second"): a gesture comes with the words.`
    : ""
}
- Answer what they asked, then stop: no question to end on, no offer of what you could do next${video ? ', never "shall the demo play on?"' : ""}.
- Talk about what the page shows (below), and never mention a demo, an image or anything else it does not show.${video ? " Call it the demo, never a video or a film." : ""}
- Your earlier answers in the conversation may break these rules: follow these rules, not them.
- Never guess how the code or the app behaves: ${onStage ? "read the code, or try it on the stage" : "read the code"}.
${
  onStage
    ? `
The stage:
- When seeing it helps, show it. They see the pointer move and click as you do it.
- The screen comes with their words, as a look returns it: refs (e12, f5e16) name the page's elements. Act by the refs of the latest screen you have; look_at_screen only if it changed since.
- Your gestures go inside your words, so they happen as you say them: a tag <act do="circle" target="e20"/> right before the words it goes with, one per action, with the fields of act_on_screen. A tag is never spoken and takes no time: the pointer gets there as those words are said. Asked to add a task called Pain:
<act do="fill" target="e14" text="Pain"/><act do="click" target="e15"/>Je l'ajoute, <act do="circle" target="text=Pain"/>et la voilà, en haut de la liste.
- That is how you act whenever the screen tells you what will happen. What only appears after a gesture of yours: by its text (text=Pain), never a ref.
- Typing and clicks take a second or two: give them enough words, so what follows still lands on its word.
- A gesture waits by itself for its target: no tool between your words and the next gesture, no wait.
- When you cannot tell what will happen (another page, a result you must read first), call act_on_screen with no word before it, then say what it shows, with tags for what you then point at.
- A turn starting with [stage] is no one speaking: a gesture of yours failed. Put it right and say so in a few words.
- What you do in the app is real (its database is a test one) and stays until the stage restarts: nothing destructive unless they ask.
`
    : ""
}
${
  video
    ? `The demo:
- It plays on only when they ask for it. Never offer it, never ask whether it should: they play it themselves when they want. When they ask, a few words to close, and call resume_presentation: the demo plays on from where they stopped it, and you stay on the call, silent, until they speak over it again.
- To see a chapter again, or all of it from the start, call resume_presentation with that chapter (1 for the start): the demo plays from there, its recorded voice with it.${onStage ? " Never play the demo's chapters yourself on the stage.\n- On the stage, show what the demo does not." : " To show them something, point them to its moment in the demo."}

`
    : ""
}The conversation:
- Beside ${onStage ? "the stage" : video ? "the demo" : "what the page shows"}, the pull request's conversation: what was written and said before this call is below, and each turn of this call joins it.
- You never change code yourself. When they ask for a change to this pull request, or say yes to one you suggested, call propose_change: it shows as a card in the conversation, and they make it with one click. Then say in one sentence that it is there, without reading it out.
- The card says what will change for the people using the app, in plain words, never code or file names; the app's labels quoted as it shows them, untranslated. Do not propose a change they did not ask for.`;

/** What only the eye can follow, written where the member reads the call. */
const WRITE: Anthropic.Beta.BetaTool = {
  name: "write_down",
  description:
    "Puts in the conversation, under your words, what must be read rather than heard: a list, code, file names, steps. Markdown. Never for what you say aloud.",
  input_schema: {
    type: "object",
    properties: { text: { type: "string", maxLength: 4000 } },
    required: ["text"],
    additionalProperties: false,
  },
};

/** The page's tool: the demo plays on, the call staying. */
const RESUME: Anthropic.Beta.BetaTool = {
  name: "resume_presentation",
  description:
    "The demo plays on, from where they stopped it or from the start of a chapter, and the call stays until they hang up. Only when they want it to, after your last words.",
  input_schema: {
    type: "object",
    properties: {
      chapter: {
        type: "integer",
        minimum: 1,
        description:
          "From this chapter's start, 1 for the beginning; from where they stopped it when absent.",
      },
    },
    additionalProperties: false,
  },
};

const eager = (tools: Anthropic.Beta.BetaTool[]) =>
  tools.map((tool) => ({ ...tool, eager_input_streaming: true }));
// The code, the tickets and the changes, as in the written conversation;
// the stage's hands when it is up.
const talkTools = (onStage: boolean, video: boolean) =>
  eager([
    ...CHAT_TOOLS,
    WRITE,
    ...(onStage ? STAGE_TOOLS : []),
    ...(video ? [RESUME] : []),
  ]);

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
  push?: number;
} {
  for (const extra of [
    request.elevenlabs_extra_body,
    request.custom_llm_extra_body,
  ]) {
    const brain = (extra as { brain?: unknown } | undefined)?.brain as
      { model?: unknown; screen?: unknown; push?: unknown } | undefined;
    if (!brain || typeof brain !== "object") continue;
    return {
      ...(isTalkModel(brain.model) ? { model: brain.model } : {}),
      ...(typeof brain.screen === "boolean" ? { screen: brain.screen } : {}),
      ...(typeof brain.push === "number" ? { push: brain.push } : {}),
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
    const words = withoutBeats(textOf(message.content)).trim();
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

/** What fills the nth silence of a turn, in the member's language. */
export function talkFiller(language: string, nth: number): string {
  const fillers = FILLERS[language.slice(0, 2)] ?? FILLERS.en!;
  return `${fillers[nth % fillers.length]} `;
}

export interface TalkAnswer {
  /** What the agent said, kept in the conversation's thread. */
  words: string;
  /** What it wrote down there, under its words. */
  written: string;
  /** The change it proposed: a card in the thread, made only from there. */
  change: string | null;
  /** The film plays on (a tool of the page): from a chapter, or where it was. */
  resume: { chapter: number | null } | null;
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
  /** The stage's hands; null on a call by voice alone. */
  stage: StageHands | null;
  say: (text: string) => void;
  /** Dev only: how many characters push the voice out before a tool. */
  push?: number;
  started?: number;
}): Promise<TalkAnswer> {
  const { client, context, sources, stage, say } = input;
  const model = input.model ?? DEFAULT_TALK_MODEL;
  const started = input.started ?? Date.now();
  let firstWordMs: number | null = null;
  let words = "";
  const written: string[] = [];
  let change: string | null = null;
  const speak = (text: string) => {
    if (!text) return;
    if (firstWordMs === null) firstWordMs = Date.now() - started;
    words += text;
    say(text);
  };
  // Spoken as it is written; a space between two runs of words.
  let wrote = false;
  // The gestures in the words: kept on the stage, their place in the voice.
  let beats = 0;
  const gestures = gestureWords({
    words: (text) => {
      wrote = true;
      speak(text);
    },
    beat: (actions) => {
      if (!stage) return;
      const n = beats++;
      void stage({ action: "gesture", n, actions }).catch(() => {});
      steps.push({
        what: `beat[${actions.map((action) => action.do).join(" ")}]`,
        ms: 0,
      });
      say(beatMark(n));
    },
  });
  // Those left, for what must come after them, or with no word to wait for.
  const beatsDone = async () => {
    if (beats) await stage?.({ action: "beat", n: null }).catch(() => {});
  };
  const answer = async (
    resume: TalkAnswer["resume"] = null,
  ): Promise<TalkAnswer> => {
    if (!words.trim()) await beatsDone();
    return {
      words: words.trim(),
      written: written.join("\n\n"),
      change,
      resume,
      usage,
      firstWordMs,
      steps,
    };
  };
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: instructions(stage !== null, context.video) },
    { type: "text", text: context.text, cache_control: { type: "ephemeral" } },
  ];
  const messages = input.messages.map((message) => ({ ...message }));
  const last = messages.at(-1);
  const note = !stage
    ? null
    : input.screen
      ? `${stageNote(input.state)}\n[The screen as they spoke, as a look returns it: act on its refs without looking first.]\n${input.screen}`
      : stageNote(input.state);
  if (note && last?.role === "user")
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
    wrote = false;
    const response = await talkStep({
      model,
      clients: { anthropic: client, meta: input.meta },
      system,
      tools: talkTools(stage !== null, context.video),
      messages,
      last: step >= TALK_MAX_STEPS,
      onText: (delta) => gestures.write(delta),
      // Words before a tool or thinking end there, and are heard then.
      onBreak: () => {
        gestures.end();
        if (!wrote) return;
        wrote = false;
        speak(untilTool(words));
        say(VOICE_PUSH.repeat(input.push ?? 0));
      },
    });
    steps.push({
      what: TALK_MODELS[model].provider === "meta" ? "muse" : "claude",
      ms: Date.now() - asked,
    });
    usage = addUsage(usage, response.usage);
    gestures.end();
    if (wrote) speak(" ");
    const { calls } = response;
    if (!response.toolUse) return answer();
    const resume = calls.find((call) => call.name === RESUME.name);
    if (resume) {
      const chapter = (resume.input as { chapter?: unknown } | null)?.chapter;
      return answer({
        chapter:
          typeof chapter === "number" &&
          Number.isInteger(chapter) &&
          chapter >= 1
            ? chapter
            : null,
      });
    }
    messages.push({ role: "assistant", content: response.content });
    // One move on the stage at a time, in the order asked.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      const ran = Date.now();
      if (isStageTool(call.name)) await beatsDone();
      const down =
        call.name === WRITE.name
          ? (call.input as { text?: unknown } | null)?.text
          : null;
      if (typeof down === "string" && down.trim()) written.push(down.trim());
      const result: { text: string; error?: boolean; change?: string } = await (
        call.name === WRITE.name
          ? Promise.resolve({ text: "It shows in the conversation." })
          : isStageTool(call.name)
            ? stage
              ? runStageTool(call, stage)
              : Promise.resolve({ text: "No stage on this call.", error: true })
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
 * call to the page's resume_presentation tool, or to ElevenLabs' skip_turn
 * when the turn was not the member's, the end.
 * https://elevenlabs.io/docs/agents-platform/customization/llm/custom-llm
 */
export const completion = {
  words(id: string, text: string): string {
    return chunk(id, { content: text }, null);
  },
  resume(id: string, chapter: number | null): string {
    return toolCall(id, RESUME.name, chapter === null ? {} : { chapter });
  },
  skip(id: string): string {
    return toolCall(id, "skip_turn");
  },
  end(id: string): string {
    return `${chunk(id, {}, "stop")}data: [DONE]\n\n`;
  },
  done: "data: [DONE]\n\n",
};

function toolCall(
  id: string,
  name: string,
  input: Record<string, unknown> = {},
): string {
  return (
    chunk(
      id,
      {
        tool_calls: [
          {
            index: 0,
            id: `call_${id}`,
            type: "function",
            function: { name, arguments: JSON.stringify(input) },
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
