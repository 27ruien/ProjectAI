ALTER TABLE "timesheet_sync_batches" ADD COLUMN "draft_version" integer;--> statement-breakpoint
ALTER TABLE "timesheet_sync_batches" ADD COLUMN "confirmed_at_snapshot" timestamp with time zone;--> statement-breakpoint
UPDATE "timesheet_sync_batches" AS batch
SET "draft_version" = draft."version",
    "confirmed_at_snapshot" = COALESCE(draft."confirmed_at", batch."created_at")
FROM "daily_timesheet_drafts" AS draft
WHERE draft."id" = batch."draft_id";--> statement-breakpoint
ALTER TABLE "timesheet_sync_batches" ALTER COLUMN "draft_version" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "timesheet_sync_batches" ALTER COLUMN "confirmed_at_snapshot" SET NOT NULL;
