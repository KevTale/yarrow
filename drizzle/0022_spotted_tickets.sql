CREATE TABLE "spotted_tickets" (
	"work_unit_id" uuid NOT NULL,
	"note" text NOT NULL,
	"ticket_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "spotted_tickets_work_unit_id_note_pk" PRIMARY KEY("work_unit_id","note")
);
--> statement-breakpoint
ALTER TABLE "spotted_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "spotted_tickets" ADD CONSTRAINT "spotted_tickets_work_unit_id_work_units_id_fk" FOREIGN KEY ("work_unit_id") REFERENCES "public"."work_units"("id") ON DELETE no action ON UPDATE no action;