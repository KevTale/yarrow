/**
 * The platform offer: one model implements, another lab's model reviews.
 * Model IDs are server-side configuration so they can follow model releases.
 */
export interface PipelineRoles {
  implementer: string;
  reviewer: string;
}

export const defaultPipelineRoles: PipelineRoles = {
  implementer: "claude-opus-5-5:high",
  reviewer: "openai-astra",
};
