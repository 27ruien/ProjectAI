ALTER TABLE "project_documents" ADD COLUMN "workflow_temporary" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "temporary_workflow_id" text;--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "temporary_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "temporary_promoted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_temporary_state_check" CHECK ((
        "project_documents"."workflow_temporary"
        and "project_documents"."temporary_workflow_id" is not null
        and "project_documents"."temporary_expires_at" is not null
        and "project_documents"."temporary_promoted_at" is null
      ) or (
        not "project_documents"."workflow_temporary"
        and "project_documents"."temporary_workflow_id" is null
        and "project_documents"."temporary_expires_at" is null
      ));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "projectai_authorized_documents"(
  "actor_id" text,
  "target_project_id" text,
  "requested_permission" "knowledge_permission"
)
RETURNS TABLE (
  "document_id" text,
  "source_project_id" text,
  "knowledge_space_id" text,
  "source_scope" "knowledge_space_type"
)
LANGUAGE sql
STABLE
AS $$
WITH target_context AS (
  SELECT
    target.id AS project_id,
    target.organization_id,
    target.department_id,
    actor.product_role,
    membership.role AS project_role
  FROM projects target
  JOIN users actor ON actor.id = actor_id AND actor.status = 'active'
  LEFT JOIN project_members membership
    ON membership.project_id = target.id
    AND membership.user_id = actor_id
  WHERE target.id = target_project_id
    AND (
      actor.product_role IN ('super_admin', 'admin')
      OR membership.user_id IS NOT NULL
    )
), candidates AS (
  SELECT DISTINCT
    document.id AS document_id,
    document.project_id AS source_project_id,
    document.created_by AS document_created_by,
    document.workflow_temporary,
    document.temporary_expires_at,
    space.id AS knowledge_space_id,
    space.space_type AS source_scope,
    space.project_id AS space_project_id,
    space.department_id AS space_department_id,
    space.visibility,
    context.project_id AS target_project_id,
    context.department_id AS target_department_id,
    context.product_role,
    context.project_role,
    member.access_level AS space_access_level,
    EXISTS (
      SELECT 1 FROM departments candidate_department
      WHERE candidate_department.id = space.department_id
        AND candidate_department.organization_id = context.organization_id
        AND candidate_department.is_active
        AND actor_id = ANY(candidate_department.head_user_ids)
    ) AS is_department_head
  FROM target_context context
  JOIN knowledge_spaces space
    ON space.organization_id = context.organization_id
    AND space.is_active
  JOIN project_documents document
    ON document.knowledge_space_id = space.id
  LEFT JOIN knowledge_space_members member
    ON member.knowledge_space_id = space.id
    AND member.user_id = actor_id
    AND member.is_active
  WHERE
    space.project_id = context.project_id
    OR (
      context.product_role IN ('super_admin', 'admin')
      AND space.space_type = 'department'
      AND space.department_id = context.department_id
    )
    OR member.user_id IS NOT NULL
    OR (
      space.space_type = 'department'
      AND space.visibility = 'department_shared'
      AND space.department_id = context.department_id
      AND EXISTS (
        SELECT 1
        FROM department_members department_membership
        WHERE department_membership.department_id = space.department_id
          AND department_membership.user_id = actor_id
          AND department_membership.is_active
      )
    )
    OR EXISTS (
      SELECT 1
      FROM project_knowledge_sources source
      WHERE source.project_id = context.project_id
        AND source.is_active
        AND (
          (source.source_type = 'knowledge_space' AND source.knowledge_space_id = space.id)
          OR (source.source_type = 'document' AND source.document_id = document.id)
        )
    )
)
SELECT
  candidate.document_id,
  candidate.source_project_id,
  candidate.knowledge_space_id,
  candidate.source_scope
FROM candidates candidate
WHERE
  (
    NOT candidate.workflow_temporary
    OR (
      candidate.temporary_expires_at > now()
      AND (
        candidate.product_role IN ('super_admin', 'admin')
        OR candidate.document_created_by = actor_id
      )
    )
  )
  AND (
    candidate.product_role IN ('super_admin', 'admin')
    OR CASE requested_permission
      WHEN 'view' THEN
        candidate.project_role IS NOT NULL
        OR candidate.space_access_level IN ('view', 'edit')
        OR (
          candidate.source_scope = 'department'
          AND candidate.visibility = 'department_shared'
          AND candidate.space_department_id = candidate.target_department_id
        )
      WHEN 'download' THEN
        candidate.project_role IS NOT NULL
        OR candidate.space_access_level IN ('view', 'edit')
        OR (
          candidate.source_scope = 'department'
          AND candidate.visibility = 'department_shared'
          AND candidate.space_department_id = candidate.target_department_id
        )
      WHEN 'upload' THEN
        (candidate.space_project_id = candidate.target_project_id AND candidate.project_role IN ('project_manager', 'project_member'))
        OR candidate.space_access_level = 'edit'
        OR (candidate.source_scope = 'department' AND candidate.is_department_head)
      WHEN 'edit_metadata' THEN
        (candidate.space_project_id = candidate.target_project_id AND candidate.project_role IN ('project_manager', 'project_member'))
        OR candidate.space_access_level = 'edit'
        OR (candidate.source_scope = 'department' AND candidate.is_department_head)
      WHEN 'manage_versions' THEN
        (candidate.space_project_id = candidate.target_project_id AND candidate.project_role IN ('project_manager', 'project_member'))
        OR candidate.space_access_level = 'edit'
        OR (candidate.source_scope = 'department' AND candidate.is_department_head)
      WHEN 'archive' THEN
        (candidate.space_project_id = candidate.target_project_id AND candidate.project_role = 'project_manager')
        OR candidate.space_access_level = 'edit'
        OR (candidate.source_scope = 'department' AND candidate.is_department_head)
      WHEN 'manage_permissions' THEN
        candidate.project_role = 'project_manager'
        OR candidate.space_access_level = 'edit'
      WHEN 'manage_members' THEN
        candidate.project_role = 'project_manager'
        OR candidate.space_access_level = 'edit'
      ELSE false
    END
  )
$$;
