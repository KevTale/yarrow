CREATE TABLE "try_days" (
	"day" date PRIMARY KEY NOT NULL,
	"turns" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "try_days" ENABLE ROW LEVEL SECURITY;