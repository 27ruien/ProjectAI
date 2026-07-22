CREATE TABLE "daily_timesheet_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"report_date" date NOT NULL,
	"status" varchar(32) DEFAULT 'needs_review' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"total_hours" numeric(6, 2) DEFAULT '0' NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unresolved_record_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai_provider" varchar(40),
	"ai_model" varchar(120),
	"prompt_version" varchar(40),
	"generated_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_timesheet_drafts_status_check" CHECK ("daily_timesheet_drafts"."status" in ('draft', 'needs_review', 'confirmed', 'syncing', 'partially_synced', 'synced', 'failed')),
	CONSTRAINT "daily_timesheet_drafts_version_check" CHECK ("daily_timesheet_drafts"."version" > 0),
	CONSTRAINT "daily_timesheet_drafts_total_hours_check" CHECK ("daily_timesheet_drafts"."total_hours" >= 0 and "daily_timesheet_drafts"."total_hours" <= 168)
);
--> statement-breakpoint
CREATE TABLE "timesheet_ai_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"draft_id" text,
	"report_date" date NOT NULL,
	"execution_id" text NOT NULL,
	"skill_id" varchar(80) NOT NULL,
	"model_profile_id" varchar(120) NOT NULL,
	"prompt_version" varchar(40) NOT NULL,
	"provider" varchar(40),
	"actual_model" varchar(120),
	"status" varchar(24) DEFAULT 'running' NOT NULL,
	"source_selection_digest" varchar(64) NOT NULL,
	"source_count" integer NOT NULL,
	"output_count" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"cost_usd_micros" integer,
	"latency_ms" integer,
	"failure_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "timesheet_ai_executions_status_check" CHECK ("timesheet_ai_executions"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "timesheet_ai_executions_digest_check" CHECK ("timesheet_ai_executions"."source_selection_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "timesheet_ai_executions_counts_check" CHECK ("timesheet_ai_executions"."source_count" >= 0 and ("timesheet_ai_executions"."output_count" is null or "timesheet_ai_executions"."output_count" >= 0))
);
--> statement-breakpoint
CREATE TABLE "timesheet_sync_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"draft_id" text NOT NULL,
	"sync_batch_id" text NOT NULL,
	"request_id" text NOT NULL,
	"connector_type" varchar(40) DEFAULT 'wecom_chrome_extension' NOT NULL,
	"status" varchar(40) DEFAULT 'pending' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_sync_batches_status_check" CHECK ("timesheet_sync_batches"."status" in ('pending', 'validating', 'waiting_for_board', 'waiting_for_login', 'running', 'paused', 'partially_synced', 'synced', 'failed', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "timesheet_sync_items" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"task_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" varchar(40) DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"external_reference" varchar(240),
	"error_code" varchar(80),
	"error_message_redacted" varchar(500),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_sync_items_status_check" CHECK ("timesheet_sync_items"."status" in ('pending', 'validating', 'waiting_for_login', 'running', 'saved', 'unknown', 'failed', 'cancelled')),
	CONSTRAINT "timesheet_sync_items_attempt_count_check" CHECK ("timesheet_sync_items"."attempt_count" >= 0 and "timesheet_sync_items"."attempt_count" <= 100)
);
--> statement-breakpoint
CREATE TABLE "timesheet_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"description" varchar(500) NOT NULL,
	"project_id" text,
	"project_name_snapshot" varchar(200) DEFAULT '' NOT NULL,
	"hours" numeric(5, 2),
	"category_id" varchar(80),
	"category_name_snapshot" varchar(120) DEFAULT '' NOT NULL,
	"work_status" varchar(80),
	"work_status_name_snapshot" varchar(120) DEFAULT '' NOT NULL,
	"confidence" jsonb NOT NULL,
	"needs_review" boolean DEFAULT true NOT NULL,
	"review_fields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source_record_ids" jsonb NOT NULL,
	"sort_order" integer NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheet_tasks_description_check" CHECK (length(btrim("timesheet_tasks"."description")) between 2 and 500),
	CONSTRAINT "timesheet_tasks_hours_check" CHECK ("timesheet_tasks"."hours" is null or ("timesheet_tasks"."hours" > 0 and "timesheet_tasks"."hours" <= 24)),
	CONSTRAINT "timesheet_tasks_sort_order_check" CHECK ("timesheet_tasks"."sort_order" >= 0)
);
--> statement-breakpoint
CREATE TABLE "work_log_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"record_date" date NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"raw_text" text NOT NULL,
	"source" varchar(24) DEFAULT 'manual' NOT NULL,
	"project_id" text,
	"project_hint" varchar(200),
	"hours_hint" numeric(5, 2),
	"status_hint" varchar(80),
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_log_records_source_check" CHECK ("work_log_records"."source" in ('manual', 'voice', 'import')),
	CONSTRAINT "work_log_records_raw_text_check" CHECK (length(btrim("work_log_records"."raw_text")) between 1 and 4000),
	CONSTRAINT "work_log_records_hours_hint_check" CHECK ("work_log_records"."hours_hint" is null or ("work_log_records"."hours_hint" > 0 and "work_log_records"."hours_hint" <= 24))
);
--> statement-breakpoint
ALTER TABLE "daily_timesheet_drafts" ADD CONSTRAINT "daily_timesheet_drafts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_timesheet_drafts" ADD CONSTRAINT "daily_timesheet_drafts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD CONSTRAINT "timesheet_ai_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD CONSTRAINT "timesheet_ai_executions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_ai_executions" ADD CONSTRAINT "timesheet_ai_executions_draft_id_daily_timesheet_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."daily_timesheet_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_sync_batches" ADD CONSTRAINT "timesheet_sync_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_sync_batches" ADD CONSTRAINT "timesheet_sync_batches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_sync_batches" ADD CONSTRAINT "timesheet_sync_batches_draft_id_daily_timesheet_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."daily_timesheet_drafts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_sync_items" ADD CONSTRAINT "timesheet_sync_items_batch_id_timesheet_sync_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."timesheet_sync_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_sync_items" ADD CONSTRAINT "timesheet_sync_items_task_id_timesheet_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."timesheet_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_tasks" ADD CONSTRAINT "timesheet_tasks_draft_id_daily_timesheet_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."daily_timesheet_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheet_tasks" ADD CONSTRAINT "timesheet_tasks_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_log_records" ADD CONSTRAINT "work_log_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_log_records" ADD CONSTRAINT "work_log_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_log_records" ADD CONSTRAINT "work_log_records_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "daily_timesheet_drafts_owner_date_uidx" ON "daily_timesheet_drafts" USING btree ("organization_id","user_id","report_date");--> statement-breakpoint
CREATE INDEX "daily_timesheet_drafts_owner_status_idx" ON "daily_timesheet_drafts" USING btree ("organization_id","user_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_ai_executions_execution_uidx" ON "timesheet_ai_executions" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "timesheet_ai_executions_owner_created_idx" ON "timesheet_ai_executions" USING btree ("organization_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_sync_batches_public_id_uidx" ON "timesheet_sync_batches" USING btree ("sync_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_sync_batches_request_uidx" ON "timesheet_sync_batches" USING btree ("organization_id","user_id","request_id");--> statement-breakpoint
CREATE INDEX "timesheet_sync_batches_owner_created_idx" ON "timesheet_sync_batches" USING btree ("organization_id","user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_sync_items_idempotency_uidx" ON "timesheet_sync_items" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_sync_items_batch_task_uidx" ON "timesheet_sync_items" USING btree ("batch_id","task_id");--> statement-breakpoint
CREATE INDEX "timesheet_sync_items_batch_status_idx" ON "timesheet_sync_items" USING btree ("batch_id","status");--> statement-breakpoint
CREATE INDEX "timesheet_tasks_draft_order_idx" ON "timesheet_tasks" USING btree ("draft_id","sort_order");--> statement-breakpoint
CREATE INDEX "timesheet_tasks_project_idx" ON "timesheet_tasks" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "work_log_records_owner_date_idx" ON "work_log_records" USING btree ("organization_id","user_id","record_date","recorded_at");--> statement-breakpoint
CREATE INDEX "work_log_records_project_idx" ON "work_log_records" USING btree ("project_id","record_date");
--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_ai_executions_running_uidx"
ON "timesheet_ai_executions" ("organization_id", "user_id", "report_date")
WHERE "status" = 'running';
--> statement-breakpoint
CREATE UNIQUE INDEX "timesheet_sync_batches_active_draft_uidx"
ON "timesheet_sync_batches" ("draft_id")
WHERE "status" IN ('pending', 'validating', 'waiting_for_board', 'waiting_for_login', 'running', 'paused');
--> statement-breakpoint
CREATE FUNCTION projectai_timesheet_scope_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_organization text;
  task_draft text;
BEGIN
  IF TG_TABLE_NAME = 'work_log_records' AND NEW.project_id IS NOT NULL THEN
    SELECT organization_id INTO expected_organization
    FROM projects WHERE id = NEW.project_id;
    IF expected_organization IS DISTINCT FROM NEW.organization_id THEN
      RAISE EXCEPTION 'work log project is outside its organization' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'timesheet_tasks' AND NEW.project_id IS NOT NULL THEN
    SELECT d.organization_id INTO expected_organization
    FROM daily_timesheet_drafts d WHERE d.id = NEW.draft_id;
    IF NOT EXISTS (
      SELECT 1 FROM projects p
      WHERE p.id = NEW.project_id AND p.organization_id = expected_organization
    ) THEN
      RAISE EXCEPTION 'timesheet task project is outside its draft organization' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'timesheet_sync_batches' THEN
    IF NOT EXISTS (
      SELECT 1 FROM daily_timesheet_drafts d
      WHERE d.id = NEW.draft_id
        AND d.organization_id = NEW.organization_id
        AND d.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'sync batch owner does not match its draft' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'timesheet_ai_executions' AND NEW.draft_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM daily_timesheet_drafts d
      WHERE d.id = NEW.draft_id
        AND d.organization_id = NEW.organization_id
        AND d.user_id = NEW.user_id
    ) THEN
      RAISE EXCEPTION 'AI execution owner does not match its draft' USING ERRCODE = '23514';
    END IF;
  ELSIF TG_TABLE_NAME = 'timesheet_sync_items' THEN
    SELECT draft_id INTO task_draft FROM timesheet_sync_batches WHERE id = NEW.batch_id;
    IF NOT EXISTS (
      SELECT 1 FROM timesheet_tasks t
      WHERE t.id = NEW.task_id AND t.draft_id = task_draft
    ) THEN
      RAISE EXCEPTION 'sync item task does not belong to its batch draft' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER work_log_records_scope_guard_trigger
BEFORE INSERT OR UPDATE OF organization_id, project_id ON work_log_records
FOR EACH ROW EXECUTE FUNCTION projectai_timesheet_scope_guard();
--> statement-breakpoint
CREATE TRIGGER timesheet_tasks_scope_guard_trigger
BEFORE INSERT OR UPDATE OF draft_id, project_id ON timesheet_tasks
FOR EACH ROW EXECUTE FUNCTION projectai_timesheet_scope_guard();
--> statement-breakpoint
CREATE TRIGGER timesheet_sync_batches_scope_guard_trigger
BEFORE INSERT OR UPDATE OF organization_id, user_id, draft_id ON timesheet_sync_batches
FOR EACH ROW EXECUTE FUNCTION projectai_timesheet_scope_guard();
--> statement-breakpoint
CREATE TRIGGER timesheet_ai_executions_scope_guard_trigger
BEFORE INSERT OR UPDATE OF organization_id, user_id, draft_id ON timesheet_ai_executions
FOR EACH ROW EXECUTE FUNCTION projectai_timesheet_scope_guard();
--> statement-breakpoint
CREATE TRIGGER timesheet_sync_items_scope_guard_trigger
BEFORE INSERT OR UPDATE OF batch_id, task_id ON timesheet_sync_items
FOR EACH ROW EXECUTE FUNCTION projectai_timesheet_scope_guard();
