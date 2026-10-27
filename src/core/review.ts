import { z } from "zod";

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

export const reviewSchema = z.object({
  summary: z.string().min(1).max(8000),
  comments: z.array(reviewCommentSchema).max(50),
});
export type Review = z.infer<typeof reviewSchema>;

/** The final review as stored on the result and published on the PR. */
export interface StoredReview extends Review {
  reviewer: string;
  /** 1 when the first review had no blocking comment, 2 after a fix round. */
  rounds: number;
}

export interface StoredArtifact {
  kind: "screenshot" | "video";
  /** R2 object key. */
  key: string;
  label: string;
  contentType: string;
}

export function blockingComments(review: Review): ReviewComment[] {
  return review.comments.filter((comment) => comment.severity === "blocking");
}
