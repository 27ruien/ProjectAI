ALTER TABLE "workflow_run_sources" DROP CONSTRAINT "workflow_run_sources_status_check";--> statement-breakpoint
ALTER TABLE "workflow_run_sources" ADD CONSTRAINT "workflow_run_sources_status_check" CHECK ("workflow_run_sources"."status" in ('uploading', 'uploaded', 'ready', 'deleting', 'expired', 'deleted', 'failed'));--> statement-breakpoint
DELETE FROM "test_fixtures" f
WHERE f."fixture_run_id" = 'uat-legacy-import-0025'
  AND f."entity_type" = 'organization'
  AND NOT EXISTS (
    SELECT 1 FROM "organizations" o
    WHERE o."id" = f."entity_id"
      AND o."id" = 'uat-org-projectai-v1'
  );--> statement-breakpoint
DELETE FROM "test_fixtures" f
WHERE f."fixture_run_id" = 'uat-legacy-import-0025'
  AND f."entity_type" = 'department'
  AND NOT EXISTS (
    SELECT 1 FROM "departments" d
    WHERE d."id" = f."entity_id"
      AND d."code" ~ '^UAT-[A-F0-9]{8}-[1-5]$'
  );--> statement-breakpoint
DELETE FROM "test_fixtures" f
WHERE f."fixture_run_id" = 'uat-legacy-import-0025'
  AND f."entity_type" = 'project'
  AND NOT EXISTS (
    SELECT 1 FROM "projects" p
    WHERE p."id" = f."entity_id"
      AND (
        p."organization_id" = 'uat-org-projectai-v1'
        OR p."name" ~* '^(Member Creator UAT [0-9a-f]{8}( 已更新)?|Product V2 ACL UAT [0-9a-f]{8}|需求结果空间 [0-9a-f]{8})$'
      )
  );--> statement-breakpoint
DELETE FROM "test_fixtures" f
WHERE f."fixture_run_id" = 'uat-legacy-import-0025'
  AND f."entity_type" = 'knowledge_space'
  AND NOT EXISTS (
    SELECT 1
    FROM "knowledge_spaces" s
    JOIN "test_fixtures" project_fixture
      ON project_fixture."entity_type" = 'project'
     AND project_fixture."entity_id" = s."project_id"
     AND project_fixture."fixture_run_id" = 'uat-legacy-import-0025'
    WHERE s."id" = f."entity_id"
  );
