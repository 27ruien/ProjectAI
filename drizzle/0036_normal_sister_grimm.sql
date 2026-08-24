CREATE TABLE "project_timelines" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"name" varchar(200) NOT NULL,
	"data_json" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_timelines_name_check" CHECK (length(btrim("project_timelines"."name")) > 0),
	CONSTRAINT "project_timelines_version_check" CHECK ("project_timelines"."version" > 0),
	CONSTRAINT "project_timelines_data_object_check" CHECK (jsonb_typeof("project_timelines"."data_json") = 'object')
);
--> statement-breakpoint
ALTER TABLE "project_timelines" ADD CONSTRAINT "project_timelines_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timelines" ADD CONSTRAINT "project_timelines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_timelines" ADD CONSTRAINT "project_timelines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "project_timelines_project_uidx" ON "project_timelines" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_timelines_updated_at_idx" ON "project_timelines" USING btree ("updated_at");