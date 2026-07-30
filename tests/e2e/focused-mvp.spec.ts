import { randomUUID } from "node:crypto";
import type { APIResponse, Download, Page } from "@playwright/test";
import type { ProjectDocumentVersionsResponse } from "@/types/documents";
import { expect, test } from "./fixtures";
import { appPath } from "./support/app-url";
import { loginByApi } from "./support/auth";
import { fictitiousText } from "./support/file-fixtures";

test.use({ authenticatedAs: "admin", trace: "off", video: "off" });

async function json<T>(response: APIResponse): Promise<T> {
  return response.json() as Promise<T>;
}

async function waitUntilParsed(page: Page, projectId: string, documentId: string) {
  await expect.poll(async () => {
    const response = await page.request.get(appPath(`/api/projects/${projectId}/documents/${documentId}/versions`));
    if (!response.ok()) return `http-${response.status()}`;
    const body = await json<ProjectDocumentVersionsResponse>(response);
    return body.versions.find((item) => item.isCurrent)?.ingestion.status;
  }, { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] }).toBe("succeeded");
}

async function waitUntilCompanyParsed(page: Page, documentId: string) {
  await expect.poll(async () => {
    const response = await page.request.get(appPath(`/api/company-knowledge/${documentId}/versions`));
    if (!response.ok()) return `http-${response.status()}`;
    const body = await json<{ versions: ProjectDocumentVersionsResponse["versions"] }>(response);
    return body.versions.find((item) => item.isCurrent)?.ingestion.status;
  }, { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] }).toBe("succeeded");
}

async function expectDownload(
  page: Page,
  triggerName: "Markdown" | "DOCX",
  extension: ".md" | ".docx",
  allowAbortedRequestOnce: (pathname: string) => void,
) {
  const link = page.getByRole("link", { name: triggerName, exact: true });
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

test("创建项目到需求文档与双范围 AI 对话的唯一 Happy Path", async ({ browser, page, runtimeMonitor }) => {
  const suffix = randomUUID().slice(0, 8);
  const projectName = `[TEST] Focused MVP ${suffix}`;
  const projectFileName = `focused-project-${suffix}.txt`;
  const projectDisplayName = projectFileName.replace(/\.txt$/, "");
  const companyFileName = `focused-company-standard-${suffix}.txt`;
  const companyDisplayName = companyFileName.replace(/\.txt$/, "");

  await page.goto(appPath("/projects"));
  await expect(page.getByRole("heading", { name: "项目", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "创建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill(projectName);
  await page.getByLabel("项目描述").fill("仅用于聚焦 MVP 自动化验收的虚构项目，不含客户信息。");
  await page.getByLabel("状态").selectOption("active");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.waitForURL(/\/projects\/project-[^/]+(?:\/overview)?$/);
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
  await waitUntilParsed(page, projectId, projectDocument!.id);
  await page.reload();
  await expect(page.getByText("知识索引已建立", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "公司知识库", exact: true }).click();
  await page.getByRole("button", { name: "上传公司资料", exact: true }).click();
  const companyUploadResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/api/company-knowledge"),
  );
  await page.getByLabel("文件").setInputFiles(fictitiousText(
    companyFileName,
    "公司项目管理规范：需求文档发布前必须由项目负责人确认，并保留来源引用。",
  ));
  await page.getByLabel("类别").selectOption("project_management");
  await page.getByRole("button", { name: "上传草稿", exact: true }).click();
  const uploadedCompany = (await (await companyUploadResponse).json()) as { documentId: string };
  await expect(page.getByText(companyDisplayName, { exact: true })).toBeVisible();
  await waitUntilCompanyParsed(page, uploadedCompany.documentId);
  const companyRow = page.getByRole("article").filter({ hasText: companyDisplayName });
  await companyRow.getByRole("button", { name: "发布", exact: true }).click();
  await expect(companyRow.getByText("已发布", { exact: false })).toBeVisible();

  await page.goto(appPath(`/projects/${projectId}/requirements`));
  await page.getByRole("button", { name: "生成新版本", exact: true }).click();
  await expect(page.getByText("版本 v1", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/项目资料 1 份 · 公司规范 [1-9]\d* 份/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "1. 文档信息与版本", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "17. 来源", exact: true })).toBeVisible();
  const firstSection = page.locator("textarea").first();
  await firstSection.fill(`${await firstSection.inputValue()}\n- [TBD] 由项目经理补充发布负责人。`);
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  await expectDownload(page, "Markdown", ".md", runtimeMonitor.allowAbortedRequestOnce);
  await expectDownload(page, "DOCX", ".docx", runtimeMonitor.allowAbortedRequestOnce);

  await page.goto(appPath("/chat"));
  await page.getByLabel("当前项目").selectOption({ label: projectName });
  await page.getByRole("button", { name: "项目资料", exact: true }).click();
  await page.getByLabel("向项目 AI 助手提问").fill("项目资料中 2026 年 10 月 15 日的内部上线事实是什么？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("2026 年 10 月 15 日", { timeout: 45_000 });
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("[项目资料]");

  await page.getByRole("button", { name: "公司资料", exact: true }).click();
  await page.getByLabel("向项目 AI 助手提问").fill("公司项目管理规范中的需求文档发布确认要求是什么？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("[公司资料]", { timeout: 45_000 });

  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  try {
    await loginByApi(outsiderPage, "outsider");
    const outsiderResponse = await outsiderPage.request.get(appPath(`/api/projects/${projectId}`));
    expect(outsiderResponse.status()).toBe(404);
  } finally {
    await outsiderContext.close();
  }
});
