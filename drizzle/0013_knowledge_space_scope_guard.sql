DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM project_documents document
    JOIN projects source_project ON source_project.id = document.project_id
    JOIN knowledge_spaces space ON space.id = document.knowledge_space_id
    WHERE source_project.organization_id IS DISTINCT FROM space.organization_id
      OR (space.project_id IS NOT NULL AND space.project_id IS DISTINCT FROM document.project_id)
      OR (space.department_id IS NOT NULL AND space.department_id IS DISTINCT FROM source_project.department_id)
  ) THEN
    RAISE EXCEPTION 'Existing project document has an invalid knowledge-space scope'
      USING ERRCODE = '23514';
  END IF;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION projectai_validate_document_knowledge_space_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_organization_id text;
  source_department_id text;
  space_organization_id text;
  space_department_id text;
  space_project_id text;
BEGIN
  SELECT organization_id, department_id
  INTO source_organization_id, source_department_id
  FROM projects
  WHERE id = NEW.project_id;

  SELECT organization_id, department_id, project_id
  INTO space_organization_id, space_department_id, space_project_id
  FROM knowledge_spaces
  WHERE id = NEW.knowledge_space_id AND is_active;

  IF source_organization_id IS NULL OR space_organization_id IS NULL
    OR source_organization_id IS DISTINCT FROM space_organization_id
    OR (space_project_id IS NOT NULL AND space_project_id IS DISTINCT FROM NEW.project_id)
    OR (space_department_id IS NOT NULL AND space_department_id IS DISTINCT FROM source_department_id)
  THEN
    RAISE EXCEPTION 'Project document knowledge-space scope is invalid'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS project_documents_scope_guard_trigger ON project_documents;
--> statement-breakpoint
CREATE TRIGGER project_documents_scope_guard_trigger
BEFORE INSERT OR UPDATE OF project_id, knowledge_space_id
ON project_documents
FOR EACH ROW
EXECUTE FUNCTION projectai_validate_document_knowledge_space_scope();
--> statement-breakpoint
COMMENT ON FUNCTION projectai_validate_document_knowledge_space_scope() IS
'Rejects cross-organization, cross-project, and cross-department document-to-knowledge-space bindings.';
