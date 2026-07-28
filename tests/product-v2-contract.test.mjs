import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Product V2 primary navigation contains only approved modules", async () => {
  const sidebar = await read("components/layout/sidebar.tsx");
  for (const label of ["工作日报", "AI 工作流", "知识库", "组织架构"]) assert.match(sidebar, new RegExp(label));
  for (const label of ["工作台", "审核中心", "Skills", "数据看板", "标准用户"]) assert.doesNotMatch(sidebar, new RegExp(label));
  assert.match(sidebar, /productRole !== item\.role/);
});

test("Staging test login is an explicit fixed-identity POST flow with Production guards", async () => {
  const [login, providers, client, stagingLogin, authRoute] = await Promise.all([
    read("components/auth/login-page.tsx"),
    read("lib/auth/providers.ts"),
    read("components/auth/auth-client.ts"),
    read("lib/auth/staging-test-login.ts"),
    read("app/api/auth/[...all]/route.ts"),
  ]);
  assert.match(login, /stagingTestLoginEnabled/);
  assert.match(login, /进入测试环境/);
  assert.match(login, /仅用于 Staging 产品验收/);
  assert.doesNotMatch(login, /type="password"|邮箱或密码/);
  assert.match(client, /signInToStagingTestEnvironment/);
  assert.match(client, /\/api\/auth\/sign-in\/staging-test/);
  assert.match(client, /body: JSON\.stringify\(\{\}\)/);
  assert.match(providers, /MOCK_WECOM_AUTH_PRODUCTION_FORBIDDEN/);
  assert.match(stagingLogin, /STAGING_TEST_LOGIN_PRODUCTION_FORBIDDEN/);
  assert.match(stagingLogin, /ALLOW_STAGING_TEST_LOGIN/);
  assert.match(stagingLogin, /STAGING_TEST_LOGIN_IDENTITY = "admin"/);
  assert.match(stagingLogin, /requestUrl\.pathname !== STAGING_TEST_LOGIN_PATH/);
  assert.match(stagingLogin, /forwardedProto !== "https"/);
  assert.match(authRoute, /STAGING_TEST_LOGIN_PAYLOAD_INVALID/);
  assert.doesNotMatch(login + providers + client, /debug=admin|debugIdentity/);
});

test("Requirement Extraction exposes structured sources, one repair, and HTTP 200", async () => {
  const [service, route] = await Promise.all([
    read("lib/project-management/requirements.ts"),
    read("app/api/projects/[projectId]/requirement-extractions/route.ts"),
  ]);
  for (const code of ["SOURCE_REQUIRED", "SOURCE_NOT_FOUND", "SOURCE_FORBIDDEN", "SOURCE_NOT_READY", "SOURCE_PARSE_FAILED", "INVALID_WORKFLOW_INPUT"]) assert.match(service + route, new RegExp(code));
  assert.match(service, /purpose: "requirement_repair"/);
  assert.match(route, /return jsonResponse\(result\);/);
  assert.doesNotMatch(route, /status: result\.replayed \? 200 : 201/);
});

test("temporary workflow attachments require explicit promote or discard lifecycle", async () => {
  const [schema, service, cleanup, workflow, documentClient] = await Promise.all([
    read("lib/db/schema/project-documents.ts"),
    read("lib/files/document-service.ts"),
    read("scripts/cleanup-temporary-workflow-documents.ts"),
    read("components/workflow/requirement-extraction-page.tsx"),
    read("lib/documents/client.ts"),
  ]);
  assert.match(schema, /temporaryWorkflowId/);
  assert.match(service, /temporary_workflow_document_promoted/);
  assert.match(service, /temporary_workflow_document_discarded/);
  assert.match(cleanup, /TEMPORARY_WORKFLOW_CLEANUP_PRODUCTION_FORBIDDEN/);
  assert.match(workflow, /readProjectDocumentVersionFile/);
  assert.match(workflow, /复制到新项目后清理临时源/);
  assert.match(documentClient, /Promise<File>/);
});

test("project spaces reuse the database-created default space and expose only view/edit membership", async () => {
  const [repository, productKnowledge, membersRoute, legacyGrantRoute, spacesRoute] = await Promise.all([
    read("lib/db/repositories/project-repository.ts"),
    read("lib/knowledge/product-v2.ts"),
    read("app/api/knowledge-spaces/[spaceId]/members/route.ts"),
    read("app/api/knowledge-spaces/[spaceId]/grants/route.ts"),
    read("app/api/knowledge-spaces/route.ts"),
  ]);
  assert.match(repository, /Project knowledge-space trigger did not create a space/);
  assert.doesNotMatch(repository, /id: `ks-\$\{createdProject\.id\}`/);
  assert.match(productKnowledge, /accessLevel: input\.accessLevel/);
  assert.match(productKnowledge, /CREATOR_ACCESS_REQUIRED/);
  assert.match(membersRoute, /z\.enum\(\["view", "edit"\]\)/);
  assert.match(legacyGrantRoute, /授权规则端点已停用/);
  assert.match(spacesRoute, /知识空间只能通过部门或项目生命周期创建/);
});

test("knowledge UI provides scoped file search, AI, project creation, and member management", async () => {
  const [page, topbar] = await Promise.all([
    read("components/system/global-knowledge-page.tsx"),
    read("components/layout/topbar.tsx"),
  ]);
  for (const label of ["当前空间", "当前部门", "全部可访问空间", "AI 对话", "新建项目空间", "空间成员"]) {
    assert.match(page, new RegExp(label));
  }
  assert.match(page, /accessLevel: "view" \| "edit"/);
  assert.match(page, /权限数据不可用/);
  assert.match(page, /permissions\?\.canEditProject/);
  assert.match(page, /permissions\?\.canManageMembers/);
  assert.match(page, /permissions\?\.canUploadDocuments/);
  assert.match(page, /编辑项目信息/);
  assert.match(page, /requestedProjectId/);
  assert.match(topbar, /\/api\/knowledge-spaces/);
  assert.doesNotMatch(page, /授权规则|权限变更审计/);
});

test("Staging smoke distinguishes a missing permission contract from a denial", async () => {
  const smoke = await read("scripts/verify-product-v2-staging.mjs");
  assert.match(smoke, /API_CONTRACT_MISSING/);
  assert.match(smoke, /PROJECT_PERMISSION_DENIED/);
  assert.match(smoke, /PROJECT_PERMISSION_MISMATCH/);
});

test("organization service protects depth, cycles, default spaces, and last super admin", async () => {
  const [service, page] = await Promise.all([
    read("lib/organization/service.ts"),
    read("components/organization/OrganizationPage.tsx"),
  ]);
  for (const marker of ["DEPARTMENT_DEPTH_EXCEEDED", "DEPARTMENT_CYCLE", "DEPARTMENT_NOT_EMPTY", "LAST_ADMIN_PROTECTED", "ks-department-"]) {
    assert.match(service, new RegExp(marker));
  }
  assert.match(service, /\.for\("update", \{ of: user \}\)/);
  assert.match(page, /pattern="\(\?:\[A-Z0-9\]\|-\)\+"/);
  assert.doesNotThrow(() => new RegExp("^(?:[A-Z0-9]|-)+$", "v"));
});

test("project managers cannot be downgraded or removed through knowledge-space membership", async () => {
  const service = await read("lib/knowledge/product-v2.ts");
  assert.match(service, /PROJECT_MANAGER_EDIT_REQUIRED/);
  assert.match(service, /existingProjectMember\?\.role === "project_manager"/);
  assert.match(service, /projectMembership\?\.role === "project_manager"/);
});

test("Product V2 document authorization keeps explicit deny ahead of every admin bypass", async () => {
  const migration = await read("drizzle/0024_restore_authorization_deny_priority.sql");
  assert.match(migration, /bool_or\(rule\.effect = 'deny'\)/);
  assert.match(migration, /candidate\.project_role IN \('project_manager', 'project_member'\)/);
  assert.match(migration, /candidate\.space_access_level = 'edit'/);
  assert.match(migration, /candidate\.visibility <> 'restricted'/);
  assert.ok(
    migration.indexOf("coalesce(explicit.denied, false) = false") <
      migration.lastIndexOf("candidate.product_role IN ('super_admin', 'admin')"),
    "matching explicit deny must be evaluated before Product administrator access",
  );
});

test("Product V2 deployer is Staging-only, exact-head, backup-first, and rollback guarded", async () => {
  const deploy = await read("scripts/deploy-product-v2-staging.sh");
  assert.match(deploy, /EXPECTED_BRANCH="agent\/projectai-product-architecture-v2"/);
  assert.match(deploy, /REMOTE_DIR="\/srv\/projectai-staging"/);
  assert.match(deploy, /COMMIT_SHA.*origin\/\$\{EXPECTED_BRANCH\}/s);
  assert.match(deploy, /pocket-charista\(\/\|\\\.zip\$\)/);
  assert.doesNotMatch(deploy, /REMOTE_DIR="\/srv\/projectai"/);
  assert.doesNotMatch(deploy, /docker compose down/);
  assert.match(deploy, /REMOTE_BACKUP/);
  assert.match(deploy, /pg_dump --format=custom/);
  assert.match(
    deploy,
    /sudo sh -c 'docker exec -i project-ai-os-staging-postgres pg_restore --list < "\$1" >\/dev\/null' sh "\$backup_path"/,
  );
  assert.match(deploy, /dropdb --if-exists --force --maintenance-db=postgres/);
  assert.match(deploy, /createdb --maintenance-db=postgres/);
  assert.match(deploy, /pg_restore --exit-on-error --no-owner --no-acl/);
  assert.match(deploy, /""\|postgres\|template0\|template1\|\*\[!A-Za-z0-9_\]\*/);
  assert.match(deploy, /rollback\(\) \{[\s\S]*set -Eeuo pipefail/);
  assert.match(
    deploy,
    /sudo rm -f -- "\$marker" "\$image_archive"[\s\S]*sudo rmdir -- "\$lock_dir"/,
  );
  assert.ok(
    deploy.indexOf("REMOTE_BACKUP") < deploy.indexOf("rsync --archive"),
    "verified Staging backup must finish before the release tree is synchronized",
  );
  assert.match(
    deploy,
    /docker save "\$APP_IMAGE_REF" "\$DB_TOOLS_IMAGE_REF" \| gzip -1 >"\$IMAGE_ARCHIVE"/,
  );
  assert.match(deploy, /for attempt in 1 2 3/);
  assert.match(deploy, /--partial --append-verify --timeout=120/);
  assert.match(deploy, /--rsync-path='sudo rsync'/);
  assert.match(deploy, /sudo sha256sum "\$image_archive"/);
  assert.match(
    deploy,
    /sudo sh -c 'gzip -dc -- "\$1" \| docker load >\/dev\/null' sh "\$image_archive"/,
  );
  assert.doesNotMatch(
    deploy,
    /docker save "\$APP_IMAGE_REF" "\$DB_TOOLS_IMAGE_REF" \| gzip -1 \| "\$\{SSH\[@\]\}"/,
  );
  assert.match(deploy, /AUTH_PROVIDER=mock-wecom/);
  assert.match(deploy, /ALLOW_STAGING_TEST_LOGIN=true/);
  assert.match(deploy, /ALLOW_DEBUG_IDENTITY" \{ next \}/);
  assert.match(deploy, /WECOM_TIMESHEET_SYNC_ENABLED=false/);
  assert.match(deploy, /ai:probe:qwen/);
  assert.match(deploy, /x-projectai-commit-sha/);
  assert.match(deploy, /"amd64" \|\| "\$arch" == "x86_64"[\s\S]*printf 'amd64'/);
  assert.match(deploy, /"arm64" \|\| "\$arch" == "aarch64"[\s\S]*printf 'arm64'/);
});

test("CI separates legacy regression, Mock WeCom, and production-build auth modes", async () => {
  const workflow = await read(".github/workflows/ci.yml");
  assert.match(workflow, /NODE_ENV: test\n\s+AUTH_PROVIDER: legacy-credential-test\n\s+ALLOW_LEGACY_CREDENTIAL_TEST_AUTH: "true"/);
  assert.match(workflow, /name: Apply passwordless Product V2 CI seed[\s\S]*AUTH_PROVIDER: mock-wecom[\s\S]*ALLOW_MOCK_WECOM_AUTH: "true"/);
  assert.match(workflow, /name: SSR tests and production build[\s\S]*NODE_ENV: production[\s\S]*AUTH_PROVIDER: wecom[\s\S]*ALLOW_MOCK_WECOM_AUTH: "false"[\s\S]*ALLOW_LEGACY_CREDENTIAL_TEST_AUTH: "false"/);
  assert.match(workflow, /name: Build isolated legacy credential E2E runtime[\s\S]*NEXT_PUBLIC_APP_ENV: test[\s\S]*AUTH_PROVIDER: legacy-credential-test[\s\S]*ALLOW_LEGACY_CREDENTIAL_TEST_AUTH: "true"/);
  assert.match(workflow, /npm run product-v2:migration-upgrade/);
  assert.match(workflow, /npm run test:product-v2-integration/);
  assert.ok(
    workflow.indexOf("npm run test:e2e") < workflow.indexOf("name: Apply passwordless Product V2 CI seed"),
    "Product V2 fixtures must not change the legacy regression dataset before it finishes",
  );
});

test("legacy password seeds cannot recreate retired credentials on Staging", async () => {
  const [legacySeed, legacyUat, productSeed] = await Promise.all([
    read("scripts/db/seed.ts"),
    read("scripts/uat/manage.ts"),
    read("scripts/db/seed-product-v2.ts"),
  ]);
  assert.match(legacySeed, /seedEnvironment !== "test"/);
  assert.match(legacyUat, /LEGACY_CREDENTIAL_UAT_RETIRED_USE_PRODUCT_V2_MOCK_WECOM/);
  assert.match(productSeed, /PRODUCT_V2_SEED_REQUIRES_MOCK_WECOM/);
  assert.doesNotMatch(productSeed, /hashPassword|passwordHash|SEED_.*_PASSWORD/);
});
