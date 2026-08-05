CREATE TABLE "ai_conversation_memories" (
  "thread_id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE restrict,
  "owner_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE restrict,
  "summary" text NOT NULL,
  "key_topics" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source_document_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "summary_embedding" vector(1024),
  "embedding_model_profile_id" varchar(120) NOT NULL,
  "embedding_dimensions" integer NOT NULL,
  "search_vector" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(key_topics::text, ''))) STORED,
  "source_message_count" integer DEFAULT 0 NOT NULL,
  "last_message_at" timestamp with time zone NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_conversation_memories_summary_check" CHECK (length(btrim("summary")) between 1 and 6000 and "source_message_count" >= 0),
  CONSTRAINT "ai_conversation_memories_embedding_dimensions_check" CHECK ("embedding_dimensions" = 1024),
  CONSTRAINT "ai_conversation_memories_thread_owner_scope_fk" FOREIGN KEY ("thread_id","project_id","owner_user_id") REFERENCES "ai_threads"("id","project_id","created_by") ON DELETE cascade
);
CREATE INDEX "ai_conversation_memories_owner_project_idx" ON "ai_conversation_memories" ("owner_user_id","project_id","last_message_at");
CREATE INDEX "ai_conversation_memories_search_idx" ON "ai_conversation_memories" USING gin ("search_vector");

CREATE TABLE "ai_message_history_citations" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL REFERENCES "projects"("id") ON DELETE restrict,
  "thread_id" text NOT NULL,
  "assistant_message_id" text NOT NULL,
  "source_thread_id" text NOT NULL REFERENCES "ai_threads"("id") ON DELETE restrict,
  "source_memory_updated_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "ai_message_history_citation_message_scope_fk" FOREIGN KEY ("assistant_message_id","project_id","thread_id") REFERENCES "ai_messages"("id","project_id","thread_id") ON DELETE restrict
);
CREATE UNIQUE INDEX "ai_message_history_citation_message_thread_uidx" ON "ai_message_history_citations" ("assistant_message_id","source_thread_id");
CREATE INDEX "ai_message_history_citation_project_message_idx" ON "ai_message_history_citations" ("project_id","thread_id","assistant_message_id");
