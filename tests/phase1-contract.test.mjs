import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

describe("Phase 1 organization and knowledge authorization contract", () => {
  it("commits the complete Round 1 data model and compatibility backfill", async () => {
    const migration = await source("drizzle/0008_material_maggott.sql");
    for (const table of [
      "organizations",
      "organization_members",
      "departments",
      "department_members",
      "knowledge_spaces",
      "knowledge_space_members",
      "document_grants",
      "knowledge_space_grants",
      "project_knowledge_sources",
      "permission_audits",
    ]) {
      assert.match(migration, new RegExp(`CREATE TABLE "${table}"`));
    }
    assert.match(migration, /UPDATE "projects"[\s\S]+"organization_id"/);
    assert.match(migration, /UPDATE "project_documents"[\s\S]+"knowledge_space_id"/);
    assert.match(migration, /projects_default_knowledge_space_trigger/);
    assert.match(migration, /project_documents_knowledge_space_trigger/);
  });

  it("uses one database authorization scope for lexical, vector, downloads and citations", async () => {
    const [migration, lexical, vector, files, citations] = await Promise.all([
      source("drizzle/0008_material_maggott.sql"),
      source("lib/documents/processing/search-service.ts"),
      source("lib/ai/retrieval/service.ts"),
      source("lib/files/authorization.ts"),
      source("lib/ai/project-assistant/repository.ts"),
    ]);
    assert.match(migration, /projectai_authorized_documents/);
    assert.match(migration, /bool_or\(mr\.effect = 'deny'\)/);
    assert.match(lexical, /projectai_authorized_documents/);
    assert.match(vector, /projectai_authorized_documents/g);
    assert.match(files, /findAuthorizedDocumentVersion/);
    assert.match(citations, /listAuthorizedDocumentScope/);
    assert.match(citations, /来源权限已变化/);
  });

  it("keeps controlled test account seeding outside Production", async () => {
    const [seed, reset, compose] = await Promise.all([
      source("scripts/db/seed.ts"),
      source("scripts/db/reset-test-account-password.ts"),
      source("docker-compose.staging.yml"),
    ]);
    assert.match(seed, /PROJECTAI_SEED_ENVIRONMENT/);
    assert.match(seed, /SEED_PRODUCTION_FORBIDDEN/);
    assert.match(reset, /TEST_ACCOUNT_RESET_PRODUCTION_FORBIDDEN/);
    assert.match(reset, /@test\.projectai\.local/);
    assert.match(compose, /PROJECTAI_SEED_ENVIRONMENT/);
  });

  it("exposes real management routes and UI instead of a static knowledge catalog", async () => {
    const [page, projectPanel] = await Promise.all([
      source("components/system/global-knowledge-page.tsx"),
      source("components/knowledge/ProjectKnowledgeSourcesPanel.tsx"),
    ]);
    assert.match(page, /\/api\/organizations/);
    assert.match(page, /新增授权规则/);
    assert.doesNotMatch(page, /const assets =/);
    assert.match(projectPanel, /knowledge-sources/);
    assert.match(projectPanel, /保存部门/);
  });

  it("binds uploads to a server-authorized knowledge-space destination", async () => {
    const [management, documentService, uploadUi, seed] = await Promise.all([
      source("lib/knowledge/management.ts"),
      source("lib/files/document-service.ts"),
      source("components/project/DocumentUploadDrawer.tsx"),
      source("scripts/db/seed.ts"),
    ]);
    assert.match(management, /listUploadableKnowledgeSpaces/);
    assert.match(management, /upload_grant\.permission = 'upload'/);
    assert.match(management, /matchingGrant\("deny"\)/);
    assert.match(documentService, /该幂等键已绑定其他知识空间/);
    assert.match(documentService, /knowledgeSpaceId: destination\.id/);
    assert.match(uploadUi, /仅显示服务端确认可上传的空间/);
    assert.match(seed, /seed-membership-a-dept-admin/);
  });
});
