CREATE TABLE "run_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"actor" text NOT NULL,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_activity_external" UNIQUE("agent_run_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "run_activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "run_activity_reads" (
	"agent_run_id" uuid PRIMARY KEY NOT NULL,
	"read_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "run_activity_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD COLUMN "implementer_session" text;--> statement-breakpoint
ALTER TABLE "run_activity" ADD CONSTRAINT "run_activity_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_activity_reads" ADD CONSTRAINT "run_activity_reads_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "run_activity_run" ON "run_activity" USING btree ("agent_run_id","at");