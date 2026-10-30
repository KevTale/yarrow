-- How the implementer got the app running in its sandbox, written back after
-- a run that did, and given to the next run (screenshots, then previews).
ALTER TABLE "project_run_configs" ADD COLUMN "recipe" jsonb;