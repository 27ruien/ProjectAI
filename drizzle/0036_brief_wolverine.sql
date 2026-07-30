CREATE TABLE "ai_retrieval_provider_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"retrieval_run_id" text NOT NULL,
	"ai_execution_id" text NOT NULL,
	"project_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"purpose" varchar(32) NOT NULL,
	"skill_id" varchar(120) NOT NULL,
	"model_profile_id" text NOT NULL,
	"status" varchar(24) DEFAULT 'reserved' NOT NULL,
	"provider" varchar(32),
	"actual_model" varchar(120),
	"reserved_token_count" integer NOT NULL,
	"input_token_count" integer,
	"output_token_count" integer,
	"total_token_count" integer,
	"cost_usd_micros" integer,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"provider_request_id" varchar(240),
	"failure_code" varchar(80),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_retrieval_provider_calls_purpose_check" CHECK ("ai_retrieval_provider_calls"."purpose" in ('query_rewrite', 'rerank')),
	CONSTRAINT "ai_retrieval_provider_calls_usage_check" CHECK (
      "ai_retrieval_provider_calls"."reserved_token_count" between 1 and 100000
      and ("ai_retrieval_provider_calls"."input_token_count" is null or "ai_retrieval_provider_calls"."input_token_count" >= 0)
      and ("ai_retrieval_provider_calls"."output_token_count" is null or "ai_retrieval_provider_calls"."output_token_count" >= 0)
      and ("ai_retrieval_provider_calls"."total_token_count" is null or "ai_retrieval_provider_calls"."total_token_count" >= 0)
      and (
        "ai_retrieval_provider_calls"."input_token_count" is null
        or "ai_retrieval_provider_calls"."output_token_count" is null
        or "ai_retrieval_provider_calls"."total_token_count" is null
        or "ai_retrieval_provider_calls"."total_token_count" = "ai_retrieval_provider_calls"."input_token_count" + "ai_retrieval_provider_calls"."output_token_count"
      )
      and ("ai_retrieval_provider_calls"."cost_usd_micros" is null or "ai_retrieval_provider_calls"."cost_usd_micros" >= 0)
      and "ai_retrieval_provider_calls"."latency_ms" >= 0
    ),
	CONSTRAINT "ai_retrieval_provider_calls_status_check" CHECK (
      (
        "ai_retrieval_provider_calls"."status" = 'reserved'
        and "ai_retrieval_provider_calls"."completed_at" is null
        and "ai_retrieval_provider_calls"."failure_code" is null
      ) or (
        "ai_retrieval_provider_calls"."status" = 'succeeded'
        and "ai_retrieval_provider_calls"."completed_at" is not null
        and "ai_retrieval_provider_calls"."failure_code" is null
        and "ai_retrieval_provider_calls"."provider" is not null
        and "ai_retrieval_provider_calls"."actual_model" is not null
      ) or (
        "ai_retrieval_provider_calls"."status" = 'unknown'
        and "ai_retrieval_provider_calls"."completed_at" is not null
        and "ai_retrieval_provider_calls"."failure_code" = 'PROVIDER_RESULT_UNKNOWN'
      )
    )
);
--> statement-breakpoint
INSERT INTO "ai_model_profiles" (
  "id", "provider", "purpose", "primary_model", "fallback_model",
  "region", "enabled", "gateway_version"
) VALUES (
  'qwen-project-assistant-cn-v1',
  'qwen',
  'project_assistant',
  'qwen3.7-plus',
  'qwen3.6-flash',
  'cn-beijing',
  true,
  '1'
) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ai_model_profiles"
    WHERE "id" = 'qwen-project-assistant-cn-v1'
      AND "provider" = 'qwen'
      AND "purpose" = 'project_assistant'
      AND "primary_model" = 'qwen3.7-plus'
      AND "fallback_model" = 'qwen3.6-flash'
      AND "region" = 'cn-beijing'
      AND "enabled" = true
      AND "gateway_version" = '1'
  ) THEN
    RAISE EXCEPTION 'PROJECT_ASSISTANT_MODEL_PROFILE_CONFLICT' USING ERRCODE = '23514';
  END IF;
END $$;--> statement-breakpoint
INSERT INTO "ai_model_profiles" (
  "id", "provider", "purpose", "primary_model", "fallback_model",
  "region", "enabled", "gateway_version"
) VALUES (
  'qwen-meeting-transcription-cn-v1',
  'alibaba-model-studio',
  'audio_transcription',
  'paraformer-v2',
  'paraformer-v2',
  'cn-beijing',
  true,
  '1'
) ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "ai_model_profiles"
    WHERE "id" = 'qwen-meeting-transcription-cn-v1'
      AND "provider" = 'alibaba-model-studio'
      AND "purpose" = 'audio_transcription'
      AND "primary_model" = 'paraformer-v2'
      AND "fallback_model" = 'paraformer-v2'
      AND "region" = 'cn-beijing'
      AND "enabled" = true
      AND "gateway_version" = '1'
  ) THEN
    RAISE EXCEPTION 'WORKFLOW_AUDIO_MODEL_PROFILE_CONFLICT' USING ERRCODE = '23514';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "workflow_artifacts" DROP CONSTRAINT "workflow_artifacts_published_document_id_project_documents_id_fk";
--> statement-breakpoint
ALTER TABLE "workflow_artifacts" DROP CONSTRAINT "workflow_artifacts_published_document_version_id_project_document_versions_id_fk";
--> statement-breakpoint
ALTER TABLE "ai_executions" DROP CONSTRAINT "ai_executions_token_usage_check";--> statement-breakpoint
ALTER TABLE "ai_executions" ADD COLUMN "cost_usd_micros" integer;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD COLUMN "skill_id" varchar(120);--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD COLUMN "model_profile_id" text;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD COLUMN "total_tokens" integer;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD COLUMN "cost_usd_micros" integer;--> statement-breakpoint
UPDATE "workflow_executions" execution
SET
  "skill_id" = CASE
    WHEN run."workflow_type" = 'meeting_minutes' AND execution."step" = 2
      THEN 'workflow.meeting_minutes.transcription'
    ELSE 'workflow.' || run."workflow_type" || '.step_' || execution."step"::text
  END,
  "model_profile_id" = CASE
    WHEN run."workflow_type" = 'meeting_minutes' AND execution."step" = 2
      THEN 'qwen-meeting-transcription-cn-v1'
    ELSE 'qwen-project-assistant-cn-v1'
  END,
  "total_tokens" = CASE
    WHEN execution."input_tokens" IS NOT NULL AND execution."output_tokens" IS NOT NULL
      THEN execution."input_tokens" + execution."output_tokens"
    ELSE NULL
  END
FROM "workflow_runs" run
WHERE run."id" = execution."run_id"
  AND run."project_id" = execution."project_id";--> statement-breakpoint
ALTER TABLE "workflow_executions" ALTER COLUMN "skill_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_executions" ALTER COLUMN "model_profile_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_id_project_unique" UNIQUE("id","project_id");--> statement-breakpoint
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_token_usage_check" CHECK (
      ("ai_executions"."input_token_count" is null or "ai_executions"."input_token_count" >= 0)
      and ("ai_executions"."output_token_count" is null or "ai_executions"."output_token_count" >= 0)
      and ("ai_executions"."total_token_count" is null or "ai_executions"."total_token_count" >= 0)
      and (
        "ai_executions"."input_token_count" is null
        or "ai_executions"."output_token_count" is null
        or "ai_executions"."total_token_count" is null
        or "ai_executions"."total_token_count" = "ai_executions"."input_token_count" + "ai_executions"."output_token_count"
      )
      and ("ai_executions"."cost_usd_micros" is null or "ai_executions"."cost_usd_micros" >= 0)
      and ("ai_executions"."latency_ms" is null or "ai_executions"."latency_ms" >= 0)
    );--> statement-breakpoint
ALTER TABLE "ai_retrieval_provider_calls" ADD CONSTRAINT "ai_retrieval_provider_calls_model_profile_id_ai_model_profiles_id_fk" FOREIGN KEY ("model_profile_id") REFERENCES "public"."ai_model_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_retrieval_provider_calls" ADD CONSTRAINT "ai_retrieval_provider_calls_run_scope_fk" FOREIGN KEY ("retrieval_run_id","project_id","actor_user_id") REFERENCES "public"."ai_retrieval_runs"("id","project_id","actor_user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_retrieval_provider_calls" ADD CONSTRAINT "ai_retrieval_provider_calls_execution_scope_fk" FOREIGN KEY ("ai_execution_id","project_id") REFERENCES "public"."ai_executions"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_retrieval_provider_calls_run_purpose_uidx" ON "ai_retrieval_provider_calls" USING btree ("retrieval_run_id","purpose");--> statement-breakpoint
CREATE INDEX "ai_retrieval_provider_calls_budget_idx" ON "ai_retrieval_provider_calls" USING btree ("created_at","actor_user_id","project_id","status");--> statement-breakpoint
CREATE OR REPLACE FUNCTION projectai_retrieval_provider_call_terminal_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status IN ('succeeded', 'unknown') THEN
    RAISE EXCEPTION 'terminal retrieval provider calls are immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "ai_retrieval_provider_calls_terminal_immutable"
BEFORE UPDATE ON "ai_retrieval_provider_calls"
FOR EACH ROW
EXECUTE FUNCTION projectai_retrieval_provider_call_terminal_immutable();--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "workflow_artifacts" artifact
    LEFT JOIN "project_documents" document
      ON document."id" = artifact."published_document_id"
      AND document."project_id" = artifact."project_id"
    LEFT JOIN "project_document_versions" version
      ON version."id" = artifact."published_document_version_id"
      AND version."document_id" = artifact."published_document_id"
      AND version."project_id" = artifact."project_id"
    WHERE artifact."published_document_id" IS NOT NULL
      AND (
        artifact."published_document_version_id" IS NULL
        OR document."id" IS NULL
        OR version."id" IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'WORKFLOW_ARTIFACT_PROJECT_SCOPE_INVALID' USING ERRCODE = '23514';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "workflow_artifacts" ADD CONSTRAINT "workflow_artifacts_published_document_project_fk" FOREIGN KEY ("published_document_id","project_id") REFERENCES "public"."project_documents"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_artifacts" ADD CONSTRAINT "workflow_artifacts_published_version_document_project_fk" FOREIGN KEY ("published_document_version_id","published_document_id","project_id") REFERENCES "public"."project_document_versions"("id","document_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_model_profile_id_ai_model_profiles_id_fk" FOREIGN KEY ("model_profile_id") REFERENCES "public"."ai_model_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_artifacts" ADD CONSTRAINT "workflow_artifacts_published_link_check" CHECK ((
        "workflow_artifacts"."published_document_id" is null
        and "workflow_artifacts"."published_document_version_id" is null
        and "workflow_artifacts"."published_at" is null
      ) or (
        "workflow_artifacts"."published_document_id" is not null
        and "workflow_artifacts"."published_document_version_id" is not null
      ));--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_usage_check" CHECK ((
        "workflow_executions"."input_tokens" is null or "workflow_executions"."input_tokens" >= 0
      ) and (
        "workflow_executions"."output_tokens" is null or "workflow_executions"."output_tokens" >= 0
      ) and (
        "workflow_executions"."total_tokens" is null or "workflow_executions"."total_tokens" >= 0
      ) and (
        "workflow_executions"."input_tokens" is null
        or "workflow_executions"."output_tokens" is null
        or "workflow_executions"."total_tokens" is null
        or "workflow_executions"."total_tokens" = "workflow_executions"."input_tokens" + "workflow_executions"."output_tokens"
      ) and (
        "workflow_executions"."cost_usd_micros" is null or "workflow_executions"."cost_usd_micros" >= 0
      ) and (
        "workflow_executions"."latency_ms" is null or "workflow_executions"."latency_ms" >= 0
      ));
