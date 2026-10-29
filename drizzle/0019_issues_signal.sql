-- Open tickets are read live from GitHub and Jira, never stored, so no row
-- changes when one is opened or renamed there. Their webhooks call this:
-- an "issues" signal on the project's channel, and its members' dashboards
-- read the open tickets again at once.
CREATE OR REPLACE FUNCTION yarrow_private.notify_issues(project uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Supabase only: a plain Postgres (the unit tests) has no realtime schema.
  IF to_regnamespace('realtime') IS NOT NULL THEN
    PERFORM realtime.send('{}'::jsonb, 'issues', 'project:' || project, true);
  END IF;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION yarrow_private.notify_issues(uuid) FROM PUBLIC;
