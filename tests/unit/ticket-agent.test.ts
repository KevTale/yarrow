import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { VOICE_PUSH } from "../../src/core/stage";
import { ensureAccount } from "../../src/db/accounts";
import { projectsForUser } from "../../src/db/github-tasks";
import {
  draftTurnsToday,
  openDraft,
  readDraft,
  saveDraftTurn,
} from "../../src/db/ticket-drafts";
import { listTickets, type ChatSources } from "../../src/runner/chat";
import { ticketTurn } from "../../src/runner/ticket-agent";
import {
  readDraftGrant,
  readTalkGrant,
  signTalkGrant,
} from "../../src/runner/voice/agent";
import { handleGitHubEvent } from "../../src/server/github/webhook";
import { claude, type Block } from "./helpers/claude-stream";
import { createTestDatabase } from "./helpers/pglite";

const t = await createTestDatabase();
const { db } = t;
const marie = { userId: crypto.randomUUID(), githubLogin: "Marie", name: null };
const usage = {
  model: "claude-sonnet-5-5",
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
};
let projectId = "";

beforeEach(async () => {
  await t.reset();
  await ensureAccount(db, marie);
  await handleGitHubEvent(db, "installation", {
    action: "created",
    sender: { login: "marie" },
    installation: { id: 42 },
    repositories: [{ id: 999, full_name: "marie/halyard", private: false }],
  });
  projectId = (await projectsForUser(db, marie.userId))[0]!.id;
});
afterAll(() => t.pg.close());

const project = {
  id: "p",
  name: "Halyard",
  repository: "marie/halyard",
  defaultBranch: "main",
  githubInstallationId: "42",
  githubRepositoryId: "999",
};

const sources: ChatSources = {
  reader: {
    readFile: async () => ({ kind: "file", text: "const a = 1;" }),
    listFiles: async () => ({ paths: [], truncated: false }),
    searchCode: async () => ["src/tasks.ts"],
    openIssues: async () => [
      {
        number: 12,
        title: "Dark mode",
        url: "https://github.com/marie/halyard/issues/12",
      },
    ],
    readIssue: async () => null,
    pullDiff: async () => [],
  },
  tickets: async () => [
    {
      source: "github",
      key: "3",
      title: "Filter tasks by status",
      status: "to review",
      pullRequest: { number: 4, state: "open" },
    },
  ],
  ticket: async () => null,
};

const text = (words: string): Block => ({ type: "text", text: words });
const tool = (id: string, name: string, input: unknown): Block => ({
  type: "tool_use",
  id,
  name,
  input,
});
const usesTools = (content: Block[]) => ({ stop_reason: "tool_use", content });
const ends = (words: string) => ({
  stop_reason: "end_turn",
  content: [text(words)],
});

const turn = (
  client: ReturnType<typeof claude>["client"],
  more: Partial<Parameters<typeof ticketTurn>[0]> = {},
) => {
  const written: { title: string; body: string }[] = [];
  const said: string[] = [];
  return {
    written,
    said,
    run: ticketTurn({
      client,
      project,
      tickets: "github 3 · Filter tasks by status · to review",
      form: { title: "", body: "" },
      history: [],
      said: "Sort the tasks by due date",
      voice: false,
      sources,
      say: (words) => said.push(words),
      onWrite: async (ticket) => {
        written.push(ticket);
      },
      ...more,
    }),
  };
};

describe("the agent that writes a ticket", () => {
  it("reads the code, fills in the form, then says what it did", async () => {
    const replies = [
      usesTools([
        text("Looking."),
        tool("a", "search_code", { query: "dueDate" }),
      ]),
      usesTools([
        tool("b", "write_ticket", {
          title: "Sort tasks by due date",
          body: "Soonest first.\n\n**Done when**\n- The list is sorted",
        }),
      ]),
      ends("It's in the form, ready for you."),
    ];
    const api = claude(() => replies.shift()!);
    const { run, written, said } = turn(api.client);
    const answer = await run;
    expect(written).toEqual([
      {
        title: "Sort tasks by due date",
        body: "Soonest first.\n\n**Done when**\n- The list is sorted",
      },
    ]);
    expect(answer.written?.title).toBe("Sort tasks by due date");
    expect(answer.words).toBe("Looking. It's in the form, ready for you.");
    expect(said).not.toContain(VOICE_PUSH);
    const results = JSON.stringify(api.requests[2]!.body.messages);
    expect(results).toContain("src/tasks.ts");
    expect(results).toContain("It is in the form.");
  });

  it("knows the project's tickets and the form, with the tools it needs", async () => {
    const api = claude(() => ends("What should come first?"));
    await turn(api.client, {
      form: { title: "Sort tasks", body: "Changed by hand" },
    }).run;
    const { body } = api.requests[0]!;
    expect(JSON.stringify(body.system)).toContain(
      "github 3 · Filter tasks by status · to review",
    );
    expect(JSON.stringify(body.system)).toContain("marie/halyard");
    expect(JSON.stringify(body.messages)).toContain("Changed by hand");
    expect((body.tools as { name: string }[]).map((one) => one.name)).toEqual([
      "read_file",
      "list_files",
      "search_code",
      "read_ticket",
      "write_ticket",
    ]);
  });

  it("lists every ticket of the project, issues included", async () => {
    await expect(listTickets(sources)).resolves.toBe(
      "github 3 · Filter tasks by status · to review · pull request #4 open\ngithub 12 · Dark mode · open on GitHub, not given to Yarrow",
    );
  });

  it("goes on from the thread, whether written or said", async () => {
    const api = claude(() => ends("Noted."));
    await turn(api.client, {
      history: [
        { author: "builder", body: "Sort the tasks" },
        { author: "agent", body: "By what?" },
      ],
      said: "By due date",
    }).run;
    const messages = api.requests[0]!.body.messages as {
      role: string;
      content: unknown;
    }[];
    expect(messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(messages[1]!.content).toBe("By what?");
    expect(String(messages[2]!.content)).toMatch(/^By due date/);
  });

  it("gives a ticket without a title back to the agent", async () => {
    const replies = [
      usesTools([tool("a", "write_ticket", { title: " ", body: "No title" })]),
      ends("Sorry."),
    ];
    const api = claude(() => replies.shift()!);
    const { run, written } = turn(api.client);
    const answer = await run;
    expect(written).toEqual([]);
    expect(answer.written).toBeNull();
    expect(JSON.stringify(api.requests[1]!.body.messages)).toContain(
      '"is_error":true',
    );
  });

  it("is heard before it reads the code, on a call", async () => {
    const replies = [
      usesTools([
        text("I'll look."),
        tool("a", "search_code", { query: "tasks" }),
      ]),
      ends("Found it."),
    ];
    const api = claude(() => replies.shift()!);
    const { run, said } = turn(api.client, { voice: true });
    await run;
    expect(said).toContain(VOICE_PUSH);
    expect(JSON.stringify(api.requests[0]!.body.system)).toContain(
      "spoken aloud",
    );
  });

  it("answers with what it has after eight tool calls", async () => {
    const api = claude((body) =>
      (body.tools as unknown[] | undefined)?.length &&
      body.tool_choice === undefined
        ? usesTools([tool("a", "search_code", { query: "x" })])
        : ends("That's what I have."),
    );
    const { run } = turn(api.client);
    const answer = await run;
    expect(api.requests.length).toBeLessThanOrEqual(10);
    expect(answer.words).toBe("That's what I have.");
  });
});

describe("a ticket's draft", () => {
  const ref = () => ({
    id: crypto.randomUUID(),
    projectId,
    userId: marie.userId,
  });

  it("keeps the form and the thread, whatever way they talked", async () => {
    const draft = ref();
    await openDraft(db, draft, { title: "One", body: "" });
    await saveDraftTurn(db, draft, { said: "Hi", words: "Hello", usage });
    await saveDraftTurn(db, draft, { said: "Go", words: "Done", usage });
    await openDraft(db, draft, { title: "Two", body: "Text" });
    const row = await openDraft(db, draft);
    expect(row).toMatchObject({ title: "Two", body: "Text", turns: 2 });
    expect(row?.thread.map((line) => line.body)).toEqual([
      "Hi",
      "Hello",
      "Go",
      "Done",
    ]);
    await expect(readDraft(db, draft)).resolves.toEqual({
      title: "Two",
      body: "Text",
    });
  });

  it("stays out of anyone else's reach", async () => {
    const draft = ref();
    await openDraft(db, draft, { title: "Mine", body: "" });
    const other = { ...draft, userId: crypto.randomUUID() };
    await expect(
      openDraft(db, other, { title: "Theirs", body: "" }),
    ).resolves.toBeNull();
    await expect(readDraft(db, other)).resolves.toBeNull();
    await expect(readDraft(db, draft)).resolves.toMatchObject({
      title: "Mine",
    });
  });

  it("counts the day's turns, every draft together", async () => {
    const now = new Date("2026-11-01T12:00:00Z");
    const first = ref();
    const second = ref();
    await openDraft(db, first, undefined, now);
    await openDraft(db, second, undefined, now);
    const turnOf = (draft: ReturnType<typeof ref>, at: Date) =>
      saveDraftTurn(db, draft, { said: "a", words: "b", usage }, at);
    await turnOf(first, new Date("2026-10-31T12:00:00Z"));
    await turnOf(second, now);
    await turnOf(second, now);
    await expect(draftTurnsToday(db, marie.userId, now)).resolves.toBe(2);
  });
});

describe("the pass of a call that writes a ticket", () => {
  const draft = {
    draftId: crypto.randomUUID(),
    projectId: crypto.randomUUID(),
    userId: crypto.randomUUID(),
    language: "fr",
  };

  it("opens that draft and no pull request's call", async () => {
    const pass = await signTalkGrant("secret", draft, 1000);
    await expect(readDraftGrant("secret", pass, 2000)).resolves.toMatchObject(
      draft,
    );
    await expect(readTalkGrant("secret", pass, 2000)).resolves.toBeNull();
    await expect(readDraftGrant("other", pass, 2000)).resolves.toBeNull();
  });

  it("is no pass for a draft when it is a pull request's", async () => {
    const pass = await signTalkGrant(
      "secret",
      {
        workUnitId: crypto.randomUUID(),
        userId: draft.userId,
        language: "fr",
        stage: true,
      },
      1000,
    );
    await expect(readDraftGrant("secret", pass, 2000)).resolves.toBeNull();
  });
});
