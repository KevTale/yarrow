import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { defaultPipelineRoles } from "../../src/core/pipeline";
import { ensureAccount } from "../../src/db/accounts";
import {
  createPendingContribution,
  settleStripeContribution,
} from "../../src/db/contributions";
import { PostgresLedger } from "../../src/db/ledger";
import { createProject, linkGithubRepositories } from "../../src/db/projects";
import * as schema from "../../src/db/schema";
import { saveSponsorFilters } from "../../src/db/sponsors";
import { upsertTicket } from "../../src/db/workunits";
import { ManagedAgentsClient } from "../../src/runner/anthropic";
import { AgentsClient, defaultReviewerRates } from "../../src/runner/openai";
import { RunPipeline } from "../../src/runner/pipeline";
import { createTestDatabase } from "./helpers/pglite";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
const encode = (value: unknown) =>
  new TextEncoder().encode(
    typeof value === "string" ? value : JSON.stringify(value),
  );
const b64 = (text: string) => Buffer.from(text).toString("base64");

/** One fake internet: GitHub, Claude Managed Agents and OpenAI Agents. */
function fakeProviders() {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const outputs: Record<string, Uint8Array> = {
    "result.json": encode({
      status: "done",
      summary: "Export now handles empty lists.",
      verification: ["pnpm test → 42 passed"],
      risks: [],
      artifacts: [
        {
          file: "evidence/export.png",
          label: "Export dialog",
          kind: "screenshot",
        },
      ],
      recipe: {
        mode: "build",
        steps: ["pnpm install", "pnpm build", "pnpm start &"],
        url: "http://localhost:3000/exports",
        sign_in: "POST /api/dev/session as demo@halyard.dev",
        notes: ["Prisma needs binaries.prisma.sh"],
      },
    }),
    "changes.json": encode({
      files: [
        {
          path: "src/export.ts",
          content: b64("export const rows = [];\n"),
          mode: "100644",
        },
      ],
    }),
    "export.png": new Uint8Array([137, 80, 78, 71]),
  };
  const fetcher = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method ?? "GET", url, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status });
    // GitHub
    if (url.includes("/access_tokens"))
      return json({ token: "ghs_x", expires_at: "2099" }, 201);
    if (url.endsWith("/repos/marie/halyard"))
      return json({ default_branch: "main" });
    if (url.includes("/issues/5/comments") && (init.method ?? "GET") === "GET")
      return json([
        { user: { login: "marie" }, body: "Happens on Safari too." },
      ]);
    if (url.endsWith("/issues/5"))
      return json({
        title: "Export crashes",
        body: "Steps…",
        html_url: "https://github.com/marie/halyard/issues/5",
      });
    if (url.includes("/git/ref/heads/yarrow"))
      return json({ message: "Not Found" }, 404);
    if (url.includes("/git/ref/heads/main"))
      return json({ object: { sha: "base" } });
    if (url.includes("/git/commits/base"))
      return json({ tree: { sha: "tree" } });
    if (url.endsWith("/git/blobs")) return json({ sha: "blob" }, 201);
    if (url.endsWith("/git/trees")) return json({ sha: "tree2" }, 201);
    if (url.endsWith("/git/commits")) return json({ sha: "commit" }, 201);
    if (url.endsWith("/git/refs")) return json({}, 201);
    if (url.endsWith("/pulls"))
      return json(
        { number: 9, html_url: "https://github.com/marie/halyard/pull/9" },
        201,
      );
    if (url.endsWith("/reviews")) return json({}, 200);
    // Anthropic Managed Agents
    if (url.endsWith("/v1/environments/env_1") && init.method === "GET")
      return json({
        id: "env_1",
        config: {
          type: "cloud",
          networking: {
            type: "limited",
            allow_package_managers: true,
            allowed_hosts: ["cdn.playwright.dev", "api.stripe.com"],
          },
        },
      });
    if (url.endsWith("/v1/environments/env_1")) return json({ id: "env_1" });
    if (url === "https://api.anthropic.com/v1/sessions")
      return json({ id: "sesn_1", status: "running" });
    if (url.endsWith("/v1/sessions/sesn_1"))
      return json({
        id: "sesn_1",
        status: "idle",
        // Shapes from the Get Session reference (platform.claude.com, 2026-10-07).
        agent: { model: { id: "claude-opus-5-5", effort: { type: "high" } } },
        usage: {
          list_cost: { amount: "187", currency: "USD" },
          active_seconds: 72.4,
          input_tokens: 1_000,
          output_tokens: 5_000,
          cache_read_input_tokens: 40_000,
          cache_creation: { ephemeral_5m_input_tokens: 2_000 },
        },
      });
    if (url.includes("/v1/files?scope_id=sesn_1"))
      return json({
        data: Object.keys(outputs).map((name) => ({
          id: `file_${name}`,
          filename: name,
        })),
      });
    const download = url.match(/\/v1\/files\/file_(.+)\/content$/);
    if (download) return new Response(outputs[download[1]!] as BodyInit);
    // OpenAI Agents
    if (url === "https://api.openai.com/v1/agents/sessions")
      return json({ id: "rev_1", status: "in_progress" });
    if (url.endsWith("/agents/sessions/rev_1"))
      return json({ id: "rev_1", status: "idle" });
    if (url.includes("/rev_1/items"))
      return json({
        data: [
          {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: '```json\n{"summary":"Correct and minimal.","comments":[{"severity":"nit","path":"src/export.ts","line":1,"body":"Name it emptyRows"}]}\n```',
              },
            ],
          },
        ],
      });
    if (url.includes("/rev_1/turns"))
      return json({
        data: [
          {
            usage: {
              input_tokens: 200_000,
              output_tokens: 10_000,
              input_tokens_details: { cached_tokens: 100_000 },
            },
          },
        ],
      });
    return json({ message: `unexpected ${url}` }, 500);
  }) as typeof fetch;
  return { calls, fetcher };
}

describe("run pipeline", async () => {
  const t = await createTestDatabase();
  const { db, raw } = t;
  afterAll(() => t.pg.close());
  beforeEach(() => t.reset());

  it("implements, reviews and delivers a draft PR with attribution", async () => {
    const owner = {
      userId: crypto.randomUUID(),
      githubLogin: "marie",
      name: null,
    };
    const accountId = await ensureAccount(db, owner);
    const projectId = await createProject(db, accountId, owner.userId, {
      name: "Halyard",
      description: "",
      productUrl: "",
      repository: "marie/halyard",
      visibility: "public",
      categories: ["saas"],
      stacks: [],
      authorizationLabel: "yarrow",
    });
    await linkGithubRepositories(db, "42", [
      { fullName: "marie/halyard", id: "999" },
    ]);
    const { workUnitId } = await upsertTicket(db, {
      projectId,
      source: "github",
      externalId: "5",
      title: "Export crashes",
      body: "Steps…",
      url: "https://github.com/marie/halyard/issues/5",
      labeled: true,
      closed: false,
    });
    const sponsor = crypto.randomUUID();
    await saveSponsorFilters(db, sponsor, {
      publicName: "Northwind",
      mode: "all_except",
      includeHidden: false,
      excludedCategories: [],
      requiredStacks: [],
      selectedProjectIds: [],
    });
    // A website: the card's click goes there, counted.
    await raw
      .update(schema.sponsorProfiles)
      .set({ websiteUrl: "https://northwind.dev" });
    await createPendingContribution(db, {
      userId: sponsor,
      amountCents: 5_000,
      stripeCheckoutId: "cs_1",
      withdrawalWaiverAt: new Date(),
    });
    await settleStripeContribution(db, {
      stripeCheckoutId: "cs_1",
      stripePaymentIntentId: "pi_1",
      amountCents: 5_000,
      taxCents: 0,
      feeCents: 175,
    });
    const runId = crypto.randomUUID();
    const ledger = new PostgresLedger(db);
    await ledger.reserve({
      runId,
      workUnitId,
      kind: "implementation",
      budgetCents: 100,
    });

    const { calls, fetcher } = fakeProviders();
    const stored: string[] = [];
    const runner = new RunPipeline({
      db,
      anthropic: new ManagedAgentsClient("sk-ant", fetcher),
      openai: new AgentsClient("sk-openai", fetcher),
      github: { appId: "1", privateKey: pem },
      trackers: {},
      evidence: { put: async (key) => stored.push(key) },
      appUrl: "https://yarrow.run",
      roles: defaultPipelineRoles,
      anthropicAgentId: "agent_1",
      defaultEnvironmentId: "env_1",
      reviewerModel: "gpt-6-astra",
      reviewerEffort: "high",
      reviewerRates: defaultReviewerRates,
      fetcher,
    });

    const run = await runner.prepare(runId);
    expect(run).toMatchObject({
      baseBranch: "main",
      checkoutBranch: "main",
      environmentId: "env_1",
      workBranch: expect.stringMatching(/^yarrow\/export-crashes-/),
    });
    expect(run.ticket.body).toContain("@marie: Happens on Safari too.");

    // An environment made before a host was added gets it, and keeps its own.
    const opened = calls.find(
      (call) =>
        call.method === "POST" && call.url.endsWith("/v1/environments/env_1"),
    )!;
    expect(opened.body).toMatchObject({
      config: {
        type: "cloud",
        networking: {
          type: "limited",
          allow_package_managers: true,
          allowed_hosts: expect.arrayContaining([
            "api.stripe.com",
            "binaries.prisma.sh",
            "nodejs.org",
          ]),
        },
      },
    });

    const sessionId = await runner.startImplementation(run);
    const created = calls.find(
      (call) => call.url === "https://api.anthropic.com/v1/sessions",
    )!;
    expect(created.body).toMatchObject({
      agent: "agent_1",
      environment_id: "env_1",
      resources: [
        {
          type: "github_repository",
          url: "https://github.com/marie/halyard",
          authorization_token: "ghs_x",
          checkout: { type: "branch", name: "main" },
        },
      ],
    });
    // The sandbox token is read-only and scoped to one repository.
    const tokenCall = calls.find((call) =>
      call.url.includes("/access_tokens"),
    )!;
    expect(tokenCall.body).toEqual({
      repository_ids: [999],
      permissions: { contents: "read" },
    });

    expect(await runner.implementerState(sessionId)).toBe("done");
    // The task carries the evidence rules; no recipe yet for this project.
    const task = JSON.stringify(created.body);
    expect(task).toContain("Evidence (these rules replace");
    expect(task).toContain("No recipe yet for running this app");

    const snapshot = await runner.readImplementation(sessionId, projectId);
    expect(snapshot).toMatchObject({
      status: "done",
      paths: ["src/export.ts"],
    });
    // The recipe the agent found is the project's now, for the next run.
    const [config] = await raw.select().from(schema.projectRunConfigs);
    expect(config?.recipe).toEqual({
      mode: "build",
      steps: ["pnpm install", "pnpm build", "pnpm start &"],
      url: "http://localhost:3000/exports",
      signIn: "POST /api/dev/session as demo@halyard.dev",
      notes: ["Prisma needs binaries.prisma.sh"],
    });
    expect((await runner.prepare(runId)).recipe?.mode).toBe("build");

    const reviewerId = await runner.startReview(run, sessionId, snapshot);
    const reviewSession = calls.find(
      (call) => call.url === "https://api.openai.com/v1/agents/sessions",
    )!;
    expect(reviewSession.body).toMatchObject({
      agent: { model: "gpt-6-astra", reasoning: { effort: "high" } },
      environment: {
        type: "openai_hosted",
        network: {
          access: "restricted",
          allowed_domains: ["github.com", "codeload.github.com"],
        },
      },
    });
    // The API takes { command } objects, not strings (seen on the first live run).
    const setup = (
      reviewSession.body as { environment: { setup_commands: unknown[] } }
    ).environment.setup_commands;
    expect(setup.length).toBeGreaterThan(0);
    for (const step of setup)
      expect(step).toEqual({ command: expect.any(String) });
    const review = await runner.readReview(reviewerId);
    expect(runner.needsFix(review)).toBe(false);

    const delivered = await runner.deliver(run, sessionId, snapshot, {
      ...review,
      reviewer: defaultPipelineRoles.reviewer,
      rounds: 1,
    });
    expect(delivered).toMatchObject({
      url: "https://github.com/marie/halyard/pull/9",
      number: 9,
    });
    expect(stored).toHaveLength(1);
    const pull = calls.find((call) => call.url.endsWith("/pulls"))!;
    const body = (pull.body as { body: string; draft: boolean }).body;
    expect((pull.body as { draft: boolean }).draft).toBe(true);
    expect(body).toContain("Closes #5");
    expect(body).toContain("pnpm test → 42 passed");
    // A public project's screenshots show in the description.
    expect(body).toMatch(
      /## Screenshots\n\n\*\*Export dialog\*\*\n\n!\[Export dialog\]\(https:\/\/yarrow\.run\/evidence\/runs\/[0-9a-f-]+\/[0-9a-f]{8}-export\.png\)/,
    );
    expect(body).toContain("Need a change? Comment `@yarrow-run` followed by");
    expect(body).toContain(
      "Implemented by Claude Opus 5.5 · Reviewed by GPT Astra",
    );
    // Delivery writes with a token that may change CI files too.
    expect(
      calls.some(
        (call) =>
          call.url.includes("/access_tokens") &&
          JSON.stringify(call.body).includes('"workflows":"write"'),
      ),
    ).toBe(true);
    // The sponsors' card closes the pull request, after the models.
    expect(body).toMatch(
      /Reviewed by GPT Astra\n\n---\n\n<a href="https:\/\/yarrow\.run\/out\/[0-9a-f-]{36}"><img alt="Sponsored by Northwind, powered by Yarrow" src="https:\/\/yarrow\.run\/pr-card\/[0-9a-f-]{36}"><\/a>$/,
    );
    const commit = calls.find((call) => call.url.endsWith("/git/commits"))!;
    expect((commit.body as { message: string }).message).toContain(
      "Assisted-by: Claude Opus 5.5, GPT Astra (Yarrow)",
    );
    // The review is in the pull request itself: no second message.
    expect(body).toContain("## Review by GPT Astra");
    expect(calls.some((call) => call.url.endsWith("/reviews"))).toBe(false);

    const cost = await runner.cost(sessionId, [reviewerId]);
    // Claude 187¢ + OpenAI: 100k fresh × $10/M + 100k cached × $1/M + 10k out × $50/M = 160¢ + 3¢ sandbox.
    expect(cost).toBe(187 + 163);
    const usage = await runner.usage(sessionId, [
      { id: reviewerId, seconds: 31 },
    ]);
    expect(usage.costCents).toBe(cost);
    expect(usage.models).toEqual([
      {
        role: "implementer",
        model: "claude-opus-5-5",
        effort: "high",
        sessions: 1,
        seconds: 72,
        secondsExact: true,
        inputTokens: 43_000,
        cachedInputTokens: 40_000,
        outputTokens: 5_000,
        costCents: 187,
        costExact: true,
      },
      {
        role: "reviewer",
        model: "gpt-6-astra",
        effort: "high",
        sessions: 1,
        seconds: 31,
        secondsExact: false,
        inputTokens: 200_000,
        cachedInputTokens: 100_000,
        outputTokens: 10_000,
        costCents: 163,
        costExact: false,
      },
    ]);
    await ledger.reserveMore(runId, cost - 100, 1);
    await ledger.settle(runId, {
      outcome: "pull_request",
      actualCostCents: cost,
      pullRequestUrl: delivered.url,
      pullRequestNumber: delivered.number,
      branch: delivered.branch,
      summary: snapshot.summary,
      evidence: snapshot.verification,
      artifacts: delivered.artifacts,
    });
    const [settled] = await raw.select().from(schema.agentRuns);
    expect(settled).toMatchObject({
      status: "completed",
      debitedCents: 350,
      uncoveredCents: 0,
    });
  });
});
