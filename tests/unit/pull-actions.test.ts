import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureAccount } from "../../src/db/accounts";
import { projectsForUser } from "../../src/db/github-tasks";
import { pullPanel } from "../../src/db/pull-panel";
import { reviewCount } from "../../src/db/queries";
import * as schema from "../../src/db/schema";
import { upsertTicket } from "../../src/db/workunits";
import {
  askedFromYarrow,
  pullRequestAction,
  requestCorrection,
} from "../../src/server/github/pull-actions";
import { handleGitHubEvent } from "../../src/server/github/webhook";
import { createIssue } from "../../src/server/github/new-issue";
import { openedFromYarrow } from "../../src/core/new-ticket";
import { createTestDatabase } from "./helpers/pglite";

const t = await createTestDatabase();
const { db, raw } = t;
const marie = { userId: crypto.randomUUID(), githubLogin: "Marie", name: null };
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const credentials = { appId: "1", privateKey };
const pullUrl = "https://github.com/marie/halyard/pull/4";
let projectId = "";
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
  projectId = (await projectsForUser(db, marie.userId))[0]!.id;
  ({ workUnitId } = await upsertTicket(db, {
    projectId,
    source: "github",
    externalId: "3",
    title: "Export crashes",
    body: "",
    url: "https://github.com/marie/halyard/issues/3",
    labeled: true,
    closed: false,
  }));
  await raw
    .update(schema.workUnits)
    .set({ status: "delivered" })
    .where(eq(schema.workUnits.id, workUnitId));
  await raw.insert(schema.pullRequests).values({
    workUnitId,
    url: pullUrl,
    number: 4,
    branch: "yarrow/3",
  });
});
afterAll(() => t.pg.close());

/** GitHub as the docs describe it, recording every call. */
function github(answers: Record<string, unknown> = {}) {
  const calls: { call: string; body: unknown }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const call = `${init.method} ${url.replace("https://api.github.com", "")}`;
    calls.push({
      call,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    if (url.endsWith("/access_tokens"))
      return Response.json({ token: "t", expires_at: "x" }, { status: 201 });
    const answer = answers[call];
    if (answer instanceof Response) return answer;
    return Response.json(answer ?? {}, { status: 200 });
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("the builder's decisions on a pull request", () => {
  it("counts the pull requests waiting for the builder, theirs only", async () => {
    expect(await reviewCount(db, marie.userId)).toBe(1);
    expect(await reviewCount(db, crypto.randomUUID())).toBe(0);
  });

  it("merges a draft: ready first, then the method the repository allows", async () => {
    const { calls, fetcher } = github({
      "GET /repos/marie/halyard/pulls/4": {
        node_id: "PR_1",
        draft: true,
        merged: false,
        state: "open",
      },
      "POST /graphql": { data: {} },
      "GET /repos/marie/halyard": { allow_squash_merge: false },
      "PUT /repos/marie/halyard/pulls/4/merge": { merged: true },
    });
    expect(
      await pullRequestAction(
        db,
        credentials,
        { workUnitId, action: "merge" },
        fetcher,
      ),
    ).toEqual({ ok: true });
    expect(calls.map((entry) => entry.call).slice(1)).toEqual([
      "GET /repos/marie/halyard/pulls/4",
      "POST /graphql",
      "GET /repos/marie/halyard",
      "PUT /repos/marie/halyard/pulls/4/merge",
    ]);
    expect(calls.at(-1)!.body).toEqual({ merge_method: "merge" });
    const [pull] = await raw.select().from(schema.pullRequests);
    expect(pull!.state).toBe("merged");
  });

  it("says what GitHub refused, and leaves the pull request open", async () => {
    const { fetcher } = github({
      "GET /repos/marie/halyard/pulls/4": {
        node_id: "PR_1",
        draft: false,
        merged: false,
        state: "open",
      },
      "PUT /repos/marie/halyard/pulls/4/merge": Response.json(
        { message: "Pull Request is not mergeable" },
        { status: 405 },
      ),
    });
    expect(
      await pullRequestAction(
        db,
        credentials,
        { workUnitId, action: "merge" },
        fetcher,
      ),
    ).toEqual({ ok: false, error: "Pull Request is not mergeable" });
    const [pull] = await raw.select().from(schema.pullRequests);
    expect(pull!.state).toBe("open");
  });

  it("only marks a draft ready for review when asked to", async () => {
    const { calls, fetcher } = github({
      "GET /repos/marie/halyard/pulls/4": {
        node_id: "PR_1",
        draft: true,
        merged: false,
        state: "open",
      },
      "POST /graphql": { data: {} },
    });
    expect(
      await pullRequestAction(
        db,
        credentials,
        { workUnitId, action: "ready" },
        fetcher,
      ),
    ).toEqual({ ok: true });
    expect(calls.at(-1)!.call).toBe("POST /graphql");
    expect(calls.at(-1)!.body).toMatchObject({ variables: { id: "PR_1" } });
  });

  it("writes a change asked from Yarrow on the pull request, then queues it", async () => {
    const { calls, fetcher } = github({
      "POST /repos/marie/halyard/issues/4/comments": { id: 777 },
    });
    expect(
      await requestCorrection(
        db,
        credentials,
        { workUnitId, instruction: "Rename the button", login: "marie" },
        fetcher,
      ),
    ).toEqual({ ok: true });
    expect(calls.at(-1)!.body).toEqual({
      body: askedFromYarrow("marie", "Rename the button"),
    });
    expect(askedFromYarrow("marie", "Rename\nthe button")).toBe(
      "**marie** asked from Yarrow:\n\n> Rename\n> the button",
    );
    const [request] = await raw.select().from(schema.correctionRequests);
    expect(request).toMatchObject({
      instruction: "Rename the button",
      requestedBy: "marie",
      externalCommentId: "777",
      status: "queued",
    });
  });

  it("refuses a pull request that is already closed", async () => {
    await raw
      .update(schema.pullRequests)
      .set({ state: "merged", closedAt: new Date() });
    const { calls, fetcher } = github();
    expect(
      await requestCorrection(
        db,
        credentials,
        { workUnitId, instruction: "x", login: "marie" },
        fetcher,
      ),
    ).toMatchObject({ ok: false });
    expect(calls).toHaveLength(0);
  });

  it("gathers what the opened row shows", async () => {
    const run = crypto.randomUUID();
    await raw.insert(schema.agentRuns).values({
      id: run,
      workUnitId,
      status: "completed",
      implementer: "claude-opus-5-5:high",
      reviewer: "openai-astra",
      createdAt: new Date("2026-10-11T10:00:00Z"),
      finishedAt: new Date("2026-10-11T10:01:53Z"),
    });
    await raw.insert(schema.results).values({
      agentRunId: run,
      outcome: "pull_request",
      summary: "Life changes in one place.",
      evidence: ["git diff --check → clean"],
      pullRequestUrl: pullUrl,
      review: {
        summary: "Meets the ticket.",
        comments: [{ severity: "suggestion", path: "a.cs", body: "Clamp" }],
        reviewer: "openai-astra",
        rounds: 1,
      },
    });
    await raw.insert(schema.runModels).values([
      {
        agentRunId: run,
        role: "implementer",
        model: "claude-opus-5-5",
        seconds: 32,
        secondsExact: true,
        costCents: 15,
        costExact: true,
      },
      {
        agentRunId: run,
        role: "reviewer",
        model: "gpt-6-astra",
        seconds: 44,
        costCents: 33,
      },
    ]);
    await raw.insert(schema.correctionRequests).values({
      workUnitId,
      instruction: "Also the title",
      requestedBy: "marie",
      externalCommentId: "1",
    });

    const panel = await pullPanel(db, projectId, "3");
    expect(panel).toMatchObject({
      workUnitId,
      runId: run,
      pullRequest: { number: 4, url: pullUrl, state: "open" },
      implementation: {
        by: "Claude Opus 5.5",
        summary: "Life changes in one place.",
        verification: ["git diff --check → clean"],
        notVerified: [],
        legacy: true,
      },
      review: {
        by: "GPT Astra",
        approved: true,
        suggestions: [{ path: "a.cs", line: null, body: "Clamp" }],
      },
      corrections: [
        {
          instruction: "Also the title",
          requestedBy: "marie",
          status: "queued",
          approved: null,
        },
      ],
      working: null,
      totalCents: 48,
      totalSeconds: 113,
    });
    expect(panel!.models).toEqual([
      expect.objectContaining({
        role: "implementer",
        seconds: 32,
        costExact: true,
      }),
      expect.objectContaining({
        role: "reviewer",
        seconds: 44,
        costExact: false,
      }),
    ]);
    expect(await pullPanel(db, projectId, "99")).toBeNull();
  });
});

describe("a ticket written on the dashboard", () => {
  const issue = {
    number: 12,
    title: "Dark mode",
    body: openedFromYarrow("Follow the system theme.", "marie"),
    html_url: "https://github.com/marie/halyard/issues/12",
  };

  it("opens an issue through the App, labeled and queued when asked", async () => {
    const { calls, fetcher } = github({
      "POST /repos/marie/halyard/issues": issue,
    });
    expect(
      await createIssue(
        db,
        credentials,
        { projectId, title: "Dark mode", body: issue.body, queue: true },
        fetcher,
      ),
    ).toEqual({ ok: true, key: "12" });
    expect(calls.at(-1)!.body).toEqual({
      title: "Dark mode",
      body: "Follow the system theme.\n\n_Opened from Yarrow by **marie**_",
      labels: ["yarrow"],
    });
    const [unit] = await raw
      .select()
      .from(schema.workUnits)
      .where(eq(schema.workUnits.externalId, "12"));
    expect(unit).toMatchObject({
      source: "github",
      title: "Dark mode",
      authorized: true,
      status: "queued",
    });
  });

  it("adds it without the label, and says what GitHub refused", async () => {
    const { calls, fetcher } = github({
      "POST /repos/marie/halyard/issues": issue,
    });
    await createIssue(
      db,
      credentials,
      { projectId, title: "Dark mode", body: "", queue: false },
      fetcher,
    );
    expect(calls.at(-1)!.body).toMatchObject({ labels: [] });
    const [unit] = await raw
      .select()
      .from(schema.workUnits)
      .where(eq(schema.workUnits.externalId, "12"));
    expect(unit!.authorized).toBe(false);
    const refusing = github({
      "POST /repos/marie/halyard/issues": Response.json(
        { message: "Issues are disabled for this repo" },
        { status: 410 },
      ),
    });
    expect(
      await createIssue(
        db,
        credentials,
        { projectId, title: "x", body: "", queue: true },
        refusing.fetcher,
      ),
    ).toEqual({ ok: false, error: "Issues are disabled for this repo" });
  });
});
