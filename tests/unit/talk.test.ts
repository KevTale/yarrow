import { createHmac } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import {
  beatMark,
  VOICE_PUSH,
  type StageCueResult,
  type StageHand,
} from "../../src/core/stage";
import type { ChatSources } from "../../src/runner/chat";
import {
  completion,
  conversationSoFar,
  memberSpoke,
  memberWords,
  stageNote,
  talkGrantOf,
  spokenLanguage,
  talkFiller,
  talkMessages,
  talkRequestSchema,
  talkTurn,
  untilTool,
  type TalkContext,
} from "../../src/runner/talk";
import {
  conversationToken,
  transcriptionToken,
  readTalkGrant,
  sameKey,
  signTalkGrant,
  TALK_GRANT_MS,
  talkAgentConfig,
  talkKey,
} from "../../src/runner/voice/agent";
import { claude } from "./helpers/claude-stream";

const context: TalkContext = {
  text: "Pull request #4 of marie/halyard: a status filter above the list.",
  video: true,
  spotted: [],
  project: {
    id: "p",
    name: "Halyard",
    repository: "marie/halyard",
    defaultBranch: "main",
    githubInstallationId: "42",
    githubRepositoryId: "999",
  },
  pullRequest: {
    number: 4,
    url: "https://github.com/marie/halyard/pull/4",
    branch: "yarrow/3",
    state: "open",
  },
};

const sources: ChatSources = {
  reader: {
    readFile: async () => ({ kind: "file", text: "const a = 1;" }),
    listFiles: async () => ({ paths: [], truncated: false }),
    searchCode: async () => [],
    openIssues: async () => [],
    readIssue: async () => null,
    pullDiff: async () => [],
  },
  tickets: async () => [],
  ticket: async () => null,
};

function stage(answers: Partial<Record<StageHand["action"], StageCueResult>>) {
  const hands: StageHand[] = [];
  return {
    hands,
    stage: async (hand: StageHand) => {
      hands.push(hand);
      return answers[hand.action] ?? { ok: true, problems: [] };
    },
  };
}

const held = {
  chapter: { index: 1, title: "The filter" },
  held: true,
  chapters: 3,
};

describe("the live call's turn", () => {
  it("talks of a video only when the ticket has one", async () => {
    const { client, requests } = claude(() => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "It returns the due date." }],
    }));
    const turn = (video: boolean) =>
      talkTurn({
        client,
        context: { ...context, video },
        messages: [{ role: "user", content: "What am I looking at?" }],
        state: null,
        sources,
        stage: null,
        say: () => {},
      });
    await turn(false);
    await turn(true);
    const rules = (at: number) =>
      (requests[at]!.body.system as { text: string }[])[0]!.text;
    const tools = (at: number) =>
      (requests[at]!.body.tools as { name: string }[]).map((tool) => tool.name);
    expect(rules(0)).toContain("never mention a demo");
    expect(rules(0)).not.toMatch(/film|resume_presentation|stands still/);
    expect(tools(0)).not.toContain("resume_presentation");
    expect(rules(1)).toContain("resume_presentation");
    expect(rules(1)).toContain("Call it the demo, never a video or a film.");
    expect(tools(1)).toContain("resume_presentation");
  });

  it("speaks first, looks, acts on the stage, then answers", async () => {
    const { client, requests } = claude((body) => {
      const turns = (body.messages as unknown[]).length;
      if (turns === 1)
        return {
          stop_reason: "tool_use",
          content: [
            { type: "text", text: "Let me show you." },
            { type: "tool_use", id: "t1", name: "look_at_screen", input: {} },
          ],
        };
      if (turns === 3)
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "t2",
              name: "act_on_screen",
              input: { actions: [{ do: "click", target: "e12" }] },
            },
          ],
        };
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Only the done tasks are left." }],
      };
    });
    const { stage: hands, hands: asked } = stage({
      look: { ok: true, problems: [], screen: '- button "Done" [ref=e12]' },
      act: { ok: true, problems: [], screen: "- list: 2 tasks" },
    });
    const said: string[] = [];
    const answer = await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "Show me the done filter." }],
      state: held,
      sources,
      stage: hands,
      say: (text) => said.push(text),
    });

    expect(said.join("")).toBe(
      `Let me show you. ${VOICE_PUSH}Only the done tasks are left. `,
    );
    expect(answer.words).toBe("Let me show you. Only the done tasks are left.");
    expect(answer.change).toBeNull();
    expect(answer.firstWordMs).not.toBeNull();
    expect(answer.steps.map((step) => step.what)).toEqual([
      "claude",
      "look_at_screen",
      "claude",
      "act_on_screen[click]",
      "claude",
    ]);
    expect(answer.usage).toMatchObject({ input: 300, output: 60 });
    expect(asked).toEqual([
      { action: "look" },
      { action: "act", actions: [{ do: "click", target: "e12" }] },
    ]);

    const first = requests[0]!;
    expect(first.beta).toContain("server-side-fallback-2026-07-01");
    expect(first.body).toMatchObject({
      model: "claude-sonnet-5-5",
      fallbacks: "default",
      output_config: { effort: "low" },
      tool_choice: { type: "auto" },
    });
    const tools = first.body.tools as { name: string }[];
    expect(tools.map((tool) => tool.name)).toContain("act_on_screen");
    expect(tools.map((tool) => tool.name)).toContain("propose_change");
    expect(
      (first.body.messages as { content: string }[])[0]!.content,
    ).toContain('stopped in chapter 2 of 3, "The filter"');

    const third = requests[2]!.body.messages as {
      role: string;
      content: { type: string; content?: string; tool_use_id?: string }[];
    }[];
    expect(third[2]!.content[0]).toMatchObject({
      type: "tool_result",
      tool_use_id: "t1",
      content: '- button "Done" [ref=e12]',
    });
  });

  it("says no word of its own when the agent goes to the code without any", async () => {
    const { client } = claude((body) =>
      (body.messages as unknown[]).length === 1
        ? {
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "list_tickets",
                input: {},
              },
            ],
          }
        : {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Two are done." }],
          },
    );
    const said: string[] = [];
    const answer = await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "How many are done?" }],
      state: held,
      sources,
      stage: stage({}).stage,
      say: (text) => said.push(text),
    });
    expect(said.join("")).toBe("Two are done. ");
    expect(answer.words).toBe("Two are done.");
  });

  it("keeps its gestures out of the voice, their place marked in it", async () => {
    const { client } = claude(() => ({
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: `<act do="fill" target="e14" text="Pain"/><act do="click" target="e15"/>Je l'ajoute, <act do="circle" target="text=Pain"/>et la voilà.`,
        },
      ],
    }));
    const { stage: hands, hands: asked } = stage({});
    const said: string[] = [];
    const answer = await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "Ajoute une tâche Pain." }],
      state: held,
      sources,
      stage: hands,
      say: (text) => said.push(text),
    });
    expect(said.join("")).toBe(
      `${beatMark(0)}Je l'ajoute, ${beatMark(1)}et la voilà. `,
    );
    expect(answer.words).toBe("Je l'ajoute, et la voilà.");
    expect(asked).toEqual([
      {
        action: "gesture",
        n: 0,
        actions: [
          { do: "fill", target: "e14", text: "Pain" },
          { do: "click", target: "e15" },
        ],
      },
      {
        action: "gesture",
        n: 1,
        actions: [{ do: "circle", target: "text=Pain" }],
      },
    ]);
    expect(answer.steps.map((step) => step.what)).toContain("beat[fill click]");
  });

  it("does its gestures at once when no word comes with them", async () => {
    const { client } = claude(() => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: `<act do="click" target="e15"/>` }],
    }));
    const { stage: hands, hands: asked } = stage({});
    await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "Clique." }],
      state: held,
      sources,
      stage: hands,
      say: () => {},
    });
    expect(asked.map((hand) => hand.action)).toEqual(["gesture", "beat"]);
    expect(asked[1]).toEqual({ action: "beat", n: null });
  });

  it("does its gestures before a move of the stage that follows them", async () => {
    const { client } = claude((body) =>
      (body.messages as unknown[]).length === 1
        ? {
            stop_reason: "tool_use",
            content: [
              {
                type: "text",
                text: `<act do="click" target="e15"/>Je clique.`,
              },
              { type: "tool_use", id: "t1", name: "look_at_screen", input: {} },
            ],
          }
        : {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Voilà." }],
          },
    );
    const { stage: hands, hands: asked } = stage({});
    await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "Clique." }],
      state: held,
      sources,
      stage: hands,
      say: () => {},
    });
    expect(asked.map((hand) => hand.action)).toEqual([
      "gesture",
      "beat",
      "look",
    ]);
  });

  it("reads the call's words without the marks of its gestures", () => {
    expect(
      talkMessages([
        { role: "user", content: "Ajoute-la." },
        { role: "assistant", content: `${beatMark(3)}La voilà.` },
      ]),
    ).toEqual([
      { role: "user", content: "Ajoute-la." },
      { role: "assistant", content: "La voilà." },
    ]);
  });

  it("acts on the stage at once, without a word before", async () => {
    const { client } = claude((body) =>
      (body.messages as unknown[]).length === 1
        ? {
            stop_reason: "tool_use",
            content: [
              { type: "tool_use", id: "t1", name: "look_at_screen", input: {} },
            ],
          }
        : {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Two are done." }],
          },
    );
    const said: string[] = [];
    await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "Show me the other tab." }],
      state: held,
      sources,
      stage: stage({}).stage,
      say: (text) => said.push(text),
    });
    expect(said.join("")).toBe("Two are done. ");
  });

  it("gives the screen with the member's words, to act without a look", async () => {
    const { client, requests } = claude(() => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "One is in Doing." }],
    }));
    const { stage: hands, hands: asked } = stage({});
    await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "How many are in Doing?" }],
      state: held,
      screen: 'Address: http://localhost:4173/\n- link "Doing 1" [ref=e7]',
      sources,
      stage: hands,
      say: () => {},
    });
    const first = (requests[0]!.body.messages as { content: string }[])[0]!;
    expect(first.content).toContain("How many are in Doing?");
    expect(first.content).toContain("without looking first");
    expect(first.content).toContain('- link "Doing 1" [ref=e7]');
    expect(asked).toEqual([]);
  });

  it("answers by voice alone when the stage is not up: no hands, no stage", async () => {
    const { client, requests } = claude(() => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "The filter keeps the done tasks." }],
    }));
    const answer = await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "What does the filter do?" }],
      state: null,
      sources,
      stage: null,
      say: () => {},
    });
    expect(answer.words).toBe("The filter keeps the done tasks.");
    const body = requests[0]!.body as {
      tools: { name: string }[];
      system: { text: string }[];
      messages: { content: string }[];
    };
    const tools = body.tools.map((tool) => tool.name);
    expect(tools).toContain("resume_presentation");
    expect(tools).not.toContain("look_at_screen");
    expect(body.system[0]!.text).toContain("No live stage is on this call");
    expect(body.system[0]!.text).not.toContain("The stage:");
    expect(body.messages[0]!.content).toBe("What does the filter do?");
  });

  it("plays the film on when they want it, from a chapter, after its words", async () => {
    const { client, requests } = claude(() => ({
      stop_reason: "tool_use",
      content: [
        { type: "text", text: "Je le reprends du début." },
        {
          type: "tool_use",
          id: "t1",
          name: "resume_presentation",
          input: { chapter: 1 },
        },
      ],
    }));
    const { stage: hands, hands: asked } = stage({});
    const said: string[] = [];
    const answer = await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "Remontre depuis le début." }],
      state: { chapter: null, held: false, chapters: 3, over: true, film: 1 },
      sources,
      stage: hands,
      say: (text) => said.push(text),
    });
    expect(answer.resume).toEqual({ chapter: 1 });
    expect(answer.words).toBe("Je le reprends du début.");
    expect(said.join("")).toBe(`Je le reprends du début. ${VOICE_PUSH}`);
    expect(asked).toEqual([]);
    expect(requests).toHaveLength(1);
    const first = (requests[0]!.body.messages as { content: string }[])[0]!;
    expect(first.content).toContain(
      "The demo is paused in chapter 2 of 3; the stage shows it as the demo had it there.",
    );
    const tools = (requests[0]!.body.tools as { name: string }[]).map(
      (tool) => tool.name,
    );
    expect(tools).toContain("resume_presentation");
    expect(tools).not.toContain("show_chapter");
  });

  it("writes down what must be read, its voice saying one sentence", async () => {
    const { client } = claude((body) =>
      (body.messages as unknown[]).length === 1
        ? {
            stop_reason: "tool_use",
            content: [
              { type: "text", text: "Three files, written beside you." },
              {
                type: "tool_use",
                id: "t1",
                name: "write_down",
                input: { text: "- `a.ts`\n- `b.ts`\n- `c.ts`" },
              },
            ],
          }
        : { stop_reason: "end_turn", content: [] },
    );
    const said: string[] = [];
    const answer = await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "Which files changed?" }],
      state: null,
      sources,
      stage: null,
      say: (text) => said.push(text),
    });
    expect(answer.words).toBe("Three files, written beside you.");
    expect(answer.written).toBe("- `a.ts`\n- `b.ts`\n- `c.ts`");
    expect(said.join("")).not.toContain("a.ts");
  });

  it("proposes a change as a card in the thread, never reading it out", async () => {
    const proposing = (change: string, then: string) =>
      claude((body) =>
        (body.messages as unknown[]).length === 1
          ? {
              stop_reason: "tool_use",
              content: [
                {
                  type: "tool_use",
                  id: "t1",
                  name: "propose_change",
                  input: { change },
                },
              ],
            }
          : {
              stop_reason: "end_turn",
              content: [{ type: "text", text: then }],
            },
      );
    const { client, requests } = proposing(
      "The filter sits on the title's line.",
      "It's in the conversation.",
    );
    const { stage: hands, hands: asked } = stage({});
    const said: string[] = [];
    const answer = await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "Put it on the title's line." }],
      state: held,
      sources,
      stage: hands,
      say: (text) => said.push(text),
    });
    expect(answer.change).toBe("The filter sits on the title's line.");
    expect(answer.words).toBe("It's in the conversation.");
    expect(said.join("")).not.toContain("title's line");
    expect(asked).toEqual([]);
    const second = requests[1]!.body.messages as {
      content: { type: string; content?: string }[];
    }[];
    expect(second.at(-1)!.content[0]!.content).toContain("as a card");

    // A merged pull request no longer changes.
    const merged = await talkTurn({
      client: proposing("Change it.", "It is merged.").client,
      context: {
        ...context,
        pullRequest: { ...context.pullRequest!, state: "merged" },
      },
      messages: [{ role: "user", content: "Change it." }],
      state: held,
      sources,
      stage: hands,
      say: () => {},
    });
    expect(merged.change).toBeNull();
  });

  it("proposes a ticket as a card, tied to the suggestion it comes from", async () => {
    const proposing = (suggestion?: number) =>
      claude((body) =>
        (body.messages as unknown[]).length === 1
          ? {
              stop_reason: "tool_use",
              content: [
                {
                  type: "tool_use",
                  id: "t1",
                  name: "propose_ticket",
                  input: {
                    title: "Keep the filter",
                    body: "Adding a task leaves the filter as it is.",
                    suggestion,
                  },
                },
              ],
            }
          : {
              stop_reason: "end_turn",
              content: [{ type: "text", text: "It's in the conversation." }],
            },
      );
    const asked = (client: Anthropic, spotted: string[]) =>
      talkTurn({
        client,
        context: { ...context, spotted },
        messages: [{ role: "user", content: "Make a ticket for that." }],
        state: held,
        sources,
        stage: null,
        say: () => {},
      });
    const spotted = ["Adding a task resets the filter — src/app.js"];

    const plain = await asked(proposing().client, spotted);
    expect(plain.ticket).toEqual({
      title: "Keep the filter",
      body: "Adding a task leaves the filter as it is.",
    });
    expect(plain.words).toBe("It's in the conversation.");

    const from = await asked(proposing(1).client, spotted);
    expect(from.ticket?.note).toBe(spotted[0]);

    // No such suggestion: no card, and the agent is told.
    const { client, requests } = proposing(2);
    expect((await asked(client, spotted)).ticket).toBeNull();
    const second = requests[1]!.body.messages as {
      content: { type: string; is_error?: boolean }[];
    }[];
    expect(second.at(-1)!.content[0]!.is_error).toBe(true);
  });

  it("tells the agent what failed on the stage, and what it sees", async () => {
    const { client, requests } = claude((body) =>
      (body.messages as unknown[]).length === 1
        ? {
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "act_on_screen",
                input: { actions: [{ do: "click", target: "e99" }] },
              },
              {
                type: "tool_use",
                id: "t2",
                name: "show_window",
                input: { window: "sideways" },
              },
            ],
          }
        : {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "That button is gone." }],
          },
    );
    const { stage: hands, hands: asked } = stage({
      act: { ok: true, problems: ["e99: not found"], screen: "- main" },
    });
    await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "Click it." }],
      state: null,
      sources,
      stage: hands,
      say: () => {},
    });
    expect(asked).toHaveLength(1);
    const results = (requests[1]!.body.messages as { content: unknown[] }[])[2]!
      .content;
    expect(results).toEqual([
      {
        type: "tool_result",
        tool_use_id: "t1",
        content: "Failed: e99: not found\n- main",
      },
      {
        type: "tool_result",
        tool_use_id: "t2",
        content: "Invalid call to show_window.",
        is_error: true,
      },
    ]);
    expect(
      (requests[0]!.body.messages as { content: string }[])[0]!.content,
    ).toContain("[The stage does not answer right now.]");
  });

  it("answers with what it has after ten tool calls", async () => {
    const { client, requests } = claude((body) =>
      body.tool_choice && (body.tool_choice as { type: string }).type === "none"
        ? {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Here is what I found." }],
          }
        : {
            stop_reason: "tool_use",
            content: [
              { type: "tool_use", id: "t", name: "look_at_screen", input: {} },
            ],
          },
    );
    const { stage: hands } = stage({});
    await talkTurn({
      client,
      context,
      messages: [{ role: "user", content: "Look everywhere." }],
      state: held,
      sources,
      stage: hands,
      say: () => {},
    });
    expect(requests).toHaveLength(11);
    const last = requests[10]!.body.messages as { content: unknown[] }[];
    expect(last.at(-1)!.content.at(-1)).toEqual({
      type: "text",
      text: "Answer now with what you have.",
    });
  });
});

describe("what ElevenLabs sends the brain", () => {
  it("keeps the words said, from the member's first", () => {
    const request = talkRequestSchema.parse({
      model: "claude-opus-5-5",
      messages: [
        { role: "system", content: "ElevenLabs' prompt" },
        { role: "assistant", content: "Hello" },
        { role: "user", content: "Show me" },
        { role: "user", content: [{ type: "text", text: " the bug" }] },
        { role: "assistant", content: null, tool_calls: [{}] },
        { role: "tool", content: "{}" },
        { role: "assistant", content: "Here it is." },
        { role: "user", content: "Thanks" },
      ],
      elevenlabs_extra_body: { yarrow: "grant" },
    });
    expect(talkMessages(request.messages)).toEqual([
      { role: "user", content: "Show me\nthe bug" },
      { role: "assistant", content: "Here it is." },
      { role: "user", content: "Thanks" },
    ]);
    expect(talkGrantOf(request)).toBe("grant");
    expect(
      talkGrantOf(
        talkRequestSchema.parse({
          messages: [],
          custom_llm_extra_body: { yarrow: "other" },
        }),
      ),
    ).toBe("other");
    expect(talkGrantOf(talkRequestSchema.parse({ messages: [] }))).toBeNull();
  });

  it("is answered once the member spoke, not after a tool of ElevenLabs'", () => {
    const asked = (messages: unknown[]) =>
      memberSpoke(talkRequestSchema.parse({ messages }));
    const skipped = [
      { role: "user", content: "Carry on." },
      {
        role: "assistant",
        content: null,
        tool_calls: [{ function: { name: "skip_turn" } }],
      },
    ];
    expect(asked(skipped.slice(0, 1))).toBe(true);
    expect(asked(skipped)).toBe(false);
    expect(
      asked([
        ...skipped,
        { role: "tool", content: "Tool called successfully." },
      ]),
    ).toBe(false);
    expect(asked([{ role: "user", content: " " }])).toBe(false);
    expect(asked([])).toBe(false);
  });

  it("keeps the member's words of the turn, for the thread", () => {
    const messages = talkMessages(
      talkRequestSchema.parse({
        messages: [
          { role: "user", content: "Carry on." },
          { role: "assistant", content: "The filter is next." },
          { role: "user", content: "Wait," },
          { role: "user", content: "click Done." },
        ],
      }).messages,
    );
    expect(memberWords(messages)).toBe("Wait,\nclick Done.");
    expect(memberWords(messages.slice(0, 2))).toBe("");
  });

  it("leaves out a noise heard as a turn", () => {
    const heard = (content: string) =>
      talkMessages(
        talkRequestSchema.parse({ messages: [{ role: "user", content }] })
          .messages,
      );
    expect(memberWords(heard("Attends, c'est juste ?"))).toBe(
      "Attends, c'est juste ?",
    );
    // No word in it: not the member's turn, nothing to answer.
    expect(heard("...")).toEqual([]);
  });

  it("knows what was written and said before the call", () => {
    expect(conversationSoFar([])).toBe(
      "Nothing was written or said before this call.",
    );
    const said = conversationSoFar([
      { author: "builder", body: "Where is the filter?" },
      { author: "agent", body: "Above the list." },
      { author: "builder", body: "x".repeat(2000) },
    ]);
    expect(said).toContain(
      "Member: Where is the filter?\nYou: Above the list.",
    );
    expect(said).toContain(`Member: ${"x".repeat(1500)} […]`);
    const long = conversationSoFar(
      Array.from({ length: 40 }, (_, i) => ({
        author: "builder" as const,
        body: `Question ${i}`,
      })),
    );
    expect(long).not.toContain("Question 9\n");
    expect(long).toContain("Question 10\n");
    expect(long).toContain("Question 39");
  });

  it("says where the presentation stands", () => {
    expect(stageNote({ chapter: null, held: true, chapters: 3 })).toContain(
      "stopped between two chapters",
    );
    expect(stageNote({ chapter: null, held: false, chapters: 3 })).toContain(
      "not playing",
    );
    expect(stageNote({ ...held, held: false })).toContain(
      'playing in chapter 2 of 3, "The filter"',
    );
    expect(stageNote({ ...held, over: true, cut: 1 })).toBe(
      "[On the stage: the presentation stopped in chapter 2 of 3 when they spoke.]",
    );
  });

  it("gets the words as chat completion chunks, then the end", () => {
    const words = JSON.parse(completion.words("1", "Hi").slice(6));
    expect(words).toMatchObject({
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
    });
    // The film on: the page's tool, from a chapter or where it was.
    const resume = (chapter: number | null) =>
      JSON.parse(completion.resume("1", chapter).split("\n\n")[0]!.slice(6))
        .choices[0].delta.tool_calls[0].function;
    expect(resume(1)).toEqual({
      name: "resume_presentation",
      arguments: '{"chapter":1}',
    });
    expect(resume(null).arguments).toBe("{}");
    // A turn that was not the member's: ElevenLabs' own skip_turn.
    expect(
      JSON.parse(completion.skip("1").split("\n\n")[0]!.slice(6)).choices[0]
        .delta.tool_calls[0].function.name,
    ).toBe("skip_turn");
    expect(completion.end("1")).toMatch(
      /"finish_reason":"stop".*\n\ndata: \[DONE\]\n\n$/s,
    );
  });

  it("hears a few words while the stage works, in the member's language", () => {
    expect(talkFiller("fr", 0)).toBe("Une seconde. ");
    expect(talkFiller("fr", 1)).toBe("J'y suis presque. ");
    expect(talkFiller("fr", 3)).toBe("Une seconde. ");
    expect(talkFiller("en-GB", 0)).toBe("One moment. ");
    expect(talkFiller("ja", 2)).toBe("Just a second. ");
  });

  it("fills in the language just spoken, not the browser's", () => {
    expect(spokenLanguage("Can you try to add a new task?", "fr")).toBe("en");
    expect(spokenLanguage("Show me the video, please.", "fr")).toBe("en");
    expect(spokenLanguage("Montre-moi la tâche ajoutée.", "en")).toBe("fr");
    expect(spokenLanguage("c'est bon", "en")).toBe("fr");
    expect(spokenLanguage("OK", "fr")).toBe("fr");
  });

  it("ends the words said before a tool so the voice says them at once", () => {
    expect(untilTool("Regarde.")).toBe(" ");
    expect(untilTool("Tu vois ? ")).toBe(" ");
    expect(untilTool("Je vérifie dans le code")).toBe(". ");
  });
});

describe("the call's pass", () => {
  const grant = { workUnitId: "w", userId: "u", language: "fr", stage: false };

  it("is good for two hours, for this pull request and member", async () => {
    const now = 1_800_000_000_000;
    const pass = await signTalkGrant("secret", grant, now);
    expect(await readTalkGrant("secret", pass, now + 60_000)).toEqual({
      ...grant,
      expires: now + TALK_GRANT_MS,
    });
    expect(
      await readTalkGrant("secret", pass, now + TALK_GRANT_MS + 1),
    ).toBeNull();
  });

  it("is over the stage when made before it said", async () => {
    const { stage: _, ...before } = grant;
    const body = Buffer.from(
      JSON.stringify({ ...before, expires: Date.now() + 1e6 }),
    ).toString("base64url");
    const signature = createHmac("sha256", "secret")
      .update(`grant ${body}`)
      .digest("base64url");
    expect((await readTalkGrant("secret", `${body}.${signature}`))?.stage).toBe(
      true,
    );
  });

  it("is refused when changed or signed by another secret", async () => {
    const pass = await signTalkGrant("secret", grant);
    const [body, signature] = pass.split(".");
    const forged = Buffer.from(
      JSON.stringify({
        ...grant,
        workUnitId: "other",
        expires: Date.now() + 1e6,
      }),
    ).toString("base64url");
    expect(await readTalkGrant("secret", `${forged}.${signature}`)).toBeNull();
    expect(await readTalkGrant("other", pass)).toBeNull();
    expect(await readTalkGrant("secret", body!)).toBeNull();
    expect(await readTalkGrant("secret", "")).toBeNull();
  });

  it("goes with the brain's key, which only VOICE_SECRET makes", async () => {
    const key = await talkKey("secret");
    expect(key).toBe(await talkKey("secret"));
    expect(key).not.toBe(await talkKey("other"));
    expect(sameKey(`Bearer ${key}`, key)).toBe(true);
    expect(sameKey(key, key)).toBe(true);
    expect(sameKey(`Bearer ${key}x`, key)).toBe(false);
    expect(sameKey(null, key)).toBe(false);
  });
});

describe("the ElevenLabs agent", () => {
  it("is private, asks the brain, and waits for the member", () => {
    const config = talkAgentConfig({
      name: "Yarrow live review (dev)",
      llmUrl: "https://dev.yarrow.run/voice/llm",
      secretId: "s1",
      toolId: "t1",
    });
    expect(config.platform_settings.auth.enable_auth).toBe(true);
    expect(config.platform_settings.overrides.custom_llm_extra_body).toBe(true);
    expect(config.conversation_config.agent.first_message).toBe("");
    expect(config.conversation_config.agent.prompt).toMatchObject({
      llm: "custom-llm",
      custom_llm: {
        url: "https://dev.yarrow.run/voice/llm",
        api_key: { secret_id: "s1" },
      },
      tool_ids: ["t1"],
      backup_llm_config: { preference: "disabled" },
      built_in_tools: {
        skip_turn: { params: { system_tool_type: "skip_turn" } },
      },
    });
    expect(config.conversation_config.turn.silence_end_call_timeout).toBe(-1);
  });

  it("starts a call with a token the brain asks for", async () => {
    const asked: string[] = [];
    const token = await conversationToken(
      "xi",
      "agent 1",
      async (url, init) => {
        asked.push(
          `${String(url)} ${new Headers(init?.headers).get("xi-api-key")}`,
        );
        return Response.json({ token: "tok", conversation_id: "c" });
      },
    );
    expect(token).toBe("tok");
    expect(asked).toEqual([
      "https://api.elevenlabs.io/v1/convai/conversation/token?agent_id=agent%201 xi",
    ]);
    await expect(
      conversationToken(
        "xi",
        "a",
        async () => new Response("no", { status: 401 }),
      ),
    ).rejects.toThrow("ElevenLabs call token failed (401)");
  });

  it("asks a single-use token for the member's words as they say them", async () => {
    const asked: string[] = [];
    const token = await transcriptionToken("xi", async (url, init) => {
      asked.push(
        `${init?.method} ${String(url)} ${new Headers(init?.headers).get("xi-api-key")}`,
      );
      return Response.json({ token: "sutkn_1" });
    });
    expect(token).toBe("sutkn_1");
    expect(asked).toEqual([
      "POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe xi",
    ]);
    await expect(
      transcriptionToken("xi", async () => new Response("no", { status: 429 })),
    ).rejects.toThrow("ElevenLabs transcription token failed (429)");
  });
});
