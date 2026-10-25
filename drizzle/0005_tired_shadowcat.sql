CREATE TYPE "public"."model_role" AS ENUM('implementer', 'reviewer');--> statement-breakpoint
CREATE TABLE "run_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"role" "model_role" NOT NULL,
	"model" text NOT NULL,
	"effort" text,
	"sessions" integer DEFAULT 1 NOT NULL,
	"seconds" integer,
	"seconds_exact" boolean DEFAULT false NOT NULL,
	"input_tokens" integer,
	"cached_input_tokens" integer,
	"output_tokens" integer,
	"cost_cents" integer NOT NULL,
	"cost_exact" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_model_role" UNIQUE("agent_run_id","role")
);
--> statement-breakpoint
ALTER TABLE "run_models" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "run_models" ADD CONSTRAINT "run_models_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;