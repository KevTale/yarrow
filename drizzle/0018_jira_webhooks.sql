ALTER TABLE "tracker_connections" ADD COLUMN "webhook_id" text;--> statement-breakpoint
ALTER TABLE "tracker_connections" ADD COLUMN "webhook_filter" text;--> statement-breakpoint
ALTER TABLE "tracker_connections" ADD COLUMN "webhook_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tracker_connections" ADD COLUMN "webhook_error" text;