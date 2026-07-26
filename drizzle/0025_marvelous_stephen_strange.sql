CREATE TABLE IF NOT EXISTS "test_fixtures" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_type" varchar(80) NOT NULL,
	"entity_id" text NOT NULL,
	"is_test_fixture" boolean DEFAULT true NOT NULL,
	"fixture_run_id" text NOT NULL,
	"environment" varchar(24) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_fixtures_flag_check" CHECK ("test_fixtures"."is_test_fixture" = true),
	CONSTRAINT "test_fixtures_environment_check" CHECK ("test_fixtures"."environment" in ('local', 'test', 'ci', 'staging')),
	CONSTRAINT "test_fixtures_entity_type_check" CHECK (length(btrim("test_fixtures"."entity_type")) between 1 and 80),
	CONSTRAINT "test_fixtures_run_id_check" CHECK (length(btrim("test_fixtures"."fixture_run_id")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" DROP CONSTRAINT "timesheet_ai_executions_status_check";--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ALTER COLUMN "status" SET DATA TYPE varchar(32);--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ALTER COLUMN "status" SET DEFAULT 'queued';--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "request_id" text;--> statement-breakpoint
UPDATE "timesheet_ai_executions"
SET "request_id" = "execution_id",
    "status" = case when "status" = 'succeeded' then 'completed' when "status" = 'running' then 'failed' else "status" end,
    "failure_code" = case when "status" = 'running' then coalesce("failure_code", 'TIMESHEET_LEGACY_EXECUTION_CLOSED') else "failure_code" end,
    "completed_at" = case when "status" = 'running' then coalesce("completed_at", now()) else "completed_at" end;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ALTER COLUMN "request_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "attempt_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "leased_by" text;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "lease_token" text;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "heartbeat_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "current_stage_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "cancellation_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "provider_dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "queue_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "retrieval_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "provider_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "parse_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "persistence_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "total_duration_ms" integer;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD COLUMN "failure_stage" varchar(32);--> statement-breakpoint
INSERT INTO "test_fixtures" (
  "id", "entity_type", "entity_id", "fixture_run_id", "environment", "expires_at"
)
SELECT
  'fixture-organization-' || md5(o.id),
  'organization',
  o.id,
  'uat-legacy-import-0025',
  'staging',
  now() + interval '7 days'
FROM organizations o
WHERE o.id = 'uat-org-projectai-v1'
   OR o.slug like '%uat%';--> statement-breakpoint
INSERT INTO "test_fixtures" (
  "id", "entity_type", "entity_id", "fixture_run_id", "environment", "expires_at"
)
SELECT
  'fixture-department-' || md5(d.id),
  'department',
  d.id,
  'uat-legacy-import-0025',
  'staging',
  now() + interval '7 days'
FROM departments d
WHERE d.code like 'UAT-%'
   OR d.description like '[UAT]%'
   OR d.description like '[ProjectAI-STAGING-UAT]%';--> statement-breakpoint
INSERT INTO "test_fixtures" (
  "id", "entity_type", "entity_id", "fixture_run_id", "environment", "expires_at"
)
SELECT
  'fixture-project-' || md5(p.id),
  'project',
  p.id,
  'uat-legacy-import-0025',
  'staging',
  now() + interval '7 days'
FROM projects p
WHERE p.organization_id = 'uat-org-projectai-v1'
   OR p.name ilike '% UAT %'
   OR p.name ilike 'UAT %'
   OR p.name ilike '% UAT'
   OR p.name ilike 'Product V2 ACL UAT%'
   OR p.name ilike 'Member Creator UAT%'
   OR p.name ilike '需求结果空间 %'
   OR p.description like '[UAT]%'
   OR p.description like '[ProjectAI-STAGING-UAT]%';--> statement-breakpoint
INSERT INTO "test_fixtures" (
  "id", "entity_type", "entity_id", "fixture_run_id", "environment", "expires_at"
)
SELECT
  'fixture-space-' || md5(s.id),
  'knowledge_space',
  s.id,
  'uat-legacy-import-0025',
  'staging',
  now() + interval '7 days'
FROM knowledge_spaces s
WHERE exists (
  select 1
  from test_fixtures f
  where f.entity_type = 'project'
    and f.entity_id = s.project_id
);--> statement-breakpoint
CREATE UNIQUE INDEX "test_fixtures_entity_uidx" ON "test_fixtures" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "test_fixtures_run_idx" ON "test_fixtures" USING btree ("fixture_run_id","environment");--> statement-breakpoint
CREATE INDEX "test_fixtures_expiry_idx" ON "test_fixtures" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_ai_executions_request_uidx" ON "timesheet_ai_executions" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_ai_executions_active_owner_date_uidx" ON "timesheet_ai_executions" USING btree ("organization_id","user_id","report_date") WHERE "timesheet_ai_executions"."status" in ('queued', 'reading_notes', 'matching_projects', 'merging_duplicates', 'generating_draft', 'validating_result');--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD CONSTRAINT "timesheet_ai_executions_attempt_check" CHECK ("timesheet_ai_executions"."attempt_count" between 1 and 20);--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD CONSTRAINT "timesheet_ai_executions_lease_check" CHECK (("timesheet_ai_executions"."leased_by" is null and "timesheet_ai_executions"."lease_token" is null and "timesheet_ai_executions"."lease_expires_at" is null) or ("timesheet_ai_executions"."leased_by" is not null and "timesheet_ai_executions"."lease_token" is not null and "timesheet_ai_executions"."lease_expires_at" is not null));--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD CONSTRAINT "timesheet_ai_executions_duration_check" CHECK (coalesce("timesheet_ai_executions"."queue_duration_ms", 0) >= 0 and coalesce("timesheet_ai_executions"."retrieval_duration_ms", 0) >= 0 and coalesce("timesheet_ai_executions"."provider_duration_ms", 0) >= 0 and coalesce("timesheet_ai_executions"."parse_duration_ms", 0) >= 0 and coalesce("timesheet_ai_executions"."persistence_duration_ms", 0) >= 0 and coalesce("timesheet_ai_executions"."total_duration_ms", 0) >= 0);--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD CONSTRAINT "timesheet_ai_executions_status_check" CHECK ("timesheet_ai_executions"."status" in ('queued', 'reading_notes', 'matching_projects', 'merging_duplicates', 'generating_draft', 'validating_result', 'completed', 'failed', 'cancelled', 'running', 'succeeded'));
