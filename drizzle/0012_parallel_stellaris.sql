CREATE TABLE "project_management_ai_executions" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"skill_id" varchar(80) NOT NULL,
	"model_profile_id" varchar(120) NOT NULL,
	"provider" varchar(40),
	"actual_model" varchar(120),
	"status" varchar(24) DEFAULT 'running' NOT NULL,
	"source_selection_digest" varchar(64) NOT NULL,
	"source_count" integer NOT NULL,
	"output_count" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd_micros" integer,
	"latency_ms" integer,
	"failure_code" varchar(80),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "project_management_ai_executions_status_check" CHECK ("project_management_ai_executions"."status" in ('running', 'succeeded', 'failed')),
	CONSTRAINT "project_management_ai_executions_digest_check" CHECK ("project_management_ai_executions"."source_selection_digest" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "project_management_ai_executions_counts_check" CHECK ("project_management_ai_executions"."source_count" >= 0 and ("project_management_ai_executions"."output_count" is null or "project_management_ai_executions"."output_count" >= 0))
);
--> statement-breakpoint
ALTER TABLE "requirement_extraction_runs" ADD COLUMN "skill_id" varchar(80) DEFAULT 'requirement-extraction' NOT NULL;--> statement-breakpoint
ALTER TABLE "requirement_extraction_runs" ADD COLUMN "cost_usd_micros" integer;--> statement-breakpoint
ALTER TABLE "project_management_ai_executions" ADD CONSTRAINT "project_management_ai_executions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_management_ai_executions" ADD CONSTRAINT "project_management_ai_executions_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_management_ai_executions_project_created_idx" ON "project_management_ai_executions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "project_management_ai_executions_actor_created_idx" ON "project_management_ai_executions" USING btree ("actor_user_id","created_at");