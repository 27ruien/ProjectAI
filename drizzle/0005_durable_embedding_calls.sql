ALTER TABLE "document_embedding_batches" DROP CONSTRAINT "document_embedding_batches_values_check";--> statement-breakpoint
ALTER TABLE "document_embedding_batches" DROP CONSTRAINT "document_embedding_batches_status_check";--> statement-breakpoint
DROP INDEX "document_embedding_batches_request_uidx";--> statement-breakpoint
ALTER TYPE "public"."document_embedding_batch_status" RENAME TO "document_embedding_batch_status_0004";--> statement-breakpoint
CREATE TYPE "public"."document_embedding_batch_status" AS ENUM('reserved', 'calling', 'succeeded', 'failed', 'unknown');--> statement-breakpoint
ALTER TABLE "document_embedding_batches" ALTER COLUMN "status" TYPE "public"."document_embedding_batch_status" USING "status"::text::"public"."document_embedding_batch_status";--> statement-breakpoint
DROP TYPE "public"."document_embedding_batch_status_0004";--> statement-breakpoint
CREATE TABLE "embedding_worker_heartbeats" (
	"worker_id" varchar(128) PRIMARY KEY NOT NULL,
	"embedding_profile_id" text NOT NULL,
	"worker_version" varchar(32) NOT NULL,
	"state" varchar(24) NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "embedding_worker_heartbeats_state_check" CHECK (
      "embedding_worker_heartbeats"."state" in ('running', 'draining')
      and length(btrim("embedding_worker_heartbeats"."worker_version")) > 0
    )
);
--> statement-breakpoint
ALTER TABLE "document_embedding_batches" ADD COLUMN "provider_attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_embedding_batches" ADD COLUMN "reserved_input_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_embedding_batches" ADD COLUMN "leased_by" varchar(128);--> statement-breakpoint
ALTER TABLE "document_embedding_batches" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_embedding_batches" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_embedding_batches" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "document_embedding_batches" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "document_embedding_batches"
SET
	"provider_attempt_count" = 1,
	"reserved_input_tokens" = ceil(
		greatest(coalesce("input_token_count", "chunk_count"), "chunk_count") * 1.25
	)::integer,
	"started_at" = "created_at",
	"completed_at" = "created_at",
	"updated_at" = "created_at";--> statement-breakpoint
WITH "legacy_duplicates" AS (
	SELECT
		"id",
		row_number() OVER (
			PARTITION BY "job_id", "request_sha256"
			ORDER BY ("status" = 'succeeded') DESC, "created_at" DESC, "id" DESC
		) AS "duplicate_number"
	FROM "document_embedding_batches"
)
UPDATE "document_embedding_batches" AS "batch"
SET "request_sha256" =
	md5("batch"."request_sha256" || ':' || "batch"."id") ||
	md5("batch"."id" || ':' || "batch"."request_sha256")
FROM "legacy_duplicates"
WHERE "legacy_duplicates"."id" = "batch"."id"
	AND "legacy_duplicates"."duplicate_number" > 1;--> statement-breakpoint
ALTER TABLE "embedding_worker_heartbeats" ADD CONSTRAINT "embedding_worker_heartbeats_embedding_profile_id_ai_embedding_profiles_id_fk" FOREIGN KEY ("embedding_profile_id") REFERENCES "public"."ai_embedding_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "embedding_worker_heartbeats_health_idx" ON "embedding_worker_heartbeats" USING btree ("embedding_profile_id","state","heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "document_embedding_batches_request_uidx" ON "document_embedding_batches" USING btree ("job_id","request_sha256");--> statement-breakpoint
ALTER TABLE "document_embedding_batches" ADD CONSTRAINT "document_embedding_batches_values_check" CHECK (
      "document_embedding_batches"."request_sha256" ~ '^[0-9a-f]{64}$'
      and "document_embedding_batches"."batch_index" >= 0
      and "document_embedding_batches"."attempt_count" > 0
      and "document_embedding_batches"."provider_attempt_count" >= 0
      and "document_embedding_batches"."dimensions" = 1024
      and "document_embedding_batches"."chunk_count" between 1 and 10
      and "document_embedding_batches"."reserved_input_tokens" >= 0
      and ("document_embedding_batches"."input_token_count" is null or "document_embedding_batches"."input_token_count" >= 0)
      and ("document_embedding_batches"."total_token_count" is null or "document_embedding_batches"."total_token_count" >= 0)
      and ("document_embedding_batches"."cost_micro_cny" is null or "document_embedding_batches"."cost_micro_cny" >= 0)
      and "document_embedding_batches"."latency_ms" >= 0
    );--> statement-breakpoint
ALTER TABLE "document_embedding_batches" ADD CONSTRAINT "document_embedding_batches_status_check" CHECK (
      (
        "document_embedding_batches"."status" = 'reserved'
        and "document_embedding_batches"."failure_code" is null
        and "document_embedding_batches"."leased_by" is not null
        and "document_embedding_batches"."lease_expires_at" is not null
        and "document_embedding_batches"."started_at" is null
        and "document_embedding_batches"."completed_at" is null
      )
      or (
        "document_embedding_batches"."status" = 'calling'
        and "document_embedding_batches"."failure_code" is null
        and "document_embedding_batches"."leased_by" is not null
        and "document_embedding_batches"."lease_expires_at" is not null
        and "document_embedding_batches"."started_at" is not null
        and "document_embedding_batches"."completed_at" is null
      )
      or (
        "document_embedding_batches"."status" = 'succeeded'
        and "document_embedding_batches"."failure_code" is null
        and "document_embedding_batches"."leased_by" is null
        and "document_embedding_batches"."lease_expires_at" is null
        and "document_embedding_batches"."started_at" is not null
        and "document_embedding_batches"."completed_at" is not null
      )
      or (
        "document_embedding_batches"."status" = 'failed'
        and "document_embedding_batches"."failure_code" is not null
        and length(btrim("document_embedding_batches"."failure_code")) > 0
        and "document_embedding_batches"."leased_by" is null
        and "document_embedding_batches"."lease_expires_at" is null
        and "document_embedding_batches"."completed_at" is not null
      )
      or (
        "document_embedding_batches"."status" = 'unknown'
        and "document_embedding_batches"."failure_code" = 'PROVIDER_RESULT_UNKNOWN'
        and "document_embedding_batches"."leased_by" is null
        and "document_embedding_batches"."lease_expires_at" is null
        and "document_embedding_batches"."started_at" is not null
        and "document_embedding_batches"."completed_at" is not null
      )
    );
