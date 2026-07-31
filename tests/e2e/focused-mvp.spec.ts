import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { APIResponse, Download, Locator, Page } from "@playwright/test";
import pg from "pg";
import type { ProjectDocumentVersionsResponse } from "@/types/documents";
import { expect, test } from "./fixtures";
import { appPath } from "./support/app-url";
import { loginByApi } from "./support/auth";
import { fictitiousText } from "./support/file-fixtures";

test.use({ authenticatedAs: "admin", trace: "off", video: "off", viewport: { width: 1440, height: 1000 } });

const evidenceDirectory = process.env.FOCUSED_UI_EVIDENCE_DIR?.trim();
async function evidence(page: Page, filename: string) {
  if (!evidenceDirectory) return;
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({ path: join(evidenceDirectory, filename), fullPage: true });
}

async function settleAnimations(locator: Locator) {
  await expect(locator).toBeVisible();
  await locator.evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished));
  });
}

async function expectNoPageOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function json<T>(response: APIResponse): Promise<T> {
  return response.json() as Promise<T>;
}

async function waitUntilAiReady(page: Page, projectId: string, documentId: string) {
  await expect.poll(async () => {
    const response = await page.request.get(appPath(`/api/projects/${projectId}/documents/${documentId}/versions`));
    if (!response.ok()) return `http-${response.status()}`;
    const body = await json<ProjectDocumentVersionsResponse>(response);
    const current = body.versions.find((item) => item.isCurrent);
    return `${current?.ingestion.status}:${current?.embedding.status}`;
  }, { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] }).toBe("succeeded:succeeded");
}

async function waitUntilCompanyAiReady(page: Page, documentId: string) {
  await expect.poll(async () => {
    const response = await page.request.get(appPath(`/api/company-knowledge/${documentId}/versions`));
    if (!response.ok()) return `http-${response.status()}`;
    const body = await json<{ versions: ProjectDocumentVersionsResponse["versions"] }>(response);
    const current = body.versions.find((item) => item.isCurrent);
    return `${current?.ingestion.status}:${current?.embedding.status}`;
  }, { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] }).toBe("succeeded:succeeded");
}

async function expectDownload(
  page: Page,
  triggerName: "下载 Markdown" | "下载 DOCX",
  extension: ".md" | ".docx",
  allowAbortedRequestOnce: (pathname: string) => void,
) {
  const link = page.getByRole("menuitem", { name: triggerName, exact: true });
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();
  allowAbortedRequestOnce(new URL(href!, page.url()).pathname);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    link.click(),
  ]);
  await verifyDownload(download, extension);
}

async function verifyDownload(download: Download, extension: ".md" | ".docx") {
  expect(await download.failure()).toBeNull();
  expect(download.suggestedFilename()).toContain(extension);
  const stream = await download.createReadStream();
  let bytes = 0;
  for await (const chunk of stream) bytes += Buffer.byteLength(chunk);
  expect(bytes).toBeGreaterThan(extension === ".docx" ? 2_000 : 200);
  await download.delete();
}

test("General Chat 单击发送一次并在刷新后保留消息", async ({ page }) => {
  let messagePostCount = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      /\/api\/ai\/threads\/[^/]+\/messages$/.test(pathname)
    ) {
      messagePostCount += 1;
    }
  });

  await page.goto(appPath("/knowledge/sessions"));
  await expect(page.getByLabel("会话范围")).toContainText("通用会话（不使用知识库）");
  const input = page.getByLabel("向项目 AI 助手提问");
  await input.fill("你能做什么？");
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await expect(page.locator('[data-message-role="user"]').last()).toContainText("你能做什么？");
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText(
    "本回答未使用知识库资料。",
    { timeout: 45_000 },
  );
  await expect(input).toHaveValue("");
  expect(messagePostCount).toBe(1);

  await page.reload();
  await expect(page.locator('[data-message-role="user"]').last()).toContainText("你能做什么？");
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText(
    "本回答未使用知识库资料。",
  );
});

test("知识库项目到会话问答与需求文档产物的唯一 Happy Path", async ({ browser, page, runtimeMonitor }) => {
  const suffix = randomUUID().slice(0, 8);
  const projectName = `[TEST] Focused MVP ${suffix}`;
  const projectFileName = `focused-project-${suffix}.txt`;
  const projectDisplayName = projectFileName.replace(/\.txt$/, "");
  const companyFileName = `focused-company-standard-${suffix}.txt`;
  const companyDisplayName = companyFileName.replace(/\.txt$/, "");

  await page.goto(appPath("/knowledge/projects"));
  await expect(page.getByRole("heading", { name: "知识库", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目", exact: true })).toBeVisible();
  await expectNoPageOverflow(page);
  await evidence(page, "01-project-list.png");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill(projectName);
  await page.getByLabel("项目描述").fill("仅用于聚焦 MVP 自动化验收的虚构项目，不含客户信息。");
  await page.getByLabel("项目状态").click();
  await page.getByRole("option", { name: "进行中", exact: true }).click();
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.waitForURL(/\/knowledge\/projects\/project-[^/]+(?:\/overview)?$/);
  await evidence(page, "02-project-overview.png");
  await page.setViewportSize({ width: 1024, height: 900 });
  await expectNoPageOverflow(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const projectId = new URL(page.url()).pathname.split("/").filter(Boolean).at(-2)?.startsWith("project-")
    ? new URL(page.url()).pathname.split("/").filter(Boolean).at(-2)!
    : new URL(page.url()).pathname.split("/").filter(Boolean).at(-1)!;

  await page.getByRole("link", { name: "项目资料", exact: true }).click();
  await page.getByRole("button", { name: "上传资料", exact: true }).click();
  const upload = page.getByRole("dialog", { name: "上传项目资料" });
  await upload.getByLabel("选择上传文件").setInputFiles(fictitiousText(
    projectFileName,
    "项目事实：虚构项目计划在 2026 年 10 月 15 日完成内部上线。用户是内部项目经理。",
  ));
  await upload.getByRole("button", { name: "开始上传", exact: true }).click();
  await expect(upload.getByText("项目资料上传成功", { exact: true })).toBeVisible();
  await upload.getByRole("button", { name: "关闭", exact: true }).last().click();
  const projectList = await page.request.get(appPath(`/api/projects/${projectId}/documents?status=active`));
  const projectBody = await json<{ documents: Array<{ id: string; displayName: string }> }>(projectList);
  const projectDocument = projectBody.documents.find((item) => item.displayName === projectDisplayName);
  expect(projectDocument).toBeTruthy();
  await waitUntilAiReady(page, projectId, projectDocument!.id);
  runtimeMonitor.allowAbortedRequestOnce(
    appPath(`/api/projects/${projectId}/documents`),
  );
  await page.reload();
  await expect(page.getByText("可用于 AI", { exact: true })).toBeVisible();
  await evidence(page, "03-project-files.png");

  await page.goto(appPath(`/knowledge/sessions?project=${encodeURIComponent(projectId)}`));
  await expect(page.getByRole("button", { name: "生成需求文档", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "生成需求文档", exact: true }).click();
  const projectOnlyArtifact = page.getByTestId("conversation-requirement-artifact");
  await expect(projectOnlyArtifact.getByText("项目需求文档 v1", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(projectOnlyArtifact).toContainText("项目资料 1 份");
  await expect(projectOnlyArtifact).toContainText("常规模板 0 份");

  await page.getByRole("link", { name: "常规模板", exact: true }).click();
  await evidence(page, "10-company-knowledge.png");
  await page.getByRole("button", { name: "上传模板", exact: true }).first().click();
  await settleAnimations(page.getByTestId("company-upload-dialog"));
  await evidence(page, "11-company-upload-dialog.png");
  const companyUploadResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/api/company-knowledge"),
  );
  await page.getByLabel("文件").setInputFiles(fictitiousText(
    companyFileName,
    "公司项目管理规范：需求文档发布前必须由项目负责人确认，并保留来源引用。",
  ));
  await page.getByLabel("分类").click();
  await page.getByRole("option", { name: "项目管理规范", exact: true }).click();
  await page.getByRole("button", { name: "上传草稿", exact: true }).click();
  const uploadedCompany = (await (await companyUploadResponse).json()) as { documentId: string };
  await expect(page.getByText(companyDisplayName, { exact: true })).toBeVisible();
  await waitUntilCompanyAiReady(page, uploadedCompany.documentId);
  const companyRow = page.getByRole("row").filter({ hasText: companyDisplayName });
  await companyRow.getByRole("button", { name: `${companyDisplayName} 操作`, exact: true }).click();
  await page.getByRole("menuitem", { name: "发布", exact: true }).click();
  await expect(companyRow.getByText("已发布", { exact: false })).toBeVisible();

  await page.goto(appPath(`/knowledge/sessions?project=${encodeURIComponent(projectId)}`));
  await expect(page.getByLabel("会话范围")).toHaveText(projectName);
  await expect(page.getByRole("button", { name: "生成需求文档", exact: true })).toBeEnabled();
  await evidence(page, "04-session-empty.png");
  await page.getByRole("button", { name: "生成需求文档", exact: true }).click();
  await expect(page.getByTestId("conversation-requirement-artifact")).toContainText("生成中");
  await evidence(page, "05-requirement-generating.png");
  const artifact = page.getByTestId("conversation-requirement-artifact");
  await expect(artifact.getByText("项目需求文档 v2", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(artifact).toContainText(/项目资料 [1-9]\d* 份/);
  await expect(artifact).toContainText(/常规模板 [1-9]\d* 份/);
  await expect(artifact.getByText("AI 草稿", { exact: true })).toBeVisible();
  await expect(artifact.getByRole("link", { name: "保存到项目", exact: true })).toBeVisible();
  await artifact.getByRole("link", { name: "预览与编辑", exact: true }).click();
  await expect(page.getByRole("heading", { name: "1. 文档信息与版本", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "17. 来源", exact: true })).toBeVisible();
  await evidence(page, "06-requirement-success-local-fake.png");
  const requirementList = await page.request.get(appPath(`/api/projects/${projectId}/requirement-documents`));
  const requirementBody = await json<{ documents: Array<{ id: string; status: string }> }>(requirementList);
  const generatedRequirement = requirementBody.documents.find((item) => item.status === "draft");
  expect(generatedRequirement).toBeTruthy();
  const database = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await database.connect();
  try {
    const execution = await database.query(
      `select status, skill_id, source_count, output_count
       from project_management_ai_executions
       where id = $1 and project_id = $2`,
      [generatedRequirement!.id, projectId],
    );
    expect(execution.rows).toHaveLength(1);
    expect(execution.rows[0]).toMatchObject({
      status: "succeeded",
      skill_id: "generate_project_requirement_document",
      output_count: 17,
    });
    expect(Number(execution.rows[0].source_count)).toBeGreaterThanOrEqual(2);
  } finally {
    await database.end();
  }
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const firstSection = page.locator("textarea").first();
  await firstSection.fill(`${await firstSection.inputValue()}\n- [TBD] 由项目经理补充发布负责人。`);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await page.getByRole("button", { name: "下载", exact: true }).click();
  await expectDownload(page, "下载 Markdown", ".md", runtimeMonitor.allowAbortedRequestOnce);
  await page.getByRole("button", { name: "下载", exact: true }).click();
  await expectDownload(page, "下载 DOCX", ".docx", runtimeMonitor.allowAbortedRequestOnce);

  await page.goto(appPath(`/knowledge/sessions?project=${encodeURIComponent(projectId)}`));
  await page.getByLabel("向项目 AI 助手提问").fill("项目资料中 2026 年 10 月 15 日的内部上线事实是什么？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("2026 年 10 月 15 日", { timeout: 45_000 });
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("[项目资料]");
  await evidence(page, "08-ai-conversation.png");

  await page.getByLabel("向项目 AI 助手提问").fill("公司项目管理规范中的需求文档发布确认要求是什么？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("[常规模板]", { timeout: 45_000 });

  const threadResponse = await page.request.get(appPath(`/api/projects/${projectId}/ai/threads`));
  const threadBody = await json<{ threads: Array<{ id: string; status: string }> }>(threadResponse);
  const activeThread = threadBody.threads.find((item) => item.status === "active");
  expect(activeThread).toBeTruthy();
  runtimeMonitor.allowHttpStatusOnce({
    status: 503,
    pathname: appPath(`/api/projects/${projectId}/ai/threads/${activeThread!.id}/messages`),
  });
  runtimeMonitor.allowConsoleErrorOnce({
    message: "Failed to load resource: the server responded with a status of 503 (Service Unavailable)",
    pathname: appPath(`/api/projects/${projectId}/ai/threads/${activeThread!.id}/messages`),
  });
  await page.getByLabel("向项目 AI 助手提问").fill("公司项目管理规范中的需求文档发布确认要求是什么？FAKE_401");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.getByText("AI 服务当前不可用。项目资料和常规模板未发生变化，请联系管理员检查模型访问权限。", { exact: true })).toBeVisible();
  await evidence(page, "09-ai-provider-failure.png");

  await page.goto(appPath(`/knowledge/projects/${projectId}/files`));
  await page.getByRole("button", { name: "上传资料", exact: true }).click();
  const failureUpload = page.getByRole("dialog", { name: "上传项目资料" });
  const failureFileName = `focused-provider-failure-${suffix}.txt`;
  await failureUpload.getByLabel("选择上传文件").setInputFiles(fictitiousText(
    failureFileName,
    "FAKE_401：仅用于验证 Provider 失败后需求 execution 会被标记为 failed。",
  ));
  await failureUpload.getByRole("button", { name: "开始上传", exact: true }).click();
  await expect(failureUpload.getByText("项目资料上传成功", { exact: true })).toBeVisible();
  await failureUpload.getByRole("button", { name: "关闭", exact: true }).last().click();
  const failureDocumentList = await page.request.get(appPath(`/api/projects/${projectId}/documents?status=active`));
  const failureDocumentBody = await json<{ documents: Array<{ id: string; displayName: string }> }>(failureDocumentList);
  const failureDocument = failureDocumentBody.documents.find((item) => item.displayName === failureFileName.replace(/\.txt$/, ""));
  expect(failureDocument).toBeTruthy();
  await waitUntilAiReady(page, projectId, failureDocument!.id);

  await page.goto(appPath(`/knowledge/sessions?project=${encodeURIComponent(projectId)}`));
  await expect(page.getByRole("button", { name: "生成需求文档", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "生成需求文档", exact: true }).click();
  let failedRequirementId = "";
  await expect.poll(async () => {
    const response = await page.request.get(appPath(`/api/projects/${projectId}/requirement-documents`));
    const body = await json<{ documents: Array<{ id: string; versionNumber: number; status: string; failureCode: string | null }> }>(response);
    const failed = body.documents.find((item) => item.versionNumber === 3);
    failedRequirementId = failed?.id ?? "";
    return failed ? `${failed.status}:${failed.failureCode}` : "missing";
  }, { timeout: 60_000, intervals: [250, 500, 1_000] }).toBe("failed:REQUIREMENT_PROVIDER_FAILED");
  await expect(page.getByText("AI 服务暂时不可用。项目资料已保留，请联系管理员检查模型访问权限后再试。", { exact: true })).toBeVisible();
  await expect(page.getByText("REQUIREMENT_PROVIDER_FAILED", { exact: true })).toHaveCount(0);
  const failureDatabase = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await failureDatabase.connect();
  try {
    const failedExecution = await failureDatabase.query(
      `select status, skill_id, failure_code
       from project_management_ai_executions
       where id = $1 and project_id = $2`,
      [failedRequirementId, projectId],
    );
    expect(failedExecution.rows).toEqual([{
      status: "failed",
      skill_id: "generate_project_requirement_document",
      failure_code: "REQUIREMENT_PROVIDER_FAILED",
    }]);
  } finally {
    await failureDatabase.end();
  }

  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  try {
    await loginByApi(outsiderPage, "outsider");
    const outsiderResponse = await outsiderPage.request.get(appPath(`/api/projects/${projectId}`));
    expect(outsiderResponse.status()).toBe(404);
  } finally {
    await outsiderContext.close();
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(appPath("/knowledge/projects"));
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  const mobileNavigation = page.getByRole("dialog", { name: "主导航" });
  await settleAnimations(mobileNavigation);
  await expectNoPageOverflow(page);
  await evidence(page, "12-mobile-navigation-375.png");
});
