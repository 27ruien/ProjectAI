CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TYPE "public"."document_ingestion_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'needs_ocr', 'cancelled');--> statement-breakpoint
CREATE TABLE "document_chunks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version_id" text NOT NULL,
	"section_id" text NOT NULL,
	"ingestion_job_id" text NOT NULL,
	"generation" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"content_sha256" varchar(64) NOT NULL,
	"search_text" text NOT NULL,
	"search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce(search_text, '')), 'A') || to_tsvector('simple', coalesce(search_text, ''))) STORED,
	"character_count" integer NOT NULL,
	"estimated_token_count" integer NOT NULL,
	"heading_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_locator" jsonb NOT NULL,
	"parser_version" varchar(32) NOT NULL,
	"chunker_version" varchar(32) NOT NULL,
	"is_effective" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunks_generation_check" CHECK ("document_chunks"."generation" > 0),
	CONSTRAINT "document_chunks_index_check" CHECK ("document_chunks"."chunk_index" >= 0),
	CONSTRAINT "document_chunks_content_check" CHECK (
      "document_chunks"."character_count" > 0
      and "document_chunks"."character_count" = length("document_chunks"."content")
      and "document_chunks"."estimated_token_count" > 0
      and length(btrim("document_chunks"."content")) > 0
      and length("document_chunks"."content") <= 1000000
    ),
	CONSTRAINT "document_chunks_sha256_check" CHECK ("document_chunks"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "document_chunks_locator_check" CHECK (jsonb_typeof("document_chunks"."source_locator") = 'object')
);
--> statement-breakpoint
CREATE TABLE "document_ingestion_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version_id" text NOT NULL,
	"generation" integer NOT NULL,
	"job_type" varchar(32) DEFAULT 'parse' NOT NULL,
	"status" "document_ingestion_status" DEFAULT 'pending' NOT NULL,
	"parser_version" varchar(32) NOT NULL,
	"chunker_version" varchar(32) NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_by" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failure_code" varchar(64),
	"failure_message" varchar(500),
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_ingestion_jobs_scope_unique" UNIQUE("id","project_id","document_id","version_id","generation"),
	CONSTRAINT "document_ingestion_jobs_generation_check" CHECK ("document_ingestion_jobs"."generation" > 0),
	CONSTRAINT "document_ingestion_jobs_type_check" CHECK ("document_ingestion_jobs"."job_type" = 'parse'),
	CONSTRAINT "document_ingestion_jobs_attempt_check" CHECK (
      "document_ingestion_jobs"."attempt_count" >= 0
      and "document_ingestion_jobs"."max_attempts" > 0
      and "document_ingestion_jobs"."attempt_count" <= "document_ingestion_jobs"."max_attempts"
    ),
	CONSTRAINT "document_ingestion_jobs_version_check" CHECK (
      length(btrim("document_ingestion_jobs"."parser_version")) > 0
      and length(btrim("document_ingestion_jobs"."chunker_version")) > 0
    ),
	CONSTRAINT "document_ingestion_jobs_running_check" CHECK (
      "document_ingestion_jobs"."status" <> 'running' or (
        "document_ingestion_jobs"."leased_by" is not null
        and "document_ingestion_jobs"."lease_expires_at" is not null
        and "document_ingestion_jobs"."started_at" is not null
        and "document_ingestion_jobs"."lease_expires_at" > "document_ingestion_jobs"."started_at"
      )
    ),
	CONSTRAINT "document_ingestion_jobs_succeeded_check" CHECK (
      "document_ingestion_jobs"."status" <> 'succeeded' or (
        "document_ingestion_jobs"."completed_at" is not null and "document_ingestion_jobs"."failure_code" is null
      )
    ),
	CONSTRAINT "document_ingestion_jobs_failed_check" CHECK (
      "document_ingestion_jobs"."status" <> 'failed' or (
        "document_ingestion_jobs"."completed_at" is not null
        and "document_ingestion_jobs"."failure_code" is not null
        and length(btrim("document_ingestion_jobs"."failure_code")) > 0
      )
    ),
	CONSTRAINT "document_ingestion_jobs_ocr_check" CHECK (
      "document_ingestion_jobs"."status" <> 'needs_ocr' or (
        "document_ingestion_jobs"."completed_at" is not null and "document_ingestion_jobs"."failure_code" = 'OCR_REQUIRED'
      )
    ),
	CONSTRAINT "document_ingestion_jobs_terminal_lease_check" CHECK (
      "document_ingestion_jobs"."status" not in ('succeeded', 'failed', 'needs_ocr', 'cancelled') or (
        "document_ingestion_jobs"."leased_by" is null and "document_ingestion_jobs"."lease_expires_at" is null
      )
    )
);
--> statement-breakpoint
CREATE TABLE "document_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version_id" text NOT NULL,
	"ingestion_job_id" text NOT NULL,
	"generation" integer NOT NULL,
	"section_type" varchar(40) NOT NULL,
	"section_index" integer NOT NULL,
	"heading" varchar(500),
	"heading_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"page_number" integer,
	"slide_number" integer,
	"sheet_name" varchar(255),
	"column_start" integer,
	"column_end" integer,
	"row_start" integer,
	"row_end" integer,
	"line_start" integer,
	"line_end" integer,
	"paragraph_start" integer,
	"paragraph_end" integer,
	"source_locator" jsonb NOT NULL,
	"content" text NOT NULL,
	"content_sha256" varchar(64) NOT NULL,
	"character_count" integer NOT NULL,
	"parser_version" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_sections_scope_unique" UNIQUE("id","project_id","document_id","version_id","ingestion_job_id","generation"),
	CONSTRAINT "document_sections_generation_check" CHECK ("document_sections"."generation" > 0),
	CONSTRAINT "document_sections_index_check" CHECK ("document_sections"."section_index" >= 0),
	CONSTRAINT "document_sections_content_check" CHECK (
      "document_sections"."character_count" > 0
      and "document_sections"."character_count" = length("document_sections"."content")
      and length(btrim("document_sections"."content")) > 0
      and length("document_sections"."content") <= 1000000
    ),
	CONSTRAINT "document_sections_sha256_check" CHECK ("document_sections"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "document_sections_locator_check" CHECK (jsonb_typeof("document_sections"."source_locator") = 'object'),
	CONSTRAINT "document_sections_positions_check" CHECK (
      ("document_sections"."page_number" is null or "document_sections"."page_number" > 0)
      and ("document_sections"."slide_number" is null or "document_sections"."slide_number" > 0)
      and ("document_sections"."column_start" is null or "document_sections"."column_start" > 0)
      and ("document_sections"."column_end" is null or "document_sections"."column_end" >= "document_sections"."column_start")
      and ("document_sections"."row_start" is null or "document_sections"."row_start" > 0)
      and ("document_sections"."row_end" is null or "document_sections"."row_end" >= "document_sections"."row_start")
      and ("document_sections"."line_start" is null or "document_sections"."line_start" > 0)
      and ("document_sections"."line_end" is null or "document_sections"."line_end" >= "document_sections"."line_start")
      and ("document_sections"."paragraph_start" is null or "document_sections"."paragraph_start" > 0)
      and ("document_sections"."paragraph_end" is null or "document_sections"."paragraph_end" >= "document_sections"."paragraph_start")
    )
);
--> statement-breakpoint
ALTER TABLE "project_document_versions" ADD CONSTRAINT "project_document_versions_id_document_project_unique" UNIQUE("id","document_id","project_id");--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_section_scope_fk" FOREIGN KEY ("section_id","project_id","document_id","version_id","ingestion_job_id","generation") REFERENCES "public"."document_sections"("id","project_id","document_id","version_id","ingestion_job_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ingestion_jobs" ADD CONSTRAINT "document_ingestion_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ingestion_jobs" ADD CONSTRAINT "document_ingestion_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_ingestion_jobs" ADD CONSTRAINT "document_ingestion_jobs_version_scope_fk" FOREIGN KEY ("version_id","document_id","project_id") REFERENCES "public"."project_document_versions"("id","document_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sections" ADD CONSTRAINT "document_sections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sections" ADD CONSTRAINT "document_sections_version_scope_fk" FOREIGN KEY ("version_id","document_id","project_id") REFERENCES "public"."project_document_versions"("id","document_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sections" ADD CONSTRAINT "document_sections_job_scope_fk" FOREIGN KEY ("ingestion_job_id","project_id","document_id","version_id","generation") REFERENCES "public"."document_ingestion_jobs"("id","project_id","document_id","version_id","generation") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunks_generation_index_uidx" ON "document_chunks" USING btree ("version_id","generation","chunk_index");--> statement-breakpoint
CREATE INDEX "document_chunks_effective_project_idx" ON "document_chunks" USING btree ("project_id","is_effective","document_id");--> statement-breakpoint
CREATE INDEX "document_chunks_search_vector_idx" ON "document_chunks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "document_chunks_search_trgm_idx" ON "document_chunks" USING gin ("search_text" gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "document_ingestion_jobs_generation_uidx" ON "document_ingestion_jobs" USING btree ("version_id","generation","parser_version","chunker_version");--> statement-breakpoint
CREATE INDEX "document_ingestion_jobs_claim_idx" ON "document_ingestion_jobs" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "document_ingestion_jobs_version_idx" ON "document_ingestion_jobs" USING btree ("project_id","document_id","version_id","generation");--> statement-breakpoint
CREATE UNIQUE INDEX "document_sections_job_index_uidx" ON "document_sections" USING btree ("ingestion_job_id","section_index");--> statement-breakpoint
CREATE INDEX "document_sections_version_idx" ON "document_sections" USING btree ("project_id","document_id","version_id","generation");
