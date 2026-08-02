CREATE TABLE "guided_requirement_overview_comparison_runs" (
  "id" text PRIMARY KEY NOT NULL,
  "overview_id" text NOT NULL REFERENCES "guided_requirement_overviews"("id") ON DELETE cascade,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "source_digest" varchar(64) NOT NULL,
  "prompt_version" varchar(64) NOT NULL,
  "prompt_digest" varchar(64) NOT NULL,
  "temperature_milli" integer NOT NULL,
  "max_output_tokens" integer NOT NULL,
  "citation_count" integer NOT NULL,
  "status" varchar(24) DEFAULT 'running' NOT NULL,
  "selected_candidate_id" text,
  "created_by" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "guided_requirement_overview_comparison_status_check" CHECK ("status" in ('running','ready','failed','selected')),
  CONSTRAINT "guided_requirement_overview_comparison_config_check" CHECK ("temperature_milli" between 0 and 2000 and "max_output_tokens" between 128 and 16384 and "citation_count" >= 0)
);
CREATE INDEX "guided_requirement_overview_comparison_overview_idx" ON "guided_requirement_overview_comparison_runs" ("overview_id","created_at");
CREATE INDEX "guided_requirement_overview_comparison_project_idx" ON "guided_requirement_overview_comparison_runs" ("project_id","created_at");

CREATE TABLE "guided_requirement_overview_comparison_candidates" (
  "id" text PRIMARY KEY NOT NULL,
  "run_id" text NOT NULL REFERENCES "guided_requirement_overview_comparison_runs"("id") ON DELETE cascade,
  "candidate_order" integer NOT NULL,
  "generation_model_id" text NOT NULL REFERENCES "ai_generation_models"("id") ON DELETE restrict,
  "model_display_name" varchar(120) NOT NULL,
  "provider_name" varchar(120) NOT NULL,
  "actual_model" varchar(160),
  "status" varchar(24) DEFAULT 'running' NOT NULL,
  "items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "input_tokens" integer,
  "output_tokens" integer,
  "total_tokens" integer,
  "latency_ms" integer,
  "failure_code" varchar(80),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone,
  CONSTRAINT "guided_requirement_overview_candidate_status_check" CHECK ("status" in ('running','ready','failed')),
  CONSTRAINT "guided_requirement_overview_candidate_usage_check" CHECK (("input_tokens" is null or "input_tokens" >= 0) and ("output_tokens" is null or "output_tokens" >= 0) and ("total_tokens" is null or "total_tokens" >= 0) and ("latency_ms" is null or "latency_ms" >= 0))
);
CREATE UNIQUE INDEX "guided_requirement_overview_candidate_run_order_uidx" ON "guided_requirement_overview_comparison_candidates" ("run_id","candidate_order");
