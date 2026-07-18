CREATE TYPE "public"."document_embedding_provider_call_status" AS ENUM('reserved', 'calling', 'succeeded', 'failed_confirmed_no_charge', 'unknown');--> statement-breakpoint
CREATE TABLE "document_embedding_provider_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"batch_id" text NOT NULL,
	"job_id" text NOT NULL,
	"project_id" text NOT NULL,
	"document_id" text NOT NULL,
	"version_id" text NOT NULL,
	"embedding_profile_id" text NOT NULL,
	"call_sequence" integer NOT NULL,
	"status" "document_embedding_provider_call_status" DEFAULT 'reserved' NOT NULL,
	"dispatch_classification" varchar(40),
	"budget_rule_version" varchar(80) NOT NULL,
	"reserved_input_tokens" integer NOT NULL,
	"input_token_count" integer,
	"total_token_count" integer,
	"cost_micro_cny" integer,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"provider_request_id" varchar(240),
	"failure_code" varchar(80),
	"leased_by" varchar(128),
	"lease_expires_at" timestamp with time zone,
	"dispatched_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_embedding_provider_calls_values_check" CHECK (
      "document_embedding_provider_calls"."call_sequence" > 0
      and length(btrim("document_embedding_provider_calls"."budget_rule_version")) > 0
      and "document_embedding_provider_calls"."reserved_input_tokens" between 1 and 33000
      and ("document_embedding_provider_calls"."input_token_count" is null or "document_embedding_provider_calls"."input_token_count" >= 0)
      and ("document_embedding_provider_calls"."total_token_count" is null or "document_embedding_provider_calls"."total_token_count" >= 0)
      and ("document_embedding_provider_calls"."cost_micro_cny" is null or "document_embedding_provider_calls"."cost_micro_cny" >= 0)
      and "document_embedding_provider_calls"."latency_ms" >= 0
      and (
        "document_embedding_provider_calls"."dispatch_classification" is null
        or "document_embedding_provider_calls"."dispatch_classification" in (
          'pre_dispatch', 'post_dispatch', 'explicit_http_rejection',
          'successful_response'
        )
      )
    ),
	CONSTRAINT "document_embedding_provider_calls_status_check" CHECK (
      (
        "document_embedding_provider_calls"."status" = 'reserved'
        and "document_embedding_provider_calls"."dispatch_classification" is null
        and "document_embedding_provider_calls"."failure_code" is null
        and "document_embedding_provider_calls"."dispatched_at" is null
        and "document_embedding_provider_calls"."completed_at" is null
      )
      or (
        "document_embedding_provider_calls"."status" = 'calling'
        and "document_embedding_provider_calls"."dispatch_classification" = 'post_dispatch'
        and "document_embedding_provider_calls"."failure_code" is null
        and "document_embedding_provider_calls"."leased_by" is not null
        and "document_embedding_provider_calls"."lease_expires_at" is not null
        and "document_embedding_provider_calls"."dispatched_at" is not null
        and "document_embedding_provider_calls"."completed_at" is null
      )
      or (
        "document_embedding_provider_calls"."status" = 'succeeded'
        and "document_embedding_provider_calls"."dispatch_classification" = 'successful_response'
        and "document_embedding_provider_calls"."failure_code" is null
        and "document_embedding_provider_calls"."leased_by" is null
        and "document_embedding_provider_calls"."lease_expires_at" is null
        and "document_embedding_provider_calls"."dispatched_at" is not null
        and "document_embedding_provider_calls"."completed_at" is not null
      )
      or (
        "document_embedding_provider_calls"."status" = 'failed_confirmed_no_charge'
        and "document_embedding_provider_calls"."dispatch_classification" = 'pre_dispatch'
        and "document_embedding_provider_calls"."failure_code" is not null
        and length(btrim("document_embedding_provider_calls"."failure_code")) > 0
        and "document_embedding_provider_calls"."leased_by" is null
        and "document_embedding_provider_calls"."lease_expires_at" is null
        and "document_embedding_provider_calls"."completed_at" is not null
      )
      or (
        "document_embedding_provider_calls"."status" = 'unknown'
        and "document_embedding_provider_calls"."dispatch_classification" in (
          'post_dispatch', 'explicit_http_rejection', 'successful_response'
        )
        and "document_embedding_provider_calls"."failure_code" = 'PROVIDER_RESULT_UNKNOWN'
        and "document_embedding_provider_calls"."leased_by" is null
        and "document_embedding_provider_calls"."lease_expires_at" is null
        and "document_embedding_provider_calls"."dispatched_at" is not null
        and "document_embedding_provider_calls"."completed_at" is not null
      )
    )
);
--> statement-breakpoint
ALTER TABLE "document_embedding_batches" ADD CONSTRAINT "document_embedding_batches_call_scope_unique" UNIQUE("id","job_id","project_id","document_id","version_id","embedding_profile_id");--> statement-breakpoint
WITH "legacy_calls" AS (
	SELECT
		"batch".*,
		greatest("batch"."provider_attempt_count", 1) AS "call_count",
		"sequence"."call_sequence"
	FROM "document_embedding_batches" AS "batch"
	CROSS JOIN LATERAL generate_series(
		1,
		greatest("batch"."provider_attempt_count", 1)
	) AS "sequence"("call_sequence")
)
INSERT INTO "document_embedding_provider_calls" (
	"id", "batch_id", "job_id", "project_id", "document_id", "version_id",
	"embedding_profile_id", "call_sequence", "status",
	"dispatch_classification", "budget_rule_version", "reserved_input_tokens",
	"input_token_count", "total_token_count", "cost_micro_cny", "latency_ms",
	"provider_request_id", "failure_code", "leased_by", "lease_expires_at",
	"dispatched_at", "completed_at", "created_at", "updated_at"
)
SELECT
	"id" || ':0006:' || lpad("call_sequence"::text, 6, '0'),
	"id", "job_id", "project_id", "document_id", "version_id",
	"embedding_profile_id", "call_sequence",
	(
		CASE
			WHEN "call_sequence" < "call_count" THEN 'unknown'
			WHEN "status" = 'reserved' THEN 'reserved'
			WHEN "status" = 'calling' THEN 'calling'
			WHEN "status" = 'succeeded' THEN 'succeeded'
			WHEN "status" = 'failed' AND "failure_code" IN (
				'SHUTDOWN_ABORTED', 'SECRET_NOT_CONFIGURED'
			) THEN 'failed_confirmed_no_charge'
			ELSE 'unknown'
		END
	)::"document_embedding_provider_call_status",
	CASE
		WHEN "call_sequence" < "call_count" THEN 'post_dispatch'
		WHEN "status" = 'reserved' THEN NULL
		WHEN "status" = 'succeeded' THEN 'successful_response'
		WHEN "status" = 'failed' AND "failure_code" IN (
			'SHUTDOWN_ABORTED', 'SECRET_NOT_CONFIGURED'
		) THEN 'pre_dispatch'
		ELSE 'post_dispatch'
	END,
	'text-embedding-v4-hard-limit-cn-beijing-v1',
	least("chunk_count" * 8192, 33000),
	CASE WHEN "call_sequence" = "call_count" AND "status" = 'succeeded'
		THEN "input_token_count" ELSE NULL END,
	CASE WHEN "call_sequence" = "call_count" AND "status" = 'succeeded'
		THEN "total_token_count" ELSE NULL END,
	CASE WHEN "call_sequence" = "call_count" AND "status" = 'succeeded'
		THEN "cost_micro_cny" ELSE NULL END,
	CASE WHEN "call_sequence" = "call_count" THEN "latency_ms" ELSE 0 END,
	CASE WHEN "call_sequence" = "call_count" AND "status" = 'succeeded'
		THEN "provider_request_id" ELSE NULL END,
	CASE
		WHEN "call_sequence" < "call_count" THEN 'PROVIDER_RESULT_UNKNOWN'
		WHEN "status" IN ('reserved', 'calling', 'succeeded') THEN NULL
		WHEN "status" = 'failed' AND "failure_code" IN (
			'SHUTDOWN_ABORTED', 'SECRET_NOT_CONFIGURED'
		) THEN "failure_code"
		ELSE 'PROVIDER_RESULT_UNKNOWN'
	END,
	CASE WHEN "call_sequence" = "call_count" AND "status" IN ('reserved', 'calling')
		THEN "leased_by" ELSE NULL END,
	CASE WHEN "call_sequence" = "call_count" AND "status" IN ('reserved', 'calling')
		THEN "lease_expires_at" ELSE NULL END,
	CASE WHEN "status" = 'reserved' AND "call_sequence" = "call_count"
		THEN NULL ELSE coalesce("started_at", "created_at") END,
	CASE WHEN "status" IN ('reserved', 'calling') AND "call_sequence" = "call_count"
		THEN NULL ELSE coalesce("completed_at", "updated_at", "created_at") END,
	"created_at", "updated_at"
FROM "legacy_calls";--> statement-breakpoint
ALTER TABLE "document_embedding_provider_calls" ADD CONSTRAINT "document_embedding_provider_calls_batch_scope_fk" FOREIGN KEY ("batch_id","job_id","project_id","document_id","version_id","embedding_profile_id") REFERENCES "public"."document_embedding_batches"("id","job_id","project_id","document_id","version_id","embedding_profile_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_embedding_provider_calls_sequence_uidx" ON "document_embedding_provider_calls" USING btree ("batch_id","call_sequence");--> statement-breakpoint
CREATE INDEX "document_embedding_provider_calls_budget_idx" ON "document_embedding_provider_calls" USING btree ("created_at","status");--> statement-breakpoint
CREATE INDEX "document_embedding_provider_calls_active_idx" ON "document_embedding_provider_calls" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE FUNCTION "prevent_terminal_embedding_provider_call_update"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF OLD.status IN ('succeeded', 'failed_confirmed_no_charge', 'unknown') THEN
		RAISE EXCEPTION 'terminal embedding provider calls are immutable';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "document_embedding_provider_calls_terminal_immutable"
BEFORE UPDATE ON "document_embedding_provider_calls"
FOR EACH ROW
EXECUTE FUNCTION "prevent_terminal_embedding_provider_call_update"();
