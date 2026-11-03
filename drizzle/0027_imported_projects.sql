ALTER TABLE "projects" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
UPDATE "projects" SET "imported_at" = "created_at";
