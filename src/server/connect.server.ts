import { z } from "zod";
import { repositorySchema } from "@/core/forms";
import { ticketSources } from "@/core/ticket-link";

/** What the visitor asked for on the landing, kept across the GitHub install. */
export const CONNECT_COOKIE = "yarrow_connect";

export const connectIntentSchema = z.object({
  repository: repositorySchema.optional(),
  issue: z.coerce.number().int().positive().max(10_000_000).optional(),
  source: z
    .enum(ticketSources.map((source) => source.id) as [string, ...string[]])
    .optional(),
});
export type ConnectIntent = z.infer<typeof connectIntentSchema>;

export function readIntent(value: string | null | undefined): ConnectIntent {
  if (!value) return {};
  try {
    const parsed = connectIntentSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}
