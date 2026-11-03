import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  addUsage,
  CHAT_EFFORT,
  CHAT_MAX_STEPS,
  CHAT_MODEL,
  clockLabel,
  type ChatTicket,
  type ChatUsage,
} from "../core/chat";
import { TITLE_MAX } from "../core/new-ticket";
import { chapterMs, type Presentation } from "../core/presentation";
import { leadProof } from "../core/proofs";
import type { StageState } from "../core/stage";
import type { ChatContext } from "../db/chat";
import type { RepoReader } from "../server/github/repo-reads";
import {
  isStageTool,
  runStageTool,
  STAGE_TOOLS,
  stageNote,
  type StageHands,
} from "./stage-tools";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type Tool = Anthropic.Beta.BetaTool;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

/** What the agent may look at besides the context it is given. */
export interface ChatSources {
  /** Null when the GitHub App cannot read the repository. */
  reader: RepoReader | null;
  tickets(): Promise<
    {
      source: string;
      key: string;
      title: string;
      status: string;
      pullRequest: { number: number; state: string } | null;
    }[]
  >;
  ticket(key: string): Promise<{
    source: string;
    title: string;
    body: string;
    url: string;
  } | null>;
}

export interface ChatAnswer {
  body: string;
  /** The change it proposes, made only from its card. */
  change: string | null;
  /** The ticket it proposes, created only from its card. */
  ticket: ChatTicket | null;
  usage: ChatUsage;
}

/** Tickets, written or on a call. */
export const TICKET_RULES = `Tickets:
- You never create a ticket yourself. When they ask for one, or say yes to one you suggested or to one of the suggested tickets, call propose_ticket. They see it as a card and create it with one click: then say in one short sentence that it is there, without repeating it.
- A ticket is for what the project should do beyond this pull request; what belongs in this pull request is a change.
- Do not propose a ticket they did not ask for: suggest it in words and let them ask. If you know of a ticket that already asks for it, tell them instead.`;

const instructions = (
  video: boolean,
) => `You are Yarrow's agent on a pull request that Yarrow's agents opened. A member of the project asks you about it on Yarrow's dashboard, next to what the change shows. Answer as a colleague who knows the change and the code.

How you answer:
- In the language of the question, in plain words, short: two to five sentences unless they ask for more. No headings, no filler, no praise of the question. A list only when you list several things.
- Never guess how the code behaves: read it with your tools first. When you could not check something, say so.
- The repository is read at the pull request's branch. Code search only covers the default branch; read files to see the branch.
- The project's other tickets are there to spot duplicates, overlaps and what is already planned.
- Talk about what the page shows (below), and never mention a demo, an image or anything else it does not show.${
  video
    ? `
- When a moment of the demo shows what you talk about, point to it with its time written exactly like [at 0:56] (the times are below). At most two per answer, only where they help. Call it the demo, never a video or a film.`
    : ""
}

Changes:
- You never change code yourself. When the member asks for a change to this pull request, or says yes to one you suggested, call propose_change. The member sees it as a card and updates the pull request with one click; your text is then one short sentence at most, without repeating the card.
- The card says what will change for the people using the app, in plain words: what they will see or be able to do. No code, file, function, class or style names: the member is not always a developer, and the implementer reads the code itself. What the app shows is quoted as it shows it, never translated: its labels and messages, in the app's own language.
- Do not propose a change they did not ask for: suggest it in words and let them ask.
- A closed or merged pull request can no longer change: say so.

${TICKET_RULES}`;

/** When the member writes beside the stage, the app running live. */
const ON_STAGE = `The stage:
- The member writes to you beside the demo: behind it runs the app of the pull request's branch, live on a desktop, in a browser (the app as it is on the branch, and when there is one, the app as it was before the change in a second tab), and a terminal in the branch's checkout (/workspace/repo). The demo stands paused while you answer.
- When seeing it helps, or when they ask you to try something, show it: look at the screen, then act on it. The moment you act, the app takes the demo's place on their screen, and they see the pointer move and click as you do it. A question words can answer needs no gesture: the demo stays where it is. Then say in your answer what you did and what you saw.
- What a look returns names the page's elements with refs (e12, f5e16): act on them by those refs, from your latest look only.
- What you do in the app is real (its database is a test one) and stays until the stage restarts: nothing destructive unless they ask.`;

/** When no live app is beside the member. */
const OFF_STAGE = `You cannot touch the app from here: asked to click or try something, say so in one sentence and that they can do it themselves with Open the app.`;

export const CHAT_TOOLS: Tool[] = [
  {
    name: "read_file",
    description:
      "Read a file of the repository at the pull request's branch, with line numbers. A directory gives its entries. Long files come in parts: pass start_line to read further.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "From the repository's root." },
        start_line: { type: "integer", minimum: 1 },
      },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description:
      "List the repository's files at the pull request's branch, under a folder or everywhere.",
    input_schema: {
      type: "object",
      properties: {
        folder: {
          type: "string",
          description: "From the repository's root; empty for everything.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "search_code",
    description:
      "GitHub code search in the repository (default branch only): the files that match.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "list_tickets",
    description:
      "The project's tickets: the ones Yarrow worked on (status, pull request) and the repository's other open issues.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "read_ticket",
    description: "What one ticket asks, by its key (an issue number, PROJ-12).",
    input_schema: {
      type: "object",
      properties: { key: { type: "string" } },
      required: ["key"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_change",
    description:
      "Propose a change to this pull request. The member sees it as a card and decides; nothing changes until they make it. The implementer then works from the card's words.",
    input_schema: {
      type: "object",
      properties: {
        change: {
          type: "string",
          description:
            "What will change, as the people using the app will notice it: one to three plain sentences in the conversation's language, precise about what they will see (where, when, what it says). No code, file, function, class or CSS names. The app's labels and messages quoted as the app shows them, untranslated.",
        },
      },
      required: ["change"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_ticket",
    description:
      "Propose a new ticket for the project. The member sees it as a card and decides: nothing is created until they do, and it is not started. One per answer.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description:
            "What is wanted, in a few plain words, in the conversation's language.",
        },
        body: {
          type: "string",
          description:
            "What the people using the app would get and why, two lines at most, in plain words, in the conversation's language: what the member asked for or agreed to, nothing more. No code, file, function, class or CSS names. The app's labels and messages quoted as the app shows them, untranslated.",
        },
        suggestion: {
          type: "integer",
          minimum: 1,
          description: "The number of the suggested ticket it comes from.",
        },
      },
      required: ["title", "body"],
      additionalProperties: false,
    },
  },
];

/** What a proposal's tool answers: the card shows under the agent's words. */
const CARD_SHOWN =
  "Shown to the member as a card, under your words. Do not repeat it: one short sentence at most.";

const READ_LINES = 400;
const LIST_PATHS = 400;
const DIFF_CHARS = 60_000;

const inputs = {
  read_file: z.object({
    path: z.string().min(1),
    start_line: z.number().int().min(1).optional(),
  }),
  list_files: z.object({ folder: z.string().optional() }),
  search_code: z.object({ query: z.string().min(1) }),
  list_tickets: z.object({}),
  read_ticket: z.object({ key: z.string().min(1) }),
  propose_change: z.object({ change: z.string().min(1).max(4000) }),
  propose_ticket: z.object({
    title: z.string().trim().min(1).max(TITLE_MAX),
    body: z.string().trim().min(1).max(4000),
    suggestion: z.number().int().min(1).optional(),
  }),
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n[…cut]` : text;

/** The film, chapter by chapter, with when each line is said. */
export function presentationLines(timeline: Presentation): string {
  const lines: string[] = [];
  let start = 0;
  for (const chapter of timeline.chapters) {
    const length = chapterMs(chapter);
    lines.push(
      `${clockLabel(start)}–${clockLabel(start + length)} "${chapter.title}"${chapter.before ? " (the app before the change)" : ""}, ${chapter.tab}${chapter.url ? ` ${chapter.url}` : ""}`,
    );
    if (chapter.cues.length)
      for (const cue of chapter.cues)
        lines.push(`  ${clockLabel(start + cue.startMs)} ${cue.text}`);
    else if (chapter.say) lines.push(`  ${clockLabel(start)} ${chapter.say}`);
    start += length;
  }
  return lines.join("\n");
}

/** The change has a demo, on the page and for the agent. */
export const hasVideo = (panel: ChatContext["panel"]) =>
  Boolean(panel?.screens.some((screen) => screen.kind === "presentation"));

/** The one thing the page shows of the change beside no demo (src/core/proofs.ts). */
function shownBesideNoVideo(panel: ChatContext["panel"]): string {
  const lead = leadProof(panel?.proofs ?? []);
  switch (lead?.kind) {
    case "images":
      return lead.before
        ? `an image to slide across, the screen before and after: ${lead.label}`
        : `an image of the screen: ${lead.label}`;
    case "measure":
      return `a number, ${lead.label}: ${lead.before} ${lead.unit} before, ${lead.after} ${lead.unit} now`;
    case "output":
      return `an example, ${lead.label}:\n${clip(lead.after, 2000)}`;
    case "document":
      return `a button to the document ${lead.file}`;
    case "check":
      return "a button to GitHub's check";
    default:
      return panel && !panel.proofs && panel.screens.length
        ? "screenshots of the app"
        : "nothing else";
  }
}

/** What the agents noticed outside this ticket, still to be made tickets. */
export const spottedLines = (panel: ChatContext["panel"]) =>
  panel?.implementation?.spotted ?? [];

/** What the member has in front of them: the agent talks about this alone. */
function pageShows(panel: ChatContext["panel"]): string {
  const page = `On the page, beside the conversation: the ticket, the summary, the files changed${panel?.preview ? ", a button that opens the app" : ""}${spottedLines(panel).length ? ", a button that lists the suggested tickets" : ""}`;
  return hasVideo(panel)
    ? `${page}, and the demo below.`
    : `${page}, and ${shownBesideNoVideo(panel)}. There is no demo on this ticket.`;
}

/** Everything about the pull request, before the conversation. */
export function chatContextText(
  context: Omit<ChatContext, "answerId" | "history">,
  extra: {
    presentation: Presentation | null;
    diff: Awaited<ReturnType<RepoReader["pullDiff"]>> | null;
  },
): string {
  const { project, ticket, pullRequest, panel } = context;
  const parts: string[] = [
    `Project: ${project.name} (${project.repository} on GitHub, default branch ${project.defaultBranch}).`,
    `Ticket (${ticket.source} ${ticket.key}): ${ticket.title}\n${ticket.url}\n${clip(ticket.body.trim() || "(no description)", 6000)}`,
  ];
  if (pullRequest)
    parts.push(
      `Pull request #${pullRequest.number}, ${pullRequest.state}, branch ${pullRequest.branch}: ${pullRequest.url}`,
    );
  else parts.push("No pull request is open for this ticket.");
  const spotted = spottedLines(panel);
  if (spotted.length)
    parts.push(
      `Suggested tickets, noticed while working on this ticket and left alone:\n${spotted
        .map((line, i) => `${i + 1}. ${line}`)
        .join("\n")}`,
    );
  const done = panel?.implementation;
  if (done) {
    if (done.ask) parts.push(`What the ticket asks:\n${done.ask}`);
    parts.push(`What it does (written by ${done.by}):\n${done.summary}`);
    if (done.criteria.length)
      parts.push(
        `Done when:\n${done.criteria
          .map(
            (item) =>
              `- [${item.status}] ${item.criterion}${item.note ? ` (${item.note})` : ""}`,
          )
          .join("\n")}`,
      );
    if (done.verification.length)
      parts.push(
        `Checks run:\n${done.verification.map((line) => `- ${line}`).join("\n")}`,
      );
    if (done.notVerified.length)
      parts.push(
        `Not verified:\n${done.notVerified.map((line) => `- ${line}`).join("\n")}`,
      );
    if (done.risks.length)
      parts.push(`Risks:\n${done.risks.map((line) => `- ${line}`).join("\n")}`);
  }
  const review = panel?.review;
  if (review) {
    const place = (comment: { path: string | null; line: number | null }) =>
      comment.path
        ? ` (${comment.path}${comment.line ? `:${comment.line}` : ""})`
        : "";
    parts.push(
      [
        `Review by ${review.by}: ${review.summary}`,
        ...review.blocking.map((c) => `- Still to fix: ${c.body}${place(c)}`),
        ...review.suggestions.map((c) => `- Suggestion: ${c.body}${place(c)}`),
      ].join("\n"),
    );
  }
  if (panel?.corrections.length)
    parts.push(
      `Changes asked since it opened:\n${panel.corrections
        .map(
          (c) =>
            `- "${c.instruction}" (${c.status})${c.summary ? `: ${c.summary}` : ""}`,
        )
        .join("\n")}`,
    );
  parts.push(pageShows(panel));
  if (extra.presentation)
    parts.push(
      `The demo (your screen with your voice; what is said, with its time):\n${presentationLines(extra.presentation)}`,
    );
  if (extra.diff) {
    const files = extra.diff
      .map(
        (file) =>
          `- ${file.path} (${file.status}, +${file.additions} −${file.deletions})`,
      )
      .join("\n");
    let budget = DIFF_CHARS;
    const patches: string[] = [];
    for (const file of extra.diff) {
      if (!file.patch) continue;
      const block = `--- ${file.path}\n${file.patch}`;
      if (block.length > budget) {
        patches.push(`--- ${file.path}\n[not shown: read the file]`);
        continue;
      }
      budget -= block.length;
      patches.push(block);
    }
    parts.push(`Files changed:\n${files}`);
    if (patches.length) parts.push(`The diff:\n${patches.join("\n\n")}`);
  }
  return parts.join("\n\n");
}

const usageOf = (response: Anthropic.Beta.BetaMessage): ChatUsage => ({
  model: response.model,
  input: response.usage.input_tokens,
  output: response.usage.output_tokens,
  cacheRead: response.usage.cache_read_input_tokens ?? 0,
  cacheWrite: response.usage.cache_creation_input_tokens ?? 0,
});

/** The project's tickets, one a line: Yarrow's, and its open issues. */
export async function listTickets(sources: ChatSources): Promise<string> {
  const known = await sources.tickets();
  const keys = new Set(known.map((ticket) => `${ticket.source}:${ticket.key}`));
  const open = sources.reader
    ? await sources.reader.openIssues().catch(() => [])
    : [];
  const lines = [
    ...known.map(
      (ticket) =>
        `${ticket.source} ${ticket.key} · ${ticket.title} · ${ticket.status}${ticket.pullRequest ? ` · pull request #${ticket.pullRequest.number} ${ticket.pullRequest.state}` : ""}`,
    ),
    ...open
      .filter((issue) => !keys.has(`github:${issue.number}`))
      .map(
        (issue) =>
          `github ${issue.number} · ${issue.title} · open on GitHub, not given to Yarrow`,
      ),
  ];
  return lines.length ? lines.join("\n") : "No tickets.";
}

/** One tool call, run: its text for the model, and a change when proposed. */
export async function runChatTool(
  call: Anthropic.Beta.BetaToolUseBlock,
  context: Pick<ChatContext, "project" | "pullRequest"> & {
    spotted: string[];
  },
  sources: ChatSources,
): Promise<ChatToolResult> {
  const schema = inputs[call.name as keyof typeof inputs];
  const parsed = schema?.safeParse(call.input);
  if (!schema || !parsed?.success)
    return { text: `Invalid call to ${call.name}.`, error: true };
  const { reader } = sources;
  const ref = context.pullRequest?.branch ?? context.project.defaultBranch;
  const noRepo = {
    text: "The repository cannot be read right now.",
    error: true,
  };
  switch (call.name) {
    case "read_file": {
      if (!reader) return noRepo;
      const input = parsed.data as z.infer<typeof inputs.read_file>;
      const found = await reader.readFile(input.path, ref);
      if (!found) return { text: `No ${input.path} on ${ref}.`, error: true };
      if (found.kind === "directory") return { text: found.entries.join("\n") };
      if (found.kind === "binary")
        return { text: `${input.path} is not text.` };
      const lines = found.text.split("\n");
      const from = (input.start_line ?? 1) - 1;
      const shown = lines
        .slice(from, from + READ_LINES)
        .map((line, i) => `${from + i + 1}\t${line}`)
        .join("\n");
      const more =
        from + READ_LINES < lines.length
          ? `\n[${lines.length - from - READ_LINES} more lines: start_line ${from + READ_LINES + 1}]`
          : "";
      return { text: shown + more };
    }
    case "list_files": {
      if (!reader) return noRepo;
      const input = parsed.data as z.infer<typeof inputs.list_files>;
      const folder = (input.folder ?? "").replace(/^\/+|\/+$/g, "");
      const { paths, truncated } = await reader.listFiles(ref);
      const under = folder
        ? paths.filter((path) => path.startsWith(`${folder}/`))
        : paths;
      const shown = under.slice(0, LIST_PATHS).join("\n");
      const more =
        under.length > LIST_PATHS || truncated
          ? `\n[more files: list a folder]`
          : "";
      return { text: (shown || "No files there.") + more };
    }
    case "search_code": {
      if (!reader) return noRepo;
      const input = parsed.data as z.infer<typeof inputs.search_code>;
      const paths = await reader.searchCode(input.query);
      return { text: paths.length ? paths.join("\n") : "Nothing matches." };
    }
    case "list_tickets":
      return { text: await listTickets(sources) };
    case "read_ticket": {
      const input = parsed.data as z.infer<typeof inputs.read_ticket>;
      const key = input.key.replace(/^#/, "");
      const known = await sources.ticket(key);
      if (known)
        return {
          text: `${known.title}\n${known.url}\n${clip(known.body.trim() || "(no description)", 8000)}`,
        };
      if (reader && /^\d+$/.test(key)) {
        const issue = await reader.readIssue(Number(key));
        if (issue)
          return {
            text: `${issue.title} (${issue.state})\n${issue.url}\n${clip(issue.body.trim() || "(no description)", 8000)}`,
          };
      }
      return { text: `No ticket ${input.key}.`, error: true };
    }
    case "propose_change": {
      if (context.pullRequest?.state !== "open")
        return {
          text: "This pull request is no longer open: it cannot change.",
          error: true,
        };
      const input = parsed.data as z.infer<typeof inputs.propose_change>;
      return { text: CARD_SHOWN, change: input.change.trim() };
    }
    case "propose_ticket": {
      const input = parsed.data as z.infer<typeof inputs.propose_ticket>;
      const note =
        input.suggestion === undefined
          ? undefined
          : context.spotted[input.suggestion - 1];
      if (input.suggestion !== undefined && !note)
        return {
          text: `No suggested ticket ${input.suggestion}.`,
          error: true,
        };
      return {
        text: CARD_SHOWN,
        ticket: { title: input.title, body: input.body, note },
      };
    }
    default:
      return { text: `No tool ${call.name}.`, error: true };
  }
}

/** A tool's answer, and the card it adds to the conversation. */
export interface ChatToolResult {
  text: string;
  error?: boolean;
  change?: string;
  ticket?: ChatTicket;
}

/**
 * The agent answers the last question of the conversation: it reads what it
 * needs (the code, the tickets) through tools, then writes its answer.
 */
export async function answerQuestion(input: {
  client: Anthropic;
  context: ChatContext;
  sources: ChatSources;
  presentation: Presentation | null;
  /** Asked beside the stage while it is up: the agent acts on it too. */
  stage?: {
    state: StageState | null;
    hands: StageHands;
    /** Before the first move: the member's screen goes to the app. */
    show?: () => Promise<void>;
  } | null;
}): Promise<ChatAnswer> {
  const { client, context, sources, stage } = input;
  const diff =
    sources.reader && context.pullRequest
      ? await sources.reader
          .pullDiff(context.pullRequest.number)
          .catch(() => null)
      : null;
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    {
      type: "text",
      text: `${instructions(hasVideo(context.panel))}\n\n${stage ? ON_STAGE : OFF_STAGE}`,
    },
    {
      type: "text",
      text: chatContextText(context, {
        presentation: input.presentation,
        diff,
      }),
      cache_control: { type: "ephemeral" },
    },
  ];
  const tools = stage ? [...CHAT_TOOLS, ...STAGE_TOOLS] : CHAT_TOOLS;
  // Earlier answers come back as their words alone: the context above them
  // may have changed since (a correction landed).
  const messages: MessageParam[] = context.history.map((message) => ({
    role: message.author === "builder" ? "user" : "assistant",
    content: message.body,
  }));
  const question = messages.at(-1);
  if (stage && question?.role === "user")
    question.content = `${question.content as string}\n\n${stageNote(stage.state)}`;
  let usage: ChatUsage = {
    model: CHAT_MODEL,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  let change: string | null = null;
  let ticket: ChatTicket | null = null;
  let shown = false;
  for (let step = 0; ; step++) {
    const last = step >= CHAT_MAX_STEPS;
    const response = await client.beta.messages.create({
      model: CHAT_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: CHAT_EFFORT },
      system,
      tools,
      tool_choice: last ? { type: "none" } : { type: "auto" },
      cache_control: { type: "ephemeral" },
      messages,
    });
    usage = addUsage(usage, usageOf(response));
    const calls = response.content.filter(
      (block): block is Anthropic.Beta.BetaToolUseBlock =>
        block.type === "tool_use",
    );
    if (response.stop_reason !== "tool_use" || calls.length === 0) {
      const text = response.content
        .filter(
          (block): block is Anthropic.Beta.BetaTextBlock =>
            block.type === "text",
        )
        .map((block) => block.text)
        .join("")
        .trim();
      if (response.stop_reason === "refusal" && !text)
        return { body: "I can't help with that one.", change, ticket, usage };
      return { body: text, change, ticket, usage };
    }
    messages.push({ role: "assistant", content: response.content });
    const run = async (call: Anthropic.Beta.BetaToolUseBlock) => {
      if (stage && isStageTool(call.name) && call.name !== "look_at_screen") {
        if (!shown) await stage.show?.();
        shown = true;
      }
      const result: ChatToolResult = await (
        stage && isStageTool(call.name)
          ? runStageTool(call, stage.hands)
          : runChatTool(
              call,
              { ...context, spotted: spottedLines(context.panel) },
              sources,
            )
      ).catch((error: Error) => ({
        text: `That failed: ${error.message.slice(0, 200)}`,
        error: true,
      }));
      if (result.change) change = result.change;
      if (result.ticket) ticket = result.ticket;
      return {
        type: "tool_result" as const,
        tool_use_id: call.id,
        content: result.text,
        ...(result.error ? { is_error: true } : {}),
      };
    };
    // Reads at once; moves on the stage one at a time, in the order asked.
    const results: ToolResult[] = calls.some((call) => isStageTool(call.name))
      ? await calls.reduce<Promise<ToolResult[]>>(
          async (done, call) => [...(await done), await run(call)],
          Promise.resolve([]),
        )
      : await Promise.all(calls.map(run));
    const content: Anthropic.Beta.BetaContentBlockParam[] = [...results];
    if (step + 1 >= CHAT_MAX_STEPS)
      content.push({
        type: "text",
        text: "Answer now with what you have read.",
      });
    messages.push({ role: "user", content });
  }
}
