-- The landing's live board follows runs: a run starting, changing phase or
-- finishing also signals the public "boards" topic (no data, just "changed").
CREATE OR REPLACE FUNCTION yarrow_private.agent_runs_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE project uuid;
BEGIN
  SELECT project_id INTO project FROM public.work_units WHERE id = NEW.work_unit_id;
  PERFORM yarrow_private.notify('project:' || project, true);
  PERFORM yarrow_private.notify_funders(NEW.work_unit_id);
  IF TG_OP = 'INSERT'
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.phase IS DISTINCT FROM OLD.phase THEN
    PERFORM yarrow_private.notify('boards', false);
  END IF;
  RETURN NULL;
END $$;
