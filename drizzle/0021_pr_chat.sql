CREATE TYPE "public"."chat_author" AS ENUM('builder', 'agent');--> statement-breakpoint
CREATE TYPE "public"."chat_status" AS ENUM('pending', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "chat_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"author" "chat_author" NOT NULL,
	"user_id" uuid,
	"body" text DEFAULT '' NOT NULL,
	"status" "chat_status" DEFAULT 'done' NOT NULL,
	"change" text,
	"correction_request_id" uuid,
	"usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "public"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_correction_request_id_correction_requests_id_fk" FOREIGN KEY ("correction_request_id") REFERENCES "public"."correction_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_messages_unit" ON "chat_messages" USING btree ("work_unit_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_messages_user" ON "chat_messages" USING btree ("user_id","created_at");