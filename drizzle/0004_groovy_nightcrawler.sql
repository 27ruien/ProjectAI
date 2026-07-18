CREATE EXTENSION IF NOT EXISTS "vector";--> statement-breakpoint
CREATE TYPE "public"."document_embedding_batch_status" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."document_embedding_job_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."document_embedding_status" AS ENUM('current', 'invalid');--> statement-breakpoint
CREATE TABLE "ai_embedding_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"model" varchar(120) NOT NULL,
	"region" varchar(64) NOT NULL,
	"dimensions" integer NOT NULL,
	"distance_metric" varchar(24) NOT NULL,
	"profile_version" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_embedding_profiles_definition_unique" UNIQUE("provider","model","region","dimensions","distance_metric","profile_version"),
	CONSTRAINT "ai_embedding_profiles_values_check" CHECK (
      length(btrim("ai_embedding_profiles"."id")) > 0
      and length(btrim("ai_embedding_profiles"."provider")) > 0
      and length(btrim("ai_embedding_profiles"."model")) > 0
      and length(btrim("ai_embedding_profiles"."region")) > 0
      and "ai_embedding_profiles"."dimensions" = 1024
      and "ai_embedding_profiles"."distance_metric" = 'cosine'
      and "ai_embedding_profiles"."profile_version" > 0
    )
);
--> statement-breakpoint
INSERT INTO "ai_embedding_profiles" (
	"id",
	"provider",
	"model",
	"region",
	"dimensions",
	"distance_metric",
	"profile_version",
	"enabled"
) VALUES (
	'qwen-text-embedding-cn-v1',
	'qwen',
	'text-embedding-v4',
	'cn-beijing',
	1024,
	'cosine',
	1,
	true
) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "document_chunk_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"embedding_profile_id" text NOT NULL,
	"embedding_job_id" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"content_sha256" varchar(64) NOT NULL,
	"status" "document_embedding_status" DEFAULT 'current' NOT NULL,
	"input_token_count" integer,
	"provider_request_id" varchar(240),
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_chunk_embeddings_sha256_check" CHECK ("document_chunk_embeddings"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "document_chunk_embeddings_token_check" CHECK ("document_chunk_embeddings"."input_token_count" is null or "document_chunk_embeddings"."input_token_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "document_embedding_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version_id" text NOT NULL,
	"embedding_profile_id" text NOT NULL,
	"request_sha256" varchar(64) NOT NULL,
	"batch_index" integer NOT NULL,
	"attempt_count" integer NOT NULL,
	"status" "document_embedding_batch_status" NOT NULL,
	"model" varchar(120) NOT NULL,
	"dimensions" integer NOT NULL,
	"chunk_count" integer NOT NULL,
	"input_token_count" integer,
	"total_token_count" integer,
	"cost_micro_cny" integer,
	"latency_ms" integer NOT NULL,
	"provider_request_id" varchar(240),
	"failure_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_embedding_batches_values_check" CHECK (
      "document_embedding_batches"."request_sha256" ~ '^[0-9a-f]{64}$'
      and "document_embedding_batches"."batch_index" >= 0
      and "document_embedding_batches"."attempt_count" > 0
      and "document_embedding_batches"."dimensions" = 1024
      and "document_embedding_batches"."chunk_count" between 1 and 10
      and ("document_embedding_batches"."input_token_count" is null or "document_embedding_batches"."input_token_count" >= 0)
      and ("document_embedding_batches"."total_token_count" is null or "document_embedding_batches"."total_token_count" >= 0)
      and ("document_embedding_batches"."cost_micro_cny" is null or "document_embedding_batches"."cost_micro_cny" >= 0)
      and "document_embedding_batches"."latency_ms" >= 0
    ),
	CONSTRAINT "document_embedding_batches_status_check" CHECK (
      ("document_embedding_batches"."status" = 'succeeded' and "document_embedding_batches"."failure_code" is null)
      or (
        "document_embedding_batches"."status" = 'failed'
        and "document_embedding_batches"."failure_code" is not null
        and length(btrim("document_embedding_batches"."failure_code")) > 0
      )
    )
);
--> statement-breakpoint
CREATE TABLE "document_embedding_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version_id" text NOT NULL,
	"embedding_profile_id" text NOT NULL,
	"generation" integer NOT NULL,
	"status" "document_embedding_job_status" DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"leased_by" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"failure_code" varchar(80),
	"failure_message" varchar(500),
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"completed_chunk_count" integer DEFAULT 0 NOT NULL,
	"input_token_count" integer,
	"total_token_count" integer,
	"provider_call_count" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_by" text NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_embedding_jobs_scope_unique" UNIQUE("id","project_id","document_id","version_id","embedding_profile_id"),
	CONSTRAINT "document_embedding_jobs_generation_check" CHECK ("document_embedding_jobs"."generation" > 0),
	CONSTRAINT "document_embedding_jobs_attempt_check" CHECK (
      "document_embedding_jobs"."attempt_count" >= 0
      and "document_embedding_jobs"."max_attempts" > 0
      and "document_embedding_jobs"."attempt_count" <= "document_embedding_jobs"."max_attempts"
    ),
	CONSTRAINT "document_embedding_jobs_counts_check" CHECK (
      "document_embedding_jobs"."chunk_count" >= 0
      and "document_embedding_jobs"."completed_chunk_count" >= 0
      and "document_embedding_jobs"."completed_chunk_count" <= "document_embedding_jobs"."chunk_count"
      and "document_embedding_jobs"."provider_call_count" >= 0
      and "document_embedding_jobs"."latency_ms" >= 0
      and ("document_embedding_jobs"."input_token_count" is null or "document_embedding_jobs"."input_token_count" >= 0)
      and ("document_embedding_jobs"."total_token_count" is null or "document_embedding_jobs"."total_token_count" >= 0)
    ),
	CONSTRAINT "document_embedding_jobs_running_check" CHECK (
      "document_embedding_jobs"."status" <> 'running' or (
        "document_embedding_jobs"."leased_by" is not null
        and "document_embedding_jobs"."lease_expires_at" is not null
        and "document_embedding_jobs"."started_at" is not null
        and "document_embedding_jobs"."lease_expires_at" > "document_embedding_jobs"."started_at"
      )
    ),
	CONSTRAINT "document_embedding_jobs_terminal_check" CHECK (
      "document_embedding_jobs"."status" not in ('succeeded', 'failed', 'cancelled') or (
        "document_embedding_jobs"."completed_at" is not null
        and "document_embedding_jobs"."leased_by" is null
        and "document_embedding_jobs"."lease_expires_at" is null
      )
    ),
	CONSTRAINT "document_embedding_jobs_succeeded_check" CHECK (
      "document_embedding_jobs"."status" <> 'succeeded' or (
        "document_embedding_jobs"."failure_code" is null
        and "document_embedding_jobs"."completed_chunk_count" = "document_embedding_jobs"."chunk_count"
      )
    ),
	CONSTRAINT "document_embedding_jobs_failed_check" CHECK (
      "document_embedding_jobs"."status" <> 'failed' or (
        "document_embedding_jobs"."failure_code" is not null
        and length(btrim("document_embedding_jobs"."failure_code")) > 0
      )
    )
);
--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_embedding_scope_unique" UNIQUE("id","project_id","document_id","version_id","content_sha256");--> statement-breakpoint
ALTER TABLE "document_chunk_embeddings" ADD CONSTRAINT "document_chunk_embeddings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunk_embeddings" ADD CONSTRAINT "document_chunk_embeddings_embedding_profile_id_ai_embedding_profiles_id_fk" FOREIGN KEY ("embedding_profile_id") REFERENCES "public"."ai_embedding_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunk_embeddings" ADD CONSTRAINT "document_chunk_embeddings_chunk_scope_fk" FOREIGN KEY ("chunk_id","project_id","document_id","version_id","content_sha256") REFERENCES "public"."document_chunks"("id","project_id","document_id","version_id","content_sha256") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunk_embeddings" ADD CONSTRAINT "document_chunk_embeddings_job_scope_fk" FOREIGN KEY ("embedding_job_id","project_id","document_id","version_id","embedding_profile_id") REFERENCES "public"."document_embedding_jobs"("id","project_id","document_id","version_id","embedding_profile_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embedding_batches" ADD CONSTRAINT "document_embedding_batches_job_scope_fk" FOREIGN KEY ("job_id","project_id","document_id","version_id","embedding_profile_id") REFERENCES "public"."document_embedding_jobs"("id","project_id","document_id","version_id","embedding_profile_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embedding_jobs" ADD CONSTRAINT "document_embedding_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embedding_jobs" ADD CONSTRAINT "document_embedding_jobs_embedding_profile_id_ai_embedding_profiles_id_fk" FOREIGN KEY ("embedding_profile_id") REFERENCES "public"."ai_embedding_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embedding_jobs" ADD CONSTRAINT "document_embedding_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_embedding_jobs" ADD CONSTRAINT "document_embedding_jobs_version_scope_fk" FOREIGN KEY ("version_id","document_id","project_id") REFERENCES "public"."project_document_versions"("id","document_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_embedding_profiles_enabled_idx" ON "ai_embedding_profiles" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "document_chunk_embeddings_chunk_profile_uidx" ON "document_chunk_embeddings" USING btree ("chunk_id","embedding_profile_id");--> statement-breakpoint
CREATE INDEX "document_chunk_embeddings_effective_idx" ON "document_chunk_embeddings" USING btree ("project_id","embedding_profile_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "document_embedding_batches_request_uidx" ON "document_embedding_batches" USING btree ("job_id","request_sha256","attempt_count");--> statement-breakpoint
CREATE INDEX "document_embedding_batches_created_idx" ON "document_embedding_batches" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_embedding_jobs_generation_uidx" ON "document_embedding_jobs" USING btree ("version_id","embedding_profile_id","generation");--> statement-breakpoint
CREATE INDEX "document_embedding_jobs_claim_idx" ON "document_embedding_jobs" USING btree ("status","available_at","created_at");--> statement-breakpoint
CREATE INDEX "document_embedding_jobs_scope_idx" ON "document_embedding_jobs" USING btree ("project_id","document_id","version_id","embedding_profile_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "invalidate_document_chunk_embeddings"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."is_effective" = true AND NEW."is_effective" = false THEN
		UPDATE "document_chunk_embeddings"
		SET "status" = 'invalid', "updated_at" = now()
		WHERE "chunk_id" = NEW."id" AND "status" = 'current';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "document_chunks_invalidate_embeddings_trigger"
AFTER UPDATE OF "is_effective" ON "document_chunks"
FOR EACH ROW
EXECUTE FUNCTION "invalidate_document_chunk_embeddings"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "protect_ai_embedding_profile_definition"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD."provider" IS DISTINCT FROM NEW."provider"
		OR OLD."model" IS DISTINCT FROM NEW."model"
		OR OLD."region" IS DISTINCT FROM NEW."region"
		OR OLD."dimensions" IS DISTINCT FROM NEW."dimensions"
		OR OLD."distance_metric" IS DISTINCT FROM NEW."distance_metric"
		OR OLD."profile_version" IS DISTINCT FROM NEW."profile_version" THEN
		RAISE EXCEPTION 'Embedding Profile definitions are immutable; insert a new Profile Version.';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_embedding_profiles_definition_immutable_trigger"
BEFORE UPDATE ON "ai_embedding_profiles"
FOR EACH ROW
EXECUTE FUNCTION "protect_ai_embedding_profile_definition"();
