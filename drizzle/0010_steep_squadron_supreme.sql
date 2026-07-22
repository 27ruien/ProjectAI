ALTER TABLE "scope_versions" ADD COLUMN "removal_declarations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scope_versions" ADD COLUMN "ambiguous_requirement_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "scope_versions" ADD COLUMN "out_of_scope_requirement_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_executions" ADD COLUMN "source_selection_digest" varchar(64) DEFAULT 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_source_selection_digest_check" CHECK ("ai_executions"."source_selection_digest" ~ '^[0-9a-f]{64}$');