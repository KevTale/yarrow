import { generateKeyPairSync } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  CHAT_DAILY_QUESTIONS,
  CHAT_MAX_STEPS,
  chatCostCents,
  chatDayStart,
  chatParts,
  answerToRead,
  captionLines,
  clockLabel,
  lineAt,
  spokenAnswer,
} from "../../src/core/chat";
import { ensureAccount } from "../../src/db/accounts";
import {
  answerBody,
  askedToday,
  askQuestion,
  chatContext,
  failAnswer,
  openProposal,
  pullContext,
  saveAnswer,
  saveSpokenTurn,
  threadMessages,
  type ChatContext,
} from "../../src/db/chat";
import { projectsForUser } from "../../src/db/github-tasks";
import { pullPanel } from "../../src/db/pull-panel";
import * as schema from "../../src/db/schema";
import { upsertTicket } from "../../src/db/workunits";
import {
  answerQuestion,
  chatContextText,
  type ChatSources,
} from "../../src/runner/chat";
import { requestCorrection } from "../../src/server/github/pull-actions";
import type { RepoReader } from "../../src/server/github/repo-reads";
import { handleGitHubEvent } from "../../src/server/github/webhook";
import type { StageHand } from "../../src/core/stage";
import { createTestDatabase } from "./helpers/pglite";

const t = await createTestDatabase();
const { db, raw } = t;
const marie = { userId: crypto.randomUUID(), githubLogin: "Marie", name: null };
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const credentials = { appId: "1", privateKey };
let workUnitId = "";

beforeEach(async () => {
  await t.reset();
  await ensureAccount(db, marie);
  await handleGitHubEvent(db, "installation", {
    action: "created",
    sender: { login: "marie" },
    installation: { id: 42 },
    repositories: [{ id: 999, full_name: "marie/halyard", private: false }],
  });
  const projectId = (await projectsForUser(db, marie.userId))[0]!.id;
  ({ workUnitId } = await upsertTicket(db, {
    projectId,
    source: "github",
    externalId: "3",
    title: "Filter tasks by status",
    body: "A status filter above the list.",
    url: "https://github.com/marie/halyard/issues/3",
    labeled: true,
    closed: false,
  }));
  await raw.insert(schema.pullRequests).values({
    workUnitId,
    url: "https://github.com/marie/halyard/pull/4",
    number: 4,
    branch: "yarrow/3",
  });
});
afterAll(() => t.pg.close());

describe("the conversation's rules", () => {
  it("says an answer's words, not what only reads", () => {
    expect(
      spokenAnswer(
        "**Yes.** See [the README](https://x.dev/a) and `dueDate`.\n\n```ts\nconst a = 1;\n```\n> Done",
      ),
    ).toBe("Yes. See the README and dueDate. Done");
    expect(spokenAnswer("a".repeat(3000))).toHaveLength(1500);
    expect(spokenAnswer("Here [at 0:23], as you saw.")).toBe(
      "Here , as you saw.",
    );
  });

  it("cuts an answer for the screen, at its sentences", () => {
    const long = `${"word ".repeat(40)}end.`;
    const lines = captionLines(`${long} Short one.`);
    expect(lines.every((line) => line.length <= 112)).toBe(true);
    expect(lines.join(" ")).toBe(`${long} Short one.`);
    expect(captionLines("Yes.")).toEqual(["Yes."]);
    expect(lineAt(["one", "two"], 0)).toBe("one");
    expect(lineAt(["one", "two"], 0.6)).toBe("two");
    expect(lineAt(["one", "two"], 1)).toBe("two");
    expect(lineAt([], 0.5)).toBeNull();
  });

  it("knows an answer that only the eye can follow", () => {
    expect(answerToRead("Above the list.", null)).toBe(false);
    expect(answerToRead("Three files:\n- a\n- b", null)).toBe(true);
    expect(answerToRead("```ts\nconst a = 1;\n```", null)).toBe(true);
    expect(answerToRead("I can do that.", "Add a filter")).toBe(true);
    expect(answerToRead("a".repeat(1501), null)).toBe(true);
  });

  it("turns [at m:ss] into moments of the film", () => {
    expect(chatParts("Checked [at 0:56], then [at 12:05].")).toEqual([
      { kind: "text", text: "Checked " },
      { kind: "moment", ms: 56_000, label: "0:56" },
      { kind: "text", text: ", then " },
      { kind: "moment", ms: 725_000, label: "12:05" },
      { kind: "text", text: "." },
    ]);
    expect(chatParts("at 0:56, no brackets")).toEqual([
      { kind: "text", text: "at 0:56, no brackets" },
    ]);
    expect(clockLabel(65_400)).toBe("1:05");
  });

  it("counts what an answer cost, cache included, and days in UTC", () => {
    expect(
      chatCostCents({
        model: "claude-opus-5-5",
        input: 1_000_000,
        output: 100_000,
        cacheRead: 1_000_000,
        cacheWrite: 0,
      }),
    ).toBe(400 + 200 + 20);
    expect(chatDayStart(new Date("2026-10-24T23:30:00-02:00"))).toEqual(
      new Date("2026-10-25T00:00:00Z"),
    );
  });
});

describe("questions and answers", () => {
  it("answers one question at a time on a pull request", async () => {
    const asked = await askQuestion(db, {
      workUnitId,
      userId: marie.userId,
      text: "What if the status is unknown?",
    });
    expect(asked.ok).toBe(true);
    expect(
      await askQuestion(db, {
        workUnitId,
        userId: marie.userId,
        text: "And another?",
      }),
    ).toEqual({ ok: false, reason: "busy" });
    const thread = await threadMessages(db, workUnitId);
    expect(thread.map((m) => [m.author, m.status])).toEqual([
      ["builder", "done"],
      ["agent", "pending"],
    ]);
  });

  it("reads aloud only a whole answer of this ticket", async () => {
    const asked = await askQuestion(db, {
      workUnitId,
      userId: marie.userId,
      text: "Where is it?",
    });
    if (!asked.ok) throw new Error("not asked");
    const input = { workUnitId, messageId: asked.answerId };
    expect(await answerBody(db, input)).toBeNull();
    await saveAnswer(db, asked.answerId, {
      body: "Above the list.",
      change: null,
      usage: null,
    });
    expect(await answerBody(db, input)).toBe("Above the list.");
    expect(
      await answerBody(db, {
        workUnitId: "00000000-0000-4000-8000-000000000000",
        messageId: asked.answerId,
      }),
    ).toBeNull();
  });

  it("gives up an answer lost for five minutes", async () => {
    const then = new Date("2026-10-24T10:00:00Z");
    await askQuestion(
      db,
      { workUnitId, userId: marie.userId, text: "One" },
      then,
    );
    const later = new Date(then.getTime() + 6 * 60_000);
    const asked = await askQuestion(
      db,
      { workUnitId, userId: marie.userId, text: "Two" },
      later,
    );
    expect(asked.ok).toBe(true);
    const thread = await threadMessages(db, workUnitId);
    expect(thread.map((m) => m.status)).toEqual([
      "done",
      "failed",
      "done",
      "pending",
    ]);
  });

  it("caps one person's questions in a day", async () => {
    const now = new Date("2026-10-24T15:00:00Z");
    await raw.insert(schema.chatMessages).values(
      Array.from({ length: CHAT_DAILY_QUESTIONS }, (_, i) => ({
        workUnitId,
        author: "builder" as const,
        userId: marie.userId,
        body: `Question ${i}`,
        createdAt: new Date(now.getTime() - 60_000 - i),
      })),
    );
    expect(
      await askQuestion(
        db,
        { workUnitId, userId: marie.userId, text: "More" },
        now,
      ),
    ).toEqual({ ok: false, reason: "limit" });
    const tomorrow = new Date("2026-10-25T00:01:00Z");
    expect(
      (
        await askQuestion(
          db,
          { workUnitId, userId: marie.userId, text: "More" },
          tomorrow,
        )
      ).ok,
    ).toBe(true);
  });

  it("tells the agent the conversation so far, without failed answers", async () => {
    const start = new Date("2026-10-24T10:00:00Z");
    const first = await askQuestion(
      db,
      { workUnitId, userId: marie.userId, text: "Lost one" },
      start,
    );
    if (!first.ok) throw new Error("not asked");
    await failAnswer(db, first.answerId);
    const second = await askQuestion(
      db,
      { workUnitId, userId: marie.userId, text: "Where is the filter?" },
      new Date(start.getTime() + 1000),
    );
    if (!second.ok) throw new Error("not asked");
    await saveAnswer(db, second.answerId, {
      body: "Above the list.",
      change: null,
      usage: null,
    });
    const third = await askQuestion(
      db,
      { workUnitId, userId: marie.userId, text: "Move it right?" },
      new Date(start.getTime() + 2000),
    );
    if (!third.ok) throw new Error("not asked");
    const context = await chatContext(db, third.answerId);
    expect(context!.history).toEqual([
      { author: "builder", body: "Where is the filter?" },
      { author: "agent", body: "Above the list." },
      { author: "builder", body: "Move it right?" },
    ]);
    expect(context!.pullRequest).toMatchObject({
      number: 4,
      branch: "yarrow/3",
      state: "open",
    });
    expect(context!.project.repository).toBe("marie/halyard");
    // The live call knows the same pull request, and what was answered.
    const pull = await pullContext(db, workUnitId);
    expect(pull).toMatchObject({
      project: context!.project,
      pullRequest: context!.pullRequest,
    });
    expect(pull!.history).toEqual([
      { author: "builder", body: "Where is the filter?" },
      { author: "agent", body: "Above the list." },
    ]);
    expect(await pullContext(db, crypto.randomUUID())).toBeNull();
    // A lost answer saved late stays lost.
    await saveAnswer(db, first.answerId, {
      body: "Too late",
      change: null,
      usage: null,
    });
    const [lost] = await raw
      .select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.id, first.answerId));
    expect(lost!.status).toBe("failed");
  });

  it("keeps the live call's turns in the thread, counted as questions", async () => {
    const at = new Date("2026-10-24T10:00:00Z");
    const turn = { workUnitId, userId: marie.userId, usage: null };
    await saveSpokenTurn(
      db,
      {
        ...turn,
        said: "Click Done.",
        words: "Only the done tasks are left.",
        change: null,
      },
      at,
    );
    await saveSpokenTurn(
      db,
      {
        ...turn,
        said: "Put it on the title's line.",
        words: "It's in the conversation.",
        change: "The filter sits on the title's line.",
      },
      new Date(at.getTime() + 30_000),
    );
    const thread = await threadMessages(db, workUnitId);
    expect(thread.map((m) => [m.author, m.body, m.status, m.change])).toEqual([
      ["builder", "Click Done.", "done", null],
      ["agent", "Only the done tasks are left.", "done", null],
      ["builder", "Put it on the title's line.", "done", null],
      [
        "agent",
        "It's in the conversation.",
        "done",
        "The filter sits on the title's line.",
      ],
    ]);
    expect(await askedToday(db, marie.userId, at)).toBe(2);
    expect(
      await askedToday(db, marie.userId, new Date("2026-10-25T08:00:00Z")),
    ).toBe(0);
    // A question written next knows what was said.
    const asked = await askQuestion(
      db,
      { workUnitId, userId: marie.userId, text: "And on mobile?" },
      new Date(at.getTime() + 60_000),
    );
    if (!asked.ok) throw new Error("not asked");
    expect((await chatContext(db, asked.answerId))!.history).toHaveLength(5);
    // Its card is made like a written one.
    expect(
      await openProposal(db, { messageId: thread[3]!.id, workUnitId }),
    ).toBe("The filter sits on the title's line.");
  });

  it("makes a proposed change once, shown under the answer that proposed it", async () => {
    const asked = await askQuestion(db, {
      workUnitId,
      userId: marie.userId,
      text: "Put the filters on the title's line",
    });
    if (!asked.ok) throw new Error("not asked");
    await saveAnswer(db, asked.answerId, {
      body: "Proposed.",
      change: "Move the filters onto the title's line.",
      usage: null,
    });
    const posted: string[] = [];
    const fetcher = (async (url: string, init: RequestInit) => {
      if (url.endsWith("/access_tokens"))
        return Response.json({ token: "t", expires_at: "x" }, { status: 201 });
      posted.push(JSON.parse(String(init.body)).body);
      return Response.json({ id: 77 }, { status: 201 });
    }) as typeof fetch;
    const input = {
      workUnitId,
      login: "Marie",
      chatMessageId: asked.answerId,
    };
    expect(await requestCorrection(db, credentials, input, fetcher)).toEqual({
      ok: true,
    });
    expect(await requestCorrection(db, credentials, input, fetcher)).toEqual({
      ok: false,
      error: "This change was already made.",
    });
    expect(posted).toHaveLength(1);
    expect(posted[0]).toContain("Move the filters onto the title's line.");
    const [answer] = (await threadMessages(db, workUnitId)).filter(
      (m) => m.author === "agent",
    );
    const panel = await pullPanel(db, (await projectId()) ?? "", "3");
    expect(panel!.corrections).toHaveLength(1);
    expect(panel!.corrections[0]!.instruction).toBe(
      "Move the filters onto the title's line.",
    );
    expect(answer!.correctionRequestId).toBe(panel!.corrections[0]!.id);
  });
});

async function projectId() {
  return (await projectsForUser(db, marie.userId))[0]?.id;
}

/** The Messages API as its docs describe it, answering from a script. */
function claude(script: (body: Record<string, unknown>) => unknown) {
  const requests: { body: Record<string, unknown>; beta: string | null }[] = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const headers = new Headers(init.headers);
    requests.push({ body, beta: headers.get("anthropic-beta") });
    return Response.json({
      id: `msg_${requests.length}`,
      type: "message",
      role: "assistant",
      model: "claude-opus-5-5",
      stop_sequence: null,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: null,
      },
      ...(script(body) as object),
    });
  }) as typeof fetch;
  return {
    requests,
    client: new Anthropic({ apiKey: "test", fetch: fetcher, maxRetries: 0 }),
  };
}

const context: ChatContext = {
  answerId: "a",
  project: {
    id: "p",
    name: "Halyard",
    repository: "marie/halyard",
    defaultBranch: "main",
    githubInstallationId: "42",
    githubRepositoryId: "999",
  },
  ticket: {
    source: "github",
    key: "3",
    title: "Filter tasks by status",
    body: "A status filter above the list.",
    url: "https://github.com/marie/halyard/issues/3",
  },
  pullRequest: {
    number: 4,
    url: "https://github.com/marie/halyard/pull/4",
    branch: "yarrow/3",
    state: "open",
  },
  panel: null,
  history: [{ author: "builder", body: "Put the filters on the right?" }],
};

function sources(): ChatSources & { reads: string[] } {
  const reads: string[] = [];
  const reader: RepoReader = {
    async readFile(path, ref) {
      reads.push(`${path}@${ref}`);
      return { kind: "file", text: "const a = 1;\nconst b = 2;" };
    },
    async listFiles() {
      return { paths: ["src/app.js"], truncated: false };
    },
    async searchCode() {
      return [];
    },
    async openIssues() {
      return [];
    },
    async readIssue() {
      return null;
    },
    async pullDiff() {
      return [
        {
          path: "src/app.js",
          status: "modified",
          additions: 2,
          deletions: 0,
          patch: "@@ -1 +1,2 @@\n+const b = 2;",
        },
      ];
    },
  };
  return {
    reads,
    reader,
    tickets: async () => [],
    ticket: async () => null,
  };
}

describe("what the agent knows the page shows", () => {
  const shown = (panel: Partial<NonNullable<ChatContext["panel"]>>) =>
    chatContextText(
      {
        ...context,
        panel: {
          corrections: [],
          screens: [],
          proofs: [],
          preview: null,
          ...panel,
        } as never,
      },
      { presentation: null, diff: null },
    );

  it("names the one thing there, and that there is no video", () => {
    expect(
      shown({
        proofs: [
          {
            kind: "measure",
            label: "Loading the list",
            unit: "ms",
            before: 1240,
            after: 23,
            better: "lower",
          },
        ],
      }),
    ).toContain(
      "and a number, Loading the list: 1240 ms before, 23 ms now. There is no demo on this ticket.",
    );
    expect(
      shown({
        proofs: [
          {
            kind: "images",
            label: "Settings",
            before: "a.png",
            after: "b.png",
            device: "desktop",
          },
        ],
      }),
    ).toContain("an image to slide across, the screen before and after");
    expect(
      shown({ proofs: [{ kind: "document", file: "README.md" }] }),
    ).toContain("a button to the document README.md");
    expect(shown({})).toContain("and nothing else. There is no demo");
  });

  it("names the video when there is one, and the app's button", () => {
    const text = shown({
      screens: [{ kind: "presentation", key: "runs/r/film.json" }] as never,
      preview: { path: null, signIn: null } as never,
    });
    expect(text).toContain("a button that opens the app, and the demo below.");
    expect(text).not.toContain("no demo");
  });
});

describe("the agent that answers", () => {
  it("reads the code at the branch, proposes the change, then answers", async () => {
    const { client, requests } = claude((body) => {
      const turns = (body.messages as unknown[]).length;
      if (turns === 1)
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "read_file",
              input: { path: "src/app.js" },
            },
          ],
        };
      if (turns === 3)
        return {
          stop_reason: "tool_use",
          content: [
            {
              type: "tool_use",
              id: "t2",
              name: "propose_change",
              input: {
                change: "The filters sit on the title's line, to the right.",
              },
            },
          ],
        };
      return {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "I proposed it [at 0:12]." }],
      };
    });
    const from = sources();
    const answer = await answerQuestion({
      client,
      context,
      sources: from,
      presentation: null,
    });
    expect(answer.body).toBe("I proposed it [at 0:12].");
    expect(answer.change).toBe(
      "The filters sit on the title's line, to the right.",
    );
    expect(answer.usage).toMatchObject({
      input: 300,
      output: 60,
      cacheRead: 3000,
    });
    expect(from.reads).toEqual(["src/app.js@yarrow/3"]);
    expect(requests).toHaveLength(3);
    const first = requests[0]!;
    expect(first.beta).toContain("server-side-fallback-2026-07-01");
    expect(first.body).toMatchObject({
      model: "claude-opus-5-5",
      fallbacks: "default",
      output_config: { effort: "low" },
      tool_choice: { type: "auto" },
    });
    expect(JSON.stringify(first.body.system)).toContain("+const b = 2;");
    expect(JSON.stringify(first.body.system)).not.toContain("[at 0:56]");
    const second = requests[1]!.body.messages as {
      role: string;
      content: unknown;
    }[];
    expect(second.at(-1)).toEqual({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: "1\tconst a = 1;\n2\tconst b = 2;",
        },
      ],
    });
  });

  it("answers with what it has after its last tool call", async () => {
    const { client, requests } = claude((body) =>
      (body.tool_choice as { type: string }).type === "none"
        ? {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Here is what I found." }],
          }
        : {
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: `t${(body.messages as unknown[]).length}`,
                name: "list_files",
                input: {},
              },
            ],
          },
    );
    const answer = await answerQuestion({
      client,
      context,
      sources: sources(),
      presentation: null,
    });
    expect(answer.body).toBe("Here is what I found.");
    expect(requests).toHaveLength(CHAT_MAX_STEPS + 1);
    const last = requests.at(-1)!.body.messages as {
      content: { type: string; text?: string }[];
    }[];
    expect(last.at(-1)!.content.at(-1)).toEqual({
      type: "text",
      text: "Answer now with what you have read.",
    });
  });

  it("acts on the stage when asked beside it, one move at a time", async () => {
    const { client, requests } = claude((body) =>
      (body.messages as unknown[]).length === 1
        ? {
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "act_on_screen",
                input: { actions: [{ do: "click", target: "e12" }] },
              },
              { type: "tool_use", id: "t2", name: "look_at_screen", input: {} },
              {
                type: "tool_use",
                id: "t3",
                name: "read_file",
                input: { path: "src/app.js" },
              },
            ],
          }
        : {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "Done is on." }],
          },
    );
    const hands: StageHand[] = [];
    const answer = await answerQuestion({
      client,
      context,
      sources: sources(),
      presentation: null,
      stage: {
        state: {
          chapter: { index: 1, title: "The filter" },
          held: true,
          chapters: 3,
        },
        hands: async (hand) => {
          hands.push(hand);
          // The click takes longer: the look still waits for it.
          if (hand.action === "act")
            await new Promise((done) => setTimeout(done, 20));
          return { ok: true, problems: [], screen: `after ${hand.action}` };
        },
        show: async () => {
          hands.push({ action: "showing" });
        },
      },
    });
    expect(answer.body).toBe("Done is on.");
    // The member's screen goes to the app before its first move, once.
    expect(hands).toEqual([
      { action: "showing" },
      { action: "act", actions: [{ do: "click", target: "e12" }] },
      { action: "look" },
    ]);
    const first = requests[0]!.body;
    expect(JSON.stringify(first.system)).toContain("beside the demo");
    expect(
      (first.tools as { name: string }[]).map((tool) => tool.name),
    ).toEqual(
      expect.arrayContaining(["act_on_screen", "propose_change", "read_file"]),
    );
    expect((first.messages as { content: string }[]).at(-1)!.content).toContain(
      'stopped in chapter 2 of 3, "The filter"',
    );
    const results = (
      requests[1]!.body.messages as {
        content: { tool_use_id: string; content: string }[];
      }[]
    ).at(-1)!.content;
    expect(results.map((result) => result.tool_use_id)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
    expect(results[1]!.content).toBe("after look");

    // Away from the stage, no stage tools.
    const away = claude(() => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Above the list." }],
    }));
    await answerQuestion({
      client: away.client,
      context,
      sources: sources(),
      presentation: null,
    });
    const tools = (away.requests[0]!.body.tools as { name: string }[]).map(
      (tool) => tool.name,
    );
    expect(tools).not.toContain("act_on_screen");
    expect(JSON.stringify(away.requests[0]!.body.system)).not.toContain(
      "beside the demo",
    );
  });

  it("does not propose a change to a merged pull request", async () => {
    const { client, requests } = claude((body) =>
      (body.messages as unknown[]).length === 1
        ? {
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: "t1",
                name: "propose_change",
                input: { change: "Change it." },
              },
            ],
          }
        : {
            stop_reason: "end_turn",
            content: [{ type: "text", text: "It is merged." }],
          },
    );
    const answer = await answerQuestion({
      client,
      context: {
        ...context,
        pullRequest: { ...context.pullRequest!, state: "merged" },
      },
      sources: sources(),
      presentation: null,
    });
    expect(answer.change).toBeNull();
    const result = (
      requests[1]!.body.messages as { content: { is_error?: boolean }[] }[]
    ).at(-1)!.content[0];
    expect(result).toMatchObject({ is_error: true });
  });
});
