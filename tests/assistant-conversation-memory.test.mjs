import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("historical conversation context stays private, authorized, and non-factual", async () => {
  const [repository, grounding, schema] = await Promise.all([
    source("lib/ai/project-assistant/repository.ts"),
    source("lib/ai/project-assistant/grounding.ts"),
    source("lib/db/schema/ai-assistant.ts"),
  ]);
  assert.match(repository, /historyRequested/);
  assert.match(repository, /eq\(aiConversationMemory\.ownerUserId, input\.principal\.user\.id\)/);
  assert.match(repository, /isNull\(aiThread\.deletedAt\)/);
  assert.match(repository, /listAllAuthorizedDocumentScope/);
  assert.match(repository, /canReadProject/);
  assert.match(repository, /sourceDocumentIds\.every/);
  assert.match(repository, /recordConversationHistoryCitations/);
  assert.match(grounding, /historical_summary 是旧 AI 对话的派生摘要，不是项目事实/);
  assert.match(schema, /ai_conversation_memories/);
  assert.match(schema, /summaryEmbedding/);
  assert.match(schema, /embeddingModelProfileId/);
  assert.match(schema, /embeddingDimensions/);
  assert.match(schema, /ai_conversation_memories_thread_owner_scope_fk/);
  assert.match(schema, /ai_message_history_citations/);
});

test("citation previews repeat server-side ownership and current-document checks", async () => {
  const repository = await source("lib/ai/project-assistant/repository.ts");
  assert.match(repository, /loadAssistantCitationPreview/);
  assert.match(repository, /requireAssistantConversationAccess/);
  assert.match(repository, /eq\(aiThread\.createdBy, input\.principal\.user\.id\)/);
  assert.match(repository, /version\.documentStatus !== "active"/);
  assert.match(repository, /AI_CITATION_NOT_FOUND/);
});

test("historical citation previews repeat owner, organization, project, and source checks", async () => {
  const repository = await source("lib/ai/project-assistant/repository.ts");
  assert.match(repository, /loadAssistantHistoryCitationPreview/);
  assert.match(repository, /eq\(aiConversationMemory\.ownerUserId, input\.principal\.user\.id\)/);
  assert.match(repository, /memory\.organizationId !== currentProject\.organizationId/);
  assert.match(repository, /canReadProject\(input\.principal, memory\.projectId\)/);
  assert.match(repository, /sourceDocumentIds\.every/);
});
