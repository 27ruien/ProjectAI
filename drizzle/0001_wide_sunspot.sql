CREATE TYPE "public"."document_status" AS ENUM('pending', 'active', 'archived', 'failed');--> statement-breakpoint
CREATE TYPE "public"."document_storage_status" AS ENUM('pending', 'stored', 'failed', 'quarantined', 'deleted');--> statement-breakpoint
CREATE TABLE "project_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"display_name" varchar(240) NOT NULL,
	"document_status" "document_status" DEFAULT 'pending' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_by" text,
	"archived_at" timestamp with time zone,
	CONSTRAINT "project_documents_id_project_unique" UNIQUE("id","project_id"),
	CONSTRAINT "project_documents_display_name_nonempty" CHECK (length(btrim("project_documents"."display_name")) > 0),
	CONSTRAINT "project_documents_archive_state_check" CHECK ((
        "project_documents"."document_status" = 'archived'
        and "project_documents"."archived_by" is not null
        and "project_documents"."archived_at" is not null
      ) or (
        "project_documents"."document_status" <> 'archived'
        and "project_documents"."archived_by" is null
        and "project_documents"."archived_at" is null
      ))
);
--> statement-breakpoint
CREATE TABLE "project_document_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"project_id" text NOT NULL,
	"version_number" integer NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"upload_id" varchar(128) NOT NULL,
	"object_key" varchar(700) NOT NULL,
	"original_filename" varchar(255) NOT NULL,
	"normalized_extension" varchar(12) NOT NULL,
	"declared_mime_type" varchar(200) NOT NULL,
	"detected_mime_type" varchar(200) NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"storage_etag" varchar(200),
	"storage_status" "document_storage_status" DEFAULT 'pending' NOT NULL,
	"failure_code" varchar(64),
	"uploaded_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stored_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	CONSTRAINT "project_document_versions_positive_number_check" CHECK ("project_document_versions"."version_number" > 0),
	CONSTRAINT "project_document_versions_positive_size_check" CHECK ("project_document_versions"."size_bytes" > 0),
	CONSTRAINT "project_document_versions_sha256_check" CHECK ("project_document_versions"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "project_document_versions_current_stored_check" CHECK ("project_document_versions"."is_current" = false or "project_document_versions"."storage_status" = 'stored'),
	CONSTRAINT "project_document_versions_stored_metadata_check" CHECK ("project_document_versions"."storage_status" <> 'stored' or (
        "project_document_versions"."storage_etag" is not null
        and length(btrim("project_document_versions"."storage_etag")) > 0
        and "project_document_versions"."stored_at" is not null
        and "project_document_versions"."failure_code" is null
      )),
	CONSTRAINT "project_document_versions_pending_state_check" CHECK ("project_document_versions"."storage_status" <> 'pending' or (
        "project_document_versions"."is_current" = false
        and "project_document_versions"."storage_etag" is null
        and "project_document_versions"."stored_at" is null
        and "project_document_versions"."failure_code" is null
      )),
	CONSTRAINT "project_document_versions_failure_state_check" CHECK ("project_document_versions"."storage_status" not in ('failed', 'quarantined') or (
        "project_document_versions"."is_current" = false
        and "project_document_versions"."failure_code" is not null
        and length(btrim("project_document_versions"."failure_code")) > 0
      )),
	CONSTRAINT "project_document_versions_failure_code_scope_check" CHECK ("project_document_versions"."failure_code" is null or "project_document_versions"."storage_status" in ('failed', 'quarantined')),
	CONSTRAINT "project_document_versions_deleted_not_current_check" CHECK ("project_document_versions"."storage_status" <> 'deleted' or "project_document_versions"."is_current" = false)
);
--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_archived_by_users_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document_versions" ADD CONSTRAINT "project_document_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document_versions" ADD CONSTRAINT "project_document_versions_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_document_versions" ADD CONSTRAINT "project_document_versions_document_project_fk" FOREIGN KEY ("document_id","project_id") REFERENCES "public"."project_documents"("id","project_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_documents_project_status_idx" ON "project_documents" USING btree ("project_id","document_status","updated_at");--> statement-breakpoint
CREATE INDEX "project_documents_created_by_idx" ON "project_documents" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "project_document_versions_number_uidx" ON "project_document_versions" USING btree ("document_id","version_number");--> statement-breakpoint
CREATE UNIQUE INDEX "project_document_versions_upload_uidx" ON "project_document_versions" USING btree ("upload_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_document_versions_object_key_uidx" ON "project_document_versions" USING btree ("object_key");--> statement-breakpoint
CREATE UNIQUE INDEX "project_document_versions_one_current_uidx" ON "project_document_versions" USING btree ("document_id") WHERE "project_document_versions"."is_current" = true;--> statement-breakpoint
CREATE INDEX "project_document_versions_project_idx" ON "project_document_versions" USING btree ("project_id","document_id");--> statement-breakpoint
CREATE INDEX "project_document_versions_storage_idx" ON "project_document_versions" USING btree ("storage_status","created_at");