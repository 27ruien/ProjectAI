CREATE TYPE "public"."action_item_status" AS ENUM('todo', 'in_progress', 'blocked', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."risk_status" AS ENUM('open', 'monitoring', 'mitigated', 'closed');--> statement-breakpoint
CREATE TYPE "public"."weekly_report_draft_status" AS ENUM('pending_review', 'published', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."work_draft_status" AS ENUM('pending_review', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "action_items" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"code" varchar(40) NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text NOT NULL,
	"owner_user_id" text,
	"start_date" varchar(10),
	"due_date" varchar(10),
	"status" "action_item_status" DEFAULT 'todo' NOT NULL,
	"priority" "work_priority" NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"blocker" text DEFAULT '' NOT NULL,
	"related_requirement_id" text,
	"related_scope_item_id" text,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_items_progress_check" CHECK ("action_items"."progress" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "action_item_dependencies" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"action_item_id" text NOT NULL,
	"depends_on_action_item_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_item_dependencies_no_self_check" CHECK ("action_item_dependencies"."action_item_id" <> "action_item_dependencies"."depends_on_action_item_id")
);
--> statement-breakpoint
CREATE TABLE "action_item_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text NOT NULL,
	"owner_user_id" text,
	"start_date" varchar(10),
	"due_date" varchar(10),
	"priority" "work_priority" NOT NULL,
	"blocker" text DEFAULT '' NOT NULL,
	"source_type" varchar(24) NOT NULL,
	"source_citation" jsonb NOT NULL,
	"related_requirement_id" text,
	"related_scope_item_id" text,
	"status" "work_draft_status" DEFAULT 'pending_review' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "action_item_drafts_source_type_check" CHECK ("action_item_drafts"."source_type" in ('document', 'requirement'))
);
--> statement-breakpoint
CREATE TABLE "action_item_history" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"action_item_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_reason" text DEFAULT '' NOT NULL,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_item_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"action_item_id" text,
	"reviewer_user_id" text NOT NULL,
	"decision" "review_decision" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "action_item_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"action_item_id" text NOT NULL,
	"source_type" varchar(24) NOT NULL,
	"source_id" text NOT NULL,
	"citation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_management_audits" (
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
CREATE TABLE "risks" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"code" varchar(40) NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text NOT NULL,
	"probability" integer NOT NULL,
	"impact" integer NOT NULL,
	"severity" integer NOT NULL,
	"owner_user_id" text,
	"mitigation" text NOT NULL,
	"trigger" text NOT NULL,
	"status" "risk_status" DEFAULT 'open' NOT NULL,
	"due_date" varchar(10),
	"related_requirement_id" text,
	"related_action_item_id" text,
	"current_version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "risks_matrix_check" CHECK ("risks"."probability" between 1 and 5 and "risks"."impact" between 1 and 5 and "risks"."severity" = "risks"."probability" * "risks"."impact")
);
--> statement-breakpoint
CREATE TABLE "risk_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"title" varchar(240) NOT NULL,
	"description" text NOT NULL,
	"probability" integer NOT NULL,
	"impact" integer NOT NULL,
	"owner_user_id" text,
	"mitigation" text NOT NULL,
	"trigger" text NOT NULL,
	"due_date" varchar(10),
	"source_type" varchar(24) NOT NULL,
	"source_citation" jsonb NOT NULL,
	"related_requirement_id" text,
	"related_action_item_id" text,
	"status" "work_draft_status" DEFAULT 'pending_review' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "risk_drafts_matrix_check" CHECK ("risk_drafts"."probability" between 1 and 5 and "risk_drafts"."impact" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "risk_history" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"risk_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"change_reason" text DEFAULT '' NOT NULL,
	"actor_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"risk_id" text,
	"reviewer_user_id" text NOT NULL,
	"decision" "review_decision" NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"risk_id" text NOT NULL,
	"source_type" varchar(24) NOT NULL,
	"source_id" text NOT NULL,
	"citation" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "weekly_report_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"period_start" varchar(10) NOT NULL,
	"period_end" varchar(10) NOT NULL,
	"sections" jsonb NOT NULL,
	"source_manifest" jsonb NOT NULL,
	"status" "weekly_report_draft_status" DEFAULT 'pending_review' NOT NULL,
	"model_profile_id" varchar(120) NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "weekly_report_drafts_period_check" CHECK ("weekly_report_drafts"."period_start" <= "weekly_report_drafts"."period_end")
);
--> statement-breakpoint
CREATE TABLE "weekly_report_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"period_start" varchar(10) NOT NULL,
	"period_end" varchar(10) NOT NULL,
	"sections" jsonb NOT NULL,
	"source_manifest" jsonb NOT NULL,
	"markdown" text NOT NULL,
	"published_by" text NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_related_requirement_id_requirements_id_fk" FOREIGN KEY ("related_requirement_id") REFERENCES "public"."requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_related_scope_item_id_scope_diff_items_id_fk" FOREIGN KEY ("related_scope_item_id") REFERENCES "public"."scope_diff_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_items" ADD CONSTRAINT "action_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_dependencies" ADD CONSTRAINT "action_item_dependencies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_dependencies" ADD CONSTRAINT "action_item_dependencies_action_item_id_action_items_id_fk" FOREIGN KEY ("action_item_id") REFERENCES "public"."action_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_dependencies" ADD CONSTRAINT "action_item_dependencies_depends_on_action_item_id_action_items_id_fk" FOREIGN KEY ("depends_on_action_item_id") REFERENCES "public"."action_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_dependencies" ADD CONSTRAINT "action_item_dependencies_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_drafts" ADD CONSTRAINT "action_item_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_drafts" ADD CONSTRAINT "action_item_drafts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_drafts" ADD CONSTRAINT "action_item_drafts_related_requirement_id_requirements_id_fk" FOREIGN KEY ("related_requirement_id") REFERENCES "public"."requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_drafts" ADD CONSTRAINT "action_item_drafts_related_scope_item_id_scope_diff_items_id_fk" FOREIGN KEY ("related_scope_item_id") REFERENCES "public"."scope_diff_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_drafts" ADD CONSTRAINT "action_item_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_history" ADD CONSTRAINT "action_item_history_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_history" ADD CONSTRAINT "action_item_history_action_item_id_action_items_id_fk" FOREIGN KEY ("action_item_id") REFERENCES "public"."action_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_history" ADD CONSTRAINT "action_item_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_reviews" ADD CONSTRAINT "action_item_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_reviews" ADD CONSTRAINT "action_item_reviews_draft_id_action_item_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."action_item_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_reviews" ADD CONSTRAINT "action_item_reviews_action_item_id_action_items_id_fk" FOREIGN KEY ("action_item_id") REFERENCES "public"."action_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_reviews" ADD CONSTRAINT "action_item_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_sources" ADD CONSTRAINT "action_item_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_item_sources" ADD CONSTRAINT "action_item_sources_action_item_id_action_items_id_fk" FOREIGN KEY ("action_item_id") REFERENCES "public"."action_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_management_audits" ADD CONSTRAINT "project_management_audits_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_management_audits" ADD CONSTRAINT "project_management_audits_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_related_requirement_id_requirements_id_fk" FOREIGN KEY ("related_requirement_id") REFERENCES "public"."requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_related_action_item_id_action_items_id_fk" FOREIGN KEY ("related_action_item_id") REFERENCES "public"."action_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risks" ADD CONSTRAINT "risks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_drafts" ADD CONSTRAINT "risk_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_drafts" ADD CONSTRAINT "risk_drafts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_drafts" ADD CONSTRAINT "risk_drafts_related_requirement_id_requirements_id_fk" FOREIGN KEY ("related_requirement_id") REFERENCES "public"."requirements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_drafts" ADD CONSTRAINT "risk_drafts_related_action_item_id_action_items_id_fk" FOREIGN KEY ("related_action_item_id") REFERENCES "public"."action_items"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_drafts" ADD CONSTRAINT "risk_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_history" ADD CONSTRAINT "risk_history_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_history" ADD CONSTRAINT "risk_history_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_history" ADD CONSTRAINT "risk_history_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_reviews" ADD CONSTRAINT "risk_reviews_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_reviews" ADD CONSTRAINT "risk_reviews_draft_id_risk_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."risk_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_reviews" ADD CONSTRAINT "risk_reviews_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_reviews" ADD CONSTRAINT "risk_reviews_reviewer_user_id_users_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_sources" ADD CONSTRAINT "risk_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "risk_sources" ADD CONSTRAINT "risk_sources_risk_id_risks_id_fk" FOREIGN KEY ("risk_id") REFERENCES "public"."risks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report_drafts" ADD CONSTRAINT "weekly_report_drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report_drafts" ADD CONSTRAINT "weekly_report_drafts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report_versions" ADD CONSTRAINT "weekly_report_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report_versions" ADD CONSTRAINT "weekly_report_versions_draft_id_weekly_report_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."weekly_report_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "weekly_report_versions" ADD CONSTRAINT "weekly_report_versions_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_items_project_code_uidx" ON "action_items" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "action_items_project_status_due_idx" ON "action_items" USING btree ("project_id","status","due_date");--> statement-breakpoint
CREATE INDEX "action_items_owner_status_idx" ON "action_items" USING btree ("owner_user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "action_item_dependencies_pair_uidx" ON "action_item_dependencies" USING btree ("action_item_id","depends_on_action_item_id");--> statement-breakpoint
CREATE INDEX "action_item_dependencies_project_idx" ON "action_item_dependencies" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "action_item_drafts_project_status_idx" ON "action_item_drafts" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "action_item_history_version_uidx" ON "action_item_history" USING btree ("action_item_id","version_number");--> statement-breakpoint
CREATE INDEX "action_item_history_project_idx" ON "action_item_history" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "action_item_reviews_draft_uidx" ON "action_item_reviews" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "action_item_reviews_project_idx" ON "action_item_reviews" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "action_item_sources_item_idx" ON "action_item_sources" USING btree ("action_item_id");--> statement-breakpoint
CREATE INDEX "action_item_sources_source_idx" ON "action_item_sources" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "project_management_audits_project_created_idx" ON "project_management_audits" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_management_audits_resource_idx" ON "project_management_audits" USING btree ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "risks_project_code_uidx" ON "risks" USING btree ("project_id","code");--> statement-breakpoint
CREATE INDEX "risks_project_status_severity_idx" ON "risks" USING btree ("project_id","status","severity");--> statement-breakpoint
CREATE INDEX "risk_drafts_project_status_idx" ON "risk_drafts" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_history_version_uidx" ON "risk_history" USING btree ("risk_id","version_number");--> statement-breakpoint
CREATE INDEX "risk_history_project_idx" ON "risk_history" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "risk_reviews_draft_uidx" ON "risk_reviews" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "risk_reviews_project_idx" ON "risk_reviews" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "risk_sources_risk_idx" ON "risk_sources" USING btree ("risk_id");--> statement-breakpoint
CREATE INDEX "risk_sources_source_idx" ON "risk_sources" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE INDEX "weekly_report_drafts_project_status_idx" ON "weekly_report_drafts" USING btree ("project_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_report_versions_project_number_uidx" ON "weekly_report_versions" USING btree ("project_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "weekly_report_versions_draft_uidx" ON "weekly_report_versions" USING btree ("draft_id");--> statement-breakpoint
CREATE INDEX "weekly_report_versions_project_period_idx" ON "weekly_report_versions" USING btree ("project_id","period_end");