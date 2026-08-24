CREATE TYPE "public"."project_knowledge_status" AS ENUM('pending', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ragflow_document_parse_status" AS ENUM('uploading', 'processing', 'ready', 'failed');--> statement-breakpoint

ALTER TABLE "projects" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "ragflow_dataset_id" varchar(64);--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "knowledge_status" "project_knowledge_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "knowledge_failure_code" varchar(64);--> statement-breakpoint

ALTER TABLE "project_documents" ADD COLUMN "ragflow_document_id" varchar(64);--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "ragflow_parse_status" "ragflow_document_parse_status";--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "ragflow_failure_code" varchar(64);--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "mime_type" varchar(200);--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "ragflow_size_bytes" bigint;--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "ragflow_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "project_documents" ALTER COLUMN "knowledge_space_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "project_documents" ALTER COLUMN "knowledge_space_id" DROP DEFAULT;--> statement-breakpoint

DROP TRIGGER IF EXISTS "project_documents_knowledge_space_trigger" ON "project_documents";--> statement-breakpoint
DROP FUNCTION IF EXISTS "projectai_bind_document_knowledge_space"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "project_documents_scope_guard_trigger" ON "project_documents";--> statement-breakpoint
DROP FUNCTION IF EXISTS "projectai_validate_document_knowledge_space_scope"();--> statement-breakpoint
DROP TRIGGER IF EXISTS "projects_default_knowledge_space_trigger" ON "projects";--> statement-breakpoint
DROP FUNCTION IF EXISTS "projectai_ensure_project_knowledge_space"();--> statement-breakpoint

CREATE UNIQUE INDEX "projects_ragflow_dataset_uidx" ON "projects" USING btree ("ragflow_dataset_id");--> statement-breakpoint
CREATE INDEX "projects_knowledge_status_idx" ON "projects" USING btree ("knowledge_status");--> statement-breakpoint
CREATE UNIQUE INDEX "project_documents_ragflow_document_uidx" ON "project_documents" USING btree ("ragflow_document_id");--> statement-breakpoint
CREATE INDEX "project_documents_ragflow_status_idx" ON "project_documents" USING btree ("project_id", "ragflow_parse_status", "updated_at");--> statement-breakpoint

ALTER TABLE "projects" ADD CONSTRAINT "projects_knowledge_state_check" CHECK (
  ("knowledge_status" = 'ready' AND "ragflow_dataset_id" IS NOT NULL AND "knowledge_failure_code" IS NULL)
  OR ("knowledge_status" = 'failed' AND "knowledge_failure_code" IS NOT NULL)
  OR ("knowledge_status" = 'pending' AND "knowledge_failure_code" IS NULL)
);--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_ragflow_state_check" CHECK (
  ("ragflow_document_id" IS NULL AND "ragflow_parse_status" IS NULL AND "ragflow_failure_code" IS NULL)
  OR ("ragflow_document_id" IS NOT NULL AND "ragflow_parse_status" IS NOT NULL
      AND (("ragflow_parse_status" = 'failed' AND "ragflow_failure_code" IS NOT NULL)
           OR ("ragflow_parse_status" <> 'failed' AND "ragflow_failure_code" IS NULL)))
);--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_ragflow_size_check" CHECK (
  "ragflow_size_bytes" IS NULL OR "ragflow_size_bytes" > 0
);--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_ragflow_sha256_check" CHECK (
  "ragflow_sha256" IS NULL OR "ragflow_sha256" ~ '^[0-9a-f]{64}$'
);
