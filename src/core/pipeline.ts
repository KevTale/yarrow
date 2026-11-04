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

/** Who reviews Muse Wonder's changes, in a Claude session of its own. */
export const META_REVIEWER = "claude-opus-5-5:high";

/** Who works on a run Meta implements. */
export const metaRoles = (model: string, effort: string): PipelineRoles => ({
  implementer: `${model}:${effort}`,
  reviewer: META_REVIEWER,
});

/** Who reviews a run: never the lab that wrote it. */
export const reviewerFor = (implementer?: "claude" | "meta") =>
  implementer === "meta" ? META_REVIEWER : defaultPipelineRoles.reviewer;

/** Initial reservation per run. An estimate, not a cap: runs top up as they spend. */
export const INITIAL_RESERVATION_CENTS = 300;

const displayNames: Record<string, string> = {
  "claude-opus-5-5:high": "Claude Opus 5.5",
  "claude-opus-5-5": "Claude Opus 5.5",
  "openai-astra": "GPT Astra",
  "gpt-6-astra": "GPT Astra",
  "muse-wonder-1.0": "Muse Wonder",
  "muse-spark-1.3": "Muse Spark",
};

/** Factual attribution ("Implemented by Claude Opus 5.5"), never product branding. */
export function modelDisplayName(id: string): string {
  // "muse-wonder-1.0:high": the effort does not change the name.
  return displayNames[id] ?? displayNames[id.split(":")[0]!] ?? id;
}

/** "Claude Opus 5.5" → "Claude Opus": the name as the pitch says it. */
export function modelShortName(name: string): string {
  return name.replace(/\s+[\d.]+$/, "");
}
