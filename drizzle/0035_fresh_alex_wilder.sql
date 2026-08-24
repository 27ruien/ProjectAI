CREATE TABLE "project_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"alias" varchar(200) NOT NULL,
	"normalized_alias" varchar(200) NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_aliases_nonempty_check" CHECK (length(btrim("project_aliases"."alias")) > 0 and length(btrim("project_aliases"."normalized_alias")) > 0)
);
--> statement-breakpoint
ALTER TABLE "project_documents" ADD COLUMN "context_kind" varchar(40) DEFAULT 'general' NOT NULL;
--> statement-breakpoint
ALTER TABLE "project_aliases" ADD CONSTRAINT "project_aliases_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_aliases" ADD CONSTRAINT "project_aliases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "project_aliases_project_normalized_uidx" ON "project_aliases" USING btree ("project_id","normalized_alias");
--> statement-breakpoint
CREATE INDEX "project_aliases_normalized_idx" ON "project_aliases" USING btree ("normalized_alias");
--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_context_kind_check" CHECK ("project_documents"."context_kind" in ('general', 'timeline', 'meeting_notes', 'scope', 'proposal', 'requirement', 'test_report', 'project_brief'));
