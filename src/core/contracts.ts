import { z } from "zod";
import { storedReviewFields } from "./review";

export const runKindSchema = z.enum(["implementation", "correction"]);
export type RunKind = z.infer<typeof runKindSchema>;

export const runRequestSchema = z
  .object({
    runId: z.uuid(),
    workUnitId: z.uuid(),
    kind: runKindSchema,
    // The owner's `@yarrow-run <request>` text on the PR. Corrections only.
    instruction: z.string().trim().min(1).max(4000).optional(),
    // The queued request this correction run consumes. Corrections only.
    correctionRequestId: z.uuid().optional(),
    // Initial reservation. It is an estimate, not a cap: the run may reserve more.
    budgetCents: z.number().int().positive(),
  })
  .refine(
    (run) =>
      (run.kind === "correction") === (run.instruction != null) &&
      (run.kind === "correction") === (run.correctionRequestId != null),
    {
      message: "Only correction runs carry an instruction and a request",
      path: ["instruction"],
    },
  );
export type RunRequest = z.infer<typeof runRequestSchema>;

/** Abstention reasons the platform reports on. Free text is kept in the summary. */
export const abstentionReasonSchema = z.enum([
  "ticket_unclear",
  "policy_violation",
  // Anthropic or OpenAI failed.
  "provider_error",
  // Yarrow's own account at Anthropic or OpenAI ran out of credit: the
  // ticket goes back to the queue and dispatch pauses.
  "provider_out_of_credit",
  // GitHub refused a write: a permission the app lacks, out of reach.
  "github_refused",
  // Yarrow itself failed (Cloudflare, the database).
  "platform_error",
  "other",
]);
export type AbstentionReason = z.infer<typeof abstentionReasonSchema>;

const storedReviewSchema = storedReviewFields.extend({
  reviewer: z.string().min(1),
  rounds: z.number().int().min(1).max(2),
});
const artifactSchema = z.object({
  kind: z.enum(["screenshot", "video", "presentation"]),
  key: z.string().min(1),
  label: z.string().min(1).max(200),
  contentType: z.string().min(1),
  poster: z.string().min(1).optional(),
});

/**
 * One thing the ticket asks, as a product manager would tick it: met,
 * unmet, or not checked here; how it was shown (seen in the running app,
 * by an automated test, by a real request); why, when it is not met.
 */
export const criterionSchema = z.object({
  criterion: z.string().min(1),
  status: z.enum(["met", "unmet", "unchecked"]),
  proof: z.enum(["app", "test", "request", "none"]).default("none"),
  note: z.string().optional(),
});
export type Criterion = z.infer<typeof criterionSchema>;

/**
 * What the implementer reported besides its summary, each in its place in
 * the builder's row: the ticket's acceptance criteria, the checks it could
 * not run, what the owner must act on, what it saw outside the ticket.
 * After a correction, the summary of the whole pull request as it stands.
 */
export const resultDetailsSchema = z.object({
  /** What the ticket asks, in the owner's words: the implementation's only. */
  ask: z.string().optional(),
  pullRequestSummary: z.string().optional(),
  /** Absent on runs delivered before acceptance criteria (2026-10-22). */
  criteria: z.array(criterionSchema).optional(),
  notVerified: z.array(z.string()).default([]),
  risks: z.array(z.string()).default([]),
  spotted: z.array(z.string()).default([]),
});
export type ResultDetails = z.infer<typeof resultDetailsSchema>;

export const runResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("pull_request"),
    actualCostCents: z.number().int().nonnegative(),
    pullRequestUrl: z
      .url()
      .regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/),
    pullRequestNumber: z.number().int().positive(),
    branch: z.string().min(1),
    summary: z.string().min(1),
    evidence: z.array(z.string()).min(1),
    review: storedReviewSchema.optional(),
    artifacts: z.array(artifactSchema).default([]),
    details: resultDetailsSchema.optional(),
  }),
  z.object({
    outcome: z.literal("abstained"),
    actualCostCents: z.number().int().nonnegative(),
    reason: abstentionReasonSchema,
    summary: z.string().min(1),
    evidence: z.array(z.string()),
    review: storedReviewSchema.optional(),
    artifacts: z.array(artifactSchema).default([]),
  }),
]);
export type RunResult = z.input<typeof runResultSchema>;

/**
 * How the implementer got a project's app running in its sandbox, written
 * by the agent after a run that did, and given to the next run so it does
 * not search again. Never secrets: the sandbox has none to write down.
 */
export const appRecipeSchema = z.object({
  /** "build": built and served as in production; "dev": the dev server. */
  mode: z.enum(["build", "dev"]),
  /** Shell commands from a fresh checkout to the app answering, in order. */
  steps: z.array(z.string().trim().min(1).max(2000)).min(1).max(30),
  /** Where the app answers, with the page worth opening first. */
  url: z.string().trim().min(1).max(500),
  /** How a signed-in session is obtained, when the app needs one. */
  signIn: z.string().trim().max(2000).nullable().default(null),
  /**
   * The app as it was, beside it: from /tmp/before, a worktree of the base
   * branch, with the app above running, to it answering on its own port.
   */
  before: z
    .object({
      steps: z.array(z.string().trim().min(1).max(2000)).min(1).max(15),
      url: z.string().trim().min(1).max(500),
    })
    .nullable()
    .default(null)
    .catch(null),
  /** What tripped the agent, so the next run does not trip on it. */
  notes: z.array(z.string().trim().min(1).max(500)).max(10).default([]),
});
export type AppRecipe = z.infer<typeof appRecipeSchema>;
