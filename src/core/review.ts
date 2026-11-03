import { z } from "zod";
import type { Criterion } from "./contracts";

/** Only `blocking` comments trigger the implementer's fix round. */
export const severitySchema = z.enum(["blocking", "suggestion", "nit"]);
export type Severity = z.infer<typeof severitySchema>;

export const reviewCommentSchema = z.object({
  severity: severitySchema,
  path: z.string().min(1).optional(),
  line: z.number().int().positive().optional(),
  body: z.string().min(1).max(4000),
});
export type ReviewComment = z.infer<typeof reviewCommentSchema>;

/**
 * A review as Yarrow keeps it. `changed` is the pull request as it stands,
 * told by the reviewer: the one text the owner reads under "What changed"
 * (decided 2026-10-27). Reviews written before have none, only a summary
 * in the reviewer's own voice; a new one's summary is its `changed`, so
 * the fix round, the conversation and the notes read one text either way.
 * `headline` is the same in one line, the ticket's title on its row (decided
 * 2026-10-31); not understood, it is dropped and the title stays.
 */
export const storedReviewFields = z.object({
  changed: z.string().min(1).max(8000).optional(),
  headline: z.string().trim().min(1).max(120).optional().catch(undefined),
  summary: z.string().min(1).max(8000),
  comments: z.array(reviewCommentSchema).max(50),
  // Acceptance criteria the implementer ticked that the change does not
  // deliver, as it listed them. Not understood, it is dropped.
  unmet: z.array(z.string().min(1)).max(10).optional().catch(undefined),
});

/** The reviewer's answer: `changed`, or a summary as before. */
export const reviewSchema = storedReviewFields
  .extend({
    changed: z.string().trim().min(1).max(8000).optional().catch(undefined),
    summary: z.string().trim().min(1).max(8000).optional(),
  })
  .refine((review) => review.changed || review.summary, {
    message: "The review says nothing",
  })
  .transform(({ summary, ...review }) => ({
    ...review,
    summary: (summary ?? review.changed)!,
  }));
export type Review = z.infer<typeof reviewSchema>;

/** The final review as stored on the result and published on the PR. */
export interface StoredReview extends Review {
  reviewer: string;
  /** 1 when the first review had no blocking comment, 2 after a fix round. */
  rounds: number;
}

export interface StoredArtifact {
  /** A presentation's key is its timeline (src/core/presentation.ts). */
  kind: "screenshot" | "video" | "presentation";
  /** R2 object key. */
  key: string;
  label: string;
  contentType: string;
  /** A presentation's still, shown before it plays and in the PR. */
  poster?: string;
}

export function blockingComments(review: Review): ReviewComment[] {
  return review.comments.filter((comment) => comment.severity === "blocking");
}

const sameCriterion = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[.!\s]+$/, "");

/**
 * The implementer's criteria as the final review leaves them: one the
 * reviewer found not delivered is not met, whatever the implementer said.
 */
export function reviewedCriteria(
  criteria: Criterion[],
  review: Review,
): Criterion[] {
  const unmet = new Set((review.unmet ?? []).map(sameCriterion));
  return criteria.map((item) =>
    unmet.has(sameCriterion(item.criterion))
      ? { ...item, status: "unmet" }
      : item,
  );
}
