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
import type { MuseClient, MuseStart } from "../../src/runner/muse";
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
      proofs: [
        {
          kind: "images",
          label: "Exporting an empty list",
          before: "proof/empty-before.png",
          after: "proof/empty-after.png",
        },
        {
          kind: "output",
          label: "The export tests",
          command: "pnpm test export",
          before: "1 failed",
          after: "3 passed",
        },
        { kind: "app", path: "/exports" },
        // Dropped: not a page of the app.
        { kind: "app", path: "//evil.example" },
      ],
      recipe: {
        mode: "build",
        steps: ["pnpm install", "pnpm build", "pnpm start &"],
        url: "http://localhost:3000/exports",
        sign_in: "POST /api/dev/session as demo@halyard.dev",
        before: {
          steps: [
            "ln -s /workspace/repo/node_modules .",
            "PORT=3001 pnpm start &",
          ],
          url: "http://localhost:3001",
        },
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
    // One by its path in the outputs, one by its name alone.
    "proof/empty-before.png": new Uint8Array([137, 80, 78, 71]),
    "empty-after.png": new Uint8Array([137, 80, 78, 71]),
    // What the recorder writes (src/runner/recorder/present.mjs).
    "presentation/presentation.json": encode({
      version: 1,
      title: "Empty exports",
      ticket: {
        source: "github",
        title: "Export crashes",
        url: "https://github.com/marie/halyard/issues/5",
      },
      poster: "presentation/k1-poster.jpg",
      apps: { before: null, after: "http://localhost:3000" },
      chapters: [
        {
          title: "The ask",
          tab: "ticket",
          url: "https://github.com/marie/halyard/issues/5",
          say: "Exporting an empty list crashed.",
          clip: "presentation/k1-01-the-ask.webm",
          startMs: 90,
          durationMs: 3400,
          width: 1280,
          height: 800,
          marks: [],
        },
        {
          title: "Export",
          tab: "app",
          url: "localhost:3000/exports",
          page: "Halyard",
          say: "It now gives a file with only the header row.",
          clip: "presentation/k1-02-export.webm",
          startMs: 480,
          durationMs: 4200,
          width: 1280,
          height: 800,
          marks: [
            {
              atMs: 1200,
              kind: "click",
              box: { x: 900, y: 100, width: 100, height: 36 },
            },
          ],
          live: {
            app: "after",
            path: "/exports",
            actions: [{ do: "click", target: "role=button[name='Export']" }],
            command: null,
            cwd: null,
            before: false,
          },
        },
      ],
    }),
    "presentation/k1-01-the-ask.webm": new Uint8Array([26, 69, 223, 163]),
    "presentation/k1-02-export.webm": new Uint8Array([26, 69, 223, 163]),
    "presentation/k1-poster.jpg": new Uint8Array([255, 216, 255]),
  };
  const fetcher = (async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    const body =
      typeof init.body === "string" ? JSON.parse(init.body) : init.body;
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
    if (url === "https://api.anthropic.com/v1/files" && init.method === "POST")
      return json({ id: "file_recorder" });
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
  return { calls, fetcher, outputs };
}

/** Muse's containers, played from the same outputs as Claude's session. */
function fakeMuse(outputs: Record<string, Uint8Array>) {
  const started: { sessionId: string; spec: MuseStart }[] = [];
  const sent: string[] = [];
  const released: string[] = [];
  const muse: MuseClient = {
    start: async (sessionId, spec) => {
      started.push({ sessionId, spec });
    },
    send: async (_sessionId, prompt) => {
      sent.push(prompt);
    },
    state: async () => ({ state: "done", error: null }),
    listFiles: async () =>
      Object.keys(outputs).map((name) => ({
        id: `/mnt/session/outputs/${name}`,
        filename: name,
      })),
    download: async (_sessionId, fileId) =>
      outputs[fileId.replace("/mnt/session/outputs/", "")]!,
    activity: async () => [
      {
        externalId: "call_1",
        at: "2026-10-26T15:00:00.000Z",
        actor: "implementer",
        kind: "test",
        detail: { command: "pnpm test", ok: true, passed: 42 },
      },
    ],
    usage: async () => ({
      model: "muse-wonder-1.0",
      effort: "high",
      models: {
        "muse-wonder-1.0": {
          input: 1_000_000,
          cached: 800_000,
          output: 10_000,
          calls: 20,
        },
      },
      agentSeconds: 420.4,
      containerSeconds: 600,
    }),
    release: async (sessionId) => {
      released.push(sessionId);
    },
  };
  return { muse, started, sent, released };
}

describe("run pipeline", async () => {
  const t = await createTestDatabase();
  const { db, raw } = t;
  afterAll(() => t.pg.close());
  beforeEach(() => t.reset());

  /** A public project, its labelled issue #5, a sponsor, and a run reserved on it. */
  async function seedRun() {
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
    return { runId, projectId, ledger };
  }

  it("implements, reviews and delivers a draft PR with attribution", async () => {
    const { runId, projectId, ledger } = await seedRun();

    const { calls, fetcher } = fakeProviders();
    const stored: string[] = [];
    const objects = new Map<string, Uint8Array>();
    const spoken: string[] = [];
    const around: (string | undefined)[][] = [];
    const runner = new RunPipeline({
      db,
      anthropic: new ManagedAgentsClient("sk-ant", fetcher),
      openai: new AgentsClient("sk-openai", fetcher),
      github: { appId: "1", privateKey: pem },
      trackers: {},
      evidence: {
        put: async (key, data) => {
          stored.push(key);
          objects.set(key, data);
        },
      },
      voice: {
        id: "test",
        voice: "chris",
        model: null,
        speak: async ({ text, before, after }) => {
          spoken.push(text);
          around.push([before, after]);
          return {
            audio: new Uint8Array([73, 68, 51]),
            contentType: "audio/mpeg",
            durationMs: 2600,
            cues: [{ startMs: 0, endMs: 2400, text, words: [] }],
          };
        },
      },
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

    // An environment made before a host was added gets it, and keeps its
    // own; the recorder's desktop packages too.
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
        packages: { apt: expect.arrayContaining(["xvfb", "ffmpeg"]) },
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
        // The recorder, uploaded by the brain, read-only in the sandbox.
        {
          type: "file",
          file_id: "file_recorder",
          mount_path: "/yarrow/present.mjs",
        },
      ],
    });
    // The sandbox token is read-only and scoped to one repository; only
    // the brain's own read (the ticket) may read issues, private ones too.
    const tokens = calls
      .filter((call) => call.url.includes("/access_tokens"))
      .map((call) => call.body);
    expect(tokens[0]).toEqual({
      repository_ids: [999],
      permissions: { contents: "read", issues: "read" },
    });
    expect(tokens.at(-1)).toEqual({
      repository_ids: [999],
      permissions: { contents: "read" },
    });

    expect(await runner.implementerState(sessionId)).toBe("done");
    // The task carries the evidence rules; no recipe yet for this project.
    const task = JSON.stringify(created.body);
    expect(task).toContain("Evidence (these rules replace");
    expect(task).toContain("Proof: you send the owner one thing");
    expect(task).toContain("Presentation (only when the proof is a video)");
    expect(task).toContain(
      "node /mnt/session/uploads/yarrow/present.mjs /tmp/presentation.json",
    );
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
      before: {
        steps: [
          "ln -s /workspace/repo/node_modules .",
          "PORT=3001 pnpm start &",
        ],
        url: "http://localhost:3001",
      },
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

    const final = {
      ...review,
      reviewer: defaultPipelineRoles.reviewer,
      rounds: 1,
    };
    // A film proves a flow in the app: one recorded for a document is noise.
    expect(
      await runner.presentation(run, sessionId, [
        { kind: "document", file: "README.md" },
      ]),
    ).toBeNull();
    // The recording is voiced after the review, in the agent's words alone.
    const presentation = await runner.presentation(run, sessionId, [
      { kind: "app", path: "/" },
    ]);
    expect(presentation).toMatchObject({
      kind: "presentation",
      label: "Empty exports",
      contentType: "application/json",
      key: expect.stringMatching(
        /^runs\/[0-9a-f-]+\/[0-9a-f]{8}-presentation\.json$/,
      ),
      poster: expect.stringMatching(/[0-9a-f]{8}-k1-poster\.jpg$/),
    });
    expect(spoken).toEqual([
      "Exporting an empty list crashed.",
      "It now gives a file with only the header row.",
    ]);
    // Each line is voiced knowing the ones around it.
    expect(around).toEqual([
      ["", spoken[1]],
      ["Exporting an empty list crashed.", undefined],
    ]);
    const timeline = JSON.parse(
      new TextDecoder().decode(objects.get(presentation!.key)),
    );
    expect(timeline).toMatchObject({
      version: 1,
      voice: { provider: "test", voice: "chris", model: null },
      apps: { before: null, after: "http://localhost:3000" },
      chapters: [
        {
          title: "The ask",
          tab: "ticket",
          video: { startMs: 90, durationMs: 3400 },
          audio: { durationMs: 2600 },
          live: null,
        },
        {
          title: "Export",
          page: "Halyard",
          marks: [{ atMs: 1200, kind: "click" }],
          // As planned, for the stage to play it live.
          live: { app: "after", path: "/exports", actions: [{ do: "click" }] },
        },
      ],
    });
    expect(timeline.chapters[1].video.key).toMatch(/k1-02-export\.webm$/);

    const delivered = await runner.deliver(
      run,
      sessionId,
      snapshot,
      final,
      presentation,
    );
    expect(delivered).toMatchObject({
      url: "https://github.com/marie/halyard/pull/9",
      number: 9,
    });
    // Two clips, two voice lines, the still and the timeline; the
    // screenshot; the two proof images.
    expect(stored).toHaveLength(9);
    expect(delivered.proofs).toEqual([
      {
        kind: "images",
        label: "Exporting an empty list",
        before: expect.stringMatching(
          /^runs\/[0-9a-f-]+\/[0-9a-f]{8}-empty-before\.png$/,
        ),
        after: expect.stringMatching(
          /^runs\/[0-9a-f-]+\/[0-9a-f]{8}-empty-after\.png$/,
        ),
        device: "desktop",
      },
      {
        kind: "output",
        label: "The export tests",
        command: "pnpm test export",
        before: "1 failed",
        after: "3 passed",
      },
      { kind: "app", path: "/exports" },
    ]);
    expect(delivered.artifacts.map((artifact) => artifact.kind)).toEqual([
      "presentation",
      "screenshot",
    ]);
    const pull = calls.find((call) => call.url.endsWith("/pulls"))!;
    const body = (pull.body as { body: string; draft: boolean }).body;
    expect((pull.body as { draft: boolean }).draft).toBe(true);
    expect(body).toContain("Closes #5");
    // Under the summary, the film first: a public project's still links to
    // the run, where it plays.
    expect(body).toMatch(
      /## What changed\n\n[^#]+\n\n<!-- yarrow:proof film -->\n\[!\[Empty exports\]\(https:\/\/yarrow\.run\/evidence\/runs\/[0-9a-f-]+\/[0-9a-f]{8}-k1-poster\.jpg\)\]\(https:\/\/yarrow\.run\/runs\/[0-9a-f-]+\)\n\n\[Watch it in Yarrow\]\(https:\/\/yarrow\.run\/runs\/[0-9a-f-]+\)/,
    );
    expect(body).toContain("pnpm test → 42 passed");
    // The proofs, right after the film: images shown on a public project.
    expect(body).toMatch(
      /\[Watch it in Yarrow\]\([^)]+\)\n\n<!-- yarrow:proof images -->\n\*\*Exporting an empty list\*\*\n\n\| Before \| After \|\n\| --- \| --- \|\n\| !\[Before\]\(https:\/\/yarrow\.run\/evidence\/runs\/[0-9a-f-]+\/[0-9a-f]{8}-empty-before\.png\) \| !\[After\]/,
    );
    expect(body).toContain(
      "<!-- yarrow:proof output -->\n**The export tests**\n\n`pnpm test export`\n\n```diff\n- 1 failed\n+ 3 passed\n```",
    );
    expect(body).toMatch(
      /<!-- yarrow:proof app -->\n\[Try it in the app\]\(https:\/\/yarrow\.run\/preview\/[0-9a-f-]+\/5\?path=%2Fexports\)/,
    );
    expect(body).not.toContain("## Presentation");
    expect(body).not.toContain("## Proof");
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
  it("lets Meta implement in Muse's container, and Claude again on the switch", async () => {
    const { runId } = await seedRun();
    const { calls, fetcher, outputs } = fakeProviders();
    const fake = fakeMuse(outputs);
    const deps = {
      db,
      anthropic: new ManagedAgentsClient("sk-ant", fetcher),
      openai: new AgentsClient("sk-openai", fetcher),
      github: { appId: "1", privateKey: pem },
      trackers: {},
      evidence: { put: async () => undefined },
      appUrl: "https://yarrow.run",
      roles: defaultPipelineRoles,
      anthropicAgentId: "agent_1",
      defaultEnvironmentId: "env_1",
      reviewerModel: "gpt-6-astra",
      reviewerEffort: "high",
      reviewerRates: defaultReviewerRates,
      fetcher,
    };
    const runner = new RunPipeline({
      ...deps,
      implementer: "meta",
      muse: fake.muse,
    });

    const run = await runner.prepare(runId);
    expect(run).toMatchObject({ implementer: "meta", environmentId: "" });
    // Named before the container starts: the table never says Claude.
    const [prepared] = await raw.select().from(schema.agentRuns);
    expect(prepared!.implementer).toBe("muse-wonder-1.0:high");
    // No Claude environment is touched.
    expect(calls.some((call) => call.url.includes("/v1/environments"))).toBe(
      false,
    );

    const sessionId = await runner.startImplementation(run);
    expect(sessionId).toBe(`muse_${runId}`);
    expect(fake.started).toHaveLength(1);
    const { spec } = fake.started[0]!;
    expect(spec).toMatchObject({
      repository: "marie/halyard",
      branch: "main",
      token: "ghs_x",
      model: "muse-wonder-1.0",
      effort: "high",
      files: [{ path: "/mnt/session/uploads/yarrow/present.mjs" }],
    });
    // Claude's rules and task, word for word.
    expect(spec.prompt).toMatch(/^You are the implementer of Yarrow/);
    expect(spec.prompt).toContain(
      "Presentation (only when the proof is a video)",
    );
    const [row] = await raw.select().from(schema.agentRuns);
    expect(row).toMatchObject({
      implementer: "muse-wonder-1.0:high",
      implementerSession: sessionId,
    });

    expect(await runner.implementerState(sessionId, runId)).toBe("done");
    const feed = await raw.select().from(schema.runActivity);
    expect(feed.map((line) => line.kind)).toEqual(["test"]);

    const snapshot = await runner.readImplementation(sessionId);
    expect(snapshot).toMatchObject({
      status: "done",
      paths: ["src/export.ts"],
    });
    await runner.sendToImplementer(sessionId, "Fix the review's comments.");
    expect(fake.sent).toEqual(["Fix the review's comments."]);
    expect(runner.unclearComment(["Which list?"], run)).toContain(
      "the implementer (Meta)",
    );

    const reviewerId = await runner.startReview(run, sessionId, snapshot);
    const review = await runner.readReview(reviewerId);
    const presentation = await runner.presentation(run, sessionId, [
      { kind: "app", path: "/" },
    ]);
    expect(presentation).toMatchObject({ kind: "presentation" });
    await runner.deliver(
      run,
      sessionId,
      snapshot,
      { ...review, reviewer: defaultPipelineRoles.reviewer, rounds: 1 },
      presentation,
    );
    const pull = calls.find((call) => call.url.endsWith("/pulls"))!;
    expect((pull.body as { body: string }).body).toContain(
      "Implemented by Muse Wonder · Reviewed by GPT Astra",
    );
    const commit = calls.find((call) => call.url.endsWith("/git/commits"))!;
    expect((commit.body as { message: string }).message).toContain(
      "Assisted-by: Muse Wonder, GPT Astra (Yarrow)",
    );

    // Wonder: 200k fresh × $4 + 800k cached × $0.20 + 10k out × $20 = 116¢,
    // and the container's 10 minutes, 4¢.
    const usage = await runner.usage(sessionId, []);
    expect(usage.models).toEqual([
      {
        role: "implementer",
        model: "muse-wonder-1.0",
        effort: "high",
        sessions: 1,
        seconds: 420,
        secondsExact: true,
        inputTokens: 1_000_000,
        cachedInputTokens: 800_000,
        outputTokens: 10_000,
        costCents: 120,
        costExact: false,
      },
    ]);
    await runner.releaseImplementer(sessionId);
    expect(fake.released).toEqual([sessionId]);

    // Without a container, or back on Claude, the next run is Claude's.
    for (const runner of [
      new RunPipeline({ ...deps, implementer: "meta", muse: null }),
      new RunPipeline({ ...deps, implementer: "claude", muse: fake.muse }),
    ])
      expect((await runner.prepare(runId)).implementer).toBe("claude");
  });
});
