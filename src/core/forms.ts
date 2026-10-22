import { z } from "zod";

/**
 * Legacy UI-only concept. The database has a single pool with sponsor filters;
 * the forms and demo pages drop commons/commercial in the UI step.
 */
export const poolSchema = z.enum(["commons", "commercial"]);
export type Pool = z.infer<typeof poolSchema>;

export const checkoutSchema = z
  .object({
    packId: z.enum(["starter", "builder", "sprint"]),
    pool: poolSchema,
    projectId: z.enum(["tidepool", "halyard", "loam", "kestrel"]).nullable(),
    visibility: z.enum(["public", "anonymous"]),
  })
  .superRefine((data, context) => {
    const projects = {
      tidepool: "commons",
      halyard: "commercial",
      loam: "commons",
      kestrel: "commercial",
    };
    if (data.projectId && projects[data.projectId] !== data.pool)
      context.addIssue({
        code: "custom",
        message: "Project and pool must match",
        path: ["projectId"],
      });
  });

export const projectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  repository: z
    .string()
    .trim()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/,
      "Use owner/repository",
    ),
  pool: poolSchema,
  authorizationLabel: z.string().trim().min(1).max(50),
  jiraSite: z.union([
    z.literal(""),
    z
      .string()
      .regex(
        /^[a-z0-9-]+\.atlassian\.net$/,
        "Use a dedicated .atlassian.net site",
      )
      .refine(
        (value) => !value.includes("ecoagile"),
        "Use a dedicated demo Jira site",
      ),
  ]),
  jiraJql: z.string().trim().max(500),
  capCents: z.number().int().min(100).max(5000),
  draftPullRequests: z.literal(true),
  requirePassingTests: z.literal(true),
});
export type ProjectDraft = z.infer<typeof projectSchema>;
