ALTER TABLE "work_units" ADD COLUMN "tracker_status_before" text;--> statement-breakpoint
-- Yarrow stopped now puts the ticket back where it was by default. Moves
-- saved before held "Don't move" there as the old default, never chosen.
UPDATE "tracker_boards" SET "moves" = jsonb_set("moves", '{stopped}', '"back"')
  WHERE "moves" IS NOT NULL AND coalesce("moves"->'stopped', 'null'::jsonb) = 'null'::jsonb;
