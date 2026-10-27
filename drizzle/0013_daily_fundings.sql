ALTER TYPE "public"."credit_source" ADD VALUE 'direct';--> statement-breakpoint
CREATE TABLE "daily_fundings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_funding_positive" CHECK ("daily_fundings"."amount_cents" > 0)
);
--> statement-breakpoint
ALTER TABLE "daily_fundings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contributions" ADD COLUMN "direct_key" text;--> statement-breakpoint
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_direct_key_unique" UNIQUE("direct_key");