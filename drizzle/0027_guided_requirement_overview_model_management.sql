CREATE TABLE "ai_provider_profiles" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "name" varchar(120) NOT NULL,
  "provider_type" varchar(32) NOT NULL,
  "base_url" varchar(500) NOT NULL,
  "region" varchar(80) NOT NULL,
  "secret_ref" varchar(80) NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "last_test_status" varchar(24) DEFAULT 'not_tested' NOT NULL,
  "last_tested_at" timestamp with time zone,
  "last_test_error_code" varchar(80),
  "created_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "updated_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_provider_profile_type_check" CHECK ("provider_type" in ('dashscope', 'openai_compatible')),
  CONSTRAINT "ai_provider_profile_test_check" CHECK ("last_test_status" in ('not_tested', 'passed', 'failed'))
);
CREATE UNIQUE INDEX "ai_provider_profile_org_name_uidx" ON "ai_provider_profiles" ("organization_id", "name");
CREATE INDEX "ai_provider_profile_org_enabled_idx" ON "ai_provider_profiles" ("organization_id", "enabled");

CREATE TABLE "ai_generation_models" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "provider_profile_id" text NOT NULL REFERENCES "ai_provider_profiles"("id") ON DELETE restrict,
  "display_name" varchar(120) NOT NULL,
  "model_id" varchar(160) NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "supports_json" boolean DEFAULT true NOT NULL,
  "last_test_status" varchar(24) DEFAULT 'not_tested' NOT NULL,
  "last_tested_at" timestamp with time zone,
  "created_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "updated_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_generation_model_test_check" CHECK ("last_test_status" in ('not_tested', 'passed', 'failed'))
);
CREATE UNIQUE INDEX "ai_generation_model_org_model_uidx" ON "ai_generation_models" ("organization_id", "model_id");
CREATE INDEX "ai_generation_model_provider_idx" ON "ai_generation_models" ("provider_profile_id", "enabled");

CREATE TABLE "ai_embedding_models" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "provider_profile_id" text NOT NULL REFERENCES "ai_provider_profiles"("id") ON DELETE restrict,
  "display_name" varchar(120) NOT NULL,
  "model_id" varchar(160) NOT NULL,
  "dimensions" integer NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "last_test_status" varchar(24) DEFAULT 'not_tested' NOT NULL,
  "last_tested_at" timestamp with time zone,
  "created_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "updated_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_embedding_model_dimensions_check" CHECK ("dimensions" = 1024),
  CONSTRAINT "ai_embedding_model_test_check" CHECK ("last_test_status" in ('not_tested', 'passed', 'failed'))
);
CREATE UNIQUE INDEX "ai_embedding_model_org_model_uidx" ON "ai_embedding_models" ("organization_id", "model_id");

CREATE TABLE "ai_scenario_bindings" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL REFERENCES "organizations"("id") ON DELETE cascade,
  "scenario" varchar(80) NOT NULL,
  "generation_model_id" text REFERENCES "ai_generation_models"("id") ON DELETE restrict,
  "embedding_model_id" text REFERENCES "ai_embedding_models"("id") ON DELETE restrict,
  "enabled" boolean DEFAULT false NOT NULL,
  "updated_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_scenario_binding_name_check" CHECK ("scenario" in ('general_chat','project_grounded_chat','requirement_overview_prefill','requirement_overview_guidance','requirement_markdown_generation'))
);
CREATE UNIQUE INDEX "ai_scenario_binding_org_scenario_uidx" ON "ai_scenario_bindings" ("organization_id", "scenario");

CREATE TABLE "guided_requirement_overviews" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "version_number" integer NOT NULL,
  "status" varchar(32) DEFAULT 'prefilled' NOT NULL,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "markdown" text DEFAULT '' NOT NULL,
  "source_digest" varchar(64) NOT NULL,
  "source_snapshot_at" timestamp with time zone DEFAULT now() NOT NULL,
  "generation_model_id" text REFERENCES "ai_generation_models"("id") ON DELETE restrict,
  "actual_model" varchar(160),
  "failure_code" varchar(80),
  "saved_document_id" text REFERENCES "project_documents"("id") ON DELETE set null,
  "created_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "updated_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "guided_requirement_overview_status_check" CHECK ("status" in ('prefilled','needs_confirmation','ready','generated','failed'))
);
CREATE UNIQUE INDEX "guided_requirement_overview_project_version_uidx" ON "guided_requirement_overviews" ("project_id", "version_number");
CREATE INDEX "guided_requirement_overview_project_updated_idx" ON "guided_requirement_overviews" ("project_id", "updated_at");

CREATE TABLE "guided_requirement_overview_citations" (
  "id" text PRIMARY KEY NOT NULL,
  "overview_id" text NOT NULL REFERENCES "guided_requirement_overviews"("id") ON DELETE cascade,
  "label" varchar(8) NOT NULL,
  "document_id" text NOT NULL REFERENCES "project_documents"("id") ON DELETE restrict,
  "version_id" text NOT NULL REFERENCES "project_document_versions"("id") ON DELETE restrict,
  "chunk_id" text NOT NULL,
  "source_scope" varchar(24) NOT NULL,
  "display_name" varchar(240) NOT NULL,
  "excerpt" text NOT NULL,
  "source_locator" jsonb DEFAULT '{}'::jsonb NOT NULL
);
CREATE UNIQUE INDEX "guided_requirement_overview_citation_uidx" ON "guided_requirement_overview_citations" ("overview_id", "label");
