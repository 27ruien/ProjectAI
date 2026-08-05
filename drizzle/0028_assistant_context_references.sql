ALTER TABLE "ai_threads" ADD COLUMN "generation_model_id" text;--> statement-breakpoint
ALTER TABLE "ai_threads" ADD CONSTRAINT "ai_threads_generation_model_id_ai_generation_models_id_fk" FOREIGN KEY ("generation_model_id") REFERENCES "public"."ai_generation_models"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "sequence" integer;--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "context_references" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
WITH numbered AS (
  SELECT id, row_number() OVER (PARTITION BY project_id, thread_id ORDER BY created_at ASC, id ASC)::integer AS sequence
  FROM ai_messages
)
UPDATE ai_messages AS message
SET sequence = numbered.sequence
FROM numbered
WHERE message.id = numbered.id;--> statement-breakpoint
ALTER TABLE "ai_messages" ALTER COLUMN "sequence" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_messages_thread_sequence_uidx" ON "ai_messages" USING btree ("project_id","thread_id","sequence");
