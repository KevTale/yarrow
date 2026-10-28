CREATE TABLE "provider_pauses" (
	"provider" text PRIMARY KEY NOT NULL,
	"message" text NOT NULL,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"until" timestamp with time zone NOT NULL,
	CONSTRAINT "provider_pause_provider" CHECK ("provider_pauses"."provider" in ('anthropic', 'openai'))
);
--> statement-breakpoint
ALTER TABLE "provider_pauses" ENABLE ROW LEVEL SECURITY;