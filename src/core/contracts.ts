import { z } from "zod";

export const runKindSchema = z.enum(["implementation", "correction"]);
export type RunKind = z.infer<typeof runKindSchema>;

export const runRequestSchema = z
  .object({
    runId: z.uuid(),
    workUnitId: z.uuid(),
    kind: runKindSchema,
    // The owner's `@agent-commons <request>` text on the PR. Corrections only.
    instruction: z.string().trim().min(1).max(4000).optional(),
    // Initial reservation. It is an estimate, not a cap: the run may reserve more.
    budgetCents: z.number().int().positive(),
  })
  .refine((run) => (run.kind === "correction") === (run.instruction != null), {
    message: "Only correction runs carry an instruction",
    path: ["instruction"],
  });
export type RunRequest = z.infer<typeof runRequestSchema>;

/** Abstention reasons the platform reports on. Free text is kept in the summary. */
export const abstentionReasonSchema = z.enum([
  "ticket_unclear",
  "policy_violation",
  "provider_error",
  "sandbox_not_configured",
  "other",
]);
export type AbstentionReason = z.infer<typeof abstentionReasonSchema>;

export const runResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("pull_request"),
    actualCostCents: z.number().int().nonnegative(),
    pullRequestUrl: z
      .url()
      .regex(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/),
    summary: z.string().min(1),
    evidence: z.array(z.string()).min(1),
  }),
  z.object({
    outcome: z.literal("abstained"),
    actualCostCents: z.number().int().nonnegative(),
    reason: abstentionReasonSchema,
    summary: z.string().min(1),
    evidence: z.array(z.string()),
  }),
]);
export type RunResult = z.infer<typeof runResultSchema>;

/** The execution boundary. Never execute repository code inside a Worker. */
export interface Runner {
  execute(run: RunRequest): Promise<RunResult>;
}
