import { describe, expect, it } from "vitest";
import { available, reserve, settle } from "../../src/core/budget";
import { checkoutSchema, projectSchema } from "../../src/core/forms";
import { CloudflareSandboxRunner } from "../../src/runner/cloudflare-sandbox-runner";

describe("compute budget", () => {
  const credit = { creditCents: 2000, reservedCents: 0, debitedCents: 0 };
  it("reserves before executing, debits actual cost and releases unused credit", () => {
    const reserved = reserve(credit, 800);
    expect(available(reserved)).toBe(1200);
    const settled = settle(reserved, 800, 342);
    expect(settled).toEqual({
      creditCents: 2000,
      reservedCents: 0,
      debitedCents: 342,
    });
    expect(available(settled)).toBe(1658);
    expect(credit.reservedCents).toBe(0);
  });
  it("rejects overspend, unreserved settlement and fractional cents", () => {
    expect(() => reserve(credit, 2001)).toThrow();
    expect(() => reserve(credit, 5.5)).toThrow();
    expect(() => reserve(credit, -50)).toThrow();
    expect(() => settle(credit, 100, 10)).toThrow();
    expect(() => settle(reserve(credit, 100), 100, 101)).toThrow();
  });
  it("does not release another run's reservation", () => {
    const reserved = reserve(reserve(credit, 800), 500);
    expect(settle(reserved, 800, 342)).toEqual({
      creditCents: 2000,
      reservedCents: 500,
      debitedCents: 342,
    });
  });
  it("validates only monetary fields on a database row", () => {
    const row = { ...credit, id: "contribution" };
    expect(available(row)).toBe(2000);
  });
});

describe("integration boundaries", () => {
  it("the runner stub abstains at zero cost", async () => {
    const result = await new CloudflareSandboxRunner().execute({
      runId: crypto.randomUUID(),
      workUnitId: crypto.randomUUID(),
      kind: "implementation",
      budgetCents: 800,
    });
    expect(result).toMatchObject({
      outcome: "abstained",
      reason: "sandbox_not_configured",
      actualCostCents: 0,
    });
  });
  it("does not let a checkout cross pool boundaries or choose arbitrary prices", () => {
    expect(
      checkoutSchema.safeParse({
        packId: "builder",
        pool: "commons",
        projectId: "halyard",
        visibility: "public",
      }).success,
    ).toBe(false);
    expect(
      checkoutSchema.safeParse({
        packId: "free",
        pool: "commons",
        projectId: null,
        visibility: "public",
      }).success,
    ).toBe(false);
  });
  it("requires a dedicated Jira site and a bounded project budget", () => {
    const draft = {
      name: "Demo",
      repository: "owner/repo",
      pool: "commons",
      authorizationLabel: "agent-ok",
      jiraSite: "demo.atlassian.net",
      jiraJql: "",
      capCents: 800,
      draftPullRequests: true,
      requirePassingTests: true,
    };
    expect(projectSchema.safeParse(draft).success).toBe(true);
    expect(
      projectSchema.safeParse({ ...draft, jiraSite: "ecoagile.atlassian.net" })
        .success,
    ).toBe(false);
    expect(
      projectSchema.safeParse({
        ...draft,
        repository: "owner/repo; echo token",
      }).success,
    ).toBe(false);
    expect(projectSchema.safeParse({ ...draft, capCents: 5001 }).success).toBe(
      false,
    );
  });
});
