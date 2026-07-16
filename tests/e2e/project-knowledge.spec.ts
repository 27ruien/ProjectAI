import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import type { APIResponse, Page } from "@playwright/test";
import type {
  ProjectDocumentListResponse,
  ProjectDocumentUploadResponse,
  ProjectDocumentVersionsResponse,
  ProjectDocumentVersionDto,
  PublicDocumentIngestionStatus,
} from "@/types/documents";
import type { KnowledgeSearchResponse } from "@/types/knowledge-search";
import { expect, test } from "./fixtures";
import { loginByApi } from "./support/auth";
import { appPath } from "./support/app-url";
import {
  corruptPdf,
  fictitiousText,
  scannedPdf,
  searchableDocx,
  searchablePdf,
  searchablePptx,
  searchableXlsx,
  type InMemoryFileFixture,
} from "./support/file-fixtures";

const projectA = "project-001";
const projectB = "project-002";

const fixtures = {
  pdf: {
    displayName: "虚构 Aurora PDF 范围",
    file: searchablePdf(
      "虚构-Aurora-范围.pdf",
      "Project Aurora PDF launch date October 15 and budget USD 100000",
    ),
  },
  docx: {
    displayName: "虚构 Aurora DOCX 纪要",
    file: searchableDocx(
      "虚构-Aurora-纪要.docx",
      "Project Aurora DOCX launch date October 15 owner Example Manager",
    ),
  },
  xlsx: {
    displayName: "虚构 Aurora XLSX 预算",
    file: searchableXlsx(
      "虚构-Aurora-预算.xlsx",
      "Project Aurora XLSX launch October 15 budget 100000",
    ),
  },
  pptx: {
    displayName: "虚构 Aurora PPTX 里程碑",
    file: searchablePptx(
      "虚构-Aurora-里程碑.pptx",
      "Project Aurora PPTX launch October 15 milestone",
    ),
  },
  txt: {
    displayName: "虚构灯塔 TXT 计划",
    file: fictitiousText(
      "虚构-灯塔计划.txt",
      "虚构灯塔计划 发布日期 十月十五日 中文检索验证",
    ),
  },
  markdown: {
    displayName: "虚构 Aurora Markdown 决策",
    file: {
      name: "虚构-Aurora-决策.md",
      mimeType: "text/markdown",
      buffer: Buffer.from(
        "# Decision\n\nProject Aurora Markdown approval date October 15.\n",
        "utf8",
      ),
    },
  },
  scan: {
    displayName: "虚构扫描 PDF",
    file: scannedPdf("虚构-扫描件.pdf"),
  },
  corrupt: {
    displayName: "虚构损坏 PDF",
    file: corruptPdf("虚构-损坏文件.pdf"),
  },
} satisfies Record<
  string,
  { displayName: string; file: InMemoryFileFixture }
>;

type Uploaded = {
  documentId: string;
  versionId: string;
  version: ProjectDocumentVersionDto;
};

const uploaded = new Map<keyof typeof fixtures, Uploaded>();

test.use({ trace: "off", video: "off" });

function appOrigin(): string {
  const configured = process.env.PLAYWRIGHT_BASE_URL?.trim();
  const port = Number(process.env.PLAYWRIGHT_PORT ?? 3200);
  return new URL(configured || `http://127.0.0.1:${port}`).origin;
}

function mutationHeaders() {
  return { origin: appOrigin() };
}

async function json<T>(response: APIResponse): Promise<T> {
  return (await response.json()) as T;
}

async function reviewScreenshot(page: Page, name: string) {
  if (process.env.PLAYWRIGHT_REVIEW_ARTIFACTS !== "1") return;
  await mkdir("review-artifacts/screenshots", { recursive: true });
  await page.screenshot({
    path: `review-artifacts/screenshots/${name}`,
    fullPage: false,
    animations: "disabled",
  });
}

async function upload(
  page: Page,
  fixture: InMemoryFileFixture,
  displayName: string,
  documentId?: string,
): Promise<ProjectDocumentUploadResponse> {
  const suffix = documentId ? `/${documentId}/versions` : "";
  const response = await page.request.post(
    appPath(`/api/projects/${projectA}/documents${suffix}`),
    {
      headers: {
        ...mutationHeaders(),
        "Idempotency-Key": randomUUID(),
      },
      multipart: { file: fixture, displayName },
    },
  );
  expect(response.status()).toBe(201);
  return json<ProjectDocumentUploadResponse>(response);
}

async function documents(page: Page, status: "active" | "archived" = "active") {
  const response = await page.request.get(
    appPath(`/api/projects/${projectA}/documents?status=${status}`),
  );
  expect(response.status()).toBe(200);
  return json<ProjectDocumentListResponse>(response);
}

async function versions(page: Page, documentId: string) {
  const response = await page.request.get(
    appPath(`/api/projects/${projectA}/documents/${documentId}/versions`),
  );
  expect(response.status()).toBe(200);
  return json<ProjectDocumentVersionsResponse>(response);
}

async function waitForIngestion(
  page: Page,
  documentId: string,
  versionId: string,
  expectedStatus: PublicDocumentIngestionStatus,
): Promise<ProjectDocumentVersionDto> {
  let current: ProjectDocumentVersionDto | undefined;
  await expect
    .poll(
      async () => {
        const result = await versions(page, documentId);
        current = result.versions.find((version) => version.id === versionId);
        return current?.ingestion.status;
      },
      { timeout: 45_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toBe(expectedStatus);
  return current!;
}

async function archiveAllActiveDocuments(page: Page) {
  const active = await documents(page);
  for (const document of active.documents) {
    if (!document.permissions.canArchive) continue;
    const response = await page.request.post(
      appPath(`/api/projects/${projectA}/documents/${document.id}/archive`),
      { headers: mutationHeaders(), data: {} },
    );
    expect(response.status()).toBe(200);
  }
}

async function searchApi(
  page: Page,
  query: string,
  documentIds: string[] = [],
) {
  const response = await page.request.post(
    appPath(`/api/projects/${projectA}/knowledge/search`),
    {
      headers: mutationHeaders(),
      data: { query, documentIds, limit: 20 },
    },
  );
  expect(response.status()).toBe(200);
  return json<KnowledgeSearchResponse>(response);
}

async function searchInUi(
  page: Page,
  query: string,
  documentId: string,
  displayName: string,
) {
  await page.getByLabel("按资料筛选").selectOption(documentId);
  await page.getByLabel("搜索项目知识").fill(query);
  await page.getByRole("button", { name: "搜索", exact: true }).click();
  const result = page.getByRole("article").filter({ hasText: displayName });
  await expect(result.first()).toBeVisible();
  return result.first();
}

test.describe.serial("文档处理与真实项目知识索引", () => {
  test("上传六种格式并展示 Pending、Succeeded、Failed 和 needs_ocr", async ({
    page,
  }) => {
    await archiveAllActiveDocuments(page);

    const entries = Object.entries(fixtures) as Array<
      [keyof typeof fixtures, (typeof fixtures)[keyof typeof fixtures]]
    >;
    const responses = await Promise.all(
      entries.map(([, fixture]) =>
        upload(page, fixture.file, fixture.displayName),
      ),
    );
    responses.forEach((response, index) => {
      const [key] = entries[index]!;
      uploaded.set(key, {
        documentId: response.document.id,
        versionId: response.version.id,
        version: response.version,
      });
    });

    await page.goto(appPath(`/projects/${projectA}/documents`));
    await expect(
      page.getByText(/等待解析|正在解析/).first(),
    ).toBeVisible();
    await reviewScreenshot(page, "document-processing-pending.png");

    for (const key of [
      "pdf",
      "docx",
      "xlsx",
      "pptx",
      "txt",
      "markdown",
    ] as const) {
      const resource = uploaded.get(key)!;
      resource.version = await waitForIngestion(
        page,
        resource.documentId,
        resource.versionId,
        "succeeded",
      );
      expect(resource.version.ingestion.sectionCount).toBeGreaterThan(0);
      expect(resource.version.ingestion.chunkCount).toBeGreaterThan(0);
    }
    const scan = uploaded.get("scan")!;
    scan.version = await waitForIngestion(
      page,
      scan.documentId,
      scan.versionId,
      "needs_ocr",
    );
    const corrupt = uploaded.get("corrupt")!;
    corrupt.version = await waitForIngestion(
      page,
      corrupt.documentId,
      corrupt.versionId,
      "failed",
    );

    await page.reload();
    await expect(page.getByText("知识索引已建立").first()).toBeVisible();
    await reviewScreenshot(page, "document-processing-succeeded.png");
    await expect(page.getByText("解析失败", { exact: true })).toBeVisible();
    await reviewScreenshot(page, "document-processing-failed.png");
    await expect(page.getByText("该 PDF 需要 OCR", { exact: true })).toBeVisible();
    await reviewScreenshot(page, "document-needs-ocr.png");
  });

  test("按 PDF、DOCX、XLSX、PPTX 来源定位并验证中英文与模糊检索", async ({
    page,
  }) => {
    await page.goto(appPath(`/projects/${projectA}/knowledge`));
    await expect(
      page.getByRole("heading", { name: "项目知识搜索", exact: true }),
    ).toBeVisible();

    const pdf = uploaded.get("pdf")!;
    const pdfResult = await searchInUi(
      page,
      "PDF launch date",
      pdf.documentId,
      fixtures.pdf.displayName,
    );
    await expect(pdfResult).toContainText("第 1 页");
    await reviewScreenshot(page, "knowledge-search-results.png");
    await reviewScreenshot(page, "knowledge-search-pdf-citation.png");

    const docx = uploaded.get("docx")!;
    const docxResult = await searchInUi(
      page,
      "DOCX launch date",
      docx.documentId,
      fixtures.docx.displayName,
    );
    await expect(docxResult).toContainText("Timeline");
    await expect(docxResult).toContainText(/段落 2/);
    await reviewScreenshot(page, "knowledge-search-docx-citation.png");

    const xlsx = uploaded.get("xlsx")!;
    const xlsxResult = await searchInUi(
      page,
      "XLSX launch",
      xlsx.documentId,
      fixtures.xlsx.displayName,
    );
    await expect(xlsxResult).toContainText("Budget");
    await expect(xlsxResult).toContainText(/行 1/);
    await reviewScreenshot(page, "knowledge-search-xlsx-citation.png");

    const pptx = uploaded.get("pptx")!;
    const pptxResult = await searchInUi(
      page,
      "PPTX launch",
      pptx.documentId,
      fixtures.pptx.displayName,
    );
    await expect(pptxResult).toContainText("第 1 张幻灯片");
    await reviewScreenshot(page, "knowledge-search-pptx-citation.png");

    const chinese = await searchApi(
      page,
      "发布日期",
      [uploaded.get("txt")!.documentId],
    );
    expect(chinese.results[0]?.excerpt).toContain("虚构灯塔计划");

    const fuzzy = await searchApi(
      page,
      "Octobr",
      [uploaded.get("markdown")!.documentId],
    );
    expect(fuzzy.results.length).toBeGreaterThan(0);
  });

  test("新当前版本、归档过滤和重新解析只激活正确 Generation", async ({
    page,
  }) => {
    const pdf = uploaded.get("pdf")!;
    const second = await upload(
      page,
      searchablePdf(
        "虚构-Aurora-范围-v2.pdf",
        "Project Aurora revised PDF launch date November 20",
      ),
      fixtures.pdf.displayName,
      pdf.documentId,
    );
    const secondVersion = await waitForIngestion(
      page,
      pdf.documentId,
      second.version.id,
      "succeeded",
    );
    expect(secondVersion.versionNumber).toBe(2);
    expect(
      (await searchApi(page, "October 15", [pdf.documentId])).results,
    ).toHaveLength(0);
    const currentResults = await searchApi(page, "November 20", [pdf.documentId]);
    expect(currentResults.results[0]?.versionNumber).toBe(2);

    const docx = uploaded.get("docx")!;
    const archived = await page.request.post(
      appPath(`/api/projects/${projectA}/documents/${docx.documentId}/archive`),
      { headers: mutationHeaders(), data: {} },
    );
    expect(archived.status()).toBe(200);
    expect(
      (await searchApi(page, "DOCX launch", [docx.documentId])).results,
    ).toHaveLength(0);

    const xlsx = uploaded.get("xlsx")!;
    const generation = xlsx.version.ingestion.generation ?? 0;
    const reindex = await page.request.post(
      appPath(
        `/api/projects/${projectA}/documents/${xlsx.documentId}/versions/${xlsx.versionId}/reindex`,
      ),
      { headers: mutationHeaders(), data: {} },
    );
    expect(reindex.status()).toBe(202);
    const reindexed = await waitForIngestion(
      page,
      xlsx.documentId,
      xlsx.versionId,
      "succeeded",
    );
    expect(reindexed.ingestion.generation).toBeGreaterThan(generation);
    expect(
      (await searchApi(page, "XLSX launch", [xlsx.documentId])).results.length,
    ).toBeGreaterThan(0);
  });

  test("Viewer 可检索下载但不能重新解析，跨项目搜索统一返回 404", async ({
    page,
  }) => {
    await loginByApi(page, "viewerA");
    await page.goto(appPath(`/projects/${projectA}/knowledge`));
    const pptx = uploaded.get("pptx")!;
    const result = await searchInUi(
      page,
      "PPTX launch",
      pptx.documentId,
      fixtures.pptx.displayName,
    );
    await expect(result.getByRole("button", { name: "下载原文件" })).toBeVisible();
    await expect(page.getByText("尚未启用 AI 综合回答")).toBeVisible();
    await reviewScreenshot(page, "viewer-knowledge-search.png");

    const forbidden = await page.request.post(
      appPath(
        `/api/projects/${projectA}/documents/${pptx.documentId}/versions/${pptx.versionId}/reindex`,
      ),
      { headers: mutationHeaders(), data: {} },
    );
    expect(forbidden.status()).toBe(403);

    await loginByApi(page, "managerA");
    const foreign = await page.request.post(
      appPath(`/api/projects/${projectB}/knowledge/search`),
      {
        headers: mutationHeaders(),
        data: { query: "Project Aurora", limit: 10 },
      },
    );
    expect(foreign.status()).toBe(404);
  });
});
