CREATE TYPE "public"."ai_execution_status" AS ENUM('reserved', 'retrieving', 'calling_provider', 'validating', 'succeeded', 'failed', 'insufficient_evidence');--> statement-breakpoint
CREATE TYPE "public"."ai_message_role" AS ENUM('user', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."ai_message_status" AS ENUM('pending', 'completed', 'failed', 'insufficient_evidence');--> statement-breakpoint
CREATE TYPE "public"."ai_thread_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "ai_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"user_message_id" text NOT NULL,
	"assistant_message_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"model_profile_id" text NOT NULL,
	"provider" varchar(32) NOT NULL,
	"requested_model" varchar(120) NOT NULL,
	"actual_model" varchar(120),
	"fallback_used" boolean DEFAULT false NOT NULL,
	"status" "ai_execution_status" DEFAULT 'reserved' NOT NULL,
	"prompt_version" varchar(32) NOT NULL,
	"retrieval_version" varchar(32) NOT NULL,
	"gateway_version" varchar(32) NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"input_token_count" integer,
	"output_token_count" integer,
	"total_token_count" integer,
	"latency_ms" integer,
	"provider_request_id" varchar(240),
	"question_sha256" varchar(64) NOT NULL,
	"idempotency_key" varchar(200) NOT NULL,
	"failure_code" varchar(80),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_executions_message_scope_unique" UNIQUE("id","project_id","thread_id","assistant_message_id"),
	CONSTRAINT "ai_executions_thread_scope_unique" UNIQUE("id","project_id","thread_id"),
	CONSTRAINT "ai_executions_question_hash_check" CHECK ("ai_executions"."question_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_executions_idempotency_key_check" CHECK (length(btrim("ai_executions"."idempotency_key")) between 8 and 200),
	CONSTRAINT "ai_executions_evidence_count_check" CHECK ("ai_executions"."evidence_count" between 0 and 10),
	CONSTRAINT "ai_executions_token_usage_check" CHECK (
      ("ai_executions"."input_token_count" is null or "ai_executions"."input_token_count" >= 0)
      and ("ai_executions"."output_token_count" is null or "ai_executions"."output_token_count" >= 0)
      and ("ai_executions"."total_token_count" is null or "ai_executions"."total_token_count" >= 0)
      and (
        "ai_executions"."input_token_count" is null
        or "ai_executions"."output_token_count" is null
        or "ai_executions"."total_token_count" is null
        or "ai_executions"."total_token_count" = "ai_executions"."input_token_count" + "ai_executions"."output_token_count"
      )
      and ("ai_executions"."latency_ms" is null or "ai_executions"."latency_ms" >= 0)
    ),
	CONSTRAINT "ai_executions_succeeded_check" CHECK (
      "ai_executions"."status" <> 'succeeded'
      or (
        "ai_executions"."completed_at" is not null
        and "ai_executions"."failure_code" is null
        and "ai_executions"."actual_model" is not null
        and "ai_executions"."evidence_count" > 0
      )
    ),
	CONSTRAINT "ai_executions_failed_check" CHECK (
      "ai_executions"."status" <> 'failed'
      or (
        "ai_executions"."completed_at" is not null
        and "ai_executions"."failure_code" is not null
        and length(btrim("ai_executions"."failure_code")) > 0
      )
    ),
	CONSTRAINT "ai_executions_insufficient_check" CHECK (
      "ai_executions"."status" <> 'insufficient_evidence'
      or (
        "ai_executions"."completed_at" is not null
        and "ai_executions"."failure_code" is null
        and "ai_executions"."evidence_count" = 0
        and "ai_executions"."input_token_count" is null
        and "ai_executions"."output_token_count" is null
        and "ai_executions"."total_token_count" is null
      )
    ),
	CONSTRAINT "ai_executions_running_check" CHECK (
      "ai_executions"."status" not in ('reserved', 'retrieving', 'calling_provider', 'validating')
      or "ai_executions"."completed_at" is null
    )
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"created_by" text NOT NULL,
	"role" "ai_message_role" NOT NULL,
	"status" "ai_message_status" NOT NULL,
	"content" text NOT NULL,
	"execution_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_messages_thread_scope_unique" UNIQUE("id","project_id","thread_id"),
	CONSTRAINT "ai_messages_content_check" CHECK (
      length("ai_messages"."content") <= 100000
      and (
        length(btrim("ai_messages"."content")) > 0
        or (
          "ai_messages"."role" = 'assistant'
          and "ai_messages"."status" = 'pending'
          and length("ai_messages"."content") = 0
        )
      )
    ),
	CONSTRAINT "ai_messages_user_status_check" CHECK ("ai_messages"."role" <> 'user' or "ai_messages"."status" = 'completed')
);
--> statement-breakpoint
CREATE TABLE "ai_message_citations" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"assistant_message_id" text NOT NULL,
	"citation_index" integer NOT NULL,
	"evidence_label" varchar(8) NOT NULL,
	"chunk_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version_id" text NOT NULL,
	"display_name" varchar(240) NOT NULL,
	"version_number" integer NOT NULL,
	"mime_type" varchar(200) NOT NULL,
	"heading_path" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_locator" jsonb NOT NULL,
	"excerpt" varchar(1000) NOT NULL,
	"content_sha256" varchar(64) NOT NULL,
	"retrieval_score" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_message_citations_index_check" CHECK ("ai_message_citations"."citation_index" between 1 and 10),
	CONSTRAINT "ai_message_citations_label_check" CHECK ("ai_message_citations"."evidence_label" ~ '^E([1-9]|10)$'),
	CONSTRAINT "ai_message_citations_version_check" CHECK ("ai_message_citations"."version_number" > 0),
	CONSTRAINT "ai_message_citations_source_check" CHECK (
      jsonb_typeof("ai_message_citations"."source_locator") = 'object'
      and jsonb_typeof("ai_message_citations"."heading_path") = 'array'
    ),
	CONSTRAINT "ai_message_citations_excerpt_check" CHECK (length(btrim("ai_message_citations"."excerpt")) > 0),
	CONSTRAINT "ai_message_citations_hash_check" CHECK ("ai_message_citations"."content_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "ai_message_citations_score_check" CHECK ("ai_message_citations"."retrieval_score" >= 0)
);
--> statement-breakpoint
CREATE TABLE "ai_model_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" varchar(32) NOT NULL,
	"purpose" varchar(64) NOT NULL,
	"primary_model" varchar(120) NOT NULL,
	"fallback_model" varchar(120) NOT NULL,
	"region" varchar(64) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"gateway_version" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_model_profiles_values_check" CHECK (
      length(btrim("ai_model_profiles"."id")) > 0
      and length(btrim("ai_model_profiles"."provider")) > 0
      and length(btrim("ai_model_profiles"."purpose")) > 0
      and length(btrim("ai_model_profiles"."primary_model")) > 0
      and length(btrim("ai_model_profiles"."fallback_model")) > 0
      and length(btrim("ai_model_profiles"."region")) > 0
      and length(btrim("ai_model_profiles"."gateway_version")) > 0
    )
);
--> statement-breakpoint
CREATE TABLE "ai_threads" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"created_by" text NOT NULL,
	"title" varchar(200) NOT NULL,
	"status" "ai_thread_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "ai_threads_project_owner_scope_unique" UNIQUE("id","project_id","created_by"),
	CONSTRAINT "ai_threads_title_check" CHECK (length(btrim("ai_threads"."title")) > 0),
	CONSTRAINT "ai_threads_archive_check" CHECK (
      ("ai_threads"."status" = 'archived' and "ai_threads"."archived_at" is not null)
      or ("ai_threads"."status" = 'active' and "ai_threads"."archived_at" is null)
    )
);
--> statement-breakpoint
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_model_profile_id_ai_model_profiles_id_fk" FOREIGN KEY ("model_profile_id") REFERENCES "public"."ai_model_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_thread_owner_scope_fk" FOREIGN KEY ("thread_id","project_id","actor_user_id") REFERENCES "public"."ai_threads"("id","project_id","created_by") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_user_message_scope_fk" FOREIGN KEY ("user_message_id","project_id","thread_id") REFERENCES "public"."ai_messages"("id","project_id","thread_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_assistant_message_scope_fk" FOREIGN KEY ("assistant_message_id","project_id","thread_id") REFERENCES "public"."ai_messages"("id","project_id","thread_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_thread_owner_scope_fk" FOREIGN KEY ("thread_id","project_id","created_by") REFERENCES "public"."ai_threads"("id","project_id","created_by") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_citations" ADD CONSTRAINT "ai_message_citations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_message_citations" ADD CONSTRAINT "ai_message_citations_message_scope_fk" FOREIGN KEY ("assistant_message_id","project_id","thread_id") REFERENCES "public"."ai_messages"("id","project_id","thread_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_citation_scope_unique" UNIQUE("id","project_id","document_id","version_id");--> statement-breakpoint
ALTER TABLE "ai_message_citations" ADD CONSTRAINT "ai_message_citations_chunk_scope_fk" FOREIGN KEY ("chunk_id","project_id","document_id","version_id") REFERENCES "public"."document_chunks"("id","project_id","document_id","version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_threads" ADD CONSTRAINT "ai_threads_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_threads" ADD CONSTRAINT "ai_threads_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_executions_idempotency_uidx" ON "ai_executions" USING btree ("project_id","actor_user_id","thread_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "ai_executions_actor_created_idx" ON "ai_executions" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_executions_project_created_idx" ON "ai_executions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_executions_status_created_idx" ON "ai_executions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "ai_messages_thread_created_idx" ON "ai_messages" USING btree ("project_id","thread_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_message_citations_message_index_uidx" ON "ai_message_citations" USING btree ("assistant_message_id","citation_index");--> statement-breakpoint
CREATE INDEX "ai_message_citations_project_thread_idx" ON "ai_message_citations" USING btree ("project_id","thread_id","assistant_message_id");--> statement-breakpoint
CREATE INDEX "ai_model_profiles_enabled_purpose_idx" ON "ai_model_profiles" USING btree ("enabled","purpose");--> statement-breakpoint
CREATE INDEX "ai_threads_owner_status_updated_idx" ON "ai_threads" USING btree ("project_id","created_by","status","updated_at");
