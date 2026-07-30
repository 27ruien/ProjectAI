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

test("Round 3 only invokes Provider Query Rewrite after baseline lexical Evidence exists", async () => {
  const retrieval = await readFile("lib/ai/retrieval/service.ts", "utf8");
  const baselineNormalization = retrieval.indexOf(
    "let processed = await processBoundedQuery({ query: input.query });",
  );
  const lexicalSelection = retrieval.indexOf(
    "let lexicalEvidence = selectLexicalEvidence(lexical);",
  );
  const rewriteGuard = retrieval.indexOf(
    "if (retrievalGateway && lexicalEvidence.length > 0)",
  );
  const providerRewrite = retrieval.indexOf(
    "gateway: retrievalGateway",
    rewriteGuard,
  );
  assert.ok(baselineNormalization >= 0);
  assert.ok(baselineNormalization < lexicalSelection);
  assert.ok(lexicalSelection < rewriteGuard);
  assert.ok(rewriteGuard < providerRewrite);
});

test("Round 3 durably budgets Rewrite and Rerank usage with the Answer execution", async () => {
  const [assistantRepository, retrievalRepository, retrievalSchema] = await Promise.all([
    readFile("lib/ai/project-assistant/repository.ts", "utf8"),
    readFile("lib/ai/retrieval/repository.ts", "utf8"),
    readFile("lib/db/schema/ai-retrieval.ts", "utf8"),
  ]);
  for (const repository of [assistantRepository, retrievalRepository]) {
    assert.match(repository, /from ai_retrieval_provider_calls/u);
    assert.match(repository, /status in \('reserved', 'succeeded', 'unknown'\)/u);
    assert.match(repository, /reserved_token_count/u);
  }
  assert.match(retrievalRepository, /pg_advisory_xact_lock/u);
  assert.match(retrievalRepository, /finalizeRetrievalProviderCallSucceeded/u);
  assert.match(retrievalRepository, /finalizeRetrievalProviderCallUnknown/u);
  assert.match(retrievalSchema, /ai_retrieval_provider_calls/u);
  assert.match(retrievalSchema, /ai_retrieval_provider_calls_run_purpose_uidx/u);
});

test("Round 3 revalidates exact Citation lifecycle and publication project scope at final persistence", async () => {
  const [assistantRepository, workflowSchema, migration] = await Promise.all([
    readFile("lib/ai/project-assistant/repository.ts", "utf8"),
    readFile("lib/db/schema/workflows.ts", "utf8"),
    readFile("drizzle/0036_brief_wolverine.sql", "utf8"),
  ]);
  const finalization = assistantRepository.slice(
    assistantRepository.indexOf("export async function finalizeSuccessfulExecution"),
  );
  for (const marker of [
    "chunk.content_sha256 = expected.content_sha256",
    "chunk.is_effective = true",
    "ingestion.generation = chunk.generation",
    "ingestion.status = 'succeeded'",
    "version.is_current = true",
    "version.storage_status = 'stored'",
    "document.document_status = 'active'",
    "projectai_authorized_documents",
  ]) {
    assert.match(finalization, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(finalization, /AI_CITATION_VALIDATION_FAILED/u);
  for (const constraint of [
    "workflow_artifacts_published_document_project_fk",
    "workflow_artifacts_published_version_document_project_fk",
    "workflow_artifacts_published_link_check",
  ]) {
    assert.match(workflowSchema, new RegExp(constraint));
    assert.match(migration, new RegExp(constraint));
  }
  assert.match(migration, /WORKFLOW_ARTIFACT_PROJECT_SCOPE_INVALID/u);
});
