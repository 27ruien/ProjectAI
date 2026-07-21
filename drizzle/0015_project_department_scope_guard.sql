CREATE OR REPLACE FUNCTION projectai_validate_project_department_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.department_id IS NOT DISTINCT FROM OLD.department_id THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM project_documents document
    JOIN knowledge_spaces space ON space.id = document.knowledge_space_id
    WHERE document.project_id = NEW.id
      AND space.department_id IS NOT NULL
      AND space.department_id IS DISTINCT FROM NEW.department_id
  ) THEN
    RAISE EXCEPTION 'Project department change conflicts with a document knowledge-space scope'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM project_knowledge_sources source
    JOIN knowledge_spaces space ON space.id = source.knowledge_space_id
    WHERE source.project_id = NEW.id
      AND source.is_active
      AND space.department_id IS NOT NULL
      AND space.department_id IS DISTINCT FROM NEW.department_id
  ) THEN
    RAISE EXCEPTION 'Project department change conflicts with an active knowledge source'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS projects_department_scope_guard_trigger ON projects;
--> statement-breakpoint
CREATE TRIGGER projects_department_scope_guard_trigger
BEFORE UPDATE OF department_id
ON projects
FOR EACH ROW
EXECUTE FUNCTION projectai_validate_project_department_change();
--> statement-breakpoint
COMMENT ON FUNCTION projectai_validate_project_department_change() IS
'Rejects department changes that would strand documents or active mounted knowledge spaces outside the project department scope.';
