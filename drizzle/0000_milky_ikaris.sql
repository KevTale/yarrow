CREATE TYPE "public"."credit_source" AS ENUM('stripe', 'promo');--> statement-breakpoint
CREATE TYPE "public"."ledger_kind" AS ENUM('credit', 'reserve', 'debit', 'release');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'member');--> statement-breakpoint
CREATE TYPE "public"."outcome" AS ENUM('pull_request', 'abstained');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'settled', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."pull_request_state" AS ENUM('open', 'merged', 'closed');--> statement-breakpoint
CREATE TYPE "public"."run_kind" AS ENUM('implementation', 'correction');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'completed', 'abstained');--> statement-breakpoint
CREATE TYPE "public"."sponsor_mode" AS ENUM('all_except', 'only');--> statement-breakpoint
CREATE TYPE "public"."tracker" AS ENUM('github', 'linear', 'jira', 'trello');--> statement-breakpoint
CREATE TYPE "public"."visibility" AS ENUM('public', 'listed', 'hidden');--> statement-breakpoint
CREATE TYPE "public"."work_status" AS ENUM('queued', 'running', 'delivered', 'abstained', 'closed');--> statement-breakpoint
CREATE TABLE "account_members" (
	"account_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_members_account_id_user_id_pk" PRIMARY KEY("account_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "account_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"kind" "run_kind" DEFAULT 'implementation' NOT NULL,
	"instruction" text,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"debited_cents" integer DEFAULT 0 NOT NULL,
	"uncovered_cents" integer DEFAULT 0 NOT NULL,
	"implementer" text NOT NULL,
	"reviewer" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "run_money" CHECK ("agent_runs"."reserved_cents" >= 0 AND "agent_runs"."debited_cents" >= 0 AND "agent_runs"."uncovered_cents" >= 0 AND "agent_runs"."debited_cents" <= "agent_runs"."reserved_cents"),
	CONSTRAINT "correction_instruction" CHECK (("agent_runs"."kind" = 'correction') = ("agent_runs"."instruction" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" "credit_source" DEFAULT 'stripe' NOT NULL,
	"payment_status" "payment_status" DEFAULT 'pending' NOT NULL,
	"stripe_checkout_id" text,
	"amount_cents" integer NOT NULL,
	"tax_cents" integer DEFAULT 0 NOT NULL,
	"fee_cents" integer DEFAULT 0 NOT NULL,
	"margin_cents" integer DEFAULT 0 NOT NULL,
	"credit_cents" integer NOT NULL,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"debited_cents" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contributions_stripe_checkout_id_unique" UNIQUE("stripe_checkout_id"),
	CONSTRAINT "valid_credit" CHECK ("contributions"."amount_cents" >= 0 AND "contributions"."tax_cents" >= 0 AND "contributions"."fee_cents" >= 0 AND "contributions"."margin_cents" >= 0 AND "contributions"."credit_cents" >= 0 AND "contributions"."reserved_cents" >= 0 AND "contributions"."debited_cents" >= 0 AND "contributions"."reserved_cents" + "contributions"."debited_cents" <= "contributions"."credit_cents"),
	CONSTRAINT "stripe_breakdown" CHECK ("contributions"."source" <> 'stripe' OR "contributions"."tax_cents" + "contributions"."fee_cents" + "contributions"."margin_cents" + "contributions"."credit_cents" <= "contributions"."amount_cents"),
	CONSTRAINT "settled_before_spend" CHECK ("contributions"."payment_status" = 'settled' OR ("contributions"."reserved_cents" = 0 AND "contributions"."debited_cents" = 0))
);
--> statement-breakpoint
ALTER TABLE "contributions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"account_id" uuid,
	"project_id" uuid,
	"user_id" uuid,
	"work_unit_id" uuid,
	"agent_run_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_type" CHECK ("events"."type" ~ '^[a-z_]+(\.[a-z_]+)+$')
);
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"contribution_id" uuid NOT NULL,
	"agent_run_id" uuid,
	"kind" "ledger_kind" NOT NULL,
	"amount_cents" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "ledger_nonnegative" CHECK ("ledger_entries"."amount_cents" >= 0)
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_run_configs" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"setup_command" text,
	"seed_command" text,
	"start_command" text,
	"app_port" integer,
	"env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "project_run_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "project_secrets" (
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"provider_credential_id" text NOT NULL,
	"allowed_host" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_secrets_project_id_name_pk" PRIMARY KEY("project_id","name"),
	CONSTRAINT "secret_name" CHECK ("project_secrets"."name" ~ '^[A-Z_][A-Z0-9_]*$')
);
--> statement-breakpoint
ALTER TABLE "project_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"product_url" text,
	"visibility" "visibility" DEFAULT 'listed' NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"stacks" text[] DEFAULT '{}' NOT NULL,
	"repository" text NOT NULL,
	"github_installation_id" text,
	"authorization_label" text DEFAULT 'agent-commons' NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_repository" UNIQUE("repository")
);
--> statement-breakpoint
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_unit_id" uuid NOT NULL,
	"url" text NOT NULL,
	"state" "pull_request_state" DEFAULT 'open' NOT NULL,
	"rejection_reason" text,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "pull_requests_work_unit_id_unique" UNIQUE("work_unit_id"),
	CONSTRAINT "pull_requests_url_unique" UNIQUE("url"),
	CONSTRAINT "pull_request_closure" CHECK (("pull_requests"."state" = 'open') = ("pull_requests"."closed_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "pull_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_run_id" uuid NOT NULL,
	"outcome" "outcome" NOT NULL,
	"summary" text NOT NULL,
	"pull_request_url" text,
	"abstention_reason" text,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "results_agent_run_id_unique" UNIQUE("agent_run_id"),
	CONSTRAINT "outcome_evidence" CHECK (("results"."outcome" = 'pull_request' AND "results"."pull_request_url" IS NOT NULL AND "results"."abstention_reason" IS NULL) OR ("results"."outcome" = 'abstained' AND "results"."abstention_reason" IS NOT NULL AND "results"."pull_request_url" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "run_fundings" (
	"agent_run_id" uuid NOT NULL,
	"contribution_id" uuid NOT NULL,
	"reserved_cents" integer DEFAULT 0 NOT NULL,
	"debited_cents" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "run_fundings_agent_run_id_contribution_id_pk" PRIMARY KEY("agent_run_id","contribution_id"),
	CONSTRAINT "funding_money" CHECK ("run_fundings"."reserved_cents" >= 0 AND "run_fundings"."debited_cents" >= 0 AND "run_fundings"."debited_cents" <= "run_fundings"."reserved_cents")
);
--> statement-breakpoint
ALTER TABLE "run_fundings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sponsor_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"public_name" text,
	"mode" "sponsor_mode" DEFAULT 'all_except' NOT NULL,
	"include_hidden" boolean DEFAULT false NOT NULL,
	"excluded_categories" text[] DEFAULT '{}' NOT NULL,
	"required_stacks" text[] DEFAULT '{}' NOT NULL,
	"founding_sponsor" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sponsor_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sponsor_project_selections" (
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_project_selections_user_id_project_id_pk" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
ALTER TABLE "sponsor_project_selections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "work_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"source" "tracker" NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"authorized" boolean DEFAULT false NOT NULL,
	"status" "work_status" DEFAULT 'queued' NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_unit_external" UNIQUE("project_id","source","external_id")
);
--> statement-breakpoint
ALTER TABLE "work_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_members" ADD CONSTRAINT "account_members_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "public"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_run_configs" ADD CONSTRAINT "project_run_configs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_secrets" ADD CONSTRAINT "project_secrets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "public"."work_units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "results" ADD CONSTRAINT "results_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_fundings" ADD CONSTRAINT "run_fundings_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_fundings" ADD CONSTRAINT "run_fundings_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "public"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_project_selections" ADD CONSTRAINT "sponsor_project_selections_user_id_sponsor_profiles_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."sponsor_profiles"("user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_project_selections" ADD CONSTRAINT "sponsor_project_selections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_units" ADD CONSTRAINT "work_units_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "runs_per_work_unit" ON "agent_runs" USING btree ("work_unit_id");--> statement-breakpoint
CREATE INDEX "runs_status" ON "agent_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contributions_user" ON "contributions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "contributions_spendable" ON "contributions" USING btree ("payment_status","created_at");--> statement-breakpoint
CREATE INDEX "events_type_time" ON "events" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "ledger_contribution" ON "ledger_entries" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "ledger_run" ON "ledger_entries" USING btree ("agent_run_id");--> statement-breakpoint
CREATE INDEX "projects_account" ON "projects" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "fundings_contribution" ON "run_fundings" USING btree ("contribution_id");--> statement-breakpoint
CREATE INDEX "work_units_queue" ON "work_units" USING btree ("status","queued_at");