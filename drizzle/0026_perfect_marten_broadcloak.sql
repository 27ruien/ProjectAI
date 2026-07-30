CREATE TABLE "transcript_segments" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"start_ms" integer NOT NULL,
	"end_ms" integer NOT NULL,
	"speaker_id" text NOT NULL,
	"text" text NOT NULL,
	"confidence_bps" integer,
	"language" varchar(24) NOT NULL,
	"source_digest" varchar(64) NOT NULL,
	CONSTRAINT "transcript_segments_time_check" CHECK ("transcript_segments"."start_ms" >= 0 and "transcript_segments"."end_ms" > "transcript_segments"."start_ms"),
	CONSTRAINT "transcript_segments_confidence_check" CHECK ("transcript_segments"."confidence_bps" is null or "transcript_segments"."confidence_bps" between 0 and 10000),
	CONSTRAINT "transcript_segments_digest_check" CHECK ("transcript_segments"."source_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "transcript_speakers" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"speaker_key" varchar(80) NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"confirmed_by_user" boolean DEFAULT false NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workflow_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"artifact_kind" varchar(48) NOT NULL,
	"title" varchar(240) NOT NULL,
	"status" varchar(24) DEFAULT 'draft' NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"content_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_artifacts_kind_check" CHECK ("workflow_artifacts"."artifact_kind" in ('project_overview', 'requirements_document', 'ga4_measurement_plan', 'action_plan', 'meeting_transcript', 'meeting_minutes', 'meeting_actions')),
	CONSTRAINT "workflow_artifacts_status_check" CHECK ("workflow_artifacts"."status" in ('draft', 'awaiting_review', 'reviewed', 'published', 'failed')),
	CONSTRAINT "workflow_artifacts_version_check" CHECK ("workflow_artifacts"."current_version" > 0),
	CONSTRAINT "workflow_artifacts_digest_check" CHECK ("workflow_artifacts"."content_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "workflow_artifact_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"project_id" text NOT NULL,
	"version" integer NOT NULL,
	"content" jsonb NOT NULL,
	"markdown" text NOT NULL,
	"source_references" jsonb NOT NULL,
	"content_digest" varchar(64) NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_artifact_versions_version_check" CHECK ("workflow_artifact_versions"."version" > 0),
	CONSTRAINT "workflow_artifact_versions_digest_check" CHECK ("workflow_artifact_versions"."content_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "workflow_audio_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_id" text NOT NULL,
	"transcription_provider" varchar(48) NOT NULL,
	"transcription_model" varchar(120) NOT NULL,
	"diarization_provider" varchar(48) NOT NULL,
	"diarization_model" varchar(120) NOT NULL,
	"provider_task_id_hash" varchar(64),
	"status" varchar(32) DEFAULT 'queued' NOT NULL,
	"failure_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "workflow_audio_jobs_status_check" CHECK ("workflow_audio_jobs"."status" in ('queued', 'transcribing', 'diarizing', 'normalizing', 'summarizing', 'awaiting_review', 'published', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "workflow_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow_type" varchar(40) NOT NULL,
	"name" varchar(120) NOT NULL,
	"description" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"model_profile_id" varchar(120) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_definitions_type_check" CHECK ("workflow_definitions"."workflow_type" in ('requirement_framework', 'meeting_minutes')),
	CONSTRAINT "workflow_definitions_version_check" CHECK ("workflow_definitions"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"step" integer NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" varchar(24) DEFAULT 'running' NOT NULL,
	"provider" varchar(40),
	"actual_model" varchar(120),
	"latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"failure_code" varchar(80),
	"result_digest" varchar(64),
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "workflow_executions_step_check" CHECK ("workflow_executions"."step" between 1 and 11),
	CONSTRAINT "workflow_executions_attempt_check" CHECK ("workflow_executions"."attempt" between 1 and 20),
	CONSTRAINT "workflow_executions_status_check" CHECK ("workflow_executions"."status" in ('running', 'succeeded', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "workflow_exports" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"project_id" text NOT NULL,
	"artifact_version" integer NOT NULL,
	"format" varchar(16) NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_exports_format_check" CHECK ("workflow_exports"."format" in ('md', 'docx', 'xlsx', 'txt')),
	CONSTRAINT "workflow_exports_digest_check" CHECK ("workflow_exports"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "workflow_exports_size_check" CHECK ("workflow_exports"."size_bytes" > 0)
);
--> statement-breakpoint
CREATE TABLE "workflow_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"project_id" text NOT NULL,
	"artifact_version" integer NOT NULL,
	"reviewer_id" text NOT NULL,
	"decision" varchar(24) NOT NULL,
	"note" text,
	"snapshot_digest" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_reviews_decision_check" CHECK ("workflow_reviews"."decision" in ('request_changes', 'approve', 'publish')),
	CONSTRAINT "workflow_reviews_digest_check" CHECK ("workflow_reviews"."snapshot_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"definition_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"department_id" text,
	"project_id" text NOT NULL,
	"workflow_type" varchar(40) NOT NULL,
	"creator_id" text NOT NULL,
	"display_name" varchar(240) NOT NULL,
	"authorized_source_scope" jsonb NOT NULL,
	"source_scope_digest" varchar(64) NOT NULL,
	"model_profile_id" varchar(120) NOT NULL,
	"status" varchar(40) DEFAULT 'queued' NOT NULL,
	"current_step" integer DEFAULT 1 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"idempotency_key_hash" varchar(64) NOT NULL,
	"legacy_requirement_run_id" text,
	"leased_by" text,
	"lease_token" text,
	"lease_expires_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	"cancellation_requested_at" timestamp with time zone,
	"failure_code" varchar(80),
	"failure_step" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "workflow_runs_type_check" CHECK ("workflow_runs"."workflow_type" in ('requirement_framework', 'meeting_minutes')),
	CONSTRAINT "workflow_runs_status_check" CHECK ("workflow_runs"."status" in ('legacy_read_only', 'queued', 'validating_sources', 'parsing_sources', 'extracting_facts', 'identifying_gaps', 'generating_overview', 'generating_requirements', 'generating_ga4', 'generating_action_plan', 'checking_consistency', 'uploading', 'uploaded', 'transcribing', 'diarizing', 'normalizing', 'summarizing', 'awaiting_review', 'published', 'failed', 'cancelled')),
	CONSTRAINT "workflow_runs_step_check" CHECK ("workflow_runs"."current_step" between 1 and 11),
	CONSTRAINT "workflow_runs_version_check" CHECK ("workflow_runs"."version" > 0),
	CONSTRAINT "workflow_runs_digest_check" CHECK ("workflow_runs"."source_scope_digest" ~ '^[0-9a-f]{64}$' and "workflow_runs"."idempotency_key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "workflow_runs_department_check" CHECK ("workflow_runs"."department_id" is not null or "workflow_runs"."legacy_requirement_run_id" is not null),
	CONSTRAINT "workflow_runs_lease_check" CHECK (("workflow_runs"."leased_by" is null and "workflow_runs"."lease_token" is null and "workflow_runs"."lease_expires_at" is null) or ("workflow_runs"."leased_by" is not null and "workflow_runs"."lease_token" is not null and "workflow_runs"."lease_expires_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "workflow_run_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_type" varchar(40) NOT NULL,
	"document_id" text,
	"document_version_id" text,
	"object_key" text,
	"display_name" varchar(240) NOT NULL,
	"mime_type" varchar(160),
	"size_bytes" integer,
	"sha256" varchar(64) NOT NULL,
	"status" varchar(32) DEFAULT 'ready' NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_run_sources_type_check" CHECK ("workflow_run_sources"."source_type" in ('project_document', 'department_document', 'organization_document', 'temporary_document', 'audio')),
	CONSTRAINT "workflow_run_sources_status_check" CHECK ("workflow_run_sources"."status" in ('uploading', 'uploaded', 'ready', 'expired', 'deleted', 'failed')),
	CONSTRAINT "workflow_run_sources_digest_check" CHECK ("workflow_run_sources"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "workflow_run_sources_shape_check" CHECK (("workflow_run_sources"."source_type" = 'audio' and "workflow_run_sources"."object_key" is not null and "workflow_run_sources"."document_id" is null) or ("workflow_run_sources"."source_type" <> 'audio' and "workflow_run_sources"."document_id" is not null and "workflow_run_sources"."document_version_id" is not null and "workflow_run_sources"."object_key" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_speakers_id_project_uidx" ON "transcript_speakers" USING btree ("id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_artifacts_id_project_uidx" ON "workflow_artifacts" USING btree ("id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_id_project_uidx" ON "workflow_runs" USING btree ("id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_sources_id_project_uidx" ON "workflow_run_sources" USING btree ("id","project_id");--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_run_project_fk" FOREIGN KEY ("run_id","project_id") REFERENCES "public"."workflow_runs"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_segments" ADD CONSTRAINT "transcript_segments_speaker_project_fk" FOREIGN KEY ("speaker_id","project_id") REFERENCES "public"."transcript_speakers"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_speakers" ADD CONSTRAINT "transcript_speakers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transcript_speakers" ADD CONSTRAINT "transcript_speakers_run_project_fk" FOREIGN KEY ("run_id","project_id") REFERENCES "public"."workflow_runs"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_artifacts" ADD CONSTRAINT "workflow_artifacts_run_project_fk" FOREIGN KEY ("run_id","project_id") REFERENCES "public"."workflow_runs"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_artifact_versions" ADD CONSTRAINT "workflow_artifact_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_artifact_versions" ADD CONSTRAINT "workflow_artifact_versions_artifact_project_fk" FOREIGN KEY ("artifact_id","project_id") REFERENCES "public"."workflow_artifacts"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_audio_jobs" ADD CONSTRAINT "workflow_audio_jobs_run_project_fk" FOREIGN KEY ("run_id","project_id") REFERENCES "public"."workflow_runs"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_audio_jobs" ADD CONSTRAINT "workflow_audio_jobs_source_project_fk" FOREIGN KEY ("source_id","project_id") REFERENCES "public"."workflow_run_sources"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_run_project_fk" FOREIGN KEY ("run_id","project_id") REFERENCES "public"."workflow_runs"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_exports" ADD CONSTRAINT "workflow_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_exports" ADD CONSTRAINT "workflow_exports_artifact_project_fk" FOREIGN KEY ("artifact_id","project_id") REFERENCES "public"."workflow_artifacts"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_reviews" ADD CONSTRAINT "workflow_reviews_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_reviews" ADD CONSTRAINT "workflow_reviews_artifact_project_fk" FOREIGN KEY ("artifact_id","project_id") REFERENCES "public"."workflow_artifacts"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_definition_id_workflow_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."workflow_definitions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_department_id_departments_id_fk" FOREIGN KEY ("department_id") REFERENCES "public"."departments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_legacy_requirement_run_id_requirement_extraction_runs_id_fk" FOREIGN KEY ("legacy_requirement_run_id") REFERENCES "public"."requirement_extraction_runs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_sources" ADD CONSTRAINT "workflow_run_sources_document_id_project_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."project_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_sources" ADD CONSTRAINT "workflow_run_sources_document_version_id_project_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."project_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_sources" ADD CONSTRAINT "workflow_run_sources_run_project_fk" FOREIGN KEY ("run_id","project_id") REFERENCES "public"."workflow_runs"("id","project_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_segments_run_sequence_uidx" ON "transcript_segments" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "transcript_speakers_run_key_uidx" ON "transcript_speakers" USING btree ("run_id","speaker_key");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_artifacts_run_kind_uidx" ON "workflow_artifacts" USING btree ("run_id","artifact_kind");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_artifact_versions_artifact_version_uidx" ON "workflow_artifact_versions" USING btree ("artifact_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_audio_jobs_run_uidx" ON "workflow_audio_jobs" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_definitions_type_version_uidx" ON "workflow_definitions" USING btree ("workflow_type","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_executions_run_step_attempt_uidx" ON "workflow_executions" USING btree ("run_id","step","attempt");--> statement-breakpoint
CREATE INDEX "workflow_exports_artifact_created_idx" ON "workflow_exports" USING btree ("artifact_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_reviews_artifact_created_idx" ON "workflow_reviews" USING btree ("artifact_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_idempotency_uidx" ON "workflow_runs" USING btree ("project_id","creator_id","idempotency_key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_runs_legacy_requirement_uidx" ON "workflow_runs" USING btree ("legacy_requirement_run_id");--> statement-breakpoint
CREATE INDEX "workflow_runs_project_updated_idx" ON "workflow_runs" USING btree ("project_id","updated_at");--> statement-breakpoint
CREATE INDEX "workflow_runs_creator_updated_idx" ON "workflow_runs" USING btree ("creator_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_run_sources_run_digest_uidx" ON "workflow_run_sources" USING btree ("run_id","source_type","sha256");--> statement-breakpoint
CREATE INDEX "workflow_run_sources_document_idx" ON "workflow_run_sources" USING btree ("document_id","run_id");
--> statement-breakpoint
INSERT INTO "workflow_definitions" (
	"id", "workflow_type", "name", "description", "version", "model_profile_id", "is_active"
) VALUES
	(
		'workflow-definition-requirement-framework-v1',
		'requirement_framework',
		'搭建需求框架',
		'从授权项目资料生成项目概览、需求文档、GA4 埋点文档和 Action Plan，并由人工审核后发布。',
		1,
		'qwen-requirement-framework-cn-v1',
		true
	),
	(
		'workflow-definition-meeting-minutes-v1',
		'meeting_minutes',
		'提取会议纪要',
		'从私有会议音视频生成带说话人和时间戳的转写、讨论要点、决策和待办，并由人工审核后发布。',
		1,
		'qwen-meeting-minutes-cn-v1',
		true
	)
ON CONFLICT ("workflow_type", "version") DO UPDATE SET
	"name" = EXCLUDED."name",
	"description" = EXCLUDED."description",
	"model_profile_id" = EXCLUDED."model_profile_id",
	"is_active" = EXCLUDED."is_active",
	"updated_at" = now();
--> statement-breakpoint
INSERT INTO "workflow_runs" (
	"id",
	"definition_id",
	"organization_id",
	"department_id",
	"project_id",
	"workflow_type",
	"creator_id",
	"display_name",
	"authorized_source_scope",
	"source_scope_digest",
	"model_profile_id",
	"status",
	"current_step",
	"version",
	"idempotency_key_hash",
	"legacy_requirement_run_id",
	"failure_code",
	"created_at",
	"completed_at",
	"updated_at"
)
SELECT
	'workflow-legacy-' || legacy."id",
	'workflow-definition-requirement-framework-v1',
	project."organization_id",
	project."department_id",
	legacy."project_id",
	'requirement_framework',
	legacy."actor_user_id",
	project."name" || ' · 旧版需求框架 · ' || to_char(legacy."created_at" AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD'),
	jsonb_build_object('documentIds', '[]'::jsonb, 'knowledgeSpaceIds', '[]'::jsonb, 'legacyReadOnly', true),
	legacy."source_selection_digest",
	legacy."model_profile_id",
	'legacy_read_only',
	11,
	1,
	legacy."idempotency_key_hash",
	legacy."id",
	legacy."failure_code",
	legacy."created_at",
	legacy."completed_at",
	coalesce(legacy."completed_at", legacy."created_at")
FROM "requirement_extraction_runs" legacy
JOIN "projects" project ON project."id" = legacy."project_id"
ON CONFLICT ("legacy_requirement_run_id") DO NOTHING;
