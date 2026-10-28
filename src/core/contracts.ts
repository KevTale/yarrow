import { z } from "zod";
import { reviewSchema } from "./review";

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

const storedReviewSchema = reviewSchema.extend({
  reviewer: z.string().min(1),
  rounds: z.number().int().min(1).max(2),
});
const artifactSchema = z.object({
  kind: z.enum(["screenshot", "video"]),
  key: z.string().min(1),
  label: z.string().min(1).max(200),
  contentType: z.string().min(1),
});

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
