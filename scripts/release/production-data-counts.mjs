#!/usr/bin/env node

import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  const result = await client.query(`
    select
      (select count(*)::int from project_documents) as documents,
      (select count(*)::int from project_document_versions) as versions,
      (select count(*)::int from document_chunks) as chunks,
      (select count(*)::int from document_embedding_jobs) as embedding_jobs,
      (select count(*)::int from document_chunk_embeddings) as vectors,
      (select count(*)::int from ai_executions) as ai_executions,
      (select count(*)::int from ai_retrieval_runs) as retrieval_runs
  `);
  process.stdout.write(`${JSON.stringify(result.rows[0])}\n`);
} finally {
  await client.end();
}
