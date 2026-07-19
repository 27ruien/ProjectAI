CREATE TYPE "public"."ai_retrieval_candidate_source" AS ENUM('lexical', 'vector', 'both');--> statement-breakpoint
CREATE TYPE "public"."ai_retrieval_mode" AS ENUM('lexical', 'shadow', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."ai_retrieval_query_embedding_call_status" AS ENUM('reserved', 'calling', 'succeeded', 'failed_confirmed_no_charge', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."ai_retrieval_run_status" AS ENUM('running', 'succeeded', 'fallback_lexical', 'failed', 'insufficient_evidence');--> statement-breakpoint
CREATE TABLE "ai_retrieval_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"profile_version" integer NOT NULL,
	"lexical_candidate_limit" integer NOT NULL,
	"vector_candidate_limit" integer NOT NULL,
	"fused_candidate_limit" integer NOT NULL,
	"evidence_limit" integer NOT NULL,
	"rrf_k" integer NOT NULL,
	"lexical_weight" double precision NOT NULL,
	"vector_weight" double precision NOT NULL,
	"vector_max_distance" double precision NOT NULL,
	"min_embedding_coverage_bps" integer NOT NULL,
	"embedding_profile_id" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_retrieval_profiles_version_unique" UNIQUE("id","profile_version"),
	CONSTRAINT "ai_retrieval_profiles_values_check" CHECK (
      length(btrim("ai_retrieval_profiles"."id")) > 0
      and "ai_retrieval_profiles"."profile_version" > 0
      and "ai_retrieval_profiles"."lexical_candidate_limit" between 1 and 30
      and "ai_retrieval_profiles"."vector_candidate_limit" between 1 and 30
      and "ai_retrieval_profiles"."fused_candidate_limit" between 1 and 30
      and "ai_retrieval_profiles"."evidence_limit" between 1 and 10
      and "ai_retrieval_profiles"."rrf_k" between 1 and 1000
      and "ai_retrieval_profiles"."lexical_weight" > 0
      and "ai_retrieval_profiles"."vector_weight" > 0
      and "ai_retrieval_profiles"."vector_max_distance" between 0 and 2
      and "ai_retrieval_profiles"."min_embedding_coverage_bps" between 0 and 10000
    )
);
--> statement-breakpoint
INSERT INTO "ai_retrieval_profiles" (
	"id", "profile_version", "lexical_candidate_limit",
	"vector_candidate_limit", "fused_candidate_limit", "evidence_limit",
	"rrf_k", "lexical_weight", "vector_weight", "vector_max_distance",
	"min_embedding_coverage_bps", "embedding_profile_id", "enabled"
) VALUES (
	'hybrid-rrf-v1', 1, 30, 30, 30, 10,
	60, 1.0, 1.0, 0.55, 9800,
	'qwen-text-embedding-cn-v1', true
) ON CONFLICT ("id") DO NOTHING;
--> statement-breakpoint
CREATE TABLE "ai_retrieval_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"retrieval_run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version_id" text NOT NULL,
	"candidate_source" "ai_retrieval_candidate_source" NOT NULL,
	"lexical_rank" integer,
	"lexical_score" double precision,
	"vector_rank" integer,
	"vector_distance" double precision,
	"rrf_score" double precision NOT NULL,
	"final_rank" integer,
	"selected_as_evidence" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_retrieval_candidates_rank_check" CHECK (
      ("ai_retrieval_candidates"."lexical_rank" is null or "ai_retrieval_candidates"."lexical_rank" between 1 and 30)
      and ("ai_retrieval_candidates"."vector_rank" is null or "ai_retrieval_candidates"."vector_rank" between 1 and 30)
      and ("ai_retrieval_candidates"."final_rank" is null or "ai_retrieval_candidates"."final_rank" between 1 and 30)
      and "ai_retrieval_candidates"."rrf_score" >= 0
      and ("ai_retrieval_candidates"."lexical_score" is null or "ai_retrieval_candidates"."lexical_score" >= 0)
      and ("ai_retrieval_candidates"."vector_distance" is null or "ai_retrieval_candidates"."vector_distance" between 0 and 2)
    ),
	CONSTRAINT "ai_retrieval_candidates_source_check" CHECK (
      ("ai_retrieval_candidates"."candidate_source" = 'lexical' and "ai_retrieval_candidates"."lexical_rank" is not null and "ai_retrieval_candidates"."vector_rank" is null)
      or ("ai_retrieval_candidates"."candidate_source" = 'vector' and "ai_retrieval_candidates"."lexical_rank" is null and "ai_retrieval_candidates"."vector_rank" is not null)
      or ("ai_retrieval_candidates"."candidate_source" = 'both' and "ai_retrieval_candidates"."lexical_rank" is not null and "ai_retrieval_candidates"."vector_rank" is not null)
    )
);
--> statement-breakpoint
CREATE TABLE "ai_retrieval_query_embedding_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"retrieval_run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"embedding_profile_id" text NOT NULL,
	"status" "ai_retrieval_query_embedding_call_status" DEFAULT 'reserved' NOT NULL,
	"dispatch_classification" varchar(40),
	"budget_rule_version" varchar(80) NOT NULL,
	"reserved_input_tokens" integer NOT NULL,
	"input_token_count" integer,
	"total_token_count" integer,
	"provider_request_id" varchar(240),
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"failure_code" varchar(80),
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_retrieval_query_embedding_calls_values_check" CHECK (
      length(btrim("ai_retrieval_query_embedding_calls"."budget_rule_version")) > 0
      and "ai_retrieval_query_embedding_calls"."reserved_input_tokens" = 8192
      and ("ai_retrieval_query_embedding_calls"."input_token_count" is null or "ai_retrieval_query_embedding_calls"."input_token_count" >= 0)
      and ("ai_retrieval_query_embedding_calls"."total_token_count" is null or "ai_retrieval_query_embedding_calls"."total_token_count" >= 0)
      and "ai_retrieval_query_embedding_calls"."latency_ms" >= 0
      and (
        "ai_retrieval_query_embedding_calls"."dispatch_classification" is null
        or "ai_retrieval_query_embedding_calls"."dispatch_classification" in (
          'pre_dispatch', 'post_dispatch', 'explicit_http_rejection',
          'successful_response'
        )
      )
    ),
	CONSTRAINT "ai_retrieval_query_embedding_calls_status_check" CHECK (
      (
        "ai_retrieval_query_embedding_calls"."status" = 'reserved'
        and "ai_retrieval_query_embedding_calls"."dispatch_classification" is null
        and "ai_retrieval_query_embedding_calls"."failure_code" is null
        and "ai_retrieval_query_embedding_calls"."dispatched_at" is null
        and "ai_retrieval_query_embedding_calls"."completed_at" is null
      ) or (
        "ai_retrieval_query_embedding_calls"."status" = 'calling'
        and "ai_retrieval_query_embedding_calls"."dispatch_classification" = 'post_dispatch'
        and "ai_retrieval_query_embedding_calls"."failure_code" is null
        and "ai_retrieval_query_embedding_calls"."dispatched_at" is not null
        and "ai_retrieval_query_embedding_calls"."completed_at" is null
      ) or (
        "ai_retrieval_query_embedding_calls"."status" = 'succeeded'
        and "ai_retrieval_query_embedding_calls"."dispatch_classification" = 'successful_response'
        and "ai_retrieval_query_embedding_calls"."failure_code" is null
        and "ai_retrieval_query_embedding_calls"."dispatched_at" is not null
        and "ai_retrieval_query_embedding_calls"."completed_at" is not null
      ) or (
        "ai_retrieval_query_embedding_calls"."status" = 'failed_confirmed_no_charge'
        and "ai_retrieval_query_embedding_calls"."dispatch_classification" = 'pre_dispatch'
        and "ai_retrieval_query_embedding_calls"."failure_code" is not null
        and length(btrim("ai_retrieval_query_embedding_calls"."failure_code")) > 0
        and "ai_retrieval_query_embedding_calls"."completed_at" is not null
      ) or (
        "ai_retrieval_query_embedding_calls"."status" = 'unknown'
        and "ai_retrieval_query_embedding_calls"."dispatch_classification" in (
          'post_dispatch', 'explicit_http_rejection', 'successful_response'
        )
        and "ai_retrieval_query_embedding_calls"."failure_code" = 'PROVIDER_RESULT_UNKNOWN'
        and "ai_retrieval_query_embedding_calls"."dispatched_at" is not null
        and "ai_retrieval_query_embedding_calls"."completed_at" is not null
      )
    )
);
--> statement-breakpoint
CREATE TABLE "ai_retrieval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"user_message_id" text NOT NULL,
	"ai_execution_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"retrieval_profile_id" text NOT NULL,
	"requested_mode" "ai_retrieval_mode" NOT NULL,
	"effective_mode" "ai_retrieval_mode",
	"status" "ai_retrieval_run_status" DEFAULT 'running' NOT NULL,
	"query_sha256" varchar(64) NOT NULL,
	"lexical_candidate_count" integer DEFAULT 0 NOT NULL,
	"vector_candidate_count" integer DEFAULT 0 NOT NULL,
	"fused_candidate_count" integer DEFAULT 0 NOT NULL,
	"selected_evidence_count" integer DEFAULT 0 NOT NULL,
	"embedding_coverage_bps" integer DEFAULT 0 NOT NULL,
	"lexical_latency_ms" integer DEFAULT 0 NOT NULL,
	"query_embedding_latency_ms" integer DEFAULT 0 NOT NULL,
	"vector_latency_ms" integer DEFAULT 0 NOT NULL,
	"fusion_latency_ms" integer DEFAULT 0 NOT NULL,
	"total_latency_ms" integer DEFAULT 0 NOT NULL,
	"fallback_reason" varchar(80),
	"retrieval_version" varchar(32) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_retrieval_runs_project_scope_unique" UNIQUE("id","project_id"),
	CONSTRAINT "ai_retrieval_runs_actor_scope_unique" UNIQUE("id","project_id","actor_user_id"),
	CONSTRAINT "ai_retrieval_runs_query_hash_check" CHECK ("ai_retrieval_runs"."query_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_retrieval_runs_counts_check" CHECK (
      "ai_retrieval_runs"."lexical_candidate_count" between 0 and 30
      and "ai_retrieval_runs"."vector_candidate_count" between 0 and 30
      and "ai_retrieval_runs"."fused_candidate_count" between 0 and 30
      and "ai_retrieval_runs"."selected_evidence_count" between 0 and 10
      and "ai_retrieval_runs"."embedding_coverage_bps" between 0 and 10000
      and "ai_retrieval_runs"."lexical_latency_ms" >= 0
      and "ai_retrieval_runs"."query_embedding_latency_ms" >= 0
      and "ai_retrieval_runs"."vector_latency_ms" >= 0
      and "ai_retrieval_runs"."fusion_latency_ms" >= 0
      and "ai_retrieval_runs"."total_latency_ms" >= 0
    ),
	CONSTRAINT "ai_retrieval_runs_status_check" CHECK (
      (
        "ai_retrieval_runs"."status" = 'running'
        and "ai_retrieval_runs"."effective_mode" is null
        and "ai_retrieval_runs"."completed_at" is null
      ) or (
        "ai_retrieval_runs"."status" = 'succeeded'
        and "ai_retrieval_runs"."effective_mode" is not null
        and "ai_retrieval_runs"."fallback_reason" is null
        and "ai_retrieval_runs"."completed_at" is not null
      ) or (
        "ai_retrieval_runs"."status" = 'insufficient_evidence'
        and "ai_retrieval_runs"."effective_mode" is not null
        and "ai_retrieval_runs"."completed_at" is not null
      ) or (
        "ai_retrieval_runs"."status" in ('fallback_lexical', 'failed')
        and "ai_retrieval_runs"."effective_mode" is not null
        and "ai_retrieval_runs"."fallback_reason" is not null
        and length(btrim("ai_retrieval_runs"."fallback_reason")) > 0
        and "ai_retrieval_runs"."completed_at" is not null
      )
    )
);
--> statement-breakpoint
ALTER TABLE "ai_executions" ADD COLUMN "retrieval_run_id" text;--> statement-breakpoint
ALTER TABLE "ai_executions" ADD COLUMN "requested_retrieval_mode" "ai_retrieval_mode" DEFAULT 'lexical' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_executions" ADD COLUMN "effective_retrieval_mode" "ai_retrieval_mode";--> statement-breakpoint
ALTER TABLE "ai_executions" ADD COLUMN "retrieval_profile_id" text DEFAULT 'hybrid-rrf-v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_executions" ADD COLUMN "retrieval_fallback_reason" varchar(80);--> statement-breakpoint
ALTER TABLE "ai_retrieval_profiles" ADD CONSTRAINT "ai_retrieval_profiles_embedding_profile_id_ai_embedding_profiles_id_fk" FOREIGN KEY ("embedding_profile_id") REFERENCES "public"."ai_embedding_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_retrieval_candidates" ADD CONSTRAINT "ai_retrieval_candidates_run_scope_fk" FOREIGN KEY ("retrieval_run_id","project_id") REFERENCES "public"."ai_retrieval_runs"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_retrieval_candidates" ADD CONSTRAINT "ai_retrieval_candidates_chunk_scope_fk" FOREIGN KEY ("chunk_id","project_id","document_id","version_id") REFERENCES "public"."document_chunks"("id","project_id","document_id","version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_retrieval_query_embedding_calls" ADD CONSTRAINT "ai_retrieval_query_embedding_calls_embedding_profile_id_ai_embedding_profiles_id_fk" FOREIGN KEY ("embedding_profile_id") REFERENCES "public"."ai_embedding_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_retrieval_query_embedding_calls" ADD CONSTRAINT "ai_retrieval_query_embedding_calls_run_scope_fk" FOREIGN KEY ("retrieval_run_id","project_id","actor_user_id") REFERENCES "public"."ai_retrieval_runs"("id","project_id","actor_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD CONSTRAINT "ai_retrieval_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD CONSTRAINT "ai_retrieval_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD CONSTRAINT "ai_retrieval_runs_retrieval_profile_id_ai_retrieval_profiles_id_fk" FOREIGN KEY ("retrieval_profile_id") REFERENCES "public"."ai_retrieval_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD CONSTRAINT "ai_retrieval_runs_execution_scope_fk" FOREIGN KEY ("ai_execution_id","project_id","thread_id") REFERENCES "public"."ai_executions"("id","project_id","thread_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD CONSTRAINT "ai_retrieval_runs_thread_owner_scope_fk" FOREIGN KEY ("thread_id","project_id","actor_user_id") REFERENCES "public"."ai_threads"("id","project_id","created_by") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD CONSTRAINT "ai_retrieval_runs_user_message_scope_fk" FOREIGN KEY ("user_message_id","project_id","thread_id") REFERENCES "public"."ai_messages"("id","project_id","thread_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_retrieval_profiles_enabled_idx" ON "ai_retrieval_profiles" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_retrieval_candidates_run_chunk_uidx" ON "ai_retrieval_candidates" USING btree ("retrieval_run_id","chunk_id");--> statement-breakpoint
CREATE INDEX "ai_retrieval_candidates_run_rank_idx" ON "ai_retrieval_candidates" USING btree ("retrieval_run_id","final_rank");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_retrieval_query_embedding_calls_run_uidx" ON "ai_retrieval_query_embedding_calls" USING btree ("retrieval_run_id");--> statement-breakpoint
CREATE INDEX "ai_retrieval_query_embedding_calls_budget_idx" ON "ai_retrieval_query_embedding_calls" USING btree ("created_at","status");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_retrieval_runs_execution_uidx" ON "ai_retrieval_runs" USING btree ("ai_execution_id");--> statement-breakpoint
CREATE INDEX "ai_retrieval_runs_project_created_idx" ON "ai_retrieval_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_retrieval_runs_status_created_idx" ON "ai_retrieval_runs" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_retrieval_profile_id_ai_retrieval_profiles_id_fk" FOREIGN KEY ("retrieval_profile_id") REFERENCES "public"."ai_retrieval_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_executions_retrieval_run_idx" ON "ai_executions" USING btree ("retrieval_run_id");--> statement-breakpoint
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_retrieval_check" CHECK (
      ("ai_executions"."retrieval_run_id" is null and "ai_executions"."effective_retrieval_mode" is null)
      or ("ai_executions"."retrieval_run_id" is not null and "ai_executions"."effective_retrieval_mode" is not null)
    );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION projectai_retrieval_query_call_terminal_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.status IN ('succeeded', 'failed_confirmed_no_charge', 'unknown') THEN
		RAISE EXCEPTION 'terminal query embedding calls are immutable';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ai_retrieval_query_embedding_calls_terminal_immutable"
BEFORE UPDATE ON "ai_retrieval_query_embedding_calls"
FOR EACH ROW
EXECUTE FUNCTION projectai_retrieval_query_call_terminal_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION projectai_retrieval_profile_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF TG_OP = 'DELETE' THEN
		RAISE EXCEPTION 'retrieval profile definitions are immutable';
	END IF;
	IF OLD.id IS DISTINCT FROM NEW.id OR
		OLD.profile_version IS DISTINCT FROM NEW.profile_version OR
		OLD.lexical_candidate_limit IS DISTINCT FROM NEW.lexical_candidate_limit OR
		OLD.vector_candidate_limit IS DISTINCT FROM NEW.vector_candidate_limit OR
		OLD.fused_candidate_limit IS DISTINCT FROM NEW.fused_candidate_limit OR
		OLD.evidence_limit IS DISTINCT FROM NEW.evidence_limit OR
		OLD.rrf_k IS DISTINCT FROM NEW.rrf_k OR
		OLD.lexical_weight IS DISTINCT FROM NEW.lexical_weight OR
		OLD.vector_weight IS DISTINCT FROM NEW.vector_weight OR
		OLD.vector_max_distance IS DISTINCT FROM NEW.vector_max_distance OR
		OLD.min_embedding_coverage_bps IS DISTINCT FROM NEW.min_embedding_coverage_bps OR
		OLD.embedding_profile_id IS DISTINCT FROM NEW.embedding_profile_id
	THEN
		RAISE EXCEPTION 'retrieval profile definitions are immutable';
	END IF;
	RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "ai_retrieval_profiles_immutable"
BEFORE UPDATE OR DELETE ON "ai_retrieval_profiles"
FOR EACH ROW
EXECUTE FUNCTION projectai_retrieval_profile_immutable();
