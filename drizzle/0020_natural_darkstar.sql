CREATE TYPE "public"."department_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."knowledge_access_level" AS ENUM('view', 'edit');--> statement-breakpoint
CREATE TYPE "public"."product_role" AS ENUM('super_admin', 'admin', 'member');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "product_role" "product_role" DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "parent_department_id" text;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "level" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "status" "department_status" DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "head_user_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "departments" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "knowledge_space_members" ADD COLUMN "access_level" "knowledge_access_level" DEFAULT 'view' NOT NULL;--> statement-breakpoint
UPDATE "users"
SET "product_role" = CASE
  WHEN "system_role" = 'system_admin' THEN 'super_admin'::"product_role"
  WHEN EXISTS (
    SELECT 1
    FROM "organization_members" membership
    WHERE membership."user_id" = "users"."id"
      AND membership."role" = 'organization_admin'
      AND membership."is_active"
  ) THEN 'admin'::"product_role"
  ELSE 'member'::"product_role"
END;--> statement-breakpoint
UPDATE "knowledge_space_members"
SET "access_level" = CASE
  WHEN "role" IN ('manager', 'editor') THEN 'edit'::"knowledge_access_level"
  ELSE 'view'::"knowledge_access_level"
END;--> statement-breakpoint
UPDATE "knowledge_spaces" space
SET "department_id" = source_project."department_id",
    "updated_at" = now()
FROM "projects" source_project
WHERE space."project_id" = source_project."id"
  AND space."space_type" = 'project'
  AND space."department_id" IS DISTINCT FROM source_project."department_id";--> statement-breakpoint
UPDATE "organizations"
SET "name" = 'Kivisense',
    "slug" = 'kivisense',
    "updated_at" = now()
WHERE "id" = 'org-legacy-default'
  AND NOT EXISTS (
    SELECT 1 FROM "organizations" existing
    WHERE existing."slug" = 'kivisense'
      AND existing."id" <> 'org-legacy-default'
  );--> statement-breakpoint
INSERT INTO "knowledge_spaces" (
  "id", "organization_id", "department_id", "project_id", "space_type",
  "visibility", "name", "description", "is_active", "created_by"
)
SELECT
  'ks-department-' || department."id",
  department."organization_id",
  department."id",
  NULL,
  'department'::"knowledge_space_type",
  'department_shared'::"knowledge_visibility",
  left(department."name", 188) || ' 共享空间',
  '部门默认共享知识空间',
  department."is_active",
  department."created_by"
FROM "departments" department
WHERE NOT EXISTS (
  SELECT 1
  FROM "knowledge_spaces" existing
  WHERE existing."department_id" = department."id"
    AND existing."space_type" = 'department'
)
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_org_fk" FOREIGN KEY ("parent_department_id","organization_id") REFERENCES "public"."departments"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_level_check" CHECK ("departments"."level" between 1 and 4);--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_parent_level_check" CHECK (("departments"."level" = 1 and "departments"."parent_department_id" is null) or ("departments"."level" > 1 and "departments"."parent_department_id" is not null));
--> statement-breakpoint
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
    space.id AS knowledge_space_id,
    space.space_type AS source_scope,
    space.project_id AS space_project_id,
    space.department_id AS space_department_id,
    space.visibility,
    context.project_id AS target_project_id,
    context.department_id AS target_department_id,
    context.product_role,
    context.project_role,
    member.access_level AS space_access_level
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
    WHEN 'edit_metadata' THEN
      (candidate.space_project_id = candidate.target_project_id AND candidate.project_role IN ('project_manager', 'project_member'))
      OR candidate.space_access_level = 'edit'
    WHEN 'manage_versions' THEN
      (candidate.space_project_id = candidate.target_project_id AND candidate.project_role IN ('project_manager', 'project_member'))
      OR candidate.space_access_level = 'edit'
    WHEN 'archive' THEN
      (candidate.space_project_id = candidate.target_project_id AND candidate.project_role = 'project_manager')
      OR candidate.space_access_level = 'edit'
    WHEN 'manage_permissions' THEN
      candidate.project_role = 'project_manager'
      OR candidate.space_access_level = 'edit'
    WHEN 'manage_members' THEN
      candidate.project_role = 'project_manager'
      OR candidate.space_access_level = 'edit'
    ELSE false
  END
$$;
--> statement-breakpoint
COMMENT ON FUNCTION "projectai_authorized_documents"(text, text, "knowledge_permission") IS
'Product V2 document authorization: global product admins, department membership, invited project membership, and view/edit knowledge-space membership. Legacy explicit allow/deny rules are not used by the Product V2 UI.';
