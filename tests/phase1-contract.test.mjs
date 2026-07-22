import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

describe("Phase 1 organization and knowledge authorization contract", () => {
  it("commits the complete Round 1 data model and compatibility backfill", async () => {
    const migration = await source("drizzle/0008_material_maggott.sql");
    const [scopeGuard, denyPriority, departmentGuard] = await Promise.all([
      source("drizzle/0013_knowledge_space_scope_guard.sql"),
      source("drizzle/0014_authorization_deny_priority.sql"),
      source("drizzle/0015_project_department_scope_guard.sql"),
    ]);
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
    assert.match(scopeGuard, /project_documents_scope_guard_trigger/);
    assert.match(scopeGuard, /space_department_id IS DISTINCT FROM source_department_id/);
    assert.match(denyPriority, /coalesce\(ea\.denied, false\) = false/);
    assert.match(denyPriority, /cd\.system_role = 'system_admin'/);
    assert.ok(
      denyPriority.indexOf("coalesce(ea.denied, false) = false") <
        denyPriority.indexOf("cd.system_role = 'system_admin'"),
      "explicit deny must be evaluated before the system-admin membership bypass",
    );
    assert.match(departmentGuard, /projects_department_scope_guard_trigger/);
    assert.match(departmentGuard, /active knowledge source/);
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
    const [page, projectPanel, unmountRoute] = await Promise.all([
      source("components/system/global-knowledge-page.tsx"),
      source("components/knowledge/ProjectKnowledgeSourcesPanel.tsx"),
      source("app/api/projects/[projectId]/knowledge-sources/[sourceId]/route.ts"),
    ]);
    assert.match(page, /\/api\/organizations/);
    assert.match(page, /新增授权规则/);
    assert.doesNotMatch(page, /const assets =/);
    assert.match(projectPanel, /knowledge-sources/);
    assert.match(projectPanel, /保存部门/);
    assert.match(projectPanel, /项目知识来源已移除/);
    assert.match(unmountRoute, /unmountProjectKnowledgeSource/);
  });

  it("binds uploads to a server-authorized knowledge-space destination", async () => {
    const [management, documentService, uploadUi, documentsUi, grantRoute, seed] =
      await Promise.all([
      source("lib/knowledge/management.ts"),
      source("lib/files/document-service.ts"),
      source("components/project/DocumentUploadDrawer.tsx"),
      source("components/project/DocumentsPage.tsx"),
      source("app/api/projects/[projectId]/documents/[documentId]/grants/route.ts"),
      source("scripts/db/seed.ts"),
      ]);
    assert.match(management, /listUploadableKnowledgeSpaces/);
    assert.match(
      management,
      /input\.type === "department" \|\| input\.type === "restricted"/,
    );
    assert.match(management, /upload_grant\.permission = 'upload'/);
    assert.match(management, /matchingGrant\("deny"\)/);
    assert.match(management, /noMatchingSpaceViewDeny/);
    assert.match(
      management,
      /knowledgeSpace\.departmentId}[\s\S]+knowledgeSpace\.departmentId} = \$\{target\.departmentId}/,
    );
    assert.match(documentService, /该幂等键已绑定其他知识空间/);
    assert.match(documentService, /knowledgeSpaceId: destination\.id/);
    assert.match(uploadUi, /仅显示服务端确认可上传的空间/);
    assert.match(documentsUi, /文件授权/);
    assert.match(documentsUi, /setProjectDocumentGrant/);
    assert.match(grantRoute, /setDocumentGrant/);
    assert.match(management, /permission: "manage_permissions"/);
    assert.match(seed, /seed-membership-a-dept-admin/);
  });

  it("keeps Phase 1 Staging cleanup project-scoped and parent-last", async () => {
    const [verification, deployment] = await Promise.all([
      source("scripts/verify-phase1-staging.mjs"),
      source("scripts/deploy-staging.sh"),
    ]);
    assert.match(verification, /cleanup refused a non-Staging database/);
    assert.match(verification, /projectai_staging/);
    assert.match(verification, /deleteProjectDatabaseState/);
    assert.ok(
      verification.indexOf('"requirement_drafts"') <
        verification.indexOf('"document_chunks"'),
      "AI drafts must be removed before their document chunks",
    );
    assert.ok(
      verification.indexOf("delete from project_document_versions") <
        verification.indexOf("delete from projects where id"),
      "document versions must be removed before their project",
    );
    assert.match(
      verification,
      /where name like '\[TEST\] phase1-staging-%'/,
    );
    assert.match(deployment, /phase1:staging-smoke -- --cleanup-stale/);
    assert.ok(
      deployment.indexOf("phase1:staging-smoke -- --cleanup-stale") <
        deployment.indexOf(
          "Verifying PostgreSQL and MinIO consistency before application startup",
        ),
      "stale synthetic state must be removed before the cross-store gate",
    );
  });
});
