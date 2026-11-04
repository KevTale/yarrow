import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureAccount } from "../../src/db/accounts";
import { projectsForUser } from "../../src/db/github-tasks";
import * as schema from "../../src/db/schema";
import { upsertTicket } from "../../src/db/workunits";
import {
  answeredFromYarrow,
  answerIssue,
  CLOSED_FROM_YARROW,
  closePullRequest,
  closeTicket,
  startAgain,
} from "../../src/server/github/ticket-actions";
import { handleGitHubEvent } from "../../src/server/github/webhook";
import type { TrackerContext } from "../../src/server/trackers/context";
import { createTestDatabase } from "./helpers/pglite";

const t = await createTestDatabase();
const { db, raw } = t;
const marie = { userId: crypto.randomUUID(), githubLogin: "Marie", name: null };
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
const credentials = { appId: "1", privateKey };
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
});
afterAll(() => t.pg.close());

/** GitHub as the docs describe it, recording every call. */
function github() {
  const calls: { call: string; body: unknown }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const call = `${init.method} ${url.replace("https://api.github.com", "")}`;
    calls.push({
      call,
      body: init.body ? JSON.parse(String(init.body)) : null,
    });
    if (url.endsWith("/access_tokens"))
      return Response.json({ token: "t", expires_at: "x" }, { status: 201 });
    return Response.json({ id: 7 }, { status: 200 });
  }) as typeof fetch;
  return { calls, fetcher };
}

const status = async () =>
  (
    await raw
      .select()
      .from(schema.workUnits)
      .where(eq(schema.workUnits.id, workUnitId))
  )[0]!.status;

const stop = () =>
  raw
    .update(schema.workUnits)
    .set({ status: "abstained" })
    .where(eq(schema.workUnits.id, workUnitId));

describe("the builder's actions on a ticket", () => {
  it("answers a stopped ticket on its issue, then queues it again", async () => {
    await stop();
    const { calls, fetcher } = github();
    expect(
      await answerIssue(
        db,
        credentials,
        { projectId, key: "3", answer: "Only the CSV export.", login: "Marie" },
        fetcher,
      ),
    ).toEqual({ ok: true });
    expect(calls.at(-1)).toEqual({
      call: "POST /repos/marie/halyard/issues/3/comments",
      body: { body: answeredFromYarrow("Marie", "Only the CSV export.") },
    });
    expect(answeredFromYarrow("Marie", "a\nb")).toBe(
      "**Marie** answered from Yarrow:\n\n> a\n> b",
    );
    expect(await status()).toBe("queued");
  });

  it("starts a stopped ticket again from its conversation", async () => {
    const trackers = { secrets: {} } as TrackerContext;
    await stop();
    const { calls, fetcher } = github();
    expect(
      await startAgain(
        db,
        credentials,
        trackers,
        { projectId, key: "3", note: null, login: "Marie" },
        fetcher,
      ),
    ).toEqual({ ok: true });
    expect(calls).toEqual([]);
    expect(await status()).toBe("queued");

    await stop();
    expect(
      await startAgain(
        db,
        credentials,
        trackers,
        { projectId, key: "3", note: "Only the CSV export.", login: "Marie" },
        fetcher,
      ),
    ).toEqual({ ok: true });
    expect(calls.at(-1)).toEqual({
      call: "POST /repos/marie/halyard/issues/3/comments",
      body: { body: answeredFromYarrow("Marie", "Only the CSV export.") },
    });
    expect(await status()).toBe("queued");
  });

  it("answers only a ticket the agents stopped on", async () => {
    const { calls, fetcher } = github();
    expect(
      await answerIssue(
        db,
        credentials,
        { projectId, key: "3", answer: "Yes", login: "Marie" },
        fetcher,
      ),
    ).toEqual({
      ok: false,
      error: "This ticket is not waiting for an answer.",
    });
    expect(calls).toEqual([]);
  });

  it("closes an issue as not planned and stops waiting on it", async () => {
    await stop();
    const { calls, fetcher } = github();
    expect(
      await closeTicket(
        db,
        credentials,
        { projectId, key: "3", source: "github" },
        fetcher,
      ),
    ).toEqual({ ok: true });
    expect(calls.at(-1)).toEqual({
      call: "PATCH /repos/marie/halyard/issues/3",
      body: { state: "closed", state_reason: "not_planned" },
    });
    expect(await status()).toBe("closed");
  });

  it("never closes a ticket the agents are working on", async () => {
    await raw
      .update(schema.workUnits)
      .set({ status: "running" })
      .where(eq(schema.workUnits.id, workUnitId));
    const { calls, fetcher } = github();
    expect(
      (
        await closeTicket(
          db,
          credentials,
          { projectId, key: "3", source: "github" },
          fetcher,
        )
      ).ok,
    ).toBe(false);
    expect(calls).toEqual([]);
  });

  it("closes a Jira ticket's pull request, Jira itself left to the web Worker", async () => {
    await raw
      .update(schema.workUnits)
      .set({ status: "delivered" })
      .where(eq(schema.workUnits.id, workUnitId));
    await raw.insert(schema.pullRequests).values({
      workUnitId,
      url: "https://github.com/marie/halyard/pull/4",
      number: 4,
      branch: "yarrow/3",
    });
    const { calls, fetcher } = github();
    expect(
      await closeTicket(
        db,
        credentials,
        { projectId, key: "3", source: "jira" },
        fetcher,
      ),
    ).toEqual({ ok: true });
    expect(calls.map((entry) => entry.call).slice(1)).toEqual([
      "PATCH /repos/marie/halyard/pulls/4",
    ]);
    expect(await status()).toBe("closed");
  });

  it("closes a pull request alone, recorded as closed from Yarrow", async () => {
    await raw
      .update(schema.workUnits)
      .set({ status: "delivered" })
      .where(eq(schema.workUnits.id, workUnitId));
    await raw.insert(schema.pullRequests).values({
      workUnitId,
      url: "https://github.com/marie/halyard/pull/4",
      number: 4,
      branch: "yarrow/3",
    });
    const { calls, fetcher } = github();
    expect(
      await closePullRequest(db, credentials, { workUnitId }, fetcher),
    ).toEqual({ ok: true });
    expect(calls.at(-1)).toEqual({
      call: "PATCH /repos/marie/halyard/pulls/4",
      body: { state: "closed" },
    });
    const [pull] = await raw.select().from(schema.pullRequests);
    expect(pull).toMatchObject({
      state: "closed",
      rejectionReason: CLOSED_FROM_YARROW,
    });
    expect(
      (await closePullRequest(db, credentials, { workUnitId }, fetcher)).ok,
    ).toBe(false);
  });
});
