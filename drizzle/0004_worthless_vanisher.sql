CREATE TYPE "public"."github_task_kind" AS ENUM('setup_project', 'label_issue');--> statement-breakpoint
CREATE TABLE "github_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "github_task_kind" NOT NULL,
	"issue_number" integer DEFAULT 0 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"done_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_task_once" UNIQUE("project_id","kind","issue_number")
);
--> statement-breakpoint
ALTER TABLE "github_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "github_tasks" ADD CONSTRAINT "github_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "github_tasks_pending" ON "github_tasks" USING btree ("done_at","created_at");