ALTER TABLE "timesheet_sync_items" ADD COLUMN "external_url" varchar(500);--> statement-breakpoint
ALTER TABLE "timesheet_sync_items" ADD COLUMN "verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_sync_items" ADD COLUMN "saved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "timesheet_tasks" ADD COLUMN "submission_status" varchar(24) DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_tasks" ADD COLUMN "submitted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "timesheet_sync_items"
SET "verified" = true,
    "saved_at" = COALESCE("updated_at", "created_at")
WHERE "status" = 'saved';--> statement-breakpoint
UPDATE "timesheet_tasks" AS task
SET "submission_status" = 'submitted',
    "submitted_at" = saved."saved_at"
FROM (
  SELECT DISTINCT ON (item."task_id")
    item."task_id",
    COALESCE(item."updated_at", item."created_at") AS "saved_at"
  FROM "timesheet_sync_items" AS item
  INNER JOIN "timesheet_sync_batches" AS batch ON batch."id" = item."batch_id"
  WHERE item."status" = 'saved' AND batch."dry_run" = false
  ORDER BY item."task_id", item."updated_at" DESC
) AS saved
WHERE task."id" = saved."task_id";--> statement-breakpoint
UPDATE "timesheet_tasks" AS task
SET "submission_status" = CASE latest."status"
  WHEN 'unknown' THEN 'unknown'
  WHEN 'failed' THEN 'failed'
  WHEN 'cancelled' THEN 'cancelled'
  WHEN 'pending' THEN 'syncing'
  WHEN 'validating' THEN 'syncing'
  WHEN 'waiting_for_login' THEN 'syncing'
  WHEN 'running' THEN 'syncing'
  ELSE task."submission_status"
END
FROM (
  SELECT DISTINCT ON (item."task_id") item."task_id", item."status"
  FROM "timesheet_sync_items" AS item
  INNER JOIN "timesheet_sync_batches" AS batch ON batch."id" = item."batch_id"
  WHERE batch."dry_run" = false AND item."status" <> 'saved'
  ORDER BY item."task_id", item."updated_at" DESC
) AS latest
WHERE task."id" = latest."task_id" AND task."submission_status" <> 'submitted';--> statement-breakpoint
UPDATE "timesheet_tasks" AS task
SET "submission_status" = 'confirmed'
FROM "daily_timesheet_drafts" AS draft
WHERE task."draft_id" = draft."id"
  AND task."submission_status" = 'draft'
  AND draft."status" IN ('confirmed', 'syncing', 'partially_synced', 'synced', 'failed');--> statement-breakpoint
CREATE INDEX "timesheet_tasks_draft_submission_idx" ON "timesheet_tasks" USING btree ("draft_id","submission_status","sort_order");--> statement-breakpoint
ALTER TABLE "timesheet_sync_items" ADD CONSTRAINT "timesheet_sync_items_saved_verification_check" CHECK ("timesheet_sync_items"."status" <> 'saved' or ("timesheet_sync_items"."verified" = true and "timesheet_sync_items"."saved_at" is not null));--> statement-breakpoint
ALTER TABLE "timesheet_tasks" ADD CONSTRAINT "timesheet_tasks_submission_status_check" CHECK ("timesheet_tasks"."submission_status" in ('draft', 'confirmed', 'syncing', 'submitted', 'failed', 'unknown', 'cancelled'));--> statement-breakpoint
ALTER TABLE "timesheet_tasks" ADD CONSTRAINT "timesheet_tasks_submitted_at_check" CHECK (("timesheet_tasks"."submission_status" = 'submitted') = ("timesheet_tasks"."submitted_at" is not null));
