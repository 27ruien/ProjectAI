CREATE TABLE "project_document_folders" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "knowledge_space_id" text NOT NULL,
  "parent_folder_id" text,
  "name" varchar(240) NOT NULL,
  "created_by" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_document_folders_id_project_unique" UNIQUE("id", "project_id"),
  CONSTRAINT "project_document_folders_name_nonempty" CHECK (length(btrim("name")) > 0),
  CONSTRAINT "project_document_folders_not_self_parent" CHECK ("parent_folder_id" IS NULL OR "parent_folder_id" <> "id")
);
--> statement-breakpoint
ALTER TABLE "project_document_folders" ADD CONSTRAINT "project_document_folders_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_document_folders" ADD CONSTRAINT "project_document_folders_knowledge_space_id_knowledge_spaces_id_fk" FOREIGN KEY ("knowledge_space_id") REFERENCES "public"."knowledge_spaces"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_document_folders" ADD CONSTRAINT "project_document_folders_parent_folder_id_project_document_folders_id_fk" FOREIGN KEY ("parent_folder_id") REFERENCES "public"."project_document_folders"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_document_folders" ADD CONSTRAINT "project_document_folders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_document_folders_parent_idx" ON "project_document_folders" USING btree ("project_id", "parent_folder_id", "updated_at");
--> statement-breakpoint
CREATE INDEX "project_document_folders_space_idx" ON "project_document_folders" USING btree ("knowledge_space_id", "project_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_document_folders_sibling_name_uidx" ON "project_document_folders" USING btree ("project_id", "knowledge_space_id", COALESCE("parent_folder_id", ''), lower("name"));
--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "folder_id" text;
--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_folder_project_fk" FOREIGN KEY ("folder_id", "project_id") REFERENCES "public"."project_document_folders"("id", "project_id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "project_documents_folder_idx" ON "project_documents" USING btree ("project_id", "folder_id", "updated_at");
--> statement-breakpoint
ALTER TABLE "guided_requirement_overviews" ADD COLUMN "based_on_overview_id" text;
--> statement-breakpoint
ALTER TABLE "guided_requirement_overviews" ADD CONSTRAINT "guided_requirement_overviews_based_on_overview_id_fk" FOREIGN KEY ("based_on_overview_id") REFERENCES "public"."guided_requirement_overviews"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "guided_requirement_overview_lineage_idx" ON "guided_requirement_overviews" USING btree ("project_id", "based_on_overview_id");
