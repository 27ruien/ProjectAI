import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  APIResponse,
  Download,
  Locator,
  Page,
  Request,
} from "@playwright/test";
import type {
  ProjectDocumentUploadResponse,
  ProjectDocumentVersionsResponse,
} from "@/types/documents";
import { expect, test } from "./fixtures";
import { appPath } from "./support/app-url";
import { actorCredentials, loginByApi } from "./support/auth";
import { fictitiousText, scannedPdf } from "./support/file-fixtures";

const PRODUCT_MAP_STEP_IDS = [
  "evidence_inventory",
  "project_understanding",
  "goals_and_behaviors",
  "user_path",
  "product_map",
  "pages_and_features",
  "independent_review",
  "final_artifact",
] as const;

test.use({
  authenticatedAs: "admin",
  trace: "off",
  video: "off",
  viewport: { width: 1440, height: 1000 },
});

const evidenceDirectory = process.env.FOCUSED_UI_EVIDENCE_DIR?.trim();
async function evidence(page: Page, filename: string) {
  if (!evidenceDirectory) return;
  await mkdir(evidenceDirectory, { recursive: true });
  await page.screenshot({
    path: join(evidenceDirectory, filename),
    fullPage: true,
  });
}

async function settleAnimations(locator: Locator) {
  await expect(locator).toBeVisible();
  await locator.evaluate(async (element) => {
    await Promise.all(
      element.getAnimations().map((animation) => animation.finished),
    );
  });
}

async function expectNoPageOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
}

async function json<T>(response: APIResponse): Promise<T> {
  return response.json() as Promise<T>;
}

type ProductMapDetail = {
  run: {
    id: string;
    projectId: string;
    status: string;
    currentStep: number;
    sourceCount: number;
    failureCode?: string | null;
  };
  sources: Array<{
    id: string;
    documentId?: string;
    displayName: string;
    status: string;
  }>;
  artifacts: Array<{
    id: string;
    status: string;
    currentVersion: number;
    content: Record<string, unknown>;
    markdown: string;
    mermaid: string;
    publishedDocumentId?: string | null;
  }>;
  versions: Array<{
    version: number;
    content: Record<string, unknown>;
  }>;
  executions: Array<{ stepId: string; status: string }>;
  permissions: { canEdit: boolean; canReview: boolean; canPublish: boolean };
};

type EditableProductMap = Record<string, unknown> & {
  projectUnderstanding: {
    oneLinePositioning: { text: string };
  };
};

type ProductMapEvidenceStatus =
  | "CONFIRMED"
  | "INFERRED"
  | "MISSING"
  | "CONFLICT"
  | "NOT_APPLICABLE";

function assertLimitedEvidenceContract(content: Record<string, unknown>) {
  const analysis = content.analysisContract as {
    sources: Array<{ id: string }>;
  };
  const evidenceInventory = content.materialInventory as {
    evidence: Array<{ id: string }>;
  };
  const quality = content.quality as {
    overall: string;
    blockers: string[];
    checks: Array<{ id: string; result: string }>;
  };
  const trustedSourceIds = new Set(analysis.sources.map((source) => source.id));
  const trustedEvidenceIds = new Set(
    evidenceInventory.evidence.map((evidence) => evidence.id),
  );
  const claims: Array<{
    path: string;
    evidenceStatus: ProductMapEvidenceStatus;
    refs: string[];
    trustedRefs: Set<string>;
  }> = [];
  const visit = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!value || typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    if (typeof item.evidenceStatus === "string") {
      const refsKey = ["sourceRefs", "citations", "citationIds"].find(
        (key) => Array.isArray(item[key]),
      );
      expect(
        refsKey,
        `${path} 的 evidenceStatus 必须搭配可核验引用字段`,
      ).toBeTruthy();
      claims.push({
        path,
        evidenceStatus: item.evidenceStatus as ProductMapEvidenceStatus,
        refs: (item[refsKey!] as unknown[]).map(String),
        trustedRefs:
          refsKey === "citationIds" ? trustedEvidenceIds : trustedSourceIds,
      });
    }
    for (const [key, child] of Object.entries(item)) {
      visit(child, `${path}.${key}`);
    }
  };
  visit(content, "artifact");

  expect(
    claims.some((claim) => claim.evidenceStatus === "MISSING"),
    "limited-evidence 产物必须保留 MISSING 项",
  ).toBe(true);
  expect(
    claims.some((claim) => claim.evidenceStatus === "INFERRED"),
    "limited-evidence 产物必须显式标记 INFERRED 项",
  ).toBe(true);
  expect(
    claims.some((claim) => claim.evidenceStatus === "CONFIRMED"),
    "limited-evidence 产物仍应保留有可信引用的 CONFIRMED 项",
  ).toBe(true);
  for (const claim of claims) {
    if (["MISSING", "NOT_APPLICABLE"].includes(claim.evidenceStatus)) {
      expect(
        claim.refs,
        `${claim.path} 的 ${claim.evidenceStatus} 不得伪造来源引用`,
      ).toEqual([]);
      continue;
    }
    if (["CONFIRMED", "INFERRED"].includes(claim.evidenceStatus)) {
      expect(
        claim.refs.length,
        `${claim.path} 的 ${claim.evidenceStatus} 必须绑定可信来源`,
      ).toBeGreaterThan(0);
    }
    for (const ref of claim.refs) {
      expect(
        claim.trustedRefs.has(ref),
        `${claim.path} 的 ${claim.evidenceStatus} 引用 ${ref} 必须来自受信证据集合`,
      ).toBe(true);
    }
  }
  expect(quality.overall).not.toBe("通过");
  if (quality.overall === "阻塞") {
    expect(quality.blockers.length).toBeGreaterThan(0);
  }
  expect(quality.checks.every((check) => check.result === "PASS")).toBe(false);
  expect(
    quality.checks.find((check) => check.id === "evidence_traceability")
      ?.result,
  ).toBe("待确认");
}

function browserOrigin(): string {
  const configured = process.env.PLAYWRIGHT_BASE_URL?.trim();
  const port = Number(process.env.PLAYWRIGHT_PORT ?? 3200);
  return new URL(configured || `http://127.0.0.1:${port}`).origin;
}

function mutationHeaders() {
  return { origin: browserOrigin() };
}

async function getProductMapDetail(
  page: Page,
  projectId: string,
  runId: string,
) {
  const response = await page.request.get(
    appPath(`/api/projects/${projectId}/workflows/${runId}`),
  );
  expect(response.status()).toBe(200);
  return json<ProductMapDetail>(response);
}

function productMapMutationSnapshot(detail: ProductMapDetail) {
  return {
    run: {
      id: detail.run.id,
      projectId: detail.run.projectId,
      status: detail.run.status,
      currentStep: detail.run.currentStep,
      sourceCount: detail.run.sourceCount,
      failureCode: detail.run.failureCode ?? null,
    },
    sources: detail.sources
      .map((source) => ({
        id: source.id,
        documentId: source.documentId ?? null,
        status: source.status,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    artifacts: detail.artifacts.map((artifact) => ({
      id: artifact.id,
      status: artifact.status,
      currentVersion: artifact.currentVersion,
      publishedDocumentId: artifact.publishedDocumentId ?? null,
    })),
    versions: detail.versions.map((version) => version.version),
    executions: detail.executions.map((execution) => ({
      stepId: execution.stepId,
      status: execution.status,
    })),
  };
}

async function waitUntilProductMapStatus(
  page: Page,
  projectId: string,
  runId: string,
  status: string,
) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          appPath(`/api/projects/${projectId}/workflows/${runId}`),
        );
        if (!response.ok()) return `http-${response.status()}`;
        return (await json<ProductMapDetail>(response)).run.status;
      },
      { timeout: 90_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toBe(status);
  return getProductMapDetail(page, projectId, runId);
}

async function listActiveProjectDocuments(page: Page, projectId: string) {
  const response = await page.request.get(
    appPath(`/api/projects/${projectId}/documents?status=active`),
  );
  expect(response.status()).toBe(200);
  return json<{ documents: Array<{ id: string; displayName: string }> }>(
    response,
  );
}

async function waitUntilAiReady(
  page: Page,
  projectId: string,
  documentId: string,
) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          appPath(
            `/api/projects/${projectId}/documents/${documentId}/versions`,
          ),
        );
        if (!response.ok()) return `http-${response.status()}`;
        const body = await json<ProjectDocumentVersionsResponse>(response);
        const current = body.versions.find((item) => item.isCurrent);
        return `${current?.ingestion.status}:${current?.embedding.status}`;
      },
      { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toBe("succeeded:succeeded");
}

async function waitUntilCompanyAiReady(page: Page, documentId: string) {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          appPath(`/api/company-knowledge/${documentId}/versions`),
        );
        if (!response.ok()) return `http-${response.status()}`;
        const body = await json<{
          versions: ProjectDocumentVersionsResponse["versions"];
        }>(response);
        const current = body.versions.find((item) => item.isCurrent);
        return `${current?.ingestion.status}:${current?.embedding.status}`;
      },
      { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toBe("succeeded:succeeded");
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

test("General Chat 单击发送一次并在刷新后保留消息", async ({
  page,
  runtimeMonitor,
}) => {
  let messagePostCount = 0;
  let messagesPath: string | null = null;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (
      request.method() === "POST" &&
      /\/api\/ai\/threads\/[^/]+\/messages$/.test(pathname)
    ) {
      messagePostCount += 1;
      messagesPath = pathname;
    }
  });

  await page.goto(appPath("/assistant"));
  await expect(
    page.getByRole("heading", { name: "AI 助手", exact: true }),
  ).toBeVisible();
  const input = page.getByTestId("assistant-composer-input");
  await input.fill("你能做什么？");
  await page.getByTestId("assistant-send-button").click();

  await expect(page.locator('[data-message-role="user"]').last()).toContainText(
    "你能做什么？",
  );
  await expect(
    page.locator('[data-message-role="assistant"]').last(),
  ).toContainText("本回答未使用项目或公司资料。", { timeout: 45_000 });
  await expect(input).toHaveValue("");
  expect(messagePostCount).toBe(1);

  expect(messagesPath).not.toBeNull();
  // A reload can supersede the just-completed thread refresh. Allow only one
  // explicit Chromium abort for this exact messages endpoint during the
  // reload window; every other request failure remains a hard failure.
  const reloadAbortAllowance = runtimeMonitor.allowAbortedRequestOnce(
    messagesPath!,
  );
  await page.reload();
  reloadAbortAllowance.release();
  await expect(page.locator('[data-message-role="user"]').last()).toContainText(
    "你能做什么？",
  );
  await expect(
    page.locator('[data-message-role="assistant"]').last(),
  ).toContainText("本回答未使用项目或公司资料。");
});

test("知识库项目到会话问答与需求文档产物的唯一 Happy Path", async ({
  browser,
  page,
  runtimeMonitor,
}) => {
  test.setTimeout(300_000);
  const pendingProjectFolderRequests = new Set<Request>();
  const isProjectFolderRequest = (request: Request) =>
    request.method() === "GET" &&
    /\/api\/projects\/[^/]+\/folders$/.test(
      new URL(request.url()).pathname,
    );
  page.on("request", (request) => {
    if (isProjectFolderRequest(request)) pendingProjectFolderRequests.add(request);
  });
  page.on("requestfinished", (request) => {
    pendingProjectFolderRequests.delete(request);
  });
  page.on("requestfailed", (request) => {
    pendingProjectFolderRequests.delete(request);
  });
  const suffix = randomUUID().slice(0, 8);
  const projectName = `[TEST] Focused MVP ${suffix}`;
  const projectFileName = `focused-project-${suffix}.txt`;
  const projectDisplayName = projectFileName.replace(/\.txt$/, "");
  const companyFileName = `focused-company-standard-${suffix}.txt`;
  const companyDisplayName = companyFileName.replace(/\.txt$/, "");

  await page.goto(appPath("/data-spaces/projects"));
  await expect(
    page.getByRole("heading", { name: "项目资料", exact: true }),
  ).toBeVisible();
  await expectNoPageOverflow(page);
  await evidence(page, "01-project-list.png");
  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill(projectName);
  await page
    .getByLabel("项目描述")
    .fill("仅用于聚焦 MVP 自动化验收的虚构项目，不含客户信息。");
  await page.getByRole("combobox", { name: "所属部门", exact: true }).click();
  await page
    .getByRole("option", { name: "交付与项目管理部", exact: true })
    .click();
  await page.getByRole("combobox", { name: "项目状态", exact: true }).click();
  await page.getByRole("option", { name: "进行中", exact: true }).click();
  await page
    .getByTestId("create-project-dialog")
    .getByRole("button", { name: "创建项目", exact: true })
    .click();
  await page.waitForURL(
    /\/data-spaces\/projects\/project-[^/]+(?:\/overview)?$/,
  );
  await evidence(page, "02-project-overview.png");
  await page.setViewportSize({ width: 1024, height: 900 });
  await expectNoPageOverflow(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const projectId = new URL(page.url()).pathname
    .split("/")
    .filter(Boolean)
    .at(-2)
    ?.startsWith("project-")
    ? new URL(page.url()).pathname.split("/").filter(Boolean).at(-2)!
    : new URL(page.url()).pathname.split("/").filter(Boolean).at(-1)!;

  const projectFoldersPath = appPath(`/api/projects/${projectId}/folders`);
  const consumedFolderAllowances: Array<{
    transition: string;
    requestUrl: string;
  }> = [];
  const navigateWithPendingFolderAllowances = async <T,>(
    transition: string,
    action: () => Promise<T>,
  ): Promise<T> => {
    // Register the exact project-scoped pathname before starting navigation as
    // well as allowances for requests already observed. Vinext can issue the
    // folders request in the same turn as page.goto/reload, after the pending
    // snapshot above, and Chromium may then abort it while replacing the page.
    // Keep this pathname allowance scoped to this one transition and consume
    // at most one newly-created request; unrelated aborts remain failures.
    const transitionAllowance = runtimeMonitor.allowAbortedRequestOnce(
      projectFoldersPath,
    );
    const pending = [...pendingProjectFolderRequests].filter(
      (request) => new URL(request.url()).pathname === projectFoldersPath,
    );
    const allowances = pending.map((request) => ({
      request,
      allowance: runtimeMonitor.allowAbortedRequestOnce(request),
    }));
    try {
      return await action();
    } finally {
      const { consumed: transitionConsumed } = transitionAllowance.release();
      if (transitionConsumed) {
        consumedFolderAllowances.push({
          transition,
          requestUrl: projectFoldersPath,
        });
      }
      for (const { request, allowance } of allowances) {
        const { consumed } = allowance.release();
        if (consumed) {
          consumedFolderAllowances.push({
            transition,
            requestUrl: request.url(),
          });
        }
      }
    }
  };

  const addViewerResponse = await page.request.post(
    appPath(`/api/projects/${projectId}/members`),
    {
      data: {
        email: process.env.SEED_VIEWER_A_EMAIL,
        role: "viewer",
      },
      headers: mutationHeaders(),
    },
  );
  expect(addViewerResponse.status()).toBe(201);
  const addManagerResponse = await page.request.post(
    appPath(`/api/projects/${projectId}/members`),
    {
      data: {
        email: actorCredentials("managerA").email,
        role: "project_manager",
      },
      headers: mutationHeaders(),
    },
  );
  expect(addManagerResponse.status()).toBe(201);

  await page.getByRole("tab", { name: "项目资料", exact: true }).click();
  const documentsPanel = page.getByTestId("project-documents-panel");
  await expect(documentsPanel).toBeVisible();
  await documentsPanel
    .getByRole("button", { name: "新建文件夹", exact: true })
    .click();
  const folderDialog = page.getByRole("dialog", { name: "新建文件夹" });
  await folderDialog.getByLabel("文件夹名称").fill("验收资料");
  await folderDialog.getByRole("button", { name: "创建", exact: true }).click();
  await expect(
    documentsPanel.getByRole("link", { name: "验收资料", exact: true }),
  ).toBeVisible();
  await documentsPanel
    .getByRole("link", { name: "验收资料", exact: true })
    .click();
  await expect(page).toHaveURL(/\?folder=/);
  await documentsPanel
    .locator("#project-workspace-upload")
    .setInputFiles(
      fictitiousText(
        projectFileName,
        "时间：2026 年 10 月 15 日\n平台：微信小程序\n项目地区：中国\nMVP需求：会员注册和 CRM 同步",
      ),
    );
  await expect(
    documentsPanel.getByText(projectDisplayName, { exact: true }),
  ).toBeVisible();
  const projectList = await page.request.get(
    appPath(`/api/projects/${projectId}/documents?status=active`),
  );
  const projectBody = await json<{
    documents: Array<{ id: string; displayName: string }>;
  }>(projectList);
  const projectDocument = projectBody.documents.find(
    (item) => item.displayName === projectDisplayName,
  );
  expect(projectDocument).toBeTruthy();
  await waitUntilAiReady(page, projectId, projectDocument!.id);
  runtimeMonitor.allowAbortedRequestOnce(
    appPath(`/api/projects/${projectId}/documents`),
  );
  await navigateWithPendingFolderAllowances(
    "项目资料解析完成后刷新",
    () => page.reload(),
  );
  await expect(page.getByText("可用于 AI", { exact: true })).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const sourceRow = page.getByRole("row").filter({
    has: page.getByRole("link", { name: projectDisplayName, exact: true }),
  });
  await sourceRow
    .getByRole("button", { name: `${projectDisplayName} 操作`, exact: true })
    .click();
  await expect(
    page.getByRole("menuitem", { name: "分享", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "复制链接", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "创建副本", exact: true }),
  ).toBeVisible();
  await page.getByRole("menuitem", { name: "分享", exact: true }).click();
  const shareDialog = page.getByRole("dialog", { name: "分享内部访问链接" });
  await expect(
    shareDialog.getByText("只对已有权限成员有效", { exact: true }),
  ).toBeVisible();
  await shareDialog.getByRole("button", { name: "关闭", exact: true }).click();
  await sourceRow
    .getByRole("button", { name: `${projectDisplayName} 操作`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "复制链接", exact: true }).click();
  await expect(
    page.getByText("内部访问链接已复制", { exact: true }),
  ).toBeVisible();
  await sourceRow
    .getByRole("button", { name: `${projectDisplayName} 操作`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "创建副本", exact: true }).click();
  const copiedName = `${projectDisplayName} 副本`;
  await expect(
    page.getByRole("link", { name: copiedName, exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  const copiedList = await page.request.get(
    appPath(`/api/projects/${projectId}/documents?status=active`),
  );
  const copiedBody = await json<{
    documents: Array<{ id: string; displayName: string }>;
  }>(copiedList);
  const copiedDocument = copiedBody.documents.find(
    (item) => item.displayName === copiedName,
  );
  expect(copiedDocument).toBeTruthy();
  await waitUntilAiReady(page, projectId, copiedDocument!.id);
  const copiedRow = page
    .getByRole("row")
    .filter({ has: page.getByRole("link", { name: copiedName, exact: true }) });
  await copiedRow
    .getByRole("button", { name: `${copiedName} 操作`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  const deleteDialog = page.getByRole("dialog", { name: "确认删除" });
  runtimeMonitor.allowAbortedRequestOnce(
    appPath(`/api/projects/${projectId}/documents/${copiedDocument!.id}`),
  );
  await deleteDialog
    .getByRole("button", { name: "确认删除", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: copiedName, exact: true }),
  ).toHaveCount(0);
  const viewerLink = page.getByRole("link", {
    name: projectDisplayName,
    exact: true,
  });
  await expect(viewerLink).toHaveAttribute(
    "href",
    new RegExp(`/documents/${projectDocument!.id}/versions/`),
  );
  runtimeMonitor.allowAbortedRequestOnce(
    appPath(`/api/projects/${projectId}/documents/${projectDocument!.id}`),
  );
  await viewerLink.click();
  await expect(page.getByTestId("text-viewer")).toBeVisible();
  await page.goBack();
  await evidence(page, "03-project-files.png");

  await navigateWithPendingFolderAllowances(
    "从项目资料切到公司资料",
    () => page.goto(appPath("/data-spaces/company")),
  );
  await evidence(page, "10-company-knowledge.png");
  await page
    .getByTestId("company-knowledge-page")
    .getByRole("button", { name: "上传公司资料", exact: true })
    .click();
  await settleAnimations(
    page.getByRole("dialog", { name: "上传公司资料", exact: true }),
  );
  await evidence(page, "11-company-upload-dialog.png");
  const companyUploadResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.endsWith("/api/company-knowledge"),
  );
  await page
    .getByLabel("文件")
    .setInputFiles(
      fictitiousText(
        companyFileName,
        "公司项目管理规范：需求文档发布前必须由项目负责人确认，并保留来源引用。",
      ),
    );
  await page.getByRole("combobox", { name: "分类", exact: true }).click();
  await page.getByRole("option", { name: "项目管理规范", exact: true }).click();
  await page.getByRole("button", { name: "上传草稿", exact: true }).click();
  const uploadedCompany = (await (await companyUploadResponse).json()) as {
    documentId: string;
  };
  runtimeMonitor.allowAbortedRequestOnce(
    appPath(`/api/company-knowledge/${uploadedCompany.documentId}`),
  );
  await expect(
    page.getByText(companyDisplayName, { exact: true }),
  ).toBeVisible();
  await waitUntilCompanyAiReady(page, uploadedCompany.documentId);
  const companyRow = page
    .getByRole("row")
    .filter({ hasText: companyDisplayName });
  await companyRow
    .getByRole("button", { name: `${companyDisplayName} 操作`, exact: true })
    .click();
  await page.getByRole("menuitem", { name: "发布", exact: true }).click();
  await expect(companyRow.getByText("已发布", { exact: false })).toBeVisible();

  const productMapPath = appPath(`/api/projects/${projectId}/workflows`);
  runtimeMonitor.allowAbortedRequestOnce(
    appPath(`/api/company-knowledge/${uploadedCompany.documentId}`),
  );
  await navigateWithPendingFolderAllowances(
    "从公司资料切到项目助手",
    () =>
      page.goto(
        appPath(`/assistant?project=${encodeURIComponent(projectId)}`),
      ),
  );
  const productMapQuickAction = page.getByTestId("quick-action-product-map");
  await expect(productMapQuickAction).toContainText(
    "Product Map｜产品结构",
  );
  await productMapQuickAction.click();
  const productMapModal = page.getByTestId("product-map-modal");
  await expect(productMapModal).toBeVisible();
  await expect(productMapModal.getByText("AI Skill · 1.0.0")).toBeVisible();
  const projectSourceOption = productMapModal.getByLabel(
    `选择资料 ${projectDisplayName}`,
  );
  const companySourceOption = productMapModal.getByLabel(
    `选择资料 ${companyDisplayName}`,
  );
  await expect(projectSourceOption).toBeEnabled();
  await expect(companySourceOption).toBeEnabled();
  await projectSourceOption.check();
  await companySourceOption.check();
  await productMapModal
    .getByLabel("Product Map 补充说明")
    .fill("仅确认这是虚构验收项目，其余信息待补充。");
  const productMapStartPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === productMapPath,
  );
  await productMapModal
    .getByRole("button", { name: "检查资料并开始", exact: true })
    .click();
  const productMapStart = await productMapStartPromise;
  expect(productMapStart.status()).toBe(201);
  const productMapCreated = (await productMapStart.json()) as {
    run: { id: string; status: string };
  };
  const productMapInput = productMapStart.request().postDataJSON() as {
    selectedSourceIds: string[];
    userInput: string;
    idempotencyKey: string;
  };
  expect(productMapInput.selectedSourceIds.sort()).toEqual(
    [projectDocument!.id, uploadedCompany.documentId].sort(),
  );
  await waitUntilProductMapStatus(
    page,
    projectId,
    productMapCreated.run.id,
    "needs_input",
  );
  await expect(productMapModal.getByText(/资料不足或存在冲突/)).toBeVisible();
  const productMapReplay = await page.request.post(productMapPath, {
    data: productMapInput,
    headers: mutationHeaders(),
  });
  expect(productMapReplay.status()).toBe(200);
  const productMapReplayBody = await json<{ run: { id: string } }>(
    productMapReplay,
  );
  expect(productMapReplayBody.run.id).toBe(productMapCreated.run.id);

  const foreignSourceUpload = await page.request.post(
    appPath("/api/projects/project-002/documents"),
    {
      headers: {
        ...mutationHeaders(),
        "Idempotency-Key": randomUUID(),
      },
      multipart: {
        file: fictitiousText(
          `focused-cross-project-${suffix}.txt`,
          "跨项目隔离虚构资料；不得被目标项目 Product Map 使用。",
        ),
        displayName: `focused-cross-project-${suffix}`,
      },
    },
  );
  expect(foreignSourceUpload.status()).toBe(201);
  const foreignSource =
    (await foreignSourceUpload.json()) as ProjectDocumentUploadResponse;
  const managerContext = await browser.newContext();
  const managerPage = await managerContext.newPage();
  try {
    await loginByApi(managerPage, "managerA");
    const mainRunBeforeForeignCreate = await getProductMapDetail(
      managerPage,
      projectId,
      productMapCreated.run.id,
    );
    const workflowsBeforeForeignCreate = await managerPage.request.get(
      productMapPath,
    );
    expect(workflowsBeforeForeignCreate.status()).toBe(200);
    const workflowsBeforeForeignCreateBody = (await workflowsBeforeForeignCreate.json()) as {
      workflows: Array<{ id: string }>;
    };
    const foreignCreate = await managerPage.request.post(productMapPath, {
      data: {
        selectedSourceIds: [foreignSource.document.id],
        userInput: "跨项目 Source 不应进入当前项目。",
        idempotencyKey: randomUUID(),
      },
      headers: mutationHeaders(),
    });
    expect(foreignCreate.status()).toBe(404);
    const foreignCreateError = (await foreignCreate.json()) as {
      error?: { code?: string };
    };
    expect(foreignCreateError.error?.code).toBe(
      "PRODUCT_MAP_SOURCE_NOT_FOUND",
    );
    const workflowsAfterForeignCreate = await managerPage.request.get(
      productMapPath,
    );
    expect(workflowsAfterForeignCreate.status()).toBe(200);
    const workflowsAfterForeignCreateBody = (await workflowsAfterForeignCreate.json()) as {
      workflows: Array<{ id: string }>;
    };
    expect(
      workflowsAfterForeignCreateBody.workflows.map((workflow) => workflow.id).sort(),
    ).toEqual(
      workflowsBeforeForeignCreateBody.workflows
        .map((workflow) => workflow.id)
        .sort(),
    );
    const mainRunAfterForeignCreate = await getProductMapDetail(
      managerPage,
      projectId,
      productMapCreated.run.id,
    );
    expect(
      productMapMutationSnapshot(mainRunAfterForeignCreate),
      "跨项目 documentId selected 失败后不得改变既有 Run",
    ).toEqual(productMapMutationSnapshot(mainRunBeforeForeignCreate));

    const mainRunBeforeForeignAttach = mainRunAfterForeignCreate;
    const foreignAttach = await managerPage.request.post(
      appPath(
        `/api/projects/${projectId}/workflows/${productMapCreated.run.id}/product-map/sources`,
      ),
      {
        data: { documentId: foreignSource.document.id },
        headers: mutationHeaders(),
      },
    );
    expect(foreignAttach.status()).toBe(404);
    const foreignAttachError = (await foreignAttach.json()) as {
      error?: { code?: string };
    };
    expect(foreignAttachError.error?.code).toBe(
      "PRODUCT_MAP_SOURCE_NOT_FOUND",
    );
    const mainRunAfterForeignAttach = await getProductMapDetail(
      managerPage,
      projectId,
      productMapCreated.run.id,
    );
    expect(
      productMapMutationSnapshot(mainRunAfterForeignAttach),
      "跨项目 documentId attach 失败后不得改变 Run、Source、Execution、Artifact 或版本",
    ).toEqual(
      productMapMutationSnapshot(mainRunBeforeForeignAttach),
    );
  } finally {
    await managerContext.close();
  }

  const cancelledStart = await page.request.post(productMapPath, {
    data: {
      selectedSourceIds: [],
      userInput: "仅用于验证取消状态的虚构输入。",
      idempotencyKey: randomUUID(),
    },
    headers: mutationHeaders(),
  });
  expect(cancelledStart.status()).toBe(201);
  const cancelledRun = await json<{ run: { id: string } }>(cancelledStart);
  await waitUntilProductMapStatus(
    page,
    projectId,
    cancelledRun.run.id,
    "needs_input",
  );
  await productMapModal
    .getByRole("button", { name: "关闭 Product Map", exact: true })
    .click();
  await expect(productMapModal).toHaveCount(0);
  await productMapQuickAction.click();
  await expect(productMapModal).toBeVisible();
  await productMapModal
    .getByTestId(`product-map-run-${cancelledRun.run.id}`)
    .click();
  await productMapModal
    .getByRole("button", { name: "取消运行", exact: true })
    .click();
  await waitUntilProductMapStatus(
    page,
    projectId,
    cancelledRun.run.id,
    "cancelled",
  );
  const cancelledDetail = await getProductMapDetail(
    page,
    projectId,
    cancelledRun.run.id,
  );
  expect(cancelledDetail.run.status).toBe("cancelled");
  expect(cancelledDetail.executions).toHaveLength(0);
  expect(cancelledDetail.artifacts).toHaveLength(0);
  const cancelledAfterReload = await (async () => {
    const cancellationReloadPage = await page.context().newPage();
    try {
      await cancellationReloadPage.goto(appPath("/data-spaces/projects"));
      await cancellationReloadPage.reload();
      return getProductMapDetail(
        cancellationReloadPage,
        projectId,
        cancelledRun.run.id,
      );
    } finally {
      await cancellationReloadPage.close();
    }
  })();
  expect(cancelledAfterReload.run.status).toBe("cancelled");
  expect(cancelledAfterReload.executions).toHaveLength(0);
  expect(cancelledAfterReload.artifacts).toHaveLength(0);
  const cancelledInRunList = await page.request.get(productMapPath);
  expect(cancelledInRunList.status()).toBe(200);
  const cancelledInRunListBody = await json<{
    workflows: Array<{ id: string; status: string }>;
  }>(cancelledInRunList);
  expect(
    cancelledInRunListBody.workflows.find(
      (workflow) => workflow.id === cancelledRun.run.id,
    )?.status,
  ).toBe("cancelled");
  await productMapModal
    .getByRole("button", { name: "关闭 Product Map", exact: true })
    .click();
  await productMapQuickAction.click();
  await expect(productMapModal).toBeVisible();
  await productMapModal
    .getByTestId(`product-map-run-${productMapCreated.run.id}`)
    .click();

  const productMapAttachmentName = `focused-product-map-${suffix}.txt`;
  const productMapAttachmentUploadPromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        appPath(`/api/projects/${projectId}/documents`),
  );
  const productMapAttachmentChooser = page.waitForEvent("filechooser");
  await productMapModal
    .getByRole("button", { name: "上传并附加", exact: true })
    .click();
  await (await productMapAttachmentChooser).setFiles(
    fictitiousText(
      productMapAttachmentName,
      "业务目标：提升项目经理梳理需求的效率。目标用户：项目经理。平台：Web。MVP需求：生成可审核产品结构。规则：正式发布必须人工审核。",
    ),
  );
  const productMapAttachmentUpload =
    await productMapAttachmentUploadPromise;
  expect(productMapAttachmentUpload.status()).toBe(201);
  const productMapAttachment =
    (await productMapAttachmentUpload.json()) as ProjectDocumentUploadResponse;
  await waitUntilAiReady(
    page,
    projectId,
    productMapAttachment.document.id,
  );
  await waitUntilProductMapStatus(
    page,
    projectId,
    productMapCreated.run.id,
    "reviewing",
  );
  let productMapReviewing = await getProductMapDetail(
    page,
    projectId,
    productMapCreated.run.id,
  );
  expect(productMapReviewing.run.status).toBe("reviewing");
  expect(
    productMapReviewing.sources.filter((source) => source.status !== "revoked"),
  ).toHaveLength(3);
  const productMapRunList = await page.request.get(productMapPath);
  expect(productMapRunList.status()).toBe(200);
  const productMapRunListBody = await json<{
    workflows: Array<{ id: string }>;
  }>(productMapRunList);
  expect(
    productMapRunListBody.workflows.filter(
      (workflow) => workflow.id === productMapCreated.run.id,
    ),
  ).toHaveLength(1);
  const savedProductMapAttachment = await listActiveProjectDocuments(
    page,
    projectId,
  );
  expect(
    savedProductMapAttachment.documents.some(
      (document) => document.id === productMapAttachment.document.id,
    ),
  ).toBe(true);
  const productMapArtifact = productMapReviewing.artifacts[0];
  expect(productMapArtifact).toBeTruthy();
  expect(productMapArtifact.content.analysisContract).toBeTruthy();
  expect(productMapArtifact.content.structureReview).toBeTruthy();
  expect(
    (
      productMapArtifact.content.stepOutputs as Array<{ stepId: string }>
    ).map((step) => step.stepId),
    "Product Map 产物必须按固定顺序保存八个 stepId",
  ).toEqual([...PRODUCT_MAP_STEP_IDS]);
  const executableProductMapStepIds = PRODUCT_MAP_STEP_IDS.filter(
    (stepId) => stepId !== "independent_review",
  );
  expect(
    productMapReviewing.executions,
    "模型与最终组装步骤必须各自留下一个且不重复的真实执行记录",
  ).toHaveLength(executableProductMapStepIds.length);
  expect(
    new Set(
      productMapReviewing.executions
        .filter((execution) => execution.status === "succeeded")
        .map((execution) => execution.stepId),
    ),
  ).toEqual(new Set(executableProductMapStepIds));
  expect(productMapReviewing.permissions.canReview).toBeTruthy();

  const documentsBeforeProductMapPublish = await listActiveProjectDocuments(
    page,
    projectId,
  );
  expect(
    documentsBeforeProductMapPublish.documents.some((document) =>
      document.displayName.includes("产品结构"),
    ),
  ).toBe(false);
  const preReviewPublish = await page.request.patch(
    appPath(
      `/api/projects/${projectId}/workflows/${productMapCreated.run.id}/artifacts/${productMapArtifact!.id}`,
    ),
    { data: { action: "publish" }, headers: mutationHeaders() },
  );
  expect(preReviewPublish.status()).toBe(409);
  const preReviewPublishError = await json<{
    error?: { code?: string };
  }>(preReviewPublish);
  expect(preReviewPublishError.error?.code).toBe(
    "PRODUCT_MAP_REVIEW_REQUIRED",
  );
  const documentsAfterRejectedProductMapPublish =
    await listActiveProjectDocuments(page, projectId);
  expect(
    documentsAfterRejectedProductMapPublish.documents
      .map((document) => document.id)
      .sort(),
    "审核前发布失败不得写入任何正式文档",
  ).toEqual(
    documentsBeforeProductMapPublish.documents
      .map((document) => document.id)
      .sort(),
  );
  const productMapAfterRejectedPublish = await getProductMapDetail(
    page,
    projectId,
    productMapCreated.run.id,
  );
  expect(productMapAfterRejectedPublish.run.status).toBe("reviewing");
  expect(productMapAfterRejectedPublish.artifacts[0]?.status).toBe("draft");
  expect(
    productMapAfterRejectedPublish.artifacts[0]?.publishedDocumentId ?? null,
  ).toBeNull();

  const productMapResult = productMapModal.getByTestId("product-map-result");
  await expect(productMapResult).toBeVisible();
  const goalSection = productMapResult
    .getByRole("heading", { name: "目标", exact: true })
    .locator("..");
  const primaryFlowSection = productMapResult
    .getByRole("heading", { name: "主流程", exact: true })
    .locator("..");
  const hierarchySection = productMapResult
    .getByRole("heading", { name: "产品功能层级", exact: true })
    .locator("..");
  const pageSection = productMapResult
    .getByRole("heading", { name: "页面", exact: true })
    .locator("..");
  const featureSection = productMapResult
    .getByRole("heading", { name: "功能", exact: true })
    .locator("..");
  const citationSection = productMapResult
    .getByRole("heading", { name: "引用", exact: true })
    .locator("..");
  await expect(goalSection).toContainText("G1");
  await expect(primaryFlowSection).toContainText("J1");
  await expect(hierarchySection).toContainText("M1");
  await expect(hierarchySection).toContainText("P1");
  await expect(hierarchySection).toContainText("F1");
  await expect(pageSection).toContainText("P1");
  await expect(featureSection).toContainText("F1");
  await expect(citationSection).toContainText(projectDisplayName);
  await expect(citationSection).toContainText(companyDisplayName);
  await expect(productMapResult.getByText(/异常路径（13\/13）/)).toBeVisible();
  await expect(productMapResult.getByText(/Structure Review/)).toBeVisible();
  const mermaidPreview = productMapResult
    .locator("details")
    .filter({ hasText: "Mermaid（文本预览）" });
  await mermaidPreview.locator("summary").click();
  await expect(mermaidPreview.locator("pre")).toContainText("flowchart TD");
  await evidence(page, "05-product-map-review.png");
  const [productMapDownload] = await Promise.all([
    page.waitForEvent("download"),
    productMapResult
      .getByRole("button", { name: "下载 Markdown", exact: true })
      .click(),
  ]);
  await verifyDownload(productMapDownload, ".md");

  const productMapEditor = productMapModal.getByLabel("Product Map 草稿编辑器");
  await productMapModal
    .getByText("编辑草稿 JSON（保存为新版本）", { exact: true })
    .click();
  await expect(productMapEditor).toBeVisible();
  const editedProductMap = JSON.parse(
    await productMapEditor.inputValue(),
  ) as EditableProductMap;
  editedProductMap.projectUnderstanding.oneLinePositioning.text = `${editedProductMap.projectUnderstanding.oneLinePositioning.text}（人工复核）`;
  await productMapEditor.fill(JSON.stringify(editedProductMap, null, 2));
  await productMapModal
    .getByRole("button", { name: "保存新版本", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        productMapReviewing = await getProductMapDetail(
          page,
          projectId,
          productMapCreated.run.id,
        );
        return `${productMapReviewing.artifacts[0]?.currentVersion}:${productMapReviewing.versions
          .map((version) => version.version)
          .sort()
          .join(",")}`;
      },
      { timeout: 30_000 },
    )
    .toBe("2:1,2");
  await expect(productMapResult.getByText(/v2.*当前/)).toBeVisible();

  await productMapModal
    .getByRole("button", { name: "审核通过", exact: true })
    .click();
  await waitUntilProductMapStatus(
    page,
    projectId,
    productMapCreated.run.id,
    "reviewing",
  );
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          appPath(
            `/api/projects/${projectId}/workflows/${productMapCreated.run.id}`,
          ),
        );
        if (!response.ok()) return "error";
        const body = await json<{ artifacts: Array<{ status: string }> }>(
          response,
        );
        return body.artifacts[0]?.status ?? "missing";
      },
      { timeout: 30_000 },
    )
    .toBe("reviewed");
  await productMapModal
    .getByRole("button", { name: "发布", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          appPath(
            `/api/projects/${projectId}/workflows/${productMapCreated.run.id}`,
          ),
        );
        if (!response.ok()) return "error";
        const body = await json<{
          run: { status: string };
          artifacts: Array<{
            status: string;
            publishedDocumentId?: string | null;
          }>;
        }>(response);
        return `${body.run.status}:${body.artifacts[0]?.status}:${body.artifacts[0]?.publishedDocumentId ? "document" : "none"}`;
      },
      { timeout: 30_000 },
    )
    .toBe("published:published:document");
  const documentsAfterProductMapPublish = await listActiveProjectDocuments(
    page,
    projectId,
  );
  const publishedProductMapDocument =
    documentsAfterProductMapPublish.documents.find((document) =>
      document.displayName.includes("产品结构"),
    );
  expect(publishedProductMapDocument).toBeTruthy();
  await waitUntilAiReady(page, projectId, publishedProductMapDocument!.id);

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  try {
    await loginByApi(viewerPage, "viewerA");
    const viewerDetailResponse = await viewerPage.request.get(
      appPath(
        `/api/projects/${projectId}/workflows/${productMapCreated.run.id}`,
      ),
    );
    expect(viewerDetailResponse.status()).toBe(200);
    const viewerDetail = await json<{
      permissions: {
        canEdit: boolean;
        canReview: boolean;
        canPublish: boolean;
      };
    }>(viewerDetailResponse);
    expect(viewerDetail.permissions).toEqual({
      canEdit: false,
      canReview: false,
      canPublish: false,
    });
    const viewerEditResponse = await viewerPage.request.patch(
      appPath(
        `/api/projects/${projectId}/workflows/${productMapCreated.run.id}/artifacts/${productMapArtifact!.id}`,
      ),
      {
        data: { action: "edit", expectedVersion: 2, content: editedProductMap },
        headers: mutationHeaders(),
      },
    );
    expect(viewerEditResponse.status()).toBe(403);

    await viewerPage.goto(
      appPath(`/assistant?project=${encodeURIComponent(projectId)}`),
    );
    await expect(
      viewerPage.getByRole("heading", {
        name: "项目 AI 助手",
        exact: true,
      }),
    ).toBeVisible();
    await viewerPage.getByTestId("quick-action-product-map").click();
    const viewerProductMapModal = viewerPage.getByTestId("product-map-modal");
    await expect(viewerProductMapModal).toBeVisible();
    const publishedRunButton = viewerProductMapModal.getByTestId(
      `product-map-run-${productMapCreated.run.id}`,
    );
    await expect(publishedRunButton).toBeVisible();
    await publishedRunButton.click();
    await expect(
      viewerProductMapModal.getByTestId("product-map-result"),
    ).toBeVisible();
    await viewerProductMapModal
      .getByText("编辑草稿 JSON（保存为新版本）", { exact: true })
      .click();
    await expect(
      viewerProductMapModal.getByText(
        "当前身份只能查看；编辑、审核和发布由授权项目成员完成。",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      viewerProductMapModal.getByLabel("Product Map 草稿编辑器"),
    ).toBeDisabled();
    await expect(
      viewerProductMapModal.getByRole("button", {
        name: "保存新版本",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      viewerProductMapModal.getByRole("button", {
        name: "审核通过",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      viewerProductMapModal.getByRole("button", {
        name: "发布",
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await viewerContext.close();
  }

  await productMapModal
    .getByRole("button", { name: "关闭 Product Map", exact: true })
    .click();
  await expect(productMapModal).toHaveCount(0);

  const limitedEvidenceStart = await page.request.post(productMapPath, {
    data: {
      selectedSourceIds: [],
      userInput: "仅有一条虚构项目背景说明。",
      idempotencyKey: randomUUID(),
    },
    headers: mutationHeaders(),
  });
  expect(limitedEvidenceStart.status()).toBe(201);
  const limitedEvidenceRun = await json<{ run: { id: string } }>(
    limitedEvidenceStart,
  );
  await waitUntilProductMapStatus(
    page,
    projectId,
    limitedEvidenceRun.run.id,
    "needs_input",
  );
  await navigateWithPendingFolderAllowances(
    "刷新项目助手恢复 limited-evidence Run",
    () => page.reload(),
  );
  await page.getByTestId("quick-action-product-map").click();
  const limitedEvidenceModal = page.getByTestId("product-map-modal");
  await expect(limitedEvidenceModal).toBeVisible();
  await limitedEvidenceModal
    .getByTestId(`product-map-run-${limitedEvidenceRun.run.id}`)
    .click();
  await expect(
    limitedEvidenceModal.getByRole("button", {
      name: "基于现有证据继续",
      exact: true,
    }),
  ).toBeVisible();
  await limitedEvidenceModal
    .getByRole("button", { name: "基于现有证据继续", exact: true })
    .click();
  const limitedEvidenceDetail = await waitUntilProductMapStatus(
    page,
    projectId,
    limitedEvidenceRun.run.id,
    "reviewing",
  );
  const limitedArtifact = limitedEvidenceDetail.artifacts[0]?.content as {
    completeness?: { limitedEvidence?: boolean };
    analysisContract?: {
      evidenceCoverage?: { inferred?: number; missing?: number };
      exceptionPaths?: Array<{
        evidenceStatus?: string;
        sourceRefs?: string[];
      }>;
    };
  };
  expect(limitedArtifact.completeness?.limitedEvidence).toBe(true);
  expect(
    limitedArtifact.analysisContract?.evidenceCoverage?.inferred ?? 0,
    `limited-evidence coverage=${JSON.stringify(limitedArtifact.analysisContract?.evidenceCoverage ?? null)}`,
  ).toBeGreaterThan(0);
  expect(
    limitedArtifact.analysisContract?.evidenceCoverage?.missing ?? 0,
  ).toBeGreaterThan(0);
  expect(
    limitedArtifact.analysisContract?.exceptionPaths?.some(
      (path) =>
        path.evidenceStatus === "MISSING" && path.sourceRefs?.length === 0,
    ),
  ).toBe(true);
  assertLimitedEvidenceContract(
    limitedEvidenceDetail.artifacts[0]!.content,
  );
  await expect(
    limitedEvidenceModal.getByTestId("product-map-result"),
  ).toBeVisible();
  await limitedEvidenceModal
    .getByRole("button", { name: "关闭 Product Map", exact: true })
    .click();

  const scannedProductMapUpload = await page.request.post(
    appPath(`/api/projects/${projectId}/documents`),
    {
      headers: {
        ...mutationHeaders(),
        "Idempotency-Key": randomUUID(),
      },
      multipart: {
        file: scannedPdf(`focused-product-map-needs-ocr-${suffix}.pdf`),
        displayName: `focused-product-map-needs-ocr-${suffix}`,
      },
    },
  );
  expect(scannedProductMapUpload.status()).toBe(201);
  const scannedProductMapDocument =
    await json<ProjectDocumentUploadResponse>(scannedProductMapUpload);
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          appPath(
            `/api/projects/${projectId}/documents/${scannedProductMapDocument.document.id}/versions`,
          ),
        );
        if (!response.ok()) return `http-${response.status()}`;
        const body = await json<ProjectDocumentVersionsResponse>(response);
        return body.versions.find((version) => version.isCurrent)?.ingestion
          .status;
      },
      { timeout: 60_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toBe("needs_ocr");

  const parseFailureStart = await page.request.post(productMapPath, {
    data: {
      selectedSourceIds: [scannedProductMapDocument.document.id],
      userInput:
        "业务目标：提升需求梳理效率。目标用户：项目经理。平台：Web。核心需求：形成可审核产品结构。规则：必须人工审核。",
      idempotencyKey: randomUUID(),
    },
    headers: mutationHeaders(),
  });
  expect(parseFailureStart.status()).toBe(201);
  const parseFailureRun = await json<{ run: { id: string } }>(
    parseFailureStart,
  );
  const parseFailureDetail = await waitUntilProductMapStatus(
    page,
    projectId,
    parseFailureRun.run.id,
    "failed",
  );
  expect(parseFailureDetail.run.failureCode).toBe(
    "PRODUCT_MAP_SOURCE_PARSE_FAILED",
  );
  expect(parseFailureDetail.executions).toHaveLength(0);
  await productMapQuickAction.click();
  const parseFailureModal = page.getByTestId("product-map-modal");
  await expect(parseFailureModal).toBeVisible();
  await parseFailureModal
    .getByTestId(`product-map-run-${parseFailureRun.run.id}`)
    .click();
  await expect(
    parseFailureModal.getByRole("button", { name: "重试", exact: true }),
  ).toBeVisible();
  await parseFailureModal
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await waitUntilProductMapStatus(
    page,
    projectId,
    parseFailureRun.run.id,
    "failed",
  );
  await parseFailureModal
    .getByRole("button", {
      name: `项目 · ${projectDisplayName}`,
      exact: true,
    })
    .click();
  const recoveredParseFailure = await waitUntilProductMapStatus(
    page,
    projectId,
    parseFailureRun.run.id,
    "reviewing",
  );
  expect(
    recoveredParseFailure.sources.find(
      (source) => source.documentId === scannedProductMapDocument.document.id,
    )?.status,
  ).toBe("revoked");
  expect(
    recoveredParseFailure.sources.some(
      (source) =>
        source.documentId === projectDocument!.id && source.status === "ready",
    ),
  ).toBe(true);
  const parseFailureRunList = await page.request.get(productMapPath);
  expect(parseFailureRunList.status()).toBe(200);
  const parseFailureRunListBody = await json<{
    workflows: Array<{ id: string }>;
  }>(parseFailureRunList);
  expect(
    parseFailureRunListBody.workflows.filter(
      (workflow) => workflow.id === parseFailureRun.run.id,
    ),
  ).toHaveLength(1);
  await parseFailureModal
    .getByRole("button", { name: "关闭 Product Map", exact: true })
    .click();

  const unknownStart = await page.request.post(productMapPath, {
    data: {
      selectedSourceIds: [projectDocument!.id],
      userInput:
        "FAKE_TIMEOUT 业务目标：提升需求梳理效率。目标用户：项目经理。平台：Web。核心需求：形成可审核产品结构。规则：必须人工审核。",
      idempotencyKey: randomUUID(),
    },
    headers: mutationHeaders(),
  });
  expect(unknownStart.status()).toBe(201);
  const unknownRun = await json<{ run: { id: string } }>(unknownStart);
  await waitUntilProductMapStatus(
    page,
    projectId,
    unknownRun.run.id,
    "unknown",
  );
  await productMapQuickAction.click();
  const unknownModal = page.getByTestId("product-map-modal");
  await expect(unknownModal).toBeVisible();
  await unknownModal
    .getByTestId(`product-map-run-${unknownRun.run.id}`)
    .click();
  await expect(
    unknownModal.getByText(/模型响应状态未知/),
  ).toBeVisible();
  await unknownModal
    .getByRole("button", { name: "重试", exact: true })
    .click();
  await waitUntilProductMapStatus(
    page,
    projectId,
    unknownRun.run.id,
    "unknown",
  );
  await unknownModal
    .getByRole("button", { name: "关闭 Product Map", exact: true })
    .click();

  runtimeMonitor.allowAbortedRequestOnce(
    appPath(`/api/company-knowledge/${uploadedCompany.documentId}`),
  );
  runtimeMonitor.allowAbortedRequestOnce(
    appPath(`/api/company-knowledge/${uploadedCompany.documentId}`),
  );
  runtimeMonitor.allowAbortedRequestOnce(
    appPath(`/api/company-knowledge/${uploadedCompany.documentId}`),
  );
  runtimeMonitor.allowAbortedRequestOnce(
    appPath(`/api/company-knowledge/${uploadedCompany.documentId}`),
  );
  await navigateWithPendingFolderAllowances(
    "恢复需求概览前返回项目助手",
    () =>
      page.goto(
        appPath(`/assistant?project=${encodeURIComponent(projectId)}`),
      ),
  );
  await expect(
    page.getByRole("heading", { name: "项目 AI 助手", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "生成需求概览", exact: true }),
  ).toBeEnabled();
  await evidence(page, "04-session-empty.png");
  await page.getByRole("button", { name: "生成需求概览", exact: true }).click();
  await page
    .getByTestId("requirement-overview-empty")
    .getByRole("button", { name: "开始需求概览", exact: true })
    .click();
  const overview = page.getByTestId("requirement-overview-workspace");
  await expect(
    overview.getByText("需求概览 v1", { exact: true }),
  ).toBeVisible();
  const overviewAnswers = overview.locator("textarea");
  await overviewAnswers.nth(0).fill("2026 年 10 月 15 日内部上线。");
  await overviewAnswers.nth(1).fill("微信小程序。");
  await overviewAnswers
    .nth(2)
    .fill("弥知负责研发与交付，客户负责业务确认，CRM 由三方提供。");
  await overviewAnswers.nth(3).fill("微信小程序由弥知主体发布。");
  await overviewAnswers
    .nth(4)
    .fill("仅处理完成会员注册所必需的数据，并在上线前确认隐私政策。");
  await overviewAnswers.nth(5).fill("可行，需要研发资源和 CRM 三方接口联调。");
  await overviewAnswers.nth(6).fill("会员注册和 CRM 同步。");
  await overview.getByRole("button", { name: "保存确认", exact: true }).click();
  await expect(
    overview.getByRole("button", { name: "生成需求概览", exact: true }),
  ).toBeEnabled();
  await overview
    .getByRole("button", { name: "生成需求概览", exact: true })
    .click();
  const generationDialog = page.getByRole("dialog", { name: "生成需求概览" });
  await expect(generationDialog).toBeVisible();
  await generationDialog
    .getByRole("button", { name: "生成一个候选", exact: true })
    .click();
  await expect(overview.getByText("可选择", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const firstSelection = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.includes("/comparisons/") &&
      new URL(response.url()).pathname.endsWith("/select"),
  );
  await overview
    .getByRole("button", { name: "选择此候选并形成草稿", exact: true })
    .click();
  expect((await firstSelection).status(), "首次候选必须能形成独立草稿").toBe(
    200,
  );
  await expect(overview.getByText("可编辑草稿", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const overviewPreview = overview.getByLabel("Markdown 草稿");
  await expect(overviewPreview).toHaveValue(/\|项目地区\|中国/);
  await expect(overviewPreview).toHaveValue(/\|平台类型\|微信小程序/);
  await expect(overviewPreview).toHaveValue(
    /\|7\|MVP需求\|会员注册和 CRM 同步/,
  );
  await expect(overviewPreview).toHaveValue(/\|适配类型\|AI 推断（待确认）：/);
  await expect(overviewPreview).not.toHaveValue(/目标与成功标准/);
  await expect(overviewPreview).not.toHaveValue(/用户与关键场景/);
  await overviewPreview.fill(
    `${await overviewPreview.inputValue()}\n\n项目经理复核：第一版。`,
  );
  await overview
    .getByRole("button", { name: "另存为新版本", exact: true })
    .click();
  await expect(
    overview.getByText("已保存为正式版本", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  const documentsAfterFirstOverviewSave = await listActiveProjectDocuments(
    page,
    projectId,
  );
  const savedOverviewDocument =
    documentsAfterFirstOverviewSave.documents.find(
      (document) => document.displayName === `${projectName} 需求概览`,
    );
  expect(savedOverviewDocument).toBeTruthy();
  await waitUntilAiReady(page, projectId, savedOverviewDocument!.id);
  await overview.getByRole("button", { name: "重新生成", exact: true }).click();
  const regeneratedDialog = page.getByRole("dialog", { name: "生成需求概览" });
  await regeneratedDialog
    .getByRole("button", { name: "生成一个候选", exact: true })
    .click();
  await expect(overview.getByText("可选择", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const secondSelection = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname.includes("/comparisons/") &&
      new URL(response.url()).pathname.endsWith("/select"),
  );
  await overview
    .getByRole("button", { name: "选择此候选并形成草稿", exact: true })
    .click();
  expect(
    (await secondSelection).status(),
    "再次生成不得被历史正式版本阻塞",
  ).toBe(200);
  await expect(overview.getByText("需求概览 v2", { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await overview
    .getByRole("button", { name: "另存为新版本", exact: true })
    .click();
  await expect(
    overview.getByText("已保存为正式版本", { exact: true }),
  ).toBeVisible({ timeout: 60_000 });
  await evidence(page, "06-requirement-success-local-fake.png");
  const overviewDownload = overview.getByRole("link", {
    name: "下载 Markdown",
    exact: true,
  });
  const overviewHref = await overviewDownload.getAttribute("href");
  expect(overviewHref).toBeTruthy();
  runtimeMonitor.allowAbortedRequestOnce(
    new URL(overviewHref!, page.url()).pathname,
  );
  const [overviewFile] = await Promise.all([
    page.waitForEvent("download"),
    overviewDownload.click(),
  ]);
  await verifyDownload(overviewFile, ".md");
  await expect(
    overview.getByText("已保存为正式版本", { exact: true }),
  ).toBeVisible();

  await navigateWithPendingFolderAllowances(
    "正式文档保存后返回项目助手",
    () =>
      page.goto(
        appPath(`/assistant?project=${encodeURIComponent(projectId)}`),
      ),
  );
  await page
    .getByTestId("assistant-composer-input")
    .fill("项目资料中 2026 年 10 月 15 日的内部上线事实是什么？");
  await page.getByTestId("assistant-send-button").click();
  await expect(
    page.locator('[data-message-role="assistant"]').last(),
  ).toContainText("2026 年 10 月 15 日", { timeout: 45_000 });
  await expect(
    page.locator('[data-message-role="assistant"]').last(),
  ).toContainText("[项目资料]");
  await evidence(page, "08-ai-conversation.png");

  await page
    .getByTestId("assistant-composer-input")
    .fill("公司项目管理规范中的需求文档发布确认要求是什么？");
  await page.getByTestId("assistant-send-button").click();
  await expect(
    page.locator('[data-message-role="assistant"]').last(),
  ).toContainText("[公司资料]", { timeout: 45_000 });

  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  try {
    await loginByApi(outsiderPage, "outsider");
    const outsiderResponse = await outsiderPage.request.get(
      appPath(`/api/projects/${projectId}`),
    );
    expect(outsiderResponse.status()).toBe(404);
    const outsiderRunResponse = await outsiderPage.request.get(
      appPath(
        `/api/projects/${projectId}/workflows/${productMapCreated.run.id}`,
      ),
    );
    expect(outsiderRunResponse.status()).toBe(404);
    const outsiderArtifactResponse = await outsiderPage.request.patch(
      appPath(
        `/api/projects/${projectId}/workflows/${productMapCreated.run.id}/artifacts/${productMapArtifact!.id}`,
      ),
      { data: { action: "publish" }, headers: mutationHeaders() },
    );
    expect(outsiderArtifactResponse.status()).toBe(404);
  } finally {
    await outsiderContext.close();
  }

  await page.setViewportSize({ width: 375, height: 812 });
  await navigateWithPendingFolderAllowances(
    "切到移动端项目列表",
    () => page.goto(appPath("/data-spaces/projects")),
  );
  await page.getByRole("button", { name: "打开导航", exact: true }).click();
  const mobileNavigation = page.getByRole("navigation");
  await settleAnimations(mobileNavigation);
  await expect(
    mobileNavigation.getByRole("link", { name: "项目资料", exact: true }),
  ).toBeVisible();
  await expectNoPageOverflow(page);
  await evidence(page, "12-mobile-navigation-375.png");
  expect(
    consumedFolderAllowances.every(
      ({ requestUrl }) =>
        new URL(requestUrl, page.url()).pathname === projectFoldersPath,
    ),
    "只有当前项目精确 folders 请求的真实 ERR_ABORTED 可以被豁免",
  ).toBe(true);
});
