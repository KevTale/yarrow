import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import {
  addUsage,
  CHAT_EFFORT,
  CHAT_MAX_STEPS,
  CHAT_MODEL,
  clockLabel,
  type ChatUsage,
} from "../core/chat";
import { chapterMs, type Presentation } from "../core/presentation";
import type { ChatContext } from "../db/chat";
import type { RepoReader } from "../server/github/repo-reads";

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
  usage: ChatUsage;
}

const INSTRUCTIONS = `You are Yarrow's agent on a pull request that Yarrow's agents opened. A member of the project asks you about it on Yarrow's dashboard, next to the film in which the agent presented the change. Answer as a colleague who knows the change and the code.

How you answer:
- In the language of the question, in plain words, short: two to five sentences unless they ask for more. No headings, no filler, no praise of the question. A list only when you list several things.
- Never guess how the code behaves: read it with your tools first. When you could not check something, say so.
- The repository is read at the pull request's branch. Code search only covers the default branch; read files to see the branch.
- The project's other tickets are there to spot duplicates, overlaps and what is already planned.
- When a moment of the film shows what you talk about, point to it with its time written exactly like [at 0:56] (the times are below). At most two per answer, only where they help.

Changes:
- You never change code yourself. When the member asks for a change to this pull request, or says yes to one you suggested, call propose_change. The member sees it as a card and updates the pull request with one click; your text is then one short sentence at most, without repeating the card.
- The card says what will change for the people using the app, in plain words: what they will see or be able to do. No code, file, function, class or style names: the member is not always a developer, and the implementer reads the code itself. What the app shows is quoted as it shows it, never translated: its labels and messages, in the app's own language.
- Do not propose a change they did not ask for: suggest it in words and let them ask.
- A closed or merged pull request can no longer change: say so.`;

const TOOLS: Tool[] = [
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
];

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

/** Everything about the pull request, before the conversation. */
export function chatContextText(
  context: ChatContext,
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
  const done = panel?.implementation;
  if (done) {
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
  if (extra.presentation)
    parts.push(
      `The film (the agent's screen with its voice; what is said, with its time):\n${presentationLines(extra.presentation)}`,
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

/** One tool call, run: its text for the model, and a change when proposed. */
async function runTool(
  call: Anthropic.Beta.BetaToolUseBlock,
  context: ChatContext,
  sources: ChatSources,
): Promise<{ text: string; error?: boolean; change?: string }> {
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
    case "list_tickets": {
      const known = await sources.tickets();
      const keys = new Set(
        known.map((ticket) => `${ticket.source}:${ticket.key}`),
      );
      const open = reader ? await reader.openIssues().catch(() => []) : [];
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
      return { text: lines.length ? lines.join("\n") : "No tickets." };
    }
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
      return {
        text: "Shown to the member as a card. Do not repeat it: one short sentence at most.",
        change: input.change.trim(),
      };
    }
    default:
      return { text: `No tool ${call.name}.`, error: true };
  }
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
}): Promise<ChatAnswer> {
  const { client, context, sources } = input;
  const diff =
    sources.reader && context.pullRequest
      ? await sources.reader
          .pullDiff(context.pullRequest.number)
          .catch(() => null)
      : null;
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: INSTRUCTIONS },
    {
      type: "text",
      text: chatContextText(context, {
        presentation: input.presentation,
        diff,
      }),
      cache_control: { type: "ephemeral" },
    },
  ];
  // Earlier answers come back as their words alone: the context above them
  // may have changed since (a correction landed).
  const messages: MessageParam[] = context.history.map((message) => ({
    role: message.author === "builder" ? "user" : "assistant",
    content: message.body,
  }));
  let usage: ChatUsage = {
    model: CHAT_MODEL,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  };
  let change: string | null = null;
  for (let step = 0; ; step++) {
    const last = step >= CHAT_MAX_STEPS;
    const response = await client.beta.messages.create({
      model: CHAT_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: CHAT_EFFORT },
      system,
      tools: TOOLS,
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
        return { body: "I can't help with that one.", change, usage };
      return { body: text, change, usage };
    }
    messages.push({ role: "assistant", content: response.content });
    const results: ToolResult[] = await Promise.all(
      calls.map(async (call) => {
        const result = await runTool(call, context, sources).catch(
          (error: Error) => ({
            text: `That failed: ${error.message.slice(0, 200)}`,
            error: true as const,
            change: undefined,
          }),
        );
        if (result.change) change = result.change;
        return {
          type: "tool_result" as const,
          tool_use_id: call.id,
          content: result.text,
          ...(result.error ? { is_error: true } : {}),
        };
      }),
    );
    const content: Anthropic.Beta.BetaContentBlockParam[] = [...results];
    if (step + 1 >= CHAT_MAX_STEPS)
      content.push({
        type: "text",
        text: "Answer now with what you have read.",
      });
    messages.push({ role: "user", content });
  }
}
