ALTER TABLE "workflow_run_sources" DROP CONSTRAINT "workflow_run_sources_shape_check";--> statement-breakpoint
ALTER TABLE "workflow_run_sources" DROP CONSTRAINT "workflow_run_sources_document_project_fk";
--> statement-breakpoint
ALTER TABLE "workflow_run_sources" DROP CONSTRAINT "workflow_run_sources_version_document_project_fk";
--> statement-breakpoint
ALTER TABLE "workflow_run_sources" ADD COLUMN "source_project_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "workflow_run_sources" ADD CONSTRAINT "workflow_run_sources_document_project_fk" FOREIGN KEY ("document_id","source_project_id") REFERENCES "public"."project_documents"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_sources" ADD CONSTRAINT "workflow_run_sources_version_document_project_fk" FOREIGN KEY ("document_version_id","document_id","source_project_id") REFERENCES "public"."project_document_versions"("id","document_id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_run_sources" ADD CONSTRAINT "workflow_run_sources_shape_check" CHECK (("workflow_run_sources"."source_type" = 'audio' and "workflow_run_sources"."source_project_id" = "workflow_run_sources"."project_id" and "workflow_run_sources"."object_key" is not null and "workflow_run_sources"."document_id" is null) or ("workflow_run_sources"."source_type" <> 'audio' and "workflow_run_sources"."document_id" is not null and "workflow_run_sources"."document_version_id" is not null and "workflow_run_sources"."object_key" is null));