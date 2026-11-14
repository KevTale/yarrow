import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { addUsage, LANGUAGE_RULE, type ChatUsage } from "../core/chat";
import {
  BODY_MAX,
  TITLE_MAX,
  type DraftLine,
  type DraftText,
} from "../core/new-ticket";
import { VOICE_PUSH } from "../core/stage";
import type { ChatContext } from "../db/chat";
import { CHAT_TOOLS, runChatTool, type ChatSources } from "./chat";
import { DEFAULT_TALK_MODEL, untilTool } from "./talk";
import {
  OPUS_FAST_RATE,
  TALK_MODELS,
  talkStep,
  type TalkModelName,
} from "./talk-models";

/**
 * The agent that writes a ticket with a member, in the new ticket dialog:
 * it reads the repository and the project's tickets, and fills in the form
 * beside the conversation as it goes, written or said. Yarrow pays for it,
 * as for the pull request's conversation.
 */

/** Tool calls one answer may make before it must answer with what it has. */
const TICKET_MAX_STEPS = 8;

const WRITE_TICKET: Anthropic.Beta.BetaTool = {
  name: "write_ticket",
  description:
    "Write the ticket into the form beside the conversation, in place of what it says. Give the whole ticket every time, what the member changed by hand kept.",
  input_schema: {
    type: "object",
    properties: {
      title: { type: "string", description: "What is wanted, in plain words." },
      body: { type: "string", description: "The description, in Markdown." },
    },
    required: ["title", "body"],
    additionalProperties: false,
  },
};

const writeInput = z.object({
  title: z.string().trim().min(1).max(TITLE_MAX),
  body: z.string().trim().max(BODY_MAX),
});

const TOOLS = [
  ...CHAT_TOOLS.filter(
    (tool) =>
      tool.name !== "list_tickets" &&
      tool.name !== "propose_change" &&
      tool.name !== "propose_ticket",
  ),
  WRITE_TICKET,
];

const instructions = (
  voice: boolean,
) => `You are Yarrow's agent. A member of a project is writing a new ticket on Yarrow's dashboard, and you write it with them. Yarrow's agents then take that ticket and open a pull request from it with no one to ask: what the ticket leaves out, they decide alone.

The page: beside this conversation, the ticket's form, a title and a description, which write_ticket fills in. The member can change it by hand: it comes as it stands with each of their turns, and what they changed stays unless they say otherwise. Only they can create or start the ticket, with the page's buttons.

How you work:
- Write early. As soon as you know roughly what they want, call write_ticket, then refine it as you talk. Never ask them to dictate what you can write yourself.
- Look before you ask. The code and the project's tickets answer most questions: where it would go, what already exists, what was tried. Ask only what neither can tell you and what changes what gets built, one question at a time.
- Say so when the code already does it, when a ticket already asks for it or overlaps it, or when a past one tried it: name it in one sentence.
- Once the ticket is good enough, say so in one sentence: it is theirs to create or start. No questions for the sake of questions.
- Stay on the ticket being written. When they think out loud about something else, say it would make another ticket.

The ticket:
- The title says what is wanted, in a few plain words.
- The description is short Markdown: what the people using the app should get and why, then what must be true once it is done, as a short list anyone can check, under a heading in the conversation's language.
- What they asked for or agreed to, nothing more: a behavior they did not mention stays out of the ticket, however natural. Worth deciding? Ask.
- Name a file or a route only where it saves the implementer a search. No plan and no steps: the implementer reads the code itself.
- In the conversation's language, the app's labels quoted as the app shows them, untranslated.

How you answer:
${
  voice
    ? "- Everything you write is spoken aloud: one or two short sentences of plain speech. No lists, no Markdown, no code, no file names.\n- Before reading code, one short sentence of your own, then the tool."
    : "- In plain words, one to three sentences. No headings, no filler."
}
- ${LANGUAGE_RULE}
- As a colleague would: the familiar form, in a language that has one.
- Never read the ticket out: it is right beside them. Say what you wrote or changed in a few words.`;

/** What the agent knows before the conversation: never changes during it. */
const contextText = (project: ChatContext["project"], tickets: string) =>
  `Project: ${project.name} (${project.repository} on GitHub, default branch ${project.defaultBranch}). You read the repository at its default branch.\n\nThe project's tickets, newest first:\n${tickets}`;

/** The form, as it stands when the member takes their turn. */
const formNote = ({ title, body }: DraftText) =>
  title.trim() || body.trim()
    ? `[The form as it stands.\nTitle: ${title}\nDescription:\n${body}]`
    : "[The form is empty.]";

/** The thread as Claude reads it: from the member, turn by turn. */
function threadMessages(
  history: DraftLine[],
): Anthropic.Beta.BetaMessageParam[] {
  const said: Anthropic.Beta.BetaMessageParam[] = [];
  for (const line of history) {
    if (!line.body.trim()) continue;
    const role = line.author === "builder" ? "user" : "assistant";
    const last = said.at(-1);
    if (last?.role === role) last.content = `${last.content}\n${line.body}`;
    else said.push({ role, content: line.body });
  }
  while (said[0]?.role === "assistant") said.shift();
  return said;
}

export interface TicketAnswer {
  words: string;
  /** The ticket as the agent last wrote it. */
  written: DraftText | null;
  usage: ChatUsage;
  firstWordMs: number | null;
  /** Where the turn's time went: each answer of Claude's, each tool. */
  steps: { what: string; ms: number }[];
}

/** The agent's answer to the member's turn, its words given to `say`. */
export async function ticketTurn(input: {
  client: Anthropic;
  model?: TalkModelName;
  project: ChatContext["project"];
  /** The project's tickets, one a line. */
  tickets: string;
  form: DraftText;
  history: DraftLine[];
  said: string;
  /** Spoken aloud, by ElevenLabs. */
  voice: boolean;
  sources: ChatSources;
  say: (text: string) => void;
  /** The ticket was written: the form follows at once. */
  onWrite: (text: DraftText) => Promise<void>;
  started?: number;
}): Promise<TicketAnswer> {
  const { client, project, voice, sources, say } = input;
  const model = input.model ?? DEFAULT_TALK_MODEL;
  const started = input.started ?? Date.now();
  let firstWordMs: number | null = null;
  let words = "";
  let written: DraftText | null = null;
  const steps: TicketAnswer["steps"] = [];
  const speak = (text: string) => {
    if (!text) return;
    if (firstWordMs === null) firstWordMs = Date.now() - started;
    words += text;
    say(text);
  };
  let usage: ChatUsage = {
    model: model === "opus-fast" ? OPUS_FAST_RATE : TALK_MODELS[model].id,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: instructions(voice) },
    {
      type: "text",
      text: contextText(project, input.tickets),
      cache_control: { type: "ephemeral" },
    },
  ];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...threadMessages(input.history),
    { role: "user", content: `${input.said}\n\n${formNote(input.form)}` },
  ];
  for (let step = 0; ; step++) {
    const asked = Date.now();
    let wrote = false;
    const response = await talkStep({
      model,
      client,
      system,
      tools: TOOLS,
      messages,
      last: step >= TICKET_MAX_STEPS,
      onText: (delta) => {
        wrote = true;
        speak(delta);
      },
      // Words before a tool end there, and are heard then.
      onBreak: () => {
        if (!wrote) return;
        wrote = false;
        speak(untilTool(words));
        if (voice) say(VOICE_PUSH);
      },
    });
    steps.push({
      what: "claude",
      ms: Date.now() - asked,
    });
    usage = addUsage(usage, response.usage);
    if (wrote) speak(" ");
    if (!response.toolUse)
      return {
        words: words.trim(),
        written,
        usage,
        firstWordMs,
        steps,
      };
    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of response.calls) {
      const ran = Date.now();
      const result = await (async () => {
        if (call.name !== WRITE_TICKET.name)
          return runChatTool(
            call,
            { project, pullRequest: null, spotted: [] },
            sources,
          );
        const ticket = writeInput.safeParse(call.input);
        if (!ticket.success)
          return { text: "A title, and a shorter ticket.", error: true };
        written = ticket.data;
        await input.onWrite(ticket.data);
        return { text: "It is in the form." };
      })().catch((error: Error) => ({
        text: `That failed: ${error.message.slice(0, 200)}`,
        error: true,
      }));
      steps.push({ what: call.name, ms: Date.now() - ran });
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: result.text,
        ...("error" in result && result.error ? { is_error: true } : {}),
      });
    }
    messages.push({ role: "user", content: results });
  }
}
