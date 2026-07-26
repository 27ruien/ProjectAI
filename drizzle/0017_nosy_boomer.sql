ALTER TABLE "timesheet_tasks" ADD COLUMN "overtime_hours" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "timesheet_tasks" ADD COLUMN "urgency_name_snapshot" varchar(120);--> statement-breakpoint
ALTER TABLE "timesheet_tasks" ADD COLUMN "progress" integer;--> statement-breakpoint
ALTER TABLE "timesheet_tasks" DROP CONSTRAINT "timesheet_tasks_hours_check";--> statement-breakpoint
ALTER TABLE "timesheet_tasks" ADD CONSTRAINT "timesheet_tasks_overtime_hours_check" CHECK ("timesheet_tasks"."overtime_hours" is null or ("timesheet_tasks"."overtime_hours" >= 0 and "timesheet_tasks"."overtime_hours" <= 24 and mod("timesheet_tasks"."overtime_hours" * 100, 25) = 0));--> statement-breakpoint
ALTER TABLE "timesheet_tasks" ADD CONSTRAINT "timesheet_tasks_total_daily_hours_check" CHECK ("timesheet_tasks"."hours" is null or "timesheet_tasks"."overtime_hours" is null or "timesheet_tasks"."hours" + "timesheet_tasks"."overtime_hours" <= 24);--> statement-breakpoint
ALTER TABLE "timesheet_tasks" ADD CONSTRAINT "timesheet_tasks_progress_check" CHECK ("timesheet_tasks"."progress" is null or ("timesheet_tasks"."progress" >= 0 and "timesheet_tasks"."progress" <= 100));--> statement-breakpoint
ALTER TABLE "timesheet_tasks" ADD CONSTRAINT "timesheet_tasks_hours_check" CHECK ("timesheet_tasks"."hours" is null or ("timesheet_tasks"."hours" >= 0 and "timesheet_tasks"."hours" <= 24 and mod("timesheet_tasks"."hours" * 100, 25) = 0));
