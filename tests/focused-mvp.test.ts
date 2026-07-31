import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { resolveProjectPermissions } from "../lib/auth/authorization";
import type { AuthenticatedPrincipal } from "../lib/auth/session";
import { FakeProjectAssistantProvider } from "../lib/ai/project-assistant/fake-provider";
import { buildGeneralUserPrompt, buildGroundedUserPrompt, GENERAL_ASSISTANT_SYSTEM_PROMPT } from "../lib/ai/project-assistant/grounding";
import { QwenProjectAssistantProvider } from "../lib/ai/project-assistant/qwen-provider";
import { ProjectAssistantError } from "../lib/ai/project-assistant/errors";
import { requirementDocx } from "../lib/focused-mvp/requirement-export";
import {
  REQUIREMENT_SKILL_ID,
  requirementGenerationFailure,
  requirementMarkdown,
  requirementSectionDefinitions,
} from "../lib/focused-mvp/requirement-documents";
import { ProjectManagementError } from "../lib/project-management/errors";
import type { ProjectKnowledgeEvidence } from "../lib/documents/processing/search-service";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

const expectedTemplate = [
  "文档信息与版本",
  "项目背景",
  "项目目标",
  "用户与使用场景",
  "产品范围",
  "Out of Scope",
  "用户流程",
  "功能需求",
  "页面与交互要求",
  "平台与兼容性",
  "权限要求",
  "异常与降级",
  "隐私和数据要求",
  "验收标准",
  "风险与依赖",
  "待确认事项",
  "来源",
];

function memberPrincipal(id: string): AuthenticatedPrincipal {
  return { sessionId: `focused-${id}`, user: { id, productRole: "member" } } as AuthenticatedPrincipal;
}

describe("focused MVP product surface", () => {
  it("exposes one knowledge entry with projects, templates and sessions inside", async () => {
    const [sidebar, router, workspace, projectHeader, knowledgeNav] = await Promise.all([
      source("components/layout/sidebar.tsx"),
      source("app/[...slug]/page.tsx"),
      source("components/workspace.tsx"),
      source("components/project/ProjectContextHeader.tsx"),
      source("components/knowledge/KnowledgeModuleNav.tsx"),
    ]);
    assert.match(sidebar, /知识库/);
    for (const removedPrimary of ["AI 对话", "公司知识库"]) assert.doesNotMatch(sidebar, new RegExp(removedPrimary));
    for (const label of ["项目", "常规模板", "会话"]) assert.match(knowledgeNav, new RegExp(label));
    for (const removed of ["工作日报", "AI 工作流", "会议纪要", "Action Plan", "周报", "Skills", "审核中心"]) {
      assert.doesNotMatch(sidebar, new RegExp(removed, "i"));
    }
    assert.match(router, /allowedRoot = \["knowledge", "organization", "settings"\]/);
    assert.match(router, /\["projects", "templates", "sessions"\]/);
    assert.match(router, /notFound\(\)/);
    assert.match(workspace, /<ProjectsPage/);
    assert.match(workspace, /<FocusedChatPage/);
    assert.match(workspace, /<CompanyKnowledgePage/);
    assert.match(projectHeader, /基本信息/);
    assert.match(projectHeader, /项目资料/);
    assert.match(projectHeader, /AI 生成文档/);
    assert.match(projectHeader, /成员与权限/);
  });

  it("supports a citation-free general conversation without exposing the internal storage project", async () => {
    const [page, service, repository, migration] = await Promise.all([
      source("components/knowledge/FocusedChatPage.tsx"),
      source("lib/ai/project-assistant/service.ts"),
      source("lib/ai/project-assistant/repository.ts"),
      source("drizzle/0026_general_chat_execution.sql"),
    ]);
    assert.match(page, /通用会话（不使用知识库）/);
    assert.match(service, /askGeneralAssistant/);
    assert.match(service, /GENERAL_ASSISTANT_SYSTEM_PROMPT/);
    assert.match(repository, /resolveGeneralChatProjectId/);
    assert.match(repository, /project-company-knowledge-/);
    assert.match(repository, /onConflictDoNothing/);
    assert.match(repository, /evidenceCount: 0/);
    assert.match(migration, /retrieval_run_id" IS NULL AND "evidence_count" = 0/);
    assert.doesNotMatch(buildGeneralUserPrompt({ question: "你能做什么？", history: [] }), /evidence_set/);
    assert.match(GENERAL_ASSISTANT_SYSTEM_PROMPT, /本回答未使用知识库资料/);
  });

  it("returns a citation-free deterministic General Chat answer", async () => {
    const provider = new FakeProjectAssistantProvider();
    const result = await provider.generate({
      model: "qwen3.7-flash",
      systemPrompt: GENERAL_ASSISTANT_SYSTEM_PROMPT,
      userPrompt: buildGeneralUserPrompt({ question: "你能做什么？", history: [] }),
      purpose: "answer",
      responseFormat: "text",
      timeoutMs: 1_000,
      temperature: 0.2,
      maxOutputTokens: 500,
    });
    assert.match(result.text, /本回答未使用知识库资料/);
    assert.doesNotMatch(result.text, /\[E\d+\]/);
  });

  it("keeps focused project statuses and hides the internal company storage project", async () => {
    const [createRoute, projectRoute, repository, migration] = await Promise.all([
      source("app/api/projects/route.ts"),
      source("app/api/projects/[projectId]/route.ts"),
      source("lib/db/repositories/project-repository.ts"),
      source("drizzle/0025_focused_internal_mvp.sql"),
    ]);
    const exactStatus = /\.enum\(\["planning", "active", "completed"\]\)/;
    assert.match(createRoute, exactStatus);
    assert.match(projectRoute, exactStatus);
    assert.match(repository, /eq\(project\.isInternal, false\)/);
    assert.match(migration, /projects_internal_organization_uidx/);
    assert.match(migration, /version_note/);
  });

  it("uses database query result rows when deleting project-owned records", async () => {
    const [deletion, projectRoute, projectsPage] = await Promise.all([
      source("lib/db/repositories/scoped-deletion.ts"),
      source("app/api/projects/[projectId]/route.ts"),
      source("components/project/ProjectsPage.tsx"),
    ]);
    assert.match(deletion, /type ExecuteResult<T> = \{ rows: T\[\] \} \| T\[\]/);
    assert.match(deletion, /return Array\.isArray\(result\) \? result : result\.rows/);
    assert.match(projectRoute, /objectResult\.rows\.map/);
    assert.match(projectRoute, /PROJECT_DELETE_FAILED/);
    assert.match(projectsPage, /删除项目失败，请稍后重试/);
  });
});

describe("focused requirement document", () => {
  it("uses the fixed internal skill and maps safe actionable failure codes", () => {
    assert.equal(REQUIREMENT_SKILL_ID, "generate_project_requirement_document");
    assert.deepEqual(
      requirementGenerationFailure(new ProjectAssistantError(503, "AI_PROVIDER_UNAVAILABLE", "hidden")),
      {
        status: 503,
        code: "REQUIREMENT_PROVIDER_FAILED",
        message: "AI 服务暂时无法生成需求文档，请稍后重试。",
      },
    );
    assert.equal(
      requirementGenerationFailure(new ProjectAssistantError(503, "AI_CONFIGURATION_INVALID", "hidden")).code,
      "REQUIREMENT_MODEL_PROFILE_NOT_CONFIGURED",
    );
    assert.equal(
      requirementGenerationFailure(new ProjectManagementError(409, "PROJECT_SOURCE_REQUIRED", "hidden")).code,
      "NO_ELIGIBLE_PROJECT_SOURCES",
    );
  });

  it("disables Qwen thinking for JSON structured output", async () => {
    const previous = process.env.QWEN_API_KEY;
    process.env.QWEN_API_KEY = "focused-test-key";
    let requestBody: Record<string, unknown> | null = null;
    try {
      const provider = new QwenProjectAssistantProvider(
        "https://example.invalid/compatible-mode/v1",
        async (_input, init) => {
          requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
          return new Response(JSON.stringify({
            id: "focused-test-response",
            model: "qwen3.7-flash",
            choices: [{ message: { content: "{\"sections\":[]}" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          }), { status: 200, headers: { "content-type": "application/json" } });
        },
      );
      await provider.generate({
        model: "qwen3.7-flash",
        systemPrompt: "请输出 JSON",
        userPrompt: "请输出 JSON",
        purpose: "requirement_document",
        responseFormat: "json_object",
        timeoutMs: 1_000,
        temperature: 0.2,
        maxOutputTokens: 1_800,
      });
      const captured = requestBody as unknown as Record<string, unknown>;
      assert.equal(captured.enable_thinking, false);
      assert.deepEqual(captured.response_format, { type: "json_object" });
    } finally {
      if (previous === undefined) delete process.env.QWEN_API_KEY;
      else process.env.QWEN_API_KEY = previous;
    }
  });

  it("uses the exact 17-section template and classified fake output", async () => {
    assert.deepEqual(requirementSectionDefinitions.map(([, title]) => title), expectedTemplate);
    const provider = new FakeProjectAssistantProvider();
    const result = await provider.generate({
      model: "qwen3.7-flash",
      systemPrompt: "focused requirement test",
      userPrompt: '<evidence_labels_json>["E1"]</evidence_labels_json>',
      purpose: "requirement_document",
      responseFormat: "json_object",
      timeoutMs: 1_000,
      temperature: 0.2,
      maxOutputTokens: 4_000,
    });
    const parsed = JSON.parse(result.text) as { sections: Array<{ title: string; content: string; citationLabels: string[] }> };
    assert.deepEqual(parsed.sections.map((item) => item.title), expectedTemplate);
    assert.equal(parsed.sections.length, 17);
    for (const section of parsed.sections) assert.match(section.content, /\[(?:Fact|Company Standard|AI Inference|TBD)\]/);
    assert.equal(parsed.sections.find((item) => item.title === "待确认事项")?.citationLabels.length, 0);
  });

  it("keeps project and company citations distinct in deterministic output", async () => {
    const provider = new FakeProjectAssistantProvider();
    const result = await provider.generate({
      model: "qwen3.7-flash",
      systemPrompt: "focused requirement test",
      userPrompt: '<evidence_labels_json>["E1","E2"]</evidence_labels_json>\n<evidence_set>\n<evidence id="E1" scope="project">项目资料</evidence>\n<evidence id="E2" scope="organization">公司规范</evidence>\n</evidence_set>',
      purpose: "requirement_document",
      responseFormat: "json_object",
      timeoutMs: 1_000,
      temperature: 0.2,
      maxOutputTokens: 4_000,
    });
    const parsed = JSON.parse(result.text) as { sections: Array<{ content: string; citationLabels: string[] }> };
    assert.equal(parsed.sections.some((item) => item.citationLabels.includes("E1")), true);
    assert.equal(parsed.sections.some((item) => item.citationLabels.includes("E2")), true);
    assert.equal(parsed.sections.some((item) => item.content.includes("[Company Standard]")), true);
  });

  it("creates real Markdown and DOCX bytes", async () => {
    const sections = requirementSectionDefinitions.map(([key, title], index) => ({
      key,
      title,
      content: index === 15 ? "- [TBD] 待项目经理确认。" : `- [Fact] ${title}来自当前项目资料。`,
      citationLabels: index === 15 ? [] : ["E1"],
    }));
    const markdown = requirementMarkdown("虚构聚焦项目", 2, sections);
    for (const title of expectedTemplate) assert.match(markdown, new RegExp(`## ${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
    const docx = await requirementDocx(markdown);
    assert.equal(Buffer.from(docx).subarray(0, 2).toString("ascii"), "PK");
    assert.ok(docx.byteLength > 2_000);
  });

  it("registers an asynchronous, resumable generation record before background work", async () => {
    const [route, service, page] = await Promise.all([
      source("app/api/projects/[projectId]/requirement-documents/route.ts"),
      source("lib/focused-mvp/requirement-documents.ts"),
      source("components/project/RequirementDocumentsPage.tsx"),
    ]);
    assert.match(route, /reserveRequirementDocument/);
    assert.match(route, /after\(async/);
    assert.match(route, /status: 202/);
    assert.match(service, /projectSourceCount/);
    assert.match(service, /companySourceCount/);
    assert.match(service, /sourceSnapshotAt/);
    assert.match(service, /category = 'project_management'/);
    assert.ok(service.indexOf("beginRequirementAiExecution") < service.indexOf("gateway.generate"));
    assert.match(service, /REQUIREMENT_PROVIDER_FAILED/);
    assert.match(service, /REQUIREMENT_EXECUTION_CREATE_FAILED/);
    assert.match(page, /status === "generating"/);
    assert.match(page, /window\.setInterval/);
    assert.match(page, /前往会话生成/);
  });

  it("pins all current text and vector generation to the qwen3.7 profiles", async () => {
    const [assistant, gateway, embedding, retrieval] = await Promise.all([
      source("lib/ai/project-assistant/config.ts"),
      source("lib/ai/project-assistant/gateway.ts"),
      source("lib/ai/embeddings/config.ts"),
      source("lib/ai/retrieval/service.ts"),
    ]);
    assert.match(assistant, /qwen3\.7-flash/);
    assert.doesNotMatch(assistant, /qwen3\.7-plus|qwen3\.6-flash|qwen-plus|qwen-flash/);
    assert.doesNotMatch(gateway, /FALLBACK_MODEL/);
    assert.match(embedding, /qwen3\.7-text-embedding/);
    assert.match(embedding, /AI_EMBEDDING_DIMENSIONS/);
    assert.match(retrieval, /embedding_profile_id = \$\{HYBRID_RETRIEVAL_PROFILE\.embeddingProfileId\}/);
  });
});

describe("focused authorization and source boundaries", () => {
  it("keeps viewers read-only while project editors can upload", () => {
    const viewer = resolveProjectPermissions(memberPrincipal("viewer"), { createdBy: "manager", projectRole: "viewer" });
    const editor = resolveProjectPermissions(memberPrincipal("editor"), { createdBy: "manager", projectRole: "project_member" });
    assert.equal(viewer.canViewProject, true);
    assert.equal(viewer.canUploadDocuments, false);
    assert.equal(editor.canUploadDocuments, true);
  });

  it("binds company AI evidence to published, unexpired, visible documents", async () => {
    const [filter, requirement, assistantRepository, retrievalRepository, migration] = await Promise.all([
      source("lib/focused-mvp/company-source-filter.ts"),
      source("lib/focused-mvp/requirement-documents.ts"),
      source("lib/ai/project-assistant/repository.ts"),
      source("lib/ai/retrieval/repository.ts"),
      source("drizzle/0025_focused_internal_mvp.sql"),
    ]);
    assert.match(filter, /lifecycle_status = 'published'/);
    assert.match(filter, /expires_at is null or company_source\.expires_at > now\(\)/);
    assert.match(filter, /department_members/);
    assert.match(requirement, /SOURCE_CHANGED/);
    assert.match(requirement, /listAuthorizedDocumentScope/);
    assert.match(assistantRepository, /来源权限已变化/);
    assert.match(assistantRepository, /current\.versionId !== citation\.versionId/);
    assert.match(assistantRepository, /sourceProjectId: evidence\.sourceProjectId/);
    assert.match(retrievalRepository, /sourceProjectId: candidate\.value\.sourceProjectId/);
    assert.doesNotMatch(assistantRepository, /sourceProjectId: evidence\.sourceProjectId \?\?/);
    assert.doesNotMatch(retrievalRepository, /sourceProjectId: candidate\.value\.sourceProjectId \?\?/);
    assert.match(retrievalRepository, /ai_retrieval_audit_degraded/);
    assert.match(assistantRepository, /ai_citation_audit_degraded/);
    assert.match(migration, /FOREIGN KEY \("chunk_id", "source_project_id", "document_id", "version_id"\)/);
  });

  it("labels project and template evidence before the model and in the UI", async () => {
    const evidence: ProjectKnowledgeEvidence = {
      label: "E1",
      chunkId: "chunk-1",
      sourceProjectId: "project-company-knowledge-org-kivisense",
      documentId: "document-1",
      versionId: "version-1",
      displayName: "虚构公司规范.md",
      versionNumber: 1,
      mimeType: "text/markdown",
      content: "所有项目必须完成需求确认。",
      contentSha256: "a".repeat(64),
      headingPath: ["需求确认"],
      source: { type: "markdown_section", headingPath: ["需求确认"], lineStart: 1, lineEnd: 1 },
      score: 1,
      knowledgeBaseId: "internal-only",
      knowledgeBaseType: "template",
      sourceScope: "organization",
    };
    const prompt = buildGroundedUserPrompt({ question: "公司要求是什么？", history: [], evidence: [evidence] });
    assert.match(prompt, /source_scope="organization"/);
    assert.equal(evidence.knowledgeBaseType, "template");
    const panel = await source("components/knowledge/ProjectAssistantPanel.tsx");
    assert.match(panel, /\[常规模板\]/);
    assert.match(panel, /\[项目资料\]/);
    assert.doesNotMatch(panel, /scopeLabels\[citation\.sourceScope\]}.+citation\.knowledgeSpaceId/);
  });
});
