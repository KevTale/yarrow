import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ensureAccount, requireProjectMember } from "../../src/db/accounts";
import {
  createPendingContribution,
  discardPendingContribution,
  refundContribution,
  settleStripeContribution,
} from "../../src/db/contributions";
import { PostgresLedger } from "../../src/db/ledger";
import { createProject, linkGithubRepositories } from "../../src/db/projects";
import {
  runDetail,
  showcase,
  sponsorDashboard,
  workFeed,
} from "../../src/db/queries";
import { loadDispatch } from "../../src/db/queue";
import * as schema from "../../src/db/schema";
import { getSponsorFilters, saveSponsorFilters } from "../../src/db/sponsors";
import { queueCorrection, upsertTicket } from "../../src/db/workunits";
import { planDispatch } from "../../src/core/queue";
import { createTestDatabase } from "./helpers/pglite";

const t = await createTestDatabase();
const { db, raw } = t;
const owner = {
  userId: crypto.randomUUID(),
  githubLogin: "marie",
  name: "Marie",
};
const sponsor = crypto.randomUUID();
const form = {
  name: "Halyard",
  description: "Billing API",
  productUrl: "",
  repository: "halyard/ledger",
  visibility: "public" as const,
  categories: ["saas" as const],
  stacks: ["supabase"],
  authorizationLabel: "agent-commons",
};
const ticket = (overrides = {}) => ({
  source: "github" as const,
  externalId: "12",
  title: "Fix the export button",
  body: "It crashes on empty lists.",
  url: "https://github.com/halyard/ledger/issues/12",
  labeled: true,
  closed: false,
  ...overrides,
});

beforeAll(async () => {}, 30000);
afterAll(async () => {
  await t.pg.close();
});
beforeEach(async () => {
  await t.reset();
});

async function setupProject(
  visibility: "public" | "listed" | "hidden" = "public",
) {
  const accountId = await ensureAccount(db, owner);
  const projectId = await createProject(db, accountId, owner.userId, {
    ...form,
    visibility,
  });
  await linkGithubRepositories(db, "inst-1", [
    { fullName: "Halyard/Ledger", id: "999", defaultBranch: "develop" },
  ]);
  return { accountId, projectId };
}

async function fund(cents = 5_000) {
  const id = await createPendingContribution(db, {
    userId: sponsor,
    amountCents: cents,
    stripeCheckoutId: `cs_${crypto.randomUUID()}`,
    withdrawalWaiverAt: new Date(),
  });
  const [row] = await raw
    .select()
    .from(schema.contributions)
    .where(eq(schema.contributions.id, id));
  await settleStripeContribution(db, {
    stripeCheckoutId: row!.stripeCheckoutId!,
    stripePaymentIntentId: `pi_${id}`,
    amountCents: cents,
    taxCents: 0,
    feeCents: 175,
  });
  return id;
}

describe("accounts and projects", () => {
  it("creates one personal account per user and checks membership", async () => {
    const first = await ensureAccount(db, owner);
    expect(await ensureAccount(db, owner)).toBe(first);
    const { projectId } = await setupProject();
    await expect(
      requireProjectMember(db, owner.userId, projectId),
    ).resolves.toMatchObject({ id: projectId });
    await expect(
      requireProjectMember(db, crypto.randomUUID(), projectId),
    ).rejects.toThrow("access");
  });
  it("links the GitHub installation by repository, case-insensitively", async () => {
    const { projectId } = await setupProject();
    const [project] = await raw
      .select()
      .from(schema.projects)
      .where(eq(schema.projects.id, projectId));
    expect(project).toMatchObject({
      githubInstallationId: "inst-1",
      githubRepositoryId: "999",
      defaultBranch: "develop",
      repository: "Halyard/Ledger",
    });
    await expect(
      createProject(db, project!.accountId, owner.userId, {
        ...form,
        repository: "HALYARD/ledger",
      }),
    ).rejects.toThrow("already listed");
  });
});

describe("tickets", () => {
  it("queues labeled tickets and leaves running work alone", async () => {
    const { projectId } = await setupProject();
    const first = await upsertTicket(db, { projectId, ...ticket() });
    expect(first.queued).toBe(true);
    await upsertTicket(db, { projectId, ...ticket({ labeled: false }) });
    let [unit] = await raw.select().from(schema.workUnits);
    expect(unit).toMatchObject({ authorized: false, status: "queued" });
    await upsertTicket(db, { projectId, ...ticket() });
    [unit] = await raw.select().from(schema.workUnits);
    expect(unit!.authorized).toBe(true);
    await raw.update(schema.workUnits).set({ status: "running" });
    await upsertTicket(db, { projectId, ...ticket({ closed: true }) });
    [unit] = await raw.select().from(schema.workUnits);
    expect(unit!.status).toBe("running");
  });
  it("requeues an abstained ticket only once the owner edits it", async () => {
    const { projectId } = await setupProject();
    await upsertTicket(db, { projectId, ...ticket() });
    await raw.update(schema.workUnits).set({ status: "abstained" });
    // The next sync sees the same ticket: it must not run again.
    expect((await upsertTicket(db, { projectId, ...ticket() })).queued).toBe(
      false,
    );
    const edited = await upsertTicket(db, {
      projectId,
      ...ticket({ body: "Repro: export with zero rows." }),
    });
    expect(edited.queued).toBe(true);
    const [unit] = await raw.select().from(schema.workUnits);
    expect(unit).toMatchObject({
      status: "queued",
      body: "Repro: export with zero rows.",
    });
  });
});

describe("Stripe contributions", () => {
  it("settles once with the real fee and margin, then freezes on refund", async () => {
    const id = await fund(10_000);
    let [row] = await raw
      .select()
      .from(schema.contributions)
      .where(eq(schema.contributions.id, id));
    expect(row).toMatchObject({
      paymentStatus: "settled",
      feeCents: 175,
      marginCents: 1_000,
      creditCents: 8_825,
    });
    expect(
      await settleStripeContribution(db, {
        stripeCheckoutId: row!.stripeCheckoutId!,
        stripePaymentIntentId: row!.stripePaymentIntentId!,
        amountCents: 10_000,
        taxCents: 0,
        feeCents: 999,
      }),
    ).toBe(true);
    [row] = await raw
      .select()
      .from(schema.contributions)
      .where(eq(schema.contributions.id, id));
    expect(row!.feeCents).toBe(175);
    const credits = await raw
      .select()
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.kind, "credit"));
    expect(credits).toHaveLength(1);
    await refundContribution(db, row!.stripePaymentIntentId!);
    [row] = await raw
      .select()
      .from(schema.contributions)
      .where(eq(schema.contributions.id, id));
    expect(row).toMatchObject({ paymentStatus: "refunded", creditCents: 0 });
  });
  it("applies the founding margin and discards abandoned checkouts", async () => {
    await saveSponsorFilters(db, sponsor, {
      publicName: "Northwind",
      mode: "all_except",
      includeHidden: false,
      excludedCategories: [],
      requiredStacks: [],
      selectedProjectIds: [],
    });
    await raw.update(schema.sponsorProfiles).set({ foundingSponsor: true });
    const id = await fund(10_000);
    const [row] = await raw
      .select()
      .from(schema.contributions)
      .where(eq(schema.contributions.id, id));
    expect(row!.marginCents).toBe(500);
    await createPendingContribution(db, {
      userId: sponsor,
      amountCents: 2_500,
      stripeCheckoutId: "cs_abandoned",
      withdrawalWaiverAt: new Date(),
    });
    await discardPendingContribution(db, "cs_abandoned");
    expect(await raw.select().from(schema.contributions)).toHaveLength(1);
  });
});

describe("sponsor filters", () => {
  it("round-trips filters and selections", async () => {
    const { projectId } = await setupProject();
    await saveSponsorFilters(db, sponsor, {
      publicName: "Northwind",
      mode: "only",
      includeHidden: true,
      excludedCategories: ["crypto"],
      requiredStacks: ["supabase", "supabase"],
      selectedProjectIds: [projectId],
    });
    expect(await getSponsorFilters(db, sponsor)).toEqual({
      publicName: "Northwind",
      mode: "only",
      includeHidden: true,
      excludedCategories: ["crypto"],
      requiredStacks: ["supabase"],
      selectedProjectIds: [projectId],
      foundingSponsor: false,
    });
  });
});

describe("dispatch and corrections", () => {
  it("loads queued work and corrections for planning", async () => {
    const { projectId, accountId } = await setupProject();
    await fund();
    const { workUnitId } = await upsertTicket(db, { projectId, ...ticket() });
    let loaded = await loadDispatch(db, {
      perAccountLimit: 5,
      globalLimit: 10,
    });
    expect(loaded.candidates).toMatchObject([
      { kind: "implementation", workUnitId, accountId },
    ]);
    const ledger = new PostgresLedger(db);
    const runId = crypto.randomUUID();
    await ledger.reserve({
      runId,
      workUnitId,
      kind: "implementation",
      budgetCents: 1_000,
    });
    loaded = await loadDispatch(db, { perAccountLimit: 5, globalLimit: 10 });
    expect(loaded.candidates).toHaveLength(0);
    expect(loaded.state.runningByAccount.get(accountId)).toBe(1);
    await ledger.settle(runId, {
      outcome: "pull_request",
      actualCostCents: 300,
      pullRequestUrl: "https://github.com/halyard/ledger/pull/13",
      pullRequestNumber: 13,
      branch: "agent-commons/12",
      summary: "Fixed",
      evidence: ["tests passed"],
    });
    const correctionId = await queueCorrection(db, {
      pullRequestUrl: "https://github.com/halyard/ledger/pull/13",
      instruction: "Rename the button",
      requestedBy: "marie",
      externalCommentId: "c-1",
    });
    expect(
      await queueCorrection(db, {
        pullRequestUrl: "https://github.com/halyard/ledger/pull/13",
        instruction: "Rename the button",
        requestedBy: "marie",
        externalCommentId: "c-1",
      }),
    ).toBeNull();
    loaded = await loadDispatch(db, { perAccountLimit: 5, globalLimit: 10 });
    const plan = planDispatch(loaded.candidates, loaded.state);
    expect(plan).toMatchObject([{ kind: "correction", id: correctionId }]);
  });
});

describe("visibility", () => {
  async function deliveredRun(visibility: "public" | "listed" | "hidden") {
    const { projectId } = await setupProject(visibility);
    await saveSponsorFilters(db, sponsor, {
      publicName: "Northwind",
      mode: "all_except",
      includeHidden: true,
      excludedCategories: [],
      requiredStacks: [],
      selectedProjectIds: [],
    });
    await fund();
    const { workUnitId } = await upsertTicket(db, { projectId, ...ticket() });
    const runId = crypto.randomUUID();
    const ledger = new PostgresLedger(db);
    await ledger.reserve({
      runId,
      workUnitId,
      kind: "implementation",
      budgetCents: 1_000,
    });
    await ledger.settle(runId, {
      outcome: "pull_request",
      actualCostCents: 300,
      pullRequestUrl: "https://github.com/halyard/ledger/pull/13",
      pullRequestNumber: 13,
      branch: "agent-commons/12",
      summary: "Fixed the export",
      evidence: ["tests passed"],
    });
    return runId;
  }

  it("shows public runs in full", async () => {
    const runId = await deliveredRun("public");
    const detail = await runDetail(db, runId, null);
    expect(detail).toMatchObject({
      ticketTitle: "Fix the export button",
      pullRequestUrl: "https://github.com/halyard/ledger/pull/13",
      summary: "Fixed the export",
      sponsors: [{ name: "Northwind" }],
    });
    expect((await showcase(db))[0]!.repository).toBe("Halyard/Ledger");
  });
  it("hides tickets and PRs of listed projects from non-members", async () => {
    const runId = await deliveredRun("listed");
    const detail = await runDetail(db, runId, null);
    expect(detail).toMatchObject({
      projectName: "Halyard",
      ticketTitle: "A ticket",
      pullRequestUrl: null,
      summary: null,
    });
    expect((await showcase(db))[0]!.repository).toBeNull();
    const member = await runDetail(db, runId, owner.userId);
    expect(member!.ticketTitle).toBe("Fix the export button");
  });
  it("keeps hidden projects out of every public view", async () => {
    const runId = await deliveredRun("hidden");
    expect(await runDetail(db, runId, null)).toBeNull();
    expect(await workFeed(db)).toHaveLength(0);
    expect(await showcase(db)).toHaveLength(0);
    const dashboard = await sponsorDashboard(db, sponsor);
    expect(dashboard.fundedRuns[0]!.projectName).toBe("A private project");
    expect(dashboard.totals.consumedCents).toBe(300);
  });
});
