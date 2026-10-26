/**
 * The platform offer: one model implements, another lab's model reviews.
 * Model IDs are server-side configuration so they can follow model releases.
 */
export interface PipelineRoles {
  implementer: string;
  reviewer: string;
}

/** Reasoning level asked of the reviewer (Claude's is set on the agent). */
export const defaultReviewerEffort = "high";

/** What one model did on a run, shown on the boards and dashboards. */
export interface RunModelUsage {
  role: "implementer" | "reviewer";
  model: string;
  effort: string | null;
  sessions: number;
  seconds: number | null;
  secondsExact: boolean;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costCents: number;
  costExact: boolean;
}

export const defaultPipelineRoles: PipelineRoles = {
  implementer: "claude-opus-5-5:high",
  reviewer: "openai-astra",
};

/** Initial reservation per run. An estimate, not a cap: runs top up as they spend. */
export const INITIAL_RESERVATION_CENTS = 300;

const displayNames: Record<string, string> = {
  "claude-opus-5-5:high": "Claude Opus 5.5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "openai-astra": "GPT Astra",
  "gpt-6-astra": "GPT Astra",
};

/** Factual attribution ("Implemented by Claude Opus 5.5"), never product branding. */
export function modelDisplayName(id: string): string {
  return displayNames[id] ?? id;
}
