ALTER TABLE "ai_retrieval_runs" DROP CONSTRAINT "ai_retrieval_runs_counts_check";--> statement-breakpoint
ALTER TABLE "document_sections" ADD COLUMN "chunk_type" varchar(32) DEFAULT 'text_block' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_sections" ADD COLUMN "parent_content" text;--> statement-breakpoint
ALTER TABLE "document_sections" ADD COLUMN "parent_content_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "document_sections" ADD COLUMN "parse_quality_bps" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_sections" ADD COLUMN "keywords" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "document_sections" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "document_sections" ADD COLUMN "embedding_status" varchar(24) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD COLUMN "normalized_query_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD COLUMN "rewritten_query_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD COLUMN "query_processing_latency_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD COLUMN "rerank_latency_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD COLUMN "context_expansion_latency_ms" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD COLUMN "rerank_fallback_reason" varchar(80);--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD CONSTRAINT "ai_retrieval_runs_normalized_query_hash_check" CHECK ("ai_retrieval_runs"."normalized_query_sha256" is null or "ai_retrieval_runs"."normalized_query_sha256" ~ '^[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "ai_retrieval_runs" ADD CONSTRAINT "ai_retrieval_runs_counts_check" CHECK (
      "ai_retrieval_runs"."lexical_candidate_count" between 0 and 30
      and "ai_retrieval_runs"."vector_candidate_count" between 0 and 30
      and "ai_retrieval_runs"."fused_candidate_count" between 0 and 30
      and "ai_retrieval_runs"."selected_evidence_count" between 0 and 10
      and "ai_retrieval_runs"."embedding_coverage_bps" between 0 and 10000
      and "ai_retrieval_runs"."lexical_latency_ms" >= 0
      and "ai_retrieval_runs"."query_embedding_latency_ms" >= 0
      and "ai_retrieval_runs"."vector_latency_ms" >= 0
      and "ai_retrieval_runs"."fusion_latency_ms" >= 0
      and "ai_retrieval_runs"."query_processing_latency_ms" >= 0
      and "ai_retrieval_runs"."rerank_latency_ms" >= 0
      and "ai_retrieval_runs"."context_expansion_latency_ms" >= 0
      and "ai_retrieval_runs"."rewritten_query_count" between 0 and 4
      and "ai_retrieval_runs"."total_latency_ms" >= 0
    );--> statement-breakpoint
ALTER TABLE "document_sections" ADD CONSTRAINT "document_sections_v3_structure_check" CHECK (
      "document_sections"."chunk_type" in ('heading', 'paragraph_group', 'table', 'sheet_range', 'slide', 'notes', 'text_block', 'code_block', 'list', 'page')
      and "document_sections"."parse_quality_bps" between 0 and 10000
      and ("document_sections"."parent_content_sha256" is null or "document_sections"."parent_content_sha256" ~ '^[0-9a-f]{64}$')
      and "document_sections"."embedding_status" in ('unknown', 'pending', 'current', 'failed', 'disabled')
    );
