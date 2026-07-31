ALTER TABLE "ai_executions" DROP CONSTRAINT "ai_executions_succeeded_check";
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_succeeded_check" CHECK (
  "status" <> 'succeeded'
  OR (
    "completed_at" IS NOT NULL
    AND "failure_code" IS NULL
    AND "actual_model" IS NOT NULL
    AND (
      ("retrieval_run_id" IS NULL AND "evidence_count" = 0)
      OR ("retrieval_run_id" IS NOT NULL AND "evidence_count" > 0)
    )
  )
);
