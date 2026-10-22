import {
  runRequestSchema,
  type Runner,
  type RunRequest,
  type RunResult,
} from "../core/contracts";

/**
 * Explicit stub, replaced in the runner step by ClaudeManagedAgentsRunner
 * (implements) and OpenAIAgentsRunner (reviews). No provider call, no
 * credentials, no shell execution and no paid API call.
 */
export class CloudflareSandboxRunner implements Runner {
  async execute(run: RunRequest): Promise<RunResult> {
    runRequestSchema.parse(run);
    return {
      outcome: "abstained",
      reason: "sandbox_not_configured",
      summary:
        "Provider runners are not connected in this scaffold. No compute was spent.",
      actualCostCents: 0,
      evidence: ["runner:stub", `run:${run.runId}`, `kind:${run.kind}`],
    };
  }
}
