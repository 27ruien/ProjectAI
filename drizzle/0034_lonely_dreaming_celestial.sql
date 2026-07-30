ALTER TABLE "document_chunks" ADD COLUMN "chunk_type" varchar(32) DEFAULT 'text_block' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "parent_content" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "parent_content_sha256" varchar(64);--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "parse_quality_bps" integer DEFAULT 10000 NOT NULL;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "keywords" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "summary" text;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD COLUMN "embedding_status" varchar(24) DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_v3_structure_check" CHECK (
      "document_chunks"."chunk_type" in ('heading', 'paragraph_group', 'table', 'sheet_range', 'slide', 'notes', 'text_block', 'code_block', 'list', 'page')
      and "document_chunks"."parse_quality_bps" between 0 and 10000
      and ("document_chunks"."parent_content_sha256" is null or "document_chunks"."parent_content_sha256" ~ '^[0-9a-f]{64}$')
      and "document_chunks"."embedding_status" in ('unknown', 'pending', 'current', 'failed', 'disabled')
    );
