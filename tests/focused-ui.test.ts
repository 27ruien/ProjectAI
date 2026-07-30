import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const root = new URL("../", import.meta.url);
const source = (path: string) => readFile(new URL(path, root), "utf8");

describe("focused MVP lightweight UI states", () => {
  it("1. renders the project list as a table", async () => { assert.match(await source("components/project/ProjectsPage.tsx"), /<Table/); });
  it("2. opens project creation in a dialog", async () => { assert.match(await source("components/project/CreateProjectPage.tsx"), /data-testid="create-project-dialog"/); });
  it("3. renders project overview as a description list", async () => { const page = await source("components/project/ProjectOverviewPage.tsx"); assert.match(page, /<dl/); assert.doesNotMatch(page, /SummaryCard/); });
  it("4. renders project files in a data table", async () => { assert.match(await source("components/project/DocumentsPage.tsx"), /<Table className="min-w-\[900px\]"/); });
  it("5. opens file upload in a dialog", async () => { assert.match(await source("components/project/DocumentUploadDrawer.tsx"), /data-testid="project-upload-dialog"/); });
  it("6. exposes the parsing state", async () => { assert.match(await source("components/project/DocumentsPage.tsx"), /正在解析/); });
  it("7. exposes a compact parsing failure state", async () => { const page = await source("components/project/DocumentsPage.tsx"); assert.match(page, /解析失败/); assert.match(page, /bg-destructive-soft/); });
  it("8. exposes an empty requirement state", async () => { assert.match(await source("components/project/RequirementDocumentsPage.tsx"), /data-testid="requirement-empty"/); });
  it("9. exposes requirement generation progress and skeletons", async () => { const page = await source("components/project/RequirementDocumentsPage.tsx"); assert.match(page, /data-testid="requirement-generating"/); assert.match(page, /<Progress/); assert.match(page, /<Skeleton/); });
  it("10. renders successful requirement classification markers", async () => { const page = await source("components/project/RequirementDocumentsPage.tsx"); for (const marker of ["Fact", "Company Standard", "AI Inference", "TBD"]) assert.match(page, new RegExp(marker)); });
  it("11. renders a human provider failure without a visible failure-code field", async () => { const page = await source("components/project/RequirementDocumentsPage.tsx"); assert.match(page, /AI 服务暂时不可用/); assert.match(page, /当前项目资料已完整保留/); assert.doesNotMatch(page, /失败码：/); });
  it("12. keeps the Markdown download entry", async () => { assert.match(await source("components/project/RequirementDocumentsPage.tsx"), /下载 Markdown/); });
  it("13. keeps the DOCX download entry", async () => { assert.match(await source("components/project/RequirementDocumentsPage.tsx"), /下载 DOCX/); });
  it("14. exposes the AI conversation empty state", async () => { assert.match(await source("components/knowledge/ProjectAssistantPanel.tsx"), /data-testid="ai-assistant-empty"/); });
  it("15. provides searchable private conversation history", async () => { const page = await source("components/knowledge/ProjectAssistantPanel.tsx"); assert.match(page, /搜索会话/); assert.match(page, /visibleThreads/); });
  it("16. renders AI citations with project and company source labels", async () => { const page = await source("components/knowledge/ProjectAssistantPanel.tsx"); assert.match(page, /data-testid="assistant-citations"/); assert.match(page, /\[项目资料\]/); assert.match(page, /\[公司资料\]/); });
  it("17. renders a human AI provider failure", async () => { assert.match(await source("components/knowledge/ProjectAssistantPanel.tsx"), /AI 服务当前不可用。项目资料和公司资料未发生变化，请联系管理员检查模型访问权限。/); });
  it("18. renders company knowledge as a filtered table", async () => { const page = await source("components/knowledge/CompanyKnowledgePage.tsx"); assert.match(page, /<Table/); assert.match(page, /全部类别/); assert.match(page, /全部状态/); });
  it("19. opens company upload in a strict dialog", async () => { assert.match(await source("components/knowledge/CompanyKnowledgePage.tsx"), /data-testid="company-upload-dialog"/); });
  it("20. uses sheets for mobile navigation and AI history", async () => { const [sidebar, assistant] = await Promise.all([source("components/layout/sidebar.tsx"), source("components/knowledge/ProjectAssistantPanel.tsx")]); assert.match(sidebar, /<Sheet/); assert.match(assistant, /<Sheet/); });
});
