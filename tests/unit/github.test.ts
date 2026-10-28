import { generateKeyPairSync, createVerify } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { ensureAccount } from "../../src/db/accounts";
import { PostgresLedger } from "../../src/db/ledger";
import { createProject } from "../../src/db/projects";
import * as schema from "../../src/db/schema";
import {
  createPendingContribution,
  settleStripeContribution,
} from "../../src/db/contributions";
import {
  createAppJwt,
  GitHubClient,
  hmacSha256Hex,
  verifyGitHubSignature,
} from "../../src/server/github/app";
import {
  branchName,
  commitChanges,
  openDraftPullRequest,
} from "../../src/server/github/delivery";
import { handleGitHubEvent } from "../../src/server/github/webhook";
import { createTestDatabase } from "./helpers/pglite";

describe("GitHub App auth", () => {
  it("signs a verifiable RS256 JWT from the PKCS#1 key GitHub issues", async () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
    });
    const pkcs1 = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
    const jwt = await createAppJwt("12345", pkcs1, Date.UTC(2026, 9, 6));
    const [header, payload, signature] = jwt.split(".");
    const verifier = createVerify("RSA-SHA256");
    verifier.update(`${header}.${payload}`);
    expect(
      verifier.verify(publicKey, Buffer.from(signature!, "base64url")),
    ).toBe(true);
    const claims = JSON.parse(Buffer.from(payload!, "base64url").toString());
    expect(claims.iss).toBe("12345");
    expect(claims.exp - claims.iat).toBe(540);
    // PKCS#8 keys work too.
    const pkcs8 = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    await expect(createAppJwt("12345", pkcs8)).resolves.toMatch(/^ey/);
  });
  it("verifies webhook signatures", async () => {
    const body = '{"action":"opened"}';
    const signature = `sha256=${await hmacSha256Hex("secret", body)}`;
    expect(await verifyGitHubSignature("secret", body, signature)).toBe(true);
    expect(await verifyGitHubSignature("other", body, signature)).toBe(false);
    expect(await verifyGitHubSignature("secret", body, null)).toBe(false);
  });
});

/** A fake GitHub that records calls and answers the Git Data API. */
function fakeGitHub(
  options: { branchExists?: boolean; rejectInline?: boolean } = {},
) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.github.com", "");
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init.method ?? "GET", path, body });
    const json = (data: unknown, status = 200) =>
      new Response(JSON.stringify(data), { status });
    if (path.includes("/git/ref/heads/yarrow"))
      return options.branchExists
        ? json({ object: { sha: "branch-head" } })
        : json({ message: "Not Found" }, 404);
    if (path.includes("/git/ref/heads/"))
      return json({ object: { sha: "base-head" } });
    if (path.includes("/git/commits/"))
      return json({ tree: { sha: "base-tree" } });
    if (path.endsWith("/git/blobs"))
      return json({ sha: `blob-${calls.length}` }, 201);
    if (path.endsWith("/git/trees")) return json({ sha: "new-tree" }, 201);
    if (path.endsWith("/git/commits")) return json({ sha: "new-commit" }, 201);
    if (path.endsWith("/pulls"))
      return json(
        { number: 7, html_url: "https://github.com/o/r/pull/7" },
        201,
      );
    if (path.endsWith("/reviews") && options.rejectInline && body.comments)
      return json({ message: "Line could not be resolved" }, 422);
    return json({}, 201);
  }) as typeof fetch;
  return { client: new GitHubClient("token", fetcher), calls };
}

describe("PR delivery", () => {
  const repository = { owner: "o", repo: "r" };
  it("creates a branch, one commit with every change, and a draft PR", async () => {
    const { client, calls } = fakeGitHub();
    const sha = await commitChanges(client, repository, {
      baseBranch: "main",
      branch: branchName("Fix the export button!", "1234567890"),
      files: [
        { path: "src/export.ts", content: "export {}" },
        { path: "logo.png", content: "iVBORw0KGgo=", encoding: "base64" },
        { path: "old.ts", content: null },
      ],
      message: "Fix export\n\nAssisted-by: Claude Opus 5.5, GPT Astra (Yarrow)",
    });
    expect(sha).toBe("new-commit");
    // Text rides in the tree request; only the binary file needs a blob.
    expect(
      calls.filter((call) => call.path.endsWith("/git/blobs")),
    ).toHaveLength(1);
    const tree = calls.find((call) => call.path.endsWith("/git/trees"))!;
    expect(tree.body).toMatchObject({
      base_tree: "base-tree",
      tree: [
        { path: "src/export.ts", content: "export {}" },
        { path: "logo.png", sha: expect.stringMatching(/^blob-/) },
        { path: "old.ts", sha: null },
      ],
    });
    const ref = calls.find((call) => call.path.endsWith("/git/refs"))!;
    expect(ref.body).toEqual({
      ref: "refs/heads/yarrow/fix-the-export-button-12345678",
      sha: "new-commit",
    });
    const pull = await openDraftPullRequest(client, repository, {
      head: "yarrow/fix-the-export-button-12345678",
      base: "main",
      title: "Fix the export button",
      body: "…",
    });
    expect(pull).toEqual({ number: 7, url: "https://github.com/o/r/pull/7" });
    expect(calls.at(-1)!.body).toMatchObject({ draft: true });
  });
  it("adds correction commits on top of the existing branch", async () => {
    const { client, calls } = fakeGitHub({ branchExists: true });
    await commitChanges(client, repository, {
      baseBranch: "main",
      branch: "yarrow/fix-12345678",
      files: [{ path: "a.ts", content: "x" }],
      message: "Rename",
    });
    const commit = calls.find((call) => call.path.endsWith("/git/commits"))!;
    expect(commit.body).toMatchObject({ parents: ["branch-head"] });
    expect(calls.at(-1)).toMatchObject({
      method: "PATCH",
      body: { sha: "new-commit", force: false },
    });
  });
});

describe("GitHub webhooks", async () => {
  const t = await createTestDatabase();
  const { db, raw } = t;
  const owner = {
    userId: crypto.randomUUID(),
    githubLogin: "Marie",
    name: null,
  };
  afterAll(() => t.pg.close());
  beforeEach(async () => {
    await t.reset();
  });

  async function listed() {
    const accountId = await ensureAccount(db, owner);
    return createProject(db, accountId, owner.userId, {
      name: "Halyard",
      description: "",
      productUrl: "",
      repository: "marie/halyard",
      visibility: "public",
      categories: ["saas"],
      stacks: [],
      authorizationLabel: "yarrow",
    });
  }
  const installation = (login: string) => ({
    action: "created",
    sender: { login },
    installation: { id: 42 },
    repositories: [{ id: 999, full_name: "marie/halyard" }],
  });
  const issue = (labels: string[], state: "open" | "closed" = "open") => ({
    action: "labeled",
    installation: { id: 42 },
    repository: { id: 999, full_name: "marie/halyard" },
    issue: {
      number: 5,
      title: "Export crashes",
      body: "Steps…",
      html_url: "https://github.com/marie/halyard/issues/5",
      state,
      labels: labels.map((name) => ({ name })),
    },
  });

  it("links an installation only for the installer's own projects", async () => {
    const projectId = await listed();
    expect(
      await handleGitHubEvent(db, "installation", installation("mallory")),
    ).toBe("installation linked 0 project(s), created 0");
    expect(
      await handleGitHubEvent(db, "installation", installation("marie")),
    ).toBe("installation linked 1 project(s), created 0");
    const [project] = await raw
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    expect(project).toMatchObject({
      githubInstallationId: "42",
      githubRepositoryId: "999",
    });
  });

  it("queues labeled issues, then takes owner corrections and merges", async () => {
    await listed();
    await handleGitHubEvent(db, "installation", installation("marie"));
    expect(await handleGitHubEvent(db, "issues", issue(["bug"]))).toBe(
      "issue updated",
    );
    expect(
      await handleGitHubEvent(db, "issues", issue(["bug", "Yarrow"])),
    ).toBe("issue queued");
    const [unit] = await raw.select().from(schema.workUnits);
    expect(unit).toMatchObject({
      authorized: true,
      status: "queued",
      title: "Export crashes",
    });

    const sponsor = crypto.randomUUID();
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
    const ledger = new PostgresLedger(db);
    const runId = crypto.randomUUID();
    await ledger.reserve({
      runId,
      workUnitId: unit!.id,
      kind: "implementation",
      budgetCents: 1_000,
    });
    await ledger.settle(runId, {
      outcome: "pull_request",
      actualCostCents: 250,
      pullRequestUrl: "https://github.com/marie/halyard/pull/6",
      pullRequestNumber: 6,
      branch: "yarrow/export-crashes",
      summary: "Fixed",
      evidence: ["tests passed"],
    });

    const comment = (body: string, association = "OWNER", type = "User") => ({
      action: "created",
      installation: { id: 42 },
      repository: { id: 999, full_name: "marie/halyard" },
      issue: {
        ...issue([]).issue,
        number: 6,
        pull_request: { html_url: "https://github.com/marie/halyard/pull/6" },
      },
      comment: {
        id: Math.floor(Math.random() * 1e9),
        body,
        author_association: association,
        user: { login: "marie", type },
      },
    });
    expect(
      await handleGitHubEvent(db, "issue_comment", comment("looks good")),
    ).toBe("ignored: no mention");
    expect(
      await handleGitHubEvent(
        db,
        "issue_comment",
        comment("@yarrow-run fix", "NONE"),
      ),
    ).toBe("ignored: commenter is not a maintainer");
    expect(
      await handleGitHubEvent(
        db,
        "issue_comment",
        comment("@yarrow-run x", "OWNER", "Bot"),
      ),
    ).toBe("ignored: bot comment");
    expect(
      await handleGitHubEvent(
        db,
        "issue_comment",
        comment("@yarrow-run: rename the button to Export CSV"),
      ),
    ).toBe("correction queued");
    const [request] = await raw.select().from(schema.correctionRequests);
    expect(request!.instruction).toBe("rename the button to Export CSV");
    // Each environment answers to its own app: dev's is yarrow-run-dev.
    expect(
      await handleGitHubEvent(
        db,
        "issue_comment",
        comment("@yarrow-run-dev also the title"),
      ),
    ).toBe("ignored: no mention");
    expect(
      await handleGitHubEvent(
        db,
        "issue_comment",
        comment("@yarrow-run-dev also the title"),
        "yarrow-run-dev",
      ),
    ).toBe("correction queued");
    expect(
      (await raw.select().from(schema.correctionRequests)).map(
        (row) => row.instruction,
      ),
    ).toContain("also the title");

    expect(
      await handleGitHubEvent(db, "pull_request", {
        action: "closed",
        pull_request: {
          html_url: "https://github.com/marie/halyard/pull/6",
          merged: true,
        },
      }),
    ).toBe("pull request merged");
    const [pull] = await raw.select().from(schema.pullRequests);
    expect(pull!.state).toBe("merged");
  });

  it("ignores repositories that are not listed", async () => {
    expect(await handleGitHubEvent(db, "issues", issue(["yarrow"]))).toBe(
      "ignored: repository not listed",
    );
  });
});
