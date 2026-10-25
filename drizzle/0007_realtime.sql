-- Realtime: rows that change send a bare "changed" signal on a Supabase
-- Realtime channel; pages then refetch through the app's own server
-- functions, so no data ever travels on a channel.
--   boards          public: the landing's Sponsors and Shipped boards
--   project:<id>    private: the project's members (Builder tab)
--   sponsor:<user>  private: that sponsor (Sponsor tab)
CREATE SCHEMA IF NOT EXISTS yarrow_private;--> statement-breakpoint

CREATE OR REPLACE FUNCTION yarrow_private.notify(topic text, is_private boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Supabase only: a plain Postgres (the unit tests) has no realtime schema.
  IF to_regnamespace('realtime') IS NOT NULL THEN
    PERFORM realtime.send('{}'::jsonb, 'changed', topic, is_private);
  END IF;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION yarrow_private.notify(text, boolean) FROM PUBLIC;--> statement-breakpoint

-- Sponsors who funded any run of a work unit.
CREATE OR REPLACE FUNCTION yarrow_private.notify_funders(unit uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE funder uuid;
BEGIN
  FOR funder IN
    SELECT DISTINCT c.user_id
    FROM public.run_fundings f
    JOIN public.contributions c ON c.id = f.contribution_id
    JOIN public.agent_runs r ON r.id = f.agent_run_id
    WHERE r.work_unit_id = unit
  LOOP
    PERFORM yarrow_private.notify('sponsor:' || funder, true);
  END LOOP;
END $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION yarrow_private.notify_funders(uuid) FROM PUBLIC;--> statement-breakpoint

CREATE OR REPLACE FUNCTION yarrow_private.contributions_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM yarrow_private.notify('sponsor:' || NEW.user_id, true);
  -- The boards only move on settled money (or a guest's payment claimed).
  IF (NEW.payment_status = 'settled'
        AND (TG_OP = 'INSERT' OR OLD.payment_status IS DISTINCT FROM NEW.payment_status))
     OR (TG_OP = 'UPDATE' AND OLD.payment_status = 'settled' AND NEW.payment_status <> 'settled')
     OR (TG_OP = 'UPDATE' AND OLD.user_id IS DISTINCT FROM NEW.user_id) THEN
    PERFORM yarrow_private.notify('boards', false);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER contributions_realtime AFTER INSERT OR UPDATE ON public.contributions
  FOR EACH ROW EXECUTE FUNCTION yarrow_private.contributions_changed();--> statement-breakpoint

CREATE OR REPLACE FUNCTION yarrow_private.sponsor_profiles_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR (OLD.public_name, OLD.tagline, OLD.description, OLD.website_url, OLD.logo_url)
        IS DISTINCT FROM
        (NEW.public_name, NEW.tagline, NEW.description, NEW.website_url, NEW.logo_url) THEN
    PERFORM yarrow_private.notify('boards', false);
    PERFORM yarrow_private.notify('sponsor:' || NEW.user_id, true);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER sponsor_profiles_realtime AFTER INSERT OR UPDATE ON public.sponsor_profiles
  FOR EACH ROW EXECUTE FUNCTION yarrow_private.sponsor_profiles_changed();--> statement-breakpoint

CREATE OR REPLACE FUNCTION yarrow_private.pull_requests_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE project uuid;
BEGIN
  SELECT project_id INTO project FROM public.work_units WHERE id = NEW.work_unit_id;
  PERFORM yarrow_private.notify('project:' || project, true);
  PERFORM yarrow_private.notify_funders(NEW.work_unit_id);
  IF NEW.state = 'merged' AND (TG_OP = 'INSERT' OR OLD.state IS DISTINCT FROM NEW.state) THEN
    PERFORM yarrow_private.notify('boards', false);
  END IF;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER pull_requests_realtime AFTER INSERT OR UPDATE ON public.pull_requests
  FOR EACH ROW EXECUTE FUNCTION yarrow_private.pull_requests_changed();--> statement-breakpoint

CREATE OR REPLACE FUNCTION yarrow_private.work_units_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM yarrow_private.notify('project:' || NEW.project_id, true);
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER work_units_realtime AFTER INSERT OR UPDATE ON public.work_units
  FOR EACH ROW EXECUTE FUNCTION yarrow_private.work_units_changed();--> statement-breakpoint

CREATE OR REPLACE FUNCTION yarrow_private.agent_runs_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE project uuid;
BEGIN
  SELECT project_id INTO project FROM public.work_units WHERE id = NEW.work_unit_id;
  PERFORM yarrow_private.notify('project:' || project, true);
  PERFORM yarrow_private.notify_funders(NEW.work_unit_id);
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER agent_runs_realtime AFTER INSERT OR UPDATE ON public.agent_runs
  FOR EACH ROW EXECUTE FUNCTION yarrow_private.agent_runs_changed();--> statement-breakpoint

CREATE OR REPLACE FUNCTION yarrow_private.run_fundings_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE funder uuid;
BEGIN
  SELECT user_id INTO funder FROM public.contributions WHERE id = NEW.contribution_id;
  PERFORM yarrow_private.notify('sponsor:' || funder, true);
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER run_fundings_realtime AFTER INSERT OR UPDATE ON public.run_fundings
  FOR EACH ROW EXECUTE FUNCTION yarrow_private.run_fundings_changed();--> statement-breakpoint

CREATE OR REPLACE FUNCTION yarrow_private.github_tasks_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM yarrow_private.notify('project:' || NEW.project_id, true);
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE TRIGGER github_tasks_realtime AFTER INSERT OR UPDATE ON public.github_tasks
  FOR EACH ROW EXECUTE FUNCTION yarrow_private.github_tasks_changed();--> statement-breakpoint

-- Private channels: a project's members, or the sponsor themself.
DO $$
BEGIN
  IF to_regnamespace('realtime') IS NOT NULL THEN
    EXECUTE $f$
      CREATE OR REPLACE FUNCTION yarrow_private.can_receive(topic text)
      RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $body$
        SELECT CASE
          WHEN topic LIKE 'sponsor:%' THEN substr(topic, 9) = auth.uid()::text
          WHEN topic LIKE 'project:%' THEN EXISTS (
            SELECT 1 FROM public.projects p
            JOIN public.account_members m ON m.account_id = p.account_id
            WHERE p.id::text = substr(topic, 9) AND m.user_id = auth.uid())
          ELSE false
        END
      $body$
    $f$;
    EXECUTE 'REVOKE ALL ON FUNCTION yarrow_private.can_receive(text) FROM PUBLIC';
    EXECUTE 'GRANT USAGE ON SCHEMA yarrow_private TO authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION yarrow_private.can_receive(text) TO authenticated';
    EXECUTE 'DROP POLICY IF EXISTS "yarrow private topics" ON realtime.messages';
    EXECUTE 'CREATE POLICY "yarrow private topics" ON realtime.messages FOR SELECT TO authenticated USING (yarrow_private.can_receive(realtime.topic()))';
  END IF;
END $$;
