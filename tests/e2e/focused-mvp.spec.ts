import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { APIResponse, Download, Locator, Page } from "@playwright/test";
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
    "时间：2026 年 10 月 15 日\n平台：微信小程序\n项目地区：中国\nMVP需求：会员注册和 CRM 同步",
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
  await expect(page.getByRole("button", { name: "生成需求概览", exact: true })).toBeEnabled();
  await evidence(page, "04-session-empty.png");
  await page.getByRole("button", { name: "生成需求概览", exact: true }).click();
  await page.getByTestId("requirement-overview-empty").getByRole("button", { name: "开始需求概览", exact: true }).click();
  const overview = page.getByTestId("requirement-overview-workspace");
  await expect(overview.getByText("需求概览 v1", { exact: true })).toBeVisible();
  const overviewAnswers = overview.locator("textarea");
  await overviewAnswers.nth(0).fill("2026 年 10 月 15 日内部上线。");
  await overviewAnswers.nth(1).fill("微信小程序。");
  await overviewAnswers.nth(2).fill("弥知负责研发与交付，客户负责业务确认，CRM 由三方提供。");
  await overviewAnswers.nth(3).fill("微信小程序由弥知主体发布。");
  await overviewAnswers.nth(4).fill("仅处理完成会员注册所必需的数据，并在上线前确认隐私政策。");
  await overviewAnswers.nth(5).fill("可行，需要研发资源和 CRM 三方接口联调。");
  await overviewAnswers.nth(6).fill("会员注册和 CRM 同步。");
  await overview.getByRole("button", { name: "保存确认", exact: true }).click();
  await expect(overview.getByRole("button", { name: "生成需求概览", exact: true })).toBeEnabled();
  await overview.getByRole("button", { name: "生成需求概览", exact: true }).click();
  await expect(overview.getByText("已生成", { exact: true })).toBeVisible({ timeout: 60_000 });
  const overviewPreview = overview.locator("pre");
  await expect(overviewPreview).toContainText("|项目地区|中国");
  await expect(overviewPreview).toContainText("|平台类型|微信小程序");
  await expect(overviewPreview).toContainText("|7|MVP需求|会员注册和 CRM 同步");
  await expect(overviewPreview).toContainText("|适配类型|TBD（待项目经理确认）|");
  await expect(overviewPreview).not.toContainText("目标与成功标准");
  await expect(overviewPreview).not.toContainText("用户与关键场景");
  await evidence(page, "06-requirement-success-local-fake.png");
  const overviewDownload = overview.getByRole("link", { name: "下载 Markdown", exact: true });
  const overviewHref = await overviewDownload.getAttribute("href");
  expect(overviewHref).toBeTruthy();
  runtimeMonitor.allowAbortedRequestOnce(new URL(overviewHref!, page.url()).pathname);
  const [overviewFile] = await Promise.all([page.waitForEvent("download"), overviewDownload.click()]);
  await verifyDownload(overviewFile, ".md");
  await overview.getByRole("button", { name: "保存到项目", exact: true }).click();
  await expect(overview.getByRole("button", { name: "已保存到项目", exact: true })).toBeVisible();

  await page.goto(appPath(`/knowledge/sessions?project=${encodeURIComponent(projectId)}`));
  await page.getByLabel("向项目 AI 助手提问").fill("项目资料中 2026 年 10 月 15 日的内部上线事实是什么？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("2026 年 10 月 15 日", { timeout: 45_000 });
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("[项目资料]");
  await evidence(page, "08-ai-conversation.png");

  await page.getByLabel("向项目 AI 助手提问").fill("公司项目管理规范中的需求文档发布确认要求是什么？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("[常规模板]", { timeout: 45_000 });

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
