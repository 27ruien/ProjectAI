CREATE TYPE "public"."department_role" AS ENUM('department_admin', 'department_member');--> statement-breakpoint
CREATE TYPE "public"."grant_effect" AS ENUM('allow', 'deny');--> statement-breakpoint
CREATE TYPE "public"."grant_subject_type" AS ENUM('organization', 'department', 'project', 'role', 'user');--> statement-breakpoint
CREATE TYPE "public"."knowledge_permission" AS ENUM('view', 'download', 'upload', 'edit_metadata', 'manage_versions', 'archive', 'manage_permissions', 'manage_members');--> statement-breakpoint
CREATE TYPE "public"."knowledge_space_member_role" AS ENUM('manager', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."knowledge_space_type" AS ENUM('organization', 'department', 'project', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."knowledge_visibility" AS ENUM('private', 'organization_shared', 'department_shared', 'restricted');--> statement-breakpoint
CREATE TYPE "public"."organization_role" AS ENUM('organization_admin', 'organization_member');--> statement-breakpoint
CREATE TYPE "public"."project_knowledge_source_type" AS ENUM('knowledge_space', 'document');--> statement-breakpoint
CREATE TABLE "departments" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" varchar(200) NOT NULL,
	"code" varchar(80) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "departments_name_check" CHECK (length(btrim("departments"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE "department_members" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"department_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "department_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_name_check" CHECK (length(btrim("organizations"."name")) > 0),
	CONSTRAINT "organizations_slug_check" CHECK ("organizations"."slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "organization_members" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "organization_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_spaces" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"department_id" text,
	"project_id" text,
	"space_type" "knowledge_space_type" NOT NULL,
	"visibility" "knowledge_visibility" DEFAULT 'private' NOT NULL,
	"name" varchar(200) NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_spaces_name_check" CHECK (length(btrim("knowledge_spaces"."name")) > 0),
	CONSTRAINT "knowledge_spaces_scope_check" CHECK (
      ("knowledge_spaces"."space_type" = 'organization' and "knowledge_spaces"."department_id" is null and "knowledge_spaces"."project_id" is null)
      or ("knowledge_spaces"."space_type" = 'department' and "knowledge_spaces"."department_id" is not null and "knowledge_spaces"."project_id" is null)
      or ("knowledge_spaces"."space_type" = 'project' and "knowledge_spaces"."project_id" is not null)
      or ("knowledge_spaces"."space_type" = 'restricted')
    )
);
--> statement-breakpoint
CREATE TABLE "knowledge_space_members" (
	"id" text PRIMARY KEY NOT NULL,
	"knowledge_space_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "knowledge_space_member_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"subject_type" "grant_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"permission" "knowledge_permission" NOT NULL,
	"effect" "grant_effect" DEFAULT 'allow' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_space_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"knowledge_space_id" text NOT NULL,
	"subject_type" "grant_subject_type" NOT NULL,
	"subject_id" text NOT NULL,
	"permission" "knowledge_permission" NOT NULL,
	"effect" "grant_effect" DEFAULT 'allow' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permission_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"actor_user_id" text NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"resource_type" varchar(80) NOT NULL,
	"resource_id" text NOT NULL,
	"before_state" jsonb,
	"after_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "permission_audits_event_check" CHECK (length(btrim("permission_audits"."event_type")) > 0)
);
--> statement-breakpoint
CREATE TABLE "project_knowledge_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source_type" "project_knowledge_source_type" NOT NULL,
	"knowledge_space_id" text,
	"document_id" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_knowledge_sources_target_check" CHECK (
      ("project_knowledge_sources"."source_type" = 'knowledge_space' and "project_knowledge_sources"."knowledge_space_id" is not null and "project_knowledge_sources"."document_id" is null)
      or ("project_knowledge_sources"."source_type" = 'document' and "project_knowledge_sources"."document_id" is not null and "project_knowledge_sources"."knowledge_space_id" is null)
    )
);
--> statement-breakpoint
INSERT INTO "organizations" ("id", "name", "slug", "created_by")
SELECT 'org-legacy-default', 'ProjectAI Organization', 'projectai-organization', "id"
FROM "users"
ORDER BY CASE WHEN "system_role" = 'system_admin' THEN 0 ELSE 1 END, "created_at", "id"
LIMIT 1
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "organization_members" (
	"id", "organization_id", "user_id", "role", "created_by"
)
SELECT
	'org-member-' || md5(u."id"),
	'org-legacy-default',
	u."id",
	CASE WHEN u."system_role" = 'system_admin'
		THEN 'organization_admin'::"organization_role"
		ELSE 'organization_member'::"organization_role"
	END,
	o."created_by"
FROM "users" u
JOIN "organizations" o ON o."id" = 'org-legacy-default'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "departments" (
	"id", "organization_id", "name", "code", "description", "created_by"
)
SELECT
	'dept-legacy-default',
	o."id",
	'Default Delivery Department',
	'DEFAULT-DELIVERY',
	'Compatibility department for projects that existed before Phase 1.',
	o."created_by"
FROM "organizations" o
WHERE o."id" = 'org-legacy-default'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "department_members" (
	"id", "organization_id", "department_id", "user_id", "role", "created_by"
)
SELECT DISTINCT ON (pm."user_id")
	'dept-member-' || md5(pm."user_id"),
	'org-legacy-default',
	'dept-legacy-default',
	pm."user_id",
	CASE WHEN bool_or(pm."role" = 'project_manager') OVER (PARTITION BY pm."user_id")
		THEN 'department_admin'::"department_role"
		ELSE 'department_member'::"department_role"
	END,
	o."created_by"
FROM "project_members" pm
JOIN "organizations" o ON o."id" = 'org-legacy-default'
ORDER BY pm."user_id", pm."id"
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "organization_id" text;--> statement-breakpoint
UPDATE "projects"
SET "organization_id" = 'org-legacy-default'
WHERE "organization_id" IS NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "organization_id" SET DEFAULT 'org-legacy-default';--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "department_id" text;--> statement-breakpoint
UPDATE "projects"
SET "department_id" = 'dept-legacy-default'
WHERE "department_id" IS NULL;--> statement-breakpoint
INSERT INTO "knowledge_spaces" (
	"id", "organization_id", "project_id", "space_type", "visibility",
	"name", "description", "created_by"
)
SELECT
	'ks-project-' || md5(p."id"),
	p."organization_id",
	p."id",
	'project'::"knowledge_space_type",
	'private'::"knowledge_visibility",
	p."name" || ' · Project Knowledge',
	'Default project knowledge space created by the Phase 1 compatibility migration.',
	p."created_by"
FROM "projects" p
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "knowledge_space_members" (
	"id", "knowledge_space_id", "user_id", "role", "created_by"
)
SELECT
	'ks-member-' || md5(ks."id" || ':' || pm."user_id"),
	ks."id",
	pm."user_id",
	CASE pm."role"
		WHEN 'project_manager' THEN 'manager'::"knowledge_space_member_role"
		WHEN 'project_member' THEN 'editor'::"knowledge_space_member_role"
		ELSE 'viewer'::"knowledge_space_member_role"
	END,
	pm."created_by"
FROM "knowledge_spaces" ks
JOIN "project_members" pm ON pm."project_id" = ks."project_id"
WHERE ks."space_type" = 'project'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "project_knowledge_sources" (
	"id", "project_id", "source_type", "knowledge_space_id", "created_by"
)
SELECT
	'pks-own-' || md5(ks."project_id"),
	ks."project_id",
	'knowledge_space'::"project_knowledge_source_type",
	ks."id",
	ks."created_by"
FROM "knowledge_spaces" ks
WHERE ks."space_type" = 'project' AND ks."project_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "knowledge_space_id" text;--> statement-breakpoint
UPDATE "project_documents" d
SET "knowledge_space_id" = ks."id"
FROM "knowledge_spaces" ks
WHERE ks."project_id" = d."project_id"
	AND ks."space_type" = 'project'
	AND d."knowledge_space_id" IS NULL;--> statement-breakpoint
ALTER TABLE "project_documents" ALTER COLUMN "knowledge_space_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "project_documents" ALTER COLUMN "knowledge_space_id" SET DEFAULT '__project_default__';--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "visibility" "knowledge_visibility" DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_department_scope_fk" FOREIGN KEY ("department_id","organization_id") REFERENCES "public"."departments"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "department_members" ADD CONSTRAINT "department_members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_spaces" ADD CONSTRAINT "knowledge_spaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_spaces" ADD CONSTRAINT "knowledge_spaces_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_spaces" ADD CONSTRAINT "knowledge_spaces_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_spaces" ADD CONSTRAINT "knowledge_spaces_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_space_members" ADD CONSTRAINT "knowledge_space_members_knowledge_space_id_knowledge_spaces_id_fk" FOREIGN KEY ("knowledge_space_id") REFERENCES "public"."knowledge_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_space_members" ADD CONSTRAINT "knowledge_space_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_space_members" ADD CONSTRAINT "knowledge_space_members_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_document_id_project_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."project_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_grants" ADD CONSTRAINT "document_grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_space_grants" ADD CONSTRAINT "knowledge_space_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_space_grants" ADD CONSTRAINT "knowledge_space_grants_knowledge_space_id_knowledge_spaces_id_fk" FOREIGN KEY ("knowledge_space_id") REFERENCES "public"."knowledge_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_space_grants" ADD CONSTRAINT "knowledge_space_grants_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_audits" ADD CONSTRAINT "permission_audits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_audits" ADD CONSTRAINT "permission_audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permission_audits" ADD CONSTRAINT "permission_audits_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_sources" ADD CONSTRAINT "project_knowledge_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_sources" ADD CONSTRAINT "project_knowledge_sources_knowledge_space_id_knowledge_spaces_id_fk" FOREIGN KEY ("knowledge_space_id") REFERENCES "public"."knowledge_spaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_sources" ADD CONSTRAINT "project_knowledge_sources_document_id_project_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."project_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_knowledge_sources" ADD CONSTRAINT "project_knowledge_sources_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "departments_org_code_uidx" ON "departments" USING btree ("organization_id","code");--> statement-breakpoint
CREATE INDEX "departments_org_active_idx" ON "departments" USING btree ("organization_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "department_members_department_user_uidx" ON "department_members" USING btree ("department_id","user_id");--> statement-breakpoint
CREATE INDEX "department_members_user_idx" ON "department_members" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "department_members_admin_idx" ON "department_members" USING btree ("department_id","role","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uidx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_members_org_user_uidx" ON "organization_members" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "organization_members_user_idx" ON "organization_members" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE INDEX "organization_members_admin_idx" ON "organization_members" USING btree ("organization_id","role","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_spaces_project_uidx" ON "knowledge_spaces" USING btree ("project_id") WHERE "knowledge_spaces"."space_type" = 'project';--> statement-breakpoint
CREATE INDEX "knowledge_spaces_org_type_idx" ON "knowledge_spaces" USING btree ("organization_id","space_type","is_active");--> statement-breakpoint
CREATE INDEX "knowledge_spaces_department_idx" ON "knowledge_spaces" USING btree ("department_id","visibility");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_space_members_space_user_uidx" ON "knowledge_space_members" USING btree ("knowledge_space_id","user_id");--> statement-breakpoint
CREATE INDEX "knowledge_space_members_user_idx" ON "knowledge_space_members" USING btree ("user_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "document_grants_rule_uidx" ON "document_grants" USING btree ("document_id","subject_type","subject_id","permission","effect");--> statement-breakpoint
CREATE INDEX "document_grants_subject_idx" ON "document_grants" USING btree ("subject_type","subject_id","permission");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_space_grants_rule_uidx" ON "knowledge_space_grants" USING btree ("knowledge_space_id","subject_type","subject_id","permission","effect");--> statement-breakpoint
CREATE INDEX "knowledge_space_grants_subject_idx" ON "knowledge_space_grants" USING btree ("subject_type","subject_id","permission");--> statement-breakpoint
CREATE INDEX "permission_audits_org_created_idx" ON "permission_audits" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "permission_audits_resource_idx" ON "permission_audits" USING btree ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_knowledge_sources_space_uidx" ON "project_knowledge_sources" USING btree ("project_id","knowledge_space_id") WHERE "project_knowledge_sources"."source_type" = 'knowledge_space';--> statement-breakpoint
CREATE UNIQUE INDEX "project_knowledge_sources_document_uidx" ON "project_knowledge_sources" USING btree ("project_id","document_id") WHERE "project_knowledge_sources"."source_type" = 'document';--> statement-breakpoint
CREATE INDEX "project_knowledge_sources_project_idx" ON "project_knowledge_sources" USING btree ("project_id","is_active");--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_knowledge_space_id_knowledge_spaces_id_fk" FOREIGN KEY ("knowledge_space_id") REFERENCES "public"."knowledge_spaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "projects_organization_idx" ON "projects" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "projects_department_idx" ON "projects" USING btree ("department_id","status");--> statement-breakpoint
CREATE INDEX "project_documents_space_visibility_idx" ON "project_documents" USING btree ("knowledge_space_id","visibility","document_status");
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
		p.id AS project_id,
		p.organization_id,
		p.department_id,
		u.system_role,
		pm.role AS project_role
	FROM projects p
	JOIN users u ON u.id = actor_id AND u.status = 'active'
	LEFT JOIN organization_members om
		ON om.organization_id = p.organization_id
		AND om.user_id = actor_id
		AND om.is_active
	LEFT JOIN project_members pm
		ON pm.project_id = p.id AND pm.user_id = actor_id
	WHERE p.id = target_project_id
		AND (
			u.system_role = 'system_admin'
			OR (pm.user_id IS NOT NULL AND om.user_id IS NOT NULL)
		)
), actor_roles AS (
	SELECT tc.organization_id, tc.department_id, role_name
	FROM target_context tc
	CROSS JOIN LATERAL (
		VALUES
			(tc.project_role::text),
			((SELECT om.role::text FROM organization_members om
				WHERE om.organization_id = tc.organization_id
					AND om.user_id = actor_id AND om.is_active LIMIT 1)),
			((SELECT dm.role::text FROM department_members dm
				WHERE dm.department_id = tc.department_id
					AND dm.organization_id = tc.organization_id
					AND dm.user_id = actor_id AND dm.is_active LIMIT 1))
	) AS roles(role_name)
	WHERE role_name IS NOT NULL
), candidate_documents AS (
	SELECT DISTINCT
		d.id AS document_id,
		d.project_id AS source_project_id,
		d.knowledge_space_id,
		ks.space_type AS source_scope,
		d.visibility,
		ks.project_id AS space_project_id,
		source_project.department_id AS source_department_id,
		ks.organization_id,
		tc.project_id AS target_project_id,
		tc.department_id AS target_department_id,
		tc.project_role,
		tc.system_role
	FROM target_context tc
	JOIN knowledge_spaces ks
		ON ks.organization_id = tc.organization_id AND ks.is_active
	JOIN project_documents d
		ON d.knowledge_space_id = ks.id
	JOIN projects source_project
		ON source_project.id = d.project_id
		AND source_project.organization_id = tc.organization_id
	WHERE
		ks.project_id = tc.project_id
		OR EXISTS (
			SELECT 1 FROM project_knowledge_sources pks
			WHERE pks.project_id = tc.project_id AND pks.is_active
				AND (
					(pks.source_type = 'knowledge_space' AND pks.knowledge_space_id = ks.id)
					OR (pks.source_type = 'document' AND pks.document_id = d.id)
				)
		)
		OR EXISTS (
			SELECT 1
			FROM document_grants direct_document_grant
			WHERE direct_document_grant.document_id = d.id
				AND direct_document_grant.organization_id = tc.organization_id
				AND direct_document_grant.subject_type = 'project'
				AND direct_document_grant.subject_id = tc.project_id
				AND direct_document_grant.permission = requested_permission
				AND direct_document_grant.effect = 'allow'
		)
		OR EXISTS (
			SELECT 1
			FROM knowledge_space_grants direct_space_grant
			WHERE direct_space_grant.knowledge_space_id = ks.id
				AND direct_space_grant.organization_id = tc.organization_id
				AND direct_space_grant.subject_type = 'project'
				AND direct_space_grant.subject_id = tc.project_id
				AND direct_space_grant.permission = requested_permission
				AND direct_space_grant.effect = 'allow'
		)
		OR (
			d.visibility = 'department_shared'
			AND tc.department_id IS NOT NULL
			AND source_project.department_id = tc.department_id
		)
		OR d.visibility = 'organization_shared'
), all_rules AS (
	SELECT
		dg.document_id,
		NULL::text AS knowledge_space_id,
		dg.organization_id,
		dg.effect,
		dg.subject_type,
		dg.subject_id
	FROM document_grants dg
	WHERE dg.permission = requested_permission
	UNION ALL
	SELECT
		NULL::text AS document_id,
		ksg.knowledge_space_id,
		ksg.organization_id,
		ksg.effect,
		ksg.subject_type,
		ksg.subject_id
	FROM knowledge_space_grants ksg
	WHERE ksg.permission = requested_permission
), matching_rules AS (
	SELECT
		cd.document_id,
		arule.effect,
		arule.subject_type,
		arule.subject_id
	FROM candidate_documents cd
	JOIN all_rules arule
		ON arule.organization_id = cd.organization_id
		AND (
			arule.document_id = cd.document_id
			OR arule.knowledge_space_id = cd.knowledge_space_id
		)
	WHERE
		CASE arule.subject_type
			WHEN 'user' THEN arule.subject_id = actor_id
			WHEN 'project' THEN arule.subject_id = cd.target_project_id
			WHEN 'department' THEN arule.subject_id = cd.target_department_id
			WHEN 'organization' THEN arule.subject_id = cd.organization_id
			WHEN 'role' THEN EXISTS (
				SELECT 1 FROM actor_roles ar
				WHERE ar.role_name = arule.subject_id
			)
			ELSE false
		END
), explicit_access AS (
	SELECT
		cd.document_id,
		bool_or(mr.effect = 'deny') AS denied,
		bool_or(mr.effect = 'allow') AS allowed
	FROM candidate_documents cd
	LEFT JOIN matching_rules mr ON mr.document_id = cd.document_id
	GROUP BY cd.document_id
), member_access AS (
	SELECT
		cd.document_id,
		CASE requested_permission
			WHEN 'view' THEN cd.project_role IS NOT NULL
			WHEN 'download' THEN cd.project_role IN ('project_manager', 'project_member')
			WHEN 'upload' THEN cd.space_project_id = cd.target_project_id
				AND cd.project_role IN ('project_manager', 'project_member')
			WHEN 'edit_metadata' THEN cd.space_project_id = cd.target_project_id
				AND cd.project_role IN ('project_manager', 'project_member')
			WHEN 'manage_versions' THEN cd.space_project_id = cd.target_project_id
				AND cd.project_role IN ('project_manager', 'project_member')
			WHEN 'archive' THEN cd.space_project_id = cd.target_project_id
				AND cd.project_role = 'project_manager'
			WHEN 'manage_permissions' THEN cd.project_role = 'project_manager'
			WHEN 'manage_members' THEN cd.project_role = 'project_manager'
			ELSE false
		END AS allowed
	FROM candidate_documents cd
)
SELECT
	cd.document_id,
	cd.source_project_id,
	cd.knowledge_space_id,
	cd.source_scope
FROM candidate_documents cd
JOIN explicit_access ea ON ea.document_id = cd.document_id
JOIN member_access ma ON ma.document_id = cd.document_id
WHERE
	cd.system_role = 'system_admin'
	OR (
		coalesce(ea.denied, false) = false
		AND (
			coalesce(ea.allowed, false)
			OR (
				cd.visibility <> 'restricted'
				AND ma.allowed
			)
			OR EXISTS (
				SELECT 1 FROM knowledge_space_members ksm
				WHERE ksm.knowledge_space_id = cd.knowledge_space_id
					AND ksm.user_id = actor_id AND ksm.is_active
					AND CASE requested_permission
						WHEN 'view' THEN true
						WHEN 'download' THEN ksm.role IN ('manager', 'editor')
						ELSE ksm.role = 'manager'
					END
			)
		)
	)
$$;
--> statement-breakpoint
COMMENT ON FUNCTION "projectai_authorized_documents"(text, text, "knowledge_permission") IS
'Central default-deny document scope. Explicit deny wins; callers must still revalidate citations and resource writes.';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "projectai_ensure_project_knowledge_space"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	space_id text;
BEGIN
	space_id := 'ks-project-' || md5(NEW.id);
	INSERT INTO knowledge_spaces (
		id, organization_id, project_id, space_type, visibility,
		name, description, created_by
	) VALUES (
		space_id, NEW.organization_id, NEW.id, 'project', 'private',
		NEW.name || ' · Project Knowledge',
		'Default project knowledge space created with the project.',
		NEW.created_by
	)
	ON CONFLICT (project_id) WHERE space_type = 'project' DO NOTHING;
	INSERT INTO project_knowledge_sources (
		id, project_id, source_type, knowledge_space_id, created_by
	) VALUES (
		'pks-own-' || md5(NEW.id), NEW.id, 'knowledge_space', space_id, NEW.created_by
	)
	ON CONFLICT (project_id, knowledge_space_id)
		WHERE source_type = 'knowledge_space' DO NOTHING;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "projects_default_knowledge_space_trigger"
AFTER INSERT ON "projects"
FOR EACH ROW
EXECUTE FUNCTION "projectai_ensure_project_knowledge_space"();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "projectai_bind_document_knowledge_space"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW.knowledge_space_id = '__project_default__' THEN
		SELECT ks.id INTO NEW.knowledge_space_id
		FROM knowledge_spaces ks
		WHERE ks.project_id = NEW.project_id AND ks.space_type = 'project'
		LIMIT 1;
		IF NEW.knowledge_space_id IS NULL THEN
			RAISE EXCEPTION 'PROJECT_KNOWLEDGE_SPACE_MISSING';
		END IF;
	END IF;
	RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER "project_documents_knowledge_space_trigger"
BEFORE INSERT ON "project_documents"
FOR EACH ROW
EXECUTE FUNCTION "projectai_bind_document_knowledge_space"();
