import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Round 3 retrieval preserves ACL-before-query/rewrite/rerank/context ordering", async () => {
  const retrieval = await readFile("lib/ai/retrieval/service.ts", "utf8");
  const context = await readFile("lib/documents/processing/search-service.ts", "utf8");
  assert.ok(retrieval.indexOf("requireProjectAccess") < retrieval.indexOf("processBoundedQuery"));
  assert.ok(retrieval.indexOf("exactVectorCandidates") < retrieval.lastIndexOf("rerankAuthorizedCandidates"));
  assert.match(context, /expandAuthorizedEvidenceContext[\s\S]+projectai_authorized_documents/);
  assert.doesNotMatch(retrieval, /HNSW|IVFFlat/i);
});

test("Round 3 stores structural chunk metadata and privacy-safe query hashes", async () => {
  const schema = await readFile("lib/db/schema/document-ingestion.ts", "utf8");
  const retrievalSchema = await readFile("lib/db/schema/ai-retrieval.ts", "utf8");
  for (const marker of ["parent_content", "chunk_type", "parse_quality_bps", "keywords", "summary", "embedding_status"]) assert.match(schema, new RegExp(marker));
  assert.match(retrievalSchema, /normalized_query_sha256/);
  assert.doesNotMatch(retrievalSchema, /original_query.*text|normalized_query.*text|rewritten_queries.*jsonb/);
});

test("Round 3 chunk management rechecks project and document ACL before hash-bound mutations", async () => {
  const service = await readFile("lib/knowledge/chunk-management.ts", "utf8");
  const route = await readFile(
    "app/api/projects/[projectId]/documents/[documentId]/chunks/[chunkId]/route.ts",
    "utf8",
  );
  assert.ok(service.indexOf("requireProjectRole") < service.indexOf(".for(\"update\"") );
  assert.ok(service.indexOf("findAuthorizedDocument") < service.indexOf("expectedContentSha256"));
  assert.match(service, /permission: \"manage_versions\"/);
  assert.match(service, /CHUNK_VERSION_CONFLICT/);
  assert.match(service, /knowledge_chunk_\$\{parsed\.data\.action\}/);
  assert.match(route, /requireTrustedMutationRequest/);
  assert.doesNotMatch(route, /embedding\s*:/);
});
