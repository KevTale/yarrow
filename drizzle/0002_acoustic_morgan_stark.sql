ALTER TABLE "sponsor_profiles" ADD COLUMN "public_id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "sponsor_profiles" ADD COLUMN "tagline" text;--> statement-breakpoint
ALTER TABLE "sponsor_profiles" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "sponsor_profiles" ADD COLUMN "website_url" text;--> statement-breakpoint
ALTER TABLE "sponsor_profiles" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "sponsor_profiles" ADD CONSTRAINT "sponsor_profiles_public_id_unique" UNIQUE("public_id");