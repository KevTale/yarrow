import { describe, expect, it } from "vitest";
import {
  assistedByTrailer,
  pullRequestFooter,
  sponsorNames,
} from "../../src/core/attribution";
import {
  checkoutSchema,
  sponsorProfileSchema,
  projectFormSchema,
  projectSecretSchema,
  runConfigSchema,
  sponsorFiltersSchema,
} from "../../src/core/forms";
import { amountCentsSchema, money } from "../../src/core/packs";
import { prCardSvg, shortSite } from "../../src/core/pr-card";
import { defaultPipelineRoles } from "../../src/core/pipeline";
import {
  estimateBreakdown,
  marginCents,
  settleBreakdown,
} from "../../src/core/pricing";
import { planDispatch, type DispatchCandidate } from "../../src/core/queue";
import { blockingComments, reviewBody } from "../../src/core/review";

describe("pricing", () => {
  it("takes 7.5% of the amount excluding VAT, 5% for founding sponsors", () => {
    expect(marginCents(10_000, false)).toBe(750);
    expect(marginCents(10_000, true)).toBe(500);
  });
  it("settles with the real Stripe fee and tax", () => {
    expect(
      settleBreakdown({
        amountCents: 10_000,
        taxCents: 0,
        feeCents: 320,
        founding: false,
      }),
    ).toEqual({
      amountCents: 10_000,
      taxCents: 0,
      feeCents: 320,
      marginCents: 750,
      creditCents: 8_930,
    });
    // A French consumer: $100 VAT-inclusive.
    expect(
      settleBreakdown({
        amountCents: 10_000,
        taxCents: 1_667,
        feeCents: 320,
        founding: false,
      }),
    ).toMatchObject({ marginCents: 625, creditCents: 7_388 });
  });
  it("estimates the brief's examples at checkout", () => {
    expect(estimateBreakdown(10_000).creditCents).toBe(8_930);
    expect(estimateBreakdown(10_000, { vatRateBps: 2000 })).toMatchObject({
      taxCents: 1_667,
      creditCents: 7_388,
    });
    expect(estimateBreakdown(1_000).creditCents).toBe(866);
  });
  it("never produces negative credit or accepts bad input", () => {
    expect(
      settleBreakdown({
        amountCents: 100,
        taxCents: 0,
        feeCents: 500,
        founding: false,
      }).creditCents,
    ).toBe(0);
    expect(() =>
      settleBreakdown({
        amountCents: 100,
        taxCents: 200,
        feeCents: 0,
        founding: false,
      }),
    ).toThrow();
    expect(() => marginCents(10.5, false)).toThrow();
  });
});

describe("amounts and forms", () => {
  it("accepts whole dollars from $10 to $1,000", () => {
    expect(amountCentsSchema.safeParse(1_000).success).toBe(true);
    expect(amountCentsSchema.safeParse(100_000).success).toBe(true);
    expect(amountCentsSchema.safeParse(900).success).toBe(false);
    expect(amountCentsSchema.safeParse(100_100).success).toBe(false);
    expect(amountCentsSchema.safeParse(1_050).success).toBe(false);
    expect(money(8_680)).toBe("$86.80");
  });
  it("requires the withdrawal waiver at checkout", () => {
    const profile = {
      publicName: null,
      tagline: null,
      description: null,
      websiteUrl: null,
    };
    expect(
      checkoutSchema.safeParse({
        amountCents: 2_500,
        profile,
        withdrawalWaiver: true,
      }).success,
    ).toBe(true);
    expect(
      checkoutSchema.safeParse({
        amountCents: 2_500,
        profile,
        withdrawalWaiver: false,
      }).success,
    ).toBe(false);
  });
  it("cleans the sponsor profile", () => {
    expect(
      sponsorProfileSchema.parse({
        publicName: " Acme ",
        tagline: "  ",
        description: "",
        websiteUrl: "",
      }),
    ).toEqual({
      publicName: "Acme",
      tagline: null,
      description: null,
      websiteUrl: null,
    });
    const site = (websiteUrl: string) =>
      sponsorProfileSchema.safeParse({
        publicName: "Acme",
        tagline: null,
        description: null,
        websiteUrl,
      }).success;
    expect(site("https://acme.dev")).toBe(true);
    expect(site("javascript:alert(1)")).toBe(false);
    expect(site("http://acme.dev")).toBe(false);
  });
  const project = {
    name: "Halyard",
    description: "Billing API",
    productUrl: "https://halyard.dev",
    repository: "halyard/ledger",
    visibility: "listed",
    categories: ["saas"],
    stacks: ["Supabase", "nextjs"],
    authorizationLabel: "yarrow",
  };
  it("validates projects and normalizes stacks", () => {
    const parsed = projectFormSchema.parse(project);
    expect(parsed.stacks).toEqual(["supabase", "nextjs"]);
    for (const bad of [
      { repository: "halyard/ledger; rm -rf" },
      { categories: [] },
      { categories: ["casino"] },
      { visibility: "secret" },
      { productUrl: "not a url" },
    ])
      expect(projectFormSchema.safeParse({ ...project, ...bad }).success).toBe(
        false,
      );
  });
  it("keeps secrets out of the run config and validates secret hosts", () => {
    expect(
      runConfigSchema.safeParse({
        setupCommand: "pnpm install",
        seedCommand: "",
        startCommand: "pnpm dev",
        appPort: 3000,
        env: { NODE_ENV: "development" },
      }).success,
    ).toBe(true);
    expect(
      runConfigSchema.safeParse({
        setupCommand: "",
        seedCommand: "",
        startCommand: "",
        appPort: null,
        env: { "bad key": "x" },
      }).success,
    ).toBe(false);
    expect(
      projectSecretSchema.safeParse({
        name: "STRIPE_KEY",
        value: "sk_test_x",
        allowedHost: "api.stripe.com",
      }).success,
    ).toBe(true);
    expect(
      projectSecretSchema.safeParse({
        name: "STRIPE_KEY",
        value: "x",
        allowedHost: "https://api.stripe.com/v1",
      }).success,
    ).toBe(false);
  });
  it("validates sponsor filters", () => {
    expect(
      sponsorFiltersSchema.safeParse({
        publicName: "Northwind",
        mode: "only",
        includeHidden: false,
        excludedCategories: ["crypto"],
        requiredStacks: ["supabase"],
        selectedProjectIds: [crypto.randomUUID()],
      }).success,
    ).toBe(true);
    expect(
      sponsorFiltersSchema.safeParse({
        publicName: null,
        mode: "everything",
        includeHidden: false,
        excludedCategories: [],
        requiredStacks: [],
        selectedProjectIds: [],
      }).success,
    ).toBe(false);
  });
});

describe("dispatch planning", () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 6, 0, minutes));
  function candidate(
    accountId: string,
    minutes: number,
    workUnitId = `${accountId}-${minutes}`,
    kind: DispatchCandidate["kind"] = "implementation",
  ): DispatchCandidate {
    return {
      kind,
      id: `${kind}-${workUnitId}-${minutes}`,
      workUnitId,
      accountId,
      queuedAt: at(minutes),
    };
  }
  const state = {
    runningByAccount: new Map<string, number>(),
    lastServedAt: new Map<string, Date>(),
    busyWorkUnits: new Set<string>(),
    perAccountLimit: 5,
    globalLimit: 100,
  };

  it("behaves like FIFO when there is room for everything", () => {
    const plan = planDispatch(
      [candidate("a", 3), candidate("a", 1), candidate("b", 2)],
      state,
    );
    expect(plan).toHaveLength(3);
  });
  it("rotates between accounts so a big backlog cannot starve others", () => {
    const big = Array.from({ length: 20 }, (_, i) => candidate("big", i));
    const plan = planDispatch([...big, candidate("marie", 30)], {
      ...state,
      globalLimit: 3,
    });
    expect(plan.map((item) => item.accountId)).toEqual(["big", "marie", "big"]);
    expect(plan[0]!.queuedAt).toEqual(at(0));
  });
  it("serves the least recently served account first", () => {
    const plan = planDispatch([candidate("a", 1), candidate("b", 2)], {
      ...state,
      lastServedAt: new Map([["a", at(50)]]),
      globalLimit: 1,
    });
    expect(plan[0]!.accountId).toBe("b");
  });
  it("respects the per-account concurrency limit", () => {
    const plan = planDispatch(
      Array.from({ length: 10 }, (_, i) => candidate("a", i)),
      { ...state, runningByAccount: new Map([["a", 3]]) },
    );
    expect(plan).toHaveLength(2);
  });
  it("never starts two runs on the same work unit", () => {
    const plan = planDispatch(
      [
        candidate("a", 1, "wu-1", "correction"),
        candidate("a", 2, "wu-1", "correction"),
        candidate("a", 3, "wu-2", "correction"),
      ],
      { ...state, busyWorkUnits: new Set(["wu-2"]) },
    );
    expect(plan.map((item) => item.queuedAt)).toEqual([at(1)]);
  });
});

describe("attribution", () => {
  it("names sponsors and merges anonymous ones", () => {
    expect(sponsorNames([])).toBeNull();
    expect(sponsorNames([{ name: "Northwind" }])).toBe("Northwind");
    expect(
      sponsorNames([
        { name: "Northwind" },
        { name: "Mara" },
        { name: null },
        { name: "Northwind" },
      ]),
    ).toBe("Northwind, Mara and an anonymous sponsor");
    expect(sponsorNames([{ name: null }, { name: null }])).toBe(
      "2 anonymous sponsors",
    );
  });
  it("writes the PR footer and the commit trailer from the brief", () => {
    const footer = pullRequestFooter({
      roles: defaultPipelineRoles,
      sponsors: [{ name: "Northwind" }],
      runUrl: "https://yarrow.run/runs/1",
    });
    expect(footer).toContain(
      "Implemented by Claude Opus 5.5 · Reviewed by GPT Astra",
    );
    expect(footer).toContain(
      "Sponsored by Northwind via [Yarrow](https://yarrow.run/runs/1)",
    );
    // A run URL that is not a real one carries no card.
    expect(footer).not.toContain("pr-card");
    const id = "0b5c1e9e-7a52-4c1e-9d6a-2f0b8c3d4e5f";
    const sponsor = "6c0d2f4a-1b3e-4a5c-8d7e-9f0a1b2c3d4e";
    const alone = pullRequestFooter({
      roles: defaultPipelineRoles,
      sponsors: [{ name: "Northwind", publicId: sponsor, website: true }],
      runUrl: `https://yarrow.run/runs/${id}`,
    });
    expect(alone).toBe(
      [
        "Implemented by Claude Opus 5.5 · Reviewed by GPT Astra",
        "",
        "---",
        "",
        `<a href="https://yarrow.run/out/${sponsor}"><picture><source media="(prefers-color-scheme: dark)" srcset="https://yarrow.run/pr-card/${id}?theme=light"><img alt="Sponsored by Northwind, powered by Yarrow" src="https://yarrow.run/pr-card/${id}?theme=dark"></picture></a>`,
      ].join("\n"),
    );
    // The card names them: no second line saying it again.
    expect(alone).not.toContain("via [Yarrow]");
    // Shared: the card draws the largest share, and its link goes there.
    const shared = pullRequestFooter({
      roles: defaultPipelineRoles,
      sponsors: [
        { name: "Northwind", publicId: sponsor, website: true },
        { name: null },
      ],
      runUrl: `https://yarrow.run/runs/${id}`,
    });
    expect(shared).toContain(
      `<a href="https://yarrow.run/out/${sponsor}"><picture>`,
    );
    // No website to send a click to: the card opens the run.
    const siteless = pullRequestFooter({
      roles: defaultPipelineRoles,
      sponsors: [{ name: "Northwind", publicId: sponsor, website: false }],
      runUrl: `https://yarrow.run/runs/${id}`,
    });
    expect(siteless).toContain(
      `<a href="https://yarrow.run/runs/${id}"><picture>`,
    );
    expect(shared).toContain(
      'alt="Sponsored by Northwind and an anonymous sponsor, powered by Yarrow"',
    );
    expect(assistedByTrailer(defaultPipelineRoles)).toBe(
      "Assisted-by: Claude Opus 5.5, GPT Astra (Yarrow)",
    );
  });
});

describe("review", () => {
  const review = {
    reviewer: "openai-astra",
    rounds: 2,
    summary: "Solid change.",
    comments: [
      {
        severity: "blocking" as const,
        path: "a.ts",
        line: 3,
        body: "Null check",
      },
      { severity: "nit" as const, body: "Typo in the title" },
    ],
  };
  it("only blocking comments trigger the fix round", () => {
    expect(blockingComments(review)).toHaveLength(1);
  });
  it("summarizes the review for GitHub", () => {
    const body = reviewBody(review, "GPT Astra");
    expect(body).toContain("Code review by GPT Astra");
    expect(body).toContain("after one fix round");
    expect(body).toContain("1 blocking, 1 nit");
    expect(body).toContain("**Nit:** Typo in the title");
  });
});

describe("ticket links", () => {
  it("recognises each source and reads GitHub repositories and issues", async () => {
    const { parseTicketLink } = await import("../../src/core/ticket-link");
    expect(
      parseTicketLink("https://github.com/KevTale/yarrow-testbench/issues/1"),
    ).toMatchObject({
      source: { id: "github" },
      repository: "KevTale/yarrow-testbench",
      issue: 1,
    });
    expect(parseTicketLink("github.com/acme/app")).toMatchObject({
      repository: "acme/app",
    });
    expect(parseTicketLink("github.com/acme/app")!.issue).toBeUndefined();
    expect(parseTicketLink("acme.atlassian.net/browse/APP-42")!.source.id).toBe(
      "jira",
    );
    expect(
      parseTicketLink("https://linear.app/acme/issue/ENG-7")!.source.id,
    ).toBe("linear");
    expect(parseTicketLink("trello.com/c/AbCd1234")!.source.id).toBe("trello");
    expect(
      parseTicketLink("gitlab.com/acme/app/-/issues/3")!.source,
    ).toMatchObject({ id: "gitlab", soon: true });
    expect(
      parseTicketLink("dev.azure.com/acme/app/_workitems/edit/9")!.source.id,
    ).toBe("azure");
    expect(parseTicketLink("example.com/ticket/1")).toBeNull();
  });
});

describe("pull request card", () => {
  it("draws the first sponsor, counts the others and escapes text", () => {
    const svg = prCardSvg({
      sponsors: [
        {
          name: "Acme <Rockets> & Co",
          description: "Ships fast",
          site: "acme.dev",
          logo: null,
        },
        { name: null, description: null, site: null, logo: null },
      ],
    });
    expect(svg).toContain("Acme &lt;Rockets&gt; &amp; Co");
    expect(svg).toContain("acme.dev");
    expect(svg).toContain("+1 sponsor<");
    expect(svg).not.toContain("<Rockets>");
    expect(svg).toContain("SPONSORED BY");
    expect(svg).toContain("Powered by");
  });
  it("wraps a long description instead of cutting it, the card growing", () => {
    const description =
      "Managed Postgres with branching, point-in-time restore and a CLI people actually enjoy using every single day of the week.";
    const short = prCardSvg({
      sponsors: [{ name: "Acme", description: "Ships", site: null, logo: null }],
    });
    const long = prCardSvg({
      sponsors: [{ name: "Acme", description, site: "acme.dev", logo: null }],
      theme: "light",
      links: { site: "https://acme.dev", yarrow: "https://yarrow.run" },
    });
    const height = (svg: string) => Number(/height="(\d+)"/.exec(svg)![1]);
    expect(long).not.toContain("…");
    expect(long).toContain("enjoy");
    expect(long).toContain("week.");
    expect(height(long)).toBeGreaterThan(height(short));
    expect(long).toContain('<a href="https://acme.dev" target="_blank">');
    expect(long).toContain('<a href="https://yarrow.run" target="_blank">');
    expect(long).toContain("#ffffff");
  });
  it("keeps only the site's host", () => {
    expect(shortSite("https://www.acme.com/pricing")).toBe("acme.com");
    expect(shortSite("not a url")).toBeNull();
  });
});
