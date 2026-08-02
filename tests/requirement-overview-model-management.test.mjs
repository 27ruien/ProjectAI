import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (file) => readFile(new URL(`../${file}`, import.meta.url), "utf8");

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

test("model management keeps keys server-side and only accepts 1024 dimensions", async () => {
  const [schema, route, ui] = await Promise.all([
    source("lib/db/schema/ai-model-management.ts"),
    source("app/api/admin/ai-configuration/route.ts"),
    source("components/system/AiModelManagementPage.tsx"),
  ]);
  assert.match(schema, /ai_embedding_model_dimensions_check/);
  assert.match(schema, /dimensions} = 1024/);
  assert.match(route, /secretReference/);
  assert.doesNotMatch(route, /apiKey/);
  assert.match(route, /test_embedding_model/);
  assert.match(ui, /浏览器不会显示、提交或保存 API Key/);
  assert.match(ui, /添加 1024 维向量模型/);
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
    source("app/api/projects/[projectId]/requirement-overviews/comparison-models/route.ts"),
    source("lib/db/schema/ai-model-management.ts"),
  ]);
  assert.match(models, /requirement_overview_prefill/);
  assert.match(models, /isProductSuperAdmin/);
  assert.match(models, /supportsJson, true/);
  assert.match(models, /lastTestStatus, "passed"/);
  assert.match(route, /requireApiPrincipal/);
  assert.match(schema, /guided_requirement_overview_comparison_runs/);
  assert.match(schema, /guided_requirement_overview_comparison_candidates/);
});
