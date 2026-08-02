import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (file) =>
  readFile(new URL(`../${file}`, import.meta.url), "utf8");

test("guided requirement overview stays structured, cited, and Markdown-only", async () => {
  const [service, ui] = await Promise.all([
    source("lib/focused-mvp/requirement-overview.ts"),
    source("components/requirement-overview/RequirementOverviewWorkspace.tsx"),
  ]);
  assert.match(service, /generate_requirement_overview/);
  assert.match(service, /needs_confirmation/);
  assert.match(service, /REQUIREMENT_CONFIRMATION_REQUIRED/);
  assert.match(service, /SOURCE_CHANGED/);
  assert.match(service, /sourceDigest/);
  assert.match(service, /REQUIREMENT_OVERVIEW_FIELD_REGISTRY/);
  assert.match(service, /renderRequirementOverviewMarkdown/);
  assert.match(service, /generateRequirementOverviewCandidates/);
  assert.match(service, /selectRequirementOverviewCandidate/);
  assert.match(service, /REQUIREMENT_OVERVIEW_FIELD_REGISTRY.length/);
  assert.match(service, /SOURCE_CHANGED/);
  assert.match(service, /项目整体架构（弥知、客户、三方等）/);
  assert.match(service, /MVP需求/);
  assert.doesNotMatch(service, /## 已确认/);
  assert.match(ui, /下载 Markdown/);
  assert.match(ui, /比较两个候选/);
  assert.match(ui, /选择此候选并形成草稿/);
  assert.match(ui, /requirement-overview-generate-dialog-trigger/);
  assert.match(ui, /当前只有一个测试成功的文本模型，暂时无法执行模型对比。/);
  assert.match(ui, /完成度/);
  assert.match(service, /syncRequirementSource/);
  assert.match(service, /selectedCandidateId/);
  assert.doesNotMatch(ui, /DOCX/);
});

test("model management encrypts managed keys server-side and preserves the fixed vector boundary", async () => {
  const [schema, route, ui, credentials, management] = await Promise.all([
    source("lib/db/schema/ai-model-management.ts"),
    source("app/api/admin/ai-configuration/route.ts"),
    source("components/system/AiModelManagementPage.tsx"),
    source("lib/ai/provider-credentials.ts"),
    source("lib/ai/model-management.ts"),
  ]);
  assert.match(schema, /ai_embedding_model_dimensions_check/);
  assert.match(schema, /dimensions} = 1024/);
  assert.match(schema, /aiProviderCredential/);
  assert.match(schema, /ciphertext/);
  assert.match(route, /replace_provider_api_key/);
  assert.match(route, /update_generation_model/);
  assert.match(route, /apiKey: key/);
  assert.match(route, /test_embedding_model/);
  assert.match(route, /set_generation_model_enabled/);
  assert.match(management, /AI_MODEL_PROFILE_DISABLED/);
  assert.match(management, /model_updated/);
  assert.match(route, /requireAiConfigurationAdmin/);
  assert.match(credentials, /aes-256-gcm/);
  assert.match(credentials, /AI_PROVIDER_CREDENTIALS_KEY_FILE/);
  assert.match(credentials, /maskProviderApiKey/);
  assert.doesNotMatch(credentials, /console\.log/);
  assert.match(management, /organizationMember\.role, "organization_admin"/);
  assert.match(management, /hasAiConfigurationAdmin/);
  assert.match(management, /Provider\/model begins as not_tested/);
  assert.match(ui, /保存后不会回显/);
  assert.match(ui, /替换 API Key/);
  assert.match(ui, /登记 1024 维模型/);
  assert.match(ui, /已启用/);
});

test("project chat resolves the server-side scenario rather than taking a browser model", async () => {
  const service = await source("lib/ai/project-assistant/service.ts");
  assert.match(service, /scenario: "general_chat"/);
  assert.match(service, /scenario: "project_grounded_chat"/);
  assert.match(service, /model: scenario\.modelId/);
});

test("requirement overview model selection remains server-controlled", async () => {
  const [models, route, schema] = await Promise.all([
    source("lib/ai/model-management.ts"),
    source(
      "app/api/projects/[projectId]/requirement-overviews/comparison-models/route.ts",
    ),
    source("lib/db/schema/ai-model-management.ts"),
  ]);
  assert.match(models, /requirement_overview_prefill/);
  assert.match(models, /hasAiConfigurationAdmin/);
  assert.match(models, /supportsJson, true/);
  assert.match(models, /lastTestStatus, "passed"/);
  assert.match(route, /requireApiPrincipal/);
  assert.match(schema, /guided_requirement_overview_comparison_runs/);
  assert.match(schema, /guided_requirement_overview_comparison_candidates/);
});
