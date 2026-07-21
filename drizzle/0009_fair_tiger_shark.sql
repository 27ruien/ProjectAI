CREATE TYPE "public"."requirement_draft_status" AS ENUM('pending_review', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."requirement_extraction_status" AS ENUM('running', 'awaiting_review', 'failed');--> statement-breakpoint
CREATE TYPE "public"."requirement_status" AS ENUM('approved', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."requirement_type" AS ENUM('functional', 'non_functional', 'business_rule', 'constraint', 'compliance');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('accept', 'edit_accept', 'reject');--> statement-breakpoint
CREATE TYPE "public"."scope_comparison_status" AS ENUM('running', 'awaiting_review', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."scope_diff_type" AS ENUM('added', 'removed', 'modified', 'unchanged', 'potentially_out_of_scope', 'not_mentioned', 'ambiguous');--> statement-breakpoint
CREATE TYPE "public"."scope_review_status" AS ENUM('pending', 'confirmed', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."scope_version_status" AS ENUM('draft', 'approved', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."work_priority" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TABLE "requirements" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"code" varchar(40) NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text NOT NULL,
	"requirement_type" "requirement_type" NOT NULL,
	"priority" "work_priority" NOT NULL,
	"status" "requirement_status" DEFAULT 'approved' NOT NULL,
	"owner_user_id" text,
	"acceptance_criteria" jsonb NOT NULL,
	"assumptions" jsonb NOT NULL,
	"open_questions" jsonb NOT NULL,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"event_type" varchar(80) NOT NULL,
	"resource_type" varchar(40) NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"extraction_run_id" text NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text NOT NULL,
	"requirement_type" "requirement_type" NOT NULL,
	"priority" "work_priority" NOT NULL,
	"owner_user_id" text,
	"acceptance_criteria" jsonb NOT NULL,
	"assumptions" jsonb NOT NULL,
	"open_questions" jsonb NOT NULL,
	"source_document_id" text NOT NULL,
	"source_version_id" text NOT NULL,
	"source_chunk_id" text NOT NULL,
	"source_text_range" jsonb NOT NULL,
	"source_label" varchar(20) NOT NULL,
	"confidence_bps" integer NOT NULL,
	"duplicate_of_draft_id" text,
	"status" "requirement_draft_status" DEFAULT 'pending_review' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "requirement_drafts_confidence_check" CHECK ("requirement_drafts"."confidence_bps" between 0 and 10000),
	CONSTRAINT "requirement_drafts_title_check" CHECK (length(btrim("requirement_drafts"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "requirement_extraction_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"idempotency_key_hash" varchar(64) NOT NULL,
	"source_selection_digest" varchar(64) NOT NULL,
	"status" "requirement_extraction_status" DEFAULT 'running' NOT NULL,
	"model_profile_id" varchar(120) NOT NULL,
	"provider" varchar(40),
	"actual_model" varchar(120),
	"input_tokens" integer,
	"output_tokens" integer,
	"latency_ms" integer,
	"failure_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "requirement_extraction_runs_digest_check" CHECK ("requirement_extraction_runs"."source_selection_digest" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "requirement_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"requirement_id" text,
	"reviewer_user_id" text NOT NULL,
	"decision" "review_decision" NOT NULL,
	"edited_fields" jsonb,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"source_label" varchar(20) NOT NULL,
	"source_locator" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "requirement_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"requirement_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"review_id" text,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requirement_versions_positive_check" CHECK ("requirement_versions"."version_number" > 0)
);
--> statement-breakpoint
CREATE TABLE "scope_comparison_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"baseline_version_id" text NOT NULL,
	"candidate_version_id" text NOT NULL,
	"status" "scope_comparison_status" DEFAULT 'running' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "scope_diff_items" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"comparison_run_id" text NOT NULL,
	"diff_type" "scope_diff_type" NOT NULL,
	"title" varchar(240) NOT NULL,
	"explanation" text NOT NULL,
	"baseline_citation" jsonb,
	"candidate_citation" jsonb,
	"confidence_bps" integer NOT NULL,
	"review_status" "scope_review_status" DEFAULT 'pending' NOT NULL,
	"reviewer_note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scope_diff_items_confidence_check" CHECK ("scope_diff_items"."confidence_bps" between 0 and 10000)
);
--> statement-breakpoint
CREATE TABLE "scope_diff_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"diff_item_id" text NOT NULL,
	"reviewer_user_id" text NOT NULL,
	"status" "scope_review_status" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scope_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" varchar(200) NOT NULL,
	"version_number" integer NOT NULL,
	"status" "scope_version_status" DEFAULT 'draft' NOT NULL,
	"requirement_snapshot" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirements" ADD CONSTRAINT "requirements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_audits" ADD CONSTRAINT "requirement_audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_audits" ADD CONSTRAINT "requirement_audits_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_drafts" ADD CONSTRAINT "requirement_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_drafts" ADD CONSTRAINT "requirement_drafts_extraction_run_id_requirement_extraction_runs_id_fk" FOREIGN KEY ("extraction_run_id") REFERENCES "public"."requirement_extraction_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_drafts" ADD CONSTRAINT "requirement_drafts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_drafts" ADD CONSTRAINT "requirement_drafts_source_document_id_project_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."project_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_drafts" ADD CONSTRAINT "requirement_drafts_source_version_id_project_document_versions_id_fk" FOREIGN KEY ("source_version_id") REFERENCES "public"."project_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_drafts" ADD CONSTRAINT "requirement_drafts_source_chunk_id_document_chunks_id_fk" FOREIGN KEY ("source_chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_extraction_runs" ADD CONSTRAINT "requirement_extraction_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_extraction_runs" ADD CONSTRAINT "requirement_extraction_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_reviews" ADD CONSTRAINT "requirement_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_reviews" ADD CONSTRAINT "requirement_reviews_draft_id_requirement_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."requirement_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_reviews" ADD CONSTRAINT "requirement_reviews_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_reviews" ADD CONSTRAINT "requirement_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_sources" ADD CONSTRAINT "requirement_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_sources" ADD CONSTRAINT "requirement_sources_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_sources" ADD CONSTRAINT "requirement_sources_document_id_project_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."project_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_sources" ADD CONSTRAINT "requirement_sources_version_id_project_document_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."project_document_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_sources" ADD CONSTRAINT "requirement_sources_chunk_id_document_chunks_id_fk" FOREIGN KEY ("chunk_id") REFERENCES "public"."document_chunks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_versions" ADD CONSTRAINT "requirement_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_versions" ADD CONSTRAINT "requirement_versions_requirement_id_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."requirements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_versions" ADD CONSTRAINT "requirement_versions_review_id_requirement_reviews_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."requirement_reviews"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requirement_versions" ADD CONSTRAINT "requirement_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_comparison_runs" ADD CONSTRAINT "scope_comparison_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_comparison_runs" ADD CONSTRAINT "scope_comparison_runs_baseline_version_id_scope_versions_id_fk" FOREIGN KEY ("baseline_version_id") REFERENCES "public"."scope_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_comparison_runs" ADD CONSTRAINT "scope_comparison_runs_candidate_version_id_scope_versions_id_fk" FOREIGN KEY ("candidate_version_id") REFERENCES "public"."scope_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_comparison_runs" ADD CONSTRAINT "scope_comparison_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_diff_items" ADD CONSTRAINT "scope_diff_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_diff_items" ADD CONSTRAINT "scope_diff_items_comparison_run_id_scope_comparison_runs_id_fk" FOREIGN KEY ("comparison_run_id") REFERENCES "public"."scope_comparison_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_diff_reviews" ADD CONSTRAINT "scope_diff_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_diff_reviews" ADD CONSTRAINT "scope_diff_reviews_diff_item_id_scope_diff_items_id_fk" FOREIGN KEY ("diff_item_id") REFERENCES "public"."scope_diff_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_diff_reviews" ADD CONSTRAINT "scope_diff_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scope_versions" ADD CONSTRAINT "scope_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "requirements_project_code_uidx" ON "requirements" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "requirements_project_status_idx" ON "requirements" USING btree ("project_id","status","updated_at");--> statement-breakpoint
CREATE INDEX "requirement_audits_project_created_idx" ON "requirement_audits" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "requirement_drafts_project_status_idx" ON "requirement_drafts" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE INDEX "requirement_drafts_source_idx" ON "requirement_drafts" USING btree ("source_document_id","source_version_id","source_chunk_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_extraction_runs_idempotency_uidx" ON "requirement_extraction_runs" USING btree ("project_id","actor_user_id","idempotency_key_hash");--> statement-breakpoint
CREATE INDEX "requirement_extraction_runs_project_created_idx" ON "requirement_extraction_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_reviews_draft_uidx" ON "requirement_reviews" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "requirement_reviews_project_created_idx" ON "requirement_reviews" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "requirement_sources_requirement_idx" ON "requirement_sources" USING btree ("requirement_id");--> statement-breakpoint
CREATE INDEX "requirement_sources_document_idx" ON "requirement_sources" USING btree ("document_id","version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "requirement_versions_number_uidx" ON "requirement_versions" USING btree ("requirement_id","version_number");--> statement-breakpoint
CREATE INDEX "requirement_versions_project_created_idx" ON "requirement_versions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "scope_comparison_runs_project_created_idx" ON "scope_comparison_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "scope_diff_items_run_type_idx" ON "scope_diff_items" USING btree ("comparison_run_id","diff_type");--> statement-breakpoint
CREATE INDEX "scope_diff_reviews_item_created_idx" ON "scope_diff_reviews" USING btree ("diff_item_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "scope_versions_project_number_uidx" ON "scope_versions" USING btree ("project_id","version_number");--> statement-breakpoint
CREATE INDEX "scope_versions_project_status_idx" ON "scope_versions" USING btree ("project_id","status");