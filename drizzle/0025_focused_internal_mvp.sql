ALTER TYPE "project_status" ADD VALUE IF NOT EXISTS 'archived';

ALTER TABLE "projects" ADD COLUMN "is_internal" boolean DEFAULT false NOT NULL;
CREATE UNIQUE INDEX "projects_internal_organization_uidx" ON "projects" USING btree ("organization_id") WHERE "is_internal" = true;

ALTER TABLE "project_document_versions" ADD COLUMN "version_note" varchar(500);

ALTER TABLE "ai_retrieval_candidates" ADD COLUMN "source_project_id" text;
UPDATE "ai_retrieval_candidates" SET "source_project_id" = "project_id" WHERE "source_project_id" IS NULL;
ALTER TABLE "ai_retrieval_candidates" ALTER COLUMN "source_project_id" SET NOT NULL;
ALTER TABLE "ai_retrieval_candidates" DROP CONSTRAINT "ai_retrieval_candidates_chunk_scope_fk";
ALTER TABLE "ai_retrieval_candidates" ADD CONSTRAINT "ai_retrieval_candidates_chunk_scope_fk"
  FOREIGN KEY ("chunk_id", "source_project_id", "document_id", "version_id")
  REFERENCES "document_chunks"("id", "project_id", "document_id", "version_id") ON DELETE RESTRICT;

ALTER TABLE "ai_message_citations" ADD COLUMN "source_project_id" text;
UPDATE "ai_message_citations" SET "source_project_id" = "project_id" WHERE "source_project_id" IS NULL;
ALTER TABLE "ai_message_citations" ALTER COLUMN "source_project_id" SET NOT NULL;
ALTER TABLE "ai_message_citations" DROP CONSTRAINT "ai_message_citations_chunk_scope_fk";
ALTER TABLE "ai_message_citations" ADD CONSTRAINT "ai_message_citations_chunk_scope_fk"
  FOREIGN KEY ("chunk_id", "source_project_id", "document_id", "version_id")
  REFERENCES "document_chunks"("id", "project_id", "document_id", "version_id") ON DELETE RESTRICT;

CREATE TABLE "company_knowledge_documents" (
  "document_id" text PRIMARY KEY NOT NULL REFERENCES "project_documents"("id") ON DELETE CASCADE,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "category" varchar(40) NOT NULL,
  "lifecycle_status" varchar(24) DEFAULT 'draft' NOT NULL,
  "audience" varchar(24) DEFAULT 'organization' NOT NULL,
  "department_id" text REFERENCES "departments"("id") ON DELETE RESTRICT,
  "created_by" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "published_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "company_knowledge_category_check" CHECK ("category" in ('charter', 'hr', 'project_management', 'security', 'finance', 'template', 'other')),
  CONSTRAINT "company_knowledge_lifecycle_check" CHECK ("lifecycle_status" in ('draft', 'published', 'expired', 'archived')),
  CONSTRAINT "company_knowledge_audience_check" CHECK ("audience" in ('organization', 'department', 'admin')),
  CONSTRAINT "company_knowledge_department_check" CHECK (("audience" = 'department' and "department_id" is not null) or ("audience" <> 'department' and "department_id" is null))
);
CREATE INDEX "company_knowledge_org_status_idx" ON "company_knowledge_documents" USING btree ("organization_id", "lifecycle_status", "category", "updated_at");

CREATE TABLE "focused_requirement_documents" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "version_number" integer NOT NULL,
  "status" varchar(24) DEFAULT 'generating' NOT NULL,
  "sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "markdown" text DEFAULT '' NOT NULL,
  "source_digest" varchar(64) NOT NULL,
  "project_source_count" integer DEFAULT 0 NOT NULL,
  "company_source_count" integer DEFAULT 0 NOT NULL,
  "source_snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
  "skill_id" varchar(80) DEFAULT 'focused-requirement-document-v1' NOT NULL,
  "model_profile_id" varchar(120) NOT NULL,
  "provider" varchar(40),
  "requested_model" varchar(120),
  "actual_model" varchar(120),
  "input_tokens" integer,
  "output_tokens" integer,
  "total_tokens" integer,
  "latency_ms" integer,
  "linked_document_id" text REFERENCES "project_documents"("id") ON DELETE SET NULL,
  "failure_code" varchar(80),
  "created_by" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "updated_by" text NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,
  "published_by" text REFERENCES "users"("id") ON DELETE RESTRICT,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "focused_requirement_status_check" CHECK ("status" in ('generating', 'draft', 'published', 'failed')),
  CONSTRAINT "focused_requirement_version_check" CHECK ("version_number" > 0),
  CONSTRAINT "focused_requirement_usage_check" CHECK (("input_tokens" is null or "input_tokens" >= 0) and ("output_tokens" is null or "output_tokens" >= 0) and ("total_tokens" is null or "total_tokens" >= 0) and ("latency_ms" is null or "latency_ms" >= 0)),
  CONSTRAINT "focused_requirement_source_count_check" CHECK ("project_source_count" >= 0 and "company_source_count" >= 0)
);
CREATE UNIQUE INDEX "focused_requirement_project_version_uidx" ON "focused_requirement_documents" USING btree ("project_id", "version_number");
CREATE INDEX "focused_requirement_project_status_idx" ON "focused_requirement_documents" USING btree ("project_id", "status", "updated_at");

CREATE TABLE "focused_requirement_citations" (
  "id" text PRIMARY KEY NOT NULL,
  "requirement_document_id" text NOT NULL REFERENCES "focused_requirement_documents"("id") ON DELETE CASCADE,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE RESTRICT,
  "citation_index" integer NOT NULL,
  "label" varchar(8) NOT NULL,
  "document_id" text NOT NULL REFERENCES "project_documents"("id") ON DELETE RESTRICT,
  "version_id" text NOT NULL REFERENCES "project_document_versions"("id") ON DELETE RESTRICT,
  "chunk_id" text NOT NULL,
  "source_scope" varchar(24) NOT NULL,
  "display_name" varchar(240) NOT NULL,
  "source_locator" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "excerpt" text NOT NULL,
  "content_sha256" varchar(64) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "focused_requirement_citation_index_check" CHECK ("citation_index" between 1 and 30),
  CONSTRAINT "focused_requirement_citation_scope_check" CHECK ("source_scope" in ('project', 'organization'))
);
CREATE UNIQUE INDEX "focused_requirement_citation_label_uidx" ON "focused_requirement_citations" USING btree ("requirement_document_id", "label");
CREATE INDEX "focused_requirement_citation_source_idx" ON "focused_requirement_citations" USING btree ("project_id", "document_id", "version_id");

ALTER TABLE "ai_threads" ADD COLUMN "deleted_at" timestamp with time zone;
