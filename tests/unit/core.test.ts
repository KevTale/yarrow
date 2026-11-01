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
import {
  describeFailure,
  isGithubRefusal,
  outOfCredit,
} from "../../src/core/failures";
import { defaultPipelineRoles } from "../../src/core/pipeline";
import {
  estimateBreakdown,
  marginCents,
  pullRequestCost,
  pullRequestsFor,
  settleBreakdown,
} from "../../src/core/pricing";
import { planDispatch, type DispatchCandidate } from "../../src/core/queue";
import type { Criterion } from "../../src/core/contracts";
import {
  blockingComments,
  reviewedCriteria,
  reviewSchema,
} from "../../src/core/review";
import { fixTask, reviewTask } from "../../src/runner/prompts";
import { reviewSection } from "../../src/runner/pull-request";

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
  it("prices a pull request from the hypothesis toward what runs cost", () => {
    expect(pullRequestCost(0, 0)).toBe(250);
    // $12.60 spent for 8 pull requests: $1.58 each, still near the hypothesis.
    expect(pullRequestCost(1_260, 8)).toBe(209);
    expect(pullRequestCost(100_000, 1_000)).toBe(101);
    expect(pullRequestsFor(7_100, 209)).toBe(34);
    expect(pullRequestsFor(100, 209)).toBe(1);
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
        `<a href="https://yarrow.run/out/${sponsor}"><img alt="Sponsored by Northwind, powered by Yarrow" src="https://yarrow.run/pr-card/${id}"></a>`,
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
      `<a href="https://yarrow.run/out/${sponsor}"><img`,
    );
    // No website to send a click to: the card opens the run.
    const siteless = pullRequestFooter({
      roles: defaultPipelineRoles,
      sponsors: [{ name: "Northwind", publicId: sponsor, website: false }],
      runUrl: `https://yarrow.run/runs/${id}`,
    });
    expect(siteless).toContain(`<a href="https://yarrow.run/runs/${id}"><img`);
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
  it("puts the review in the pull request under its reviewer's name", () => {
    const section = reviewSection({
      ...review,
      comments: [
        ...review.comments,
        { severity: "suggestion", path: "b.ts", line: 8, body: "Cache it" },
      ],
    });
    expect(section).toBe(
      "## Review by GPT Astra\n\nSolid change.\n\n**Still to fix**\n\n- `a.ts:3`: Null check\n\n- `b.ts:8`: Cache it",
    );
    // Fixed after one round: the reviewer's words tell it, nothing is left.
    expect(
      reviewSection({
        ...review,
        summary:
          "I tried damaged saves: at first some replaced the game, I sent it back and they are now refused.",
        comments: [],
      }),
    ).toBe(
      "## Review by GPT Astra\n\nI tried damaged saves: at first some replaced the game, I sent it back and they are now refused.",
    );
  });

  it("unticks a criterion the final review finds not delivered", () => {
    const criteria: Criterion[] = [
      {
        criterion: "Damaged text leaves the game untouched",
        status: "met",
        proof: "app",
      },
      { criterion: "Export copies the save", status: "met", proof: "app" },
    ];
    expect(
      reviewedCriteria(criteria, {
        ...review,
        unmet: ["damaged text leaves the game untouched."],
      }),
    ).toEqual([{ ...criteria[0], status: "unmet" }, criteria[1]]);
    expect(reviewedCriteria(criteria, review)).toEqual(criteria);
  });

  it("reads an unmet list it cannot use as none", () => {
    expect(
      reviewSchema.parse({ summary: "Ok.", comments: [], unmet: [{ x: 1 }] })
        .unmet,
    ).toBeUndefined();
  });

  it("shows the reviewer its first review on the second look", () => {
    const ticket = {
      url: "https://github.com/a/b/issues/3",
      title: "Export a save",
      body: "",
      source: "github",
    };
    const first = reviewTask({
      ticket,
      implementerSummary: "Done.",
      verification: [],
    });
    expect(first).not.toContain("second look");
    expect(first).toContain("Before or after merging: (nothing)");
    const warned = reviewTask({
      ticket,
      implementerSummary: "Done.",
      verification: [],
      risks: ["Rotate the leaked key"],
    });
    expect(warned).toContain("Before or after merging: Rotate the leaked key");
    const second = reviewTask({
      ticket,
      implementerSummary: "Done.",
      verification: [],
      earlier: review,
    });
    expect(second).toContain("This is your second look");
    expect(second).toContain("- Null check");
    expect(second).not.toContain("Typo in the title");
    expect(fixTask(review)).toContain("the whole pull request");
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
    expect(svg).toContain("Sponsored by");
    expect(svg).toContain("Powered by");
  });
  it("wraps a long description instead of cutting it, the card growing", () => {
    const description =
      "Managed Postgres with branching, point-in-time restore and a CLI people actually enjoy using every single day of the week.";
    const short = prCardSvg({
      sponsors: [
        { name: "Acme", description: "Ships", site: null, logo: null },
      ],
    });
    const long = prCardSvg({
      sponsors: [{ name: "Acme", description, site: "acme.dev", logo: null }],
      links: { site: "https://acme.dev", yarrow: "https://yarrow.run" },
    });
    const height = (svg: string) => Number(/height="(\d+)"/.exec(svg)![1]);
    expect(long).not.toContain("…");
    expect(long).toContain("enjoy");
    expect(long).toContain("week.");
    expect(height(long)).toBeGreaterThan(height(short));
    expect(long).toContain('<a href="https://acme.dev" target="_blank">');
    expect(long).toContain('<a href="https://yarrow.run" target="_blank">');
    expect(long).toContain("#15161a");
  });
  it("keeps only the site's host", () => {
    expect(shortSite("https://www.acme.com/pricing")).toBe("acme.com");
    expect(shortSite("https://x.com/xKevinTale")).toBe("x.com/xKevinTale");
    expect(shortSite("https://www.linkedin.com/in/kevin/?trk=a")).toBe(
      "linkedin.com/in/kevin",
    );
    expect(shortSite("https://x.com/")).toBe("x.com");
    expect(shortSite("not a url")).toBeNull();
  });
});

describe("run failures", () => {
  const refused =
    'GitHub POST /repos/KevTale/hakai/git/trees failed (403): {"message":"Resource not accessible by integration","status":"403"}';
  it("names the Workflows permission when a CI file was refused", () => {
    expect(
      describeFailure(refused, ["deno.json", ".github/workflows/check.yml"]),
    ).toEqual({
      reason: "github_refused",
      summary:
        "GitHub refused to write .github/workflows/check.yml: the Yarrow app needs the Workflows permission on this repository.",
    });
    expect(describeFailure(refused, ["deno.json"]).summary).toContain(
      "missing a permission",
    );
    // As Workflows hands it back, the error's name in front.
    expect(
      describeFailure(`NonRetryableError: ${refused}`, [
        ".github/workflows/check.yml",
      ]).reason,
    ).toBe("github_refused");
  });
  it("never retries a GitHub refusal, only the rest", () => {
    expect(isGithubRefusal(refused)).toBe(true);
    expect(
      isGithubRefusal("GitHub POST /repos/a/b/pulls failed (502): Bad gateway"),
    ).toBe(false);
    expect(
      isGithubRefusal("Too many subrequests by single Worker invocation"),
    ).toBe(false);
  });
  it("tells the providers from Yarrow itself", () => {
    expect(
      describeFailure(
        'Anthropic POST /sessions failed (403): {"type":"forbidden"}',
      ).reason,
    ).toBe("provider_error");
    expect(
      describeFailure(
        'Failed query: select "reserved_cents", "status" from "agent_runs"',
      ),
    ).toEqual({
      reason: "platform_error",
      summary:
        "Yarrow stopped on an internal error before the pull request could open.",
    });
  });
  it("tells Yarrow's empty provider accounts from other provider errors", () => {
    const anthropic =
      'Anthropic POST /sessions failed (400): {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."}}';
    const limit =
      "Anthropic session error: You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.";
    const openai =
      'OpenAI POST / failed (429): {"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}';
    expect(outOfCredit(anthropic)).toBe("anthropic");
    expect(outOfCredit(`NonRetryableError: ${limit}`)).toBe("anthropic");
    expect(outOfCredit(openai)).toBe("openai");
    expect(
      outOfCredit(
        'OpenAI POST / failed (429): {"error":{"type":"requests","code":"rate_limit_exceeded"}}',
      ),
    ).toBeNull();
    expect(
      outOfCredit(
        'Anthropic POST /sessions failed (403): {"type":"forbidden"}',
      ),
    ).toBeNull();
    // A sponsor's ticket that mentions billing is not Yarrow's account.
    expect(
      outOfCredit("GitHub POST /repos/a/b failed (422): quota"),
    ).toBeNull();
    expect(describeFailure(openai)).toEqual({
      reason: "provider_out_of_credit",
      summary: expect.stringContaining("OpenAI account ran out of credit"),
    });
  });
});
