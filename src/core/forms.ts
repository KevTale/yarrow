import { z } from "zod";
import { amountCentsSchema } from "./packs";

/** Project categories, declared by owners and used by sponsors to opt out. */
export const categories = [
  "saas",
  "developer-tools",
  "open-source",
  "game",
  "ai",
  "mobile",
  "e-commerce",
  "fintech",
  "crypto",
  "education",
  "health",
  "research",
  "other",
] as const;
export const categorySchema = z.enum(categories);

export const visibilitySchema = z.enum(["public", "listed", "hidden"]);
export type Visibility = z.infer<typeof visibilitySchema>;

const tag = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9.+#-]{0,31}$/, "Use short lowercase tags");

export const repositorySchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/, "Use owner/repository");

/** "acme/webapp" → "webapp": a project is named after its repository. */
export const repoName = (repository: string) =>
  repository.split("/")[1] ?? repository;

export const projectFormSchema = z.object({
  /** Ignored: the name always follows the repository (decided 2026-10-08). */
  name: z.string().optional(),
  description: z.string().trim().max(500),
  productUrl: z.union([z.literal(""), z.url().max(300)]),
  repository: repositorySchema,
  visibility: visibilitySchema,
  categories: z.array(categorySchema).min(1).max(5),
  stacks: z.array(tag).max(12),
  authorizationLabel: z
    .string()
    .trim()
    .min(1)
    .max(50)
    .regex(/^[^,]+$/, "One label"),
});
export type ProjectForm = z.infer<typeof projectFormSchema>;

const command = z.string().trim().max(500);
const envKey = /^[A-Z_][A-Z0-9_]*$/;

/** How to run the app for screenshots and video. Non-secret values only. */
export const runConfigSchema = z.object({
  setupCommand: command,
  seedCommand: command,
  startCommand: command,
  appPort: z.number().int().min(1).max(65535).nullable(),
  env: z
    .record(z.string().regex(envKey), z.string().max(2000))
    .refine((env) => Object.keys(env).length <= 50, "Too many variables"),
});
export type RunConfig = z.infer<typeof runConfigSchema>;

/** A test or staging secret. The value goes to the provider vault, never to our DB. */
export const projectSecretSchema = z.object({
  name: z.string().regex(envKey, "Use UPPER_SNAKE_CASE"),
  value: z.string().min(1).max(4000),
  allowedHost: z
    .string()
    .trim()
    .toLowerCase()
    .regex(
      /^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/,
      "Use a host like api.stripe.com",
    ),
});

export const sponsorFiltersSchema = z.object({
  publicName: z.string().trim().min(2).max(60).nullable(),
  mode: z.enum(["all_except", "only"]),
  includeHidden: z.boolean(),
  excludedCategories: z.array(categorySchema).max(categories.length),
  requiredStacks: z.array(tag).max(20),
  selectedProjectIds: z.array(z.uuid()).max(500),
});
export type SponsorFilters = z.infer<typeof sponsorFiltersSchema>;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => value || null);

/**
 * A logo from a form: undefined keeps it, null removes it, a data URL is a
 * new upload (drawn small by the browser), an /images/ URL is unchanged.
 */
export const logoSchema = z.string().max(140_000).nullable().optional();

/** A sponsor's description: printed whole on their pull request card. */
export const DESCRIPTION_MAX = 160;

/** What a sponsor shows on the boards. NULL publicName means anonymous. */
export const sponsorProfileSchema = z.object({
  publicName: z.string().trim().min(2).max(60).nullable(),
  tagline: optionalText(80),
  description: optionalText(DESCRIPTION_MAX),
  websiteUrl: z
    .union([z.literal(""), z.url({ protocol: /^https$/ }).max(300)])
    .nullable()
    .transform((value) => value || null),
  logo: logoSchema,
});
export type SponsorProfile = z.infer<typeof sponsorProfileSchema>;

export const checkoutSchema = z.object({
  amountCents: amountCentsSchema,
  profile: sponsorProfileSchema,
  // Compute starts immediately: EU consumers waive the 14-day withdrawal right.
  withdrawalWaiver: z.literal(true, {
    error: "Please confirm that compute starts immediately.",
  }),
});
