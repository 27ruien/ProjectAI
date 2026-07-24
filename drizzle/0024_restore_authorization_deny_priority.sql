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
), actor_roles AS (
  SELECT context.organization_id, context.department_id, role_name
  FROM target_context context
  CROSS JOIN LATERAL (
    VALUES
      (context.project_role::text),
      ((SELECT organization_membership.role::text
        FROM organization_members organization_membership
        WHERE organization_membership.organization_id = context.organization_id
          AND organization_membership.user_id = actor_id
          AND organization_membership.is_active
        LIMIT 1)),
      ((SELECT department_membership.role::text
        FROM department_members department_membership
        WHERE department_membership.department_id = context.department_id
          AND department_membership.organization_id = context.organization_id
          AND department_membership.user_id = actor_id
          AND department_membership.is_active
        LIMIT 1))
  ) AS roles(role_name)
  WHERE role_name IS NOT NULL
), candidate_documents AS (
  SELECT DISTINCT
    document.id AS document_id,
    document.project_id AS source_project_id,
    document.created_by AS document_created_by,
    document.workflow_temporary,
    document.temporary_expires_at,
    space.id AS knowledge_space_id,
    space.space_type AS source_scope,
    space.project_id AS space_project_id,
    source_project.department_id AS source_department_id,
    space.organization_id,
    space.visibility,
    context.project_id AS target_project_id,
    context.department_id AS target_department_id,
    context.product_role,
    context.project_role,
    space_member.access_level AS space_access_level,
    EXISTS (
      SELECT 1
      FROM department_members department_membership
      WHERE department_membership.department_id = space.department_id
        AND department_membership.organization_id = context.organization_id
        AND department_membership.user_id = actor_id
        AND department_membership.is_active
    ) AS is_department_member,
    EXISTS (
      SELECT 1
      FROM departments candidate_department
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
  JOIN projects source_project
    ON source_project.id = document.project_id
    AND source_project.organization_id = context.organization_id
  LEFT JOIN knowledge_space_members space_member
    ON space_member.knowledge_space_id = space.id
    AND space_member.user_id = actor_id
    AND space_member.is_active
  WHERE
    context.product_role IN ('super_admin', 'admin')
    OR space.project_id = context.project_id
    OR space_member.user_id IS NOT NULL
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
    OR EXISTS (
      SELECT 1
      FROM document_grants direct_document_grant
      WHERE direct_document_grant.document_id = document.id
        AND direct_document_grant.organization_id = context.organization_id
        AND direct_document_grant.subject_type = 'project'
        AND direct_document_grant.subject_id = context.project_id
        AND direct_document_grant.permission = requested_permission
        AND direct_document_grant.effect = 'allow'
    )
    OR EXISTS (
      SELECT 1
      FROM knowledge_space_grants direct_space_grant
      WHERE direct_space_grant.knowledge_space_id = space.id
        AND direct_space_grant.organization_id = context.organization_id
        AND direct_space_grant.subject_type = 'project'
        AND direct_space_grant.subject_id = context.project_id
        AND direct_space_grant.permission = requested_permission
        AND direct_space_grant.effect = 'allow'
    )
    OR (
      document.visibility = 'department_shared'
      AND context.department_id IS NOT NULL
      AND source_project.department_id = context.department_id
      AND EXISTS (
        SELECT 1
        FROM department_members shared_department_membership
        WHERE shared_department_membership.department_id = context.department_id
          AND shared_department_membership.organization_id = context.organization_id
          AND shared_department_membership.user_id = actor_id
          AND shared_department_membership.is_active
      )
    )
    OR document.visibility = 'organization_shared'
), all_rules AS (
  SELECT
    document_rule.document_id,
    NULL::text AS knowledge_space_id,
    document_rule.organization_id,
    document_rule.effect,
    document_rule.subject_type,
    document_rule.subject_id
  FROM document_grants document_rule
  WHERE document_rule.permission = requested_permission
  UNION ALL
  SELECT
    NULL::text AS document_id,
    space_rule.knowledge_space_id,
    space_rule.organization_id,
    space_rule.effect,
    space_rule.subject_type,
    space_rule.subject_id
  FROM knowledge_space_grants space_rule
  WHERE space_rule.permission = requested_permission
), matching_rules AS (
  SELECT
    candidate.document_id,
    rule.effect
  FROM candidate_documents candidate
  JOIN all_rules rule
    ON rule.organization_id = candidate.organization_id
    AND (
      rule.document_id = candidate.document_id
      OR rule.knowledge_space_id = candidate.knowledge_space_id
    )
  WHERE CASE rule.subject_type
    WHEN 'user' THEN rule.subject_id = actor_id
    WHEN 'project' THEN rule.subject_id = candidate.target_project_id
    WHEN 'department' THEN rule.subject_id = candidate.target_department_id
    WHEN 'organization' THEN rule.subject_id = candidate.organization_id
    WHEN 'role' THEN EXISTS (
      SELECT 1
      FROM actor_roles actor_role
      WHERE actor_role.role_name = rule.subject_id
    )
    ELSE false
  END
), explicit_access AS (
  SELECT
    candidate.document_id,
    bool_or(rule.effect = 'deny') AS denied,
    bool_or(rule.effect = 'allow') AS allowed
  FROM candidate_documents candidate
  LEFT JOIN matching_rules rule ON rule.document_id = candidate.document_id
  GROUP BY candidate.document_id
), member_access AS (
  SELECT
    candidate.document_id,
    CASE requested_permission
      WHEN 'view' THEN
        candidate.project_role IS NOT NULL
        OR candidate.space_access_level IN ('view', 'edit')
        OR (
          candidate.source_scope = 'department'
          AND candidate.visibility = 'department_shared'
          AND candidate.source_department_id = candidate.target_department_id
          AND candidate.is_department_member
        )
      WHEN 'download' THEN
        candidate.project_role IS NOT NULL
        OR candidate.space_access_level IN ('view', 'edit')
        OR (
          candidate.source_scope = 'department'
          AND candidate.visibility = 'department_shared'
          AND candidate.source_department_id = candidate.target_department_id
          AND candidate.is_department_member
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
    END AS allowed
  FROM candidate_documents candidate
)
SELECT
  candidate.document_id,
  candidate.source_project_id,
  candidate.knowledge_space_id,
  candidate.source_scope
FROM candidate_documents candidate
JOIN explicit_access explicit ON explicit.document_id = candidate.document_id
JOIN member_access membership ON membership.document_id = candidate.document_id
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
  AND coalesce(explicit.denied, false) = false
  AND (
    candidate.product_role IN ('super_admin', 'admin')
    OR coalesce(explicit.allowed, false)
    OR (
      candidate.visibility <> 'restricted'
      AND membership.allowed
    )
  )
$$;
--> statement-breakpoint
COMMENT ON FUNCTION "projectai_authorized_documents"(text, text, "knowledge_permission") IS
'Product V2 default-deny document scope. Exact organization/project/space access is combined with view/edit membership; every matching explicit deny wins for every actor, including Product administrators.';
