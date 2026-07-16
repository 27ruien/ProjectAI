import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { APIResponse, Locator, Page } from "@playwright/test";
import type {
  ProjectDocumentListResponse,
  ProjectDocumentUploadResponse,
  ProjectDocumentVersionsResponse,
} from "@/types/documents";
import { expect, test } from "./fixtures";
import {
  fictitiousOoxml,
  fictitiousPdf,
  fictitiousText,
  fixtureSha256,
  type InMemoryFileFixture,
} from "./support/file-fixtures";
import { loginByApi } from "./support/auth";
import { appPath } from "./support/app-url";

const projectA = { id: "project-001", name: "北美旗舰店 AI 互动活动" };
const projectB = { id: "project-002", name: "品牌官网重构" };
const logicalDocumentName = "虚构项目启动说明";
const versionOne = fictitiousPdf("虚构-项目启动说明-v1.pdf", 1);
const versionTwo = fictitiousPdf("虚构-项目启动说明-v2.pdf", 2);
const viewerForbiddenFile = fictitiousOoxml(
  "docx",
  "虚构-Viewer-禁止上传.docx",
);
const forgedPdf = fictitiousText("虚构-伪造文件.pdf", "NOT A PDF SIGNATURE");

let projectADocumentId = "";
let projectAVersionOneId = "";
let projectAVersionTwoId = "";

test.use({ trace: "off", video: "off" });

function appOrigin(): string {
  const configured = process.env.PLAYWRIGHT_BASE_URL?.trim();
  const port = Number(process.env.PLAYWRIGHT_PORT ?? 3200);
  return new URL(configured || `http://127.0.0.1:${port}`).origin;
}

function mutationHeaders() {
  return { origin: appOrigin() };
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

async function responseJson<T>(response: APIResponse): Promise<T> {
  return (await response.json()) as T;
}

async function listDocuments(
  page: Page,
  projectId: string,
  status: "active" | "archived" = "active",
) {
  const response = await page.request.get(
    appPath(`/api/projects/${projectId}/documents?status=${status}`),
  );
  expect(response.status()).toBe(200);
  return responseJson<ProjectDocumentListResponse>(response);
}

async function listVersions(page: Page, projectId: string, documentId: string) {
  const response = await page.request.get(
    appPath(`/api/projects/${projectId}/documents/${documentId}/versions`),
  );
  expect(response.status()).toBe(200);
  return responseJson<ProjectDocumentVersionsResponse>(response);
}

async function uploadByApi(
  page: Page,
  projectId: string,
  fixture: InMemoryFileFixture,
  options: { documentId?: string; displayName?: string } = {},
) {
  const suffix = options.documentId
    ? `/${options.documentId}/versions`
    : "";
  const response = await page.request.post(
    appPath(`/api/projects/${projectId}/documents${suffix}`),
    {
      headers: {
        ...mutationHeaders(),
        "Idempotency-Key": randomUUID(),
      },
      multipart: {
        file: fixture,
        ...(options.displayName ? { displayName: options.displayName } : {}),
      },
    },
  );
  return response;
}

async function archiveAllActiveDocuments(page: Page, projectId: string) {
  const { documents } = await listDocuments(page, projectId);
  for (const document of documents) {
    if (!document.permissions.canArchive) continue;
    const response = await page.request.post(
      appPath(`/api/projects/${projectId}/documents/${document.id}/archive`),
      { headers: mutationHeaders(), data: {} },
    );
    expect(response.status()).toBe(200);
  }
}

async function expectDownloadedHash(
  page: Page,
  trigger: Locator,
  expectedSha256: string,
) {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "projectai-download-"));
  const destination = path.join(temporaryDirectory, "downloaded-file.bin");
  try {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      trigger.click(),
    ]);
    expect(await download.failure()).toBeNull();
    await download.saveAs(destination);
    const downloaded = await readFile(destination);
    expect(fixtureSha256({
      name: "downloaded-file.bin",
      mimeType: "application/octet-stream",
      buffer: downloaded,
    })).toBe(expectedSha256);
    await download.delete();
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function chooseUploadFile(
  page: Page,
  dialogName: "上传项目资料" | "上传新版本",
  fixture: InMemoryFileFixture,
) {
  const dialog = page.getByRole("dialog", { name: dialogName });
  await dialog.getByLabel("选择上传文件").setInputFiles(fixture);
  return dialog;
}

test.describe.serial("真实项目资料与文件版本", () => {
  test("Manager 上传、刷新、下载校验并创建 v2", async ({ page }) => {
    await archiveAllActiveDocuments(page, projectA.id);
    await page.goto(appPath(`/projects/${projectA.id}/documents`));

    await expect(page.getByRole("heading", { name: "项目资料", exact: true })).toBeVisible();
    await expect(page.getByText("文件已真实存储；")).toBeVisible();
    await expect(page.getByText("暂无项目资料", { exact: true })).toBeVisible();
    await reviewScreenshot(page, "documents-empty.png");

    await page.getByRole("button", { name: "上传资料", exact: true }).click();
    let dialog = await chooseUploadFile(page, "上传项目资料", versionOne);
    await dialog.getByLabel("资料名称").fill(logicalDocumentName);
    await expect(dialog.getByText(versionOne.name, { exact: true })).toBeVisible();
    await reviewScreenshot(page, "documents-upload-dialog.png");
    await dialog.getByRole("button", { name: "开始上传", exact: true }).click();
    await expect(dialog.getByText("项目资料上传成功", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();

    await expect(page.getByText(logicalDocumentName, { exact: true })).toBeVisible();
    await expect(page.getByText("v1", { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText(logicalDocumentName, { exact: true })).toBeVisible();
    await expectDownloadedHash(
      page,
      page.getByRole("button", { name: `下载 ${logicalDocumentName}` }),
      fixtureSha256(versionOne),
    );
    await reviewScreenshot(page, "documents-uploaded.png");

    await page.getByRole("button", { name: `为 ${logicalDocumentName} 上传新版本` }).click();
    dialog = await chooseUploadFile(page, "上传新版本", versionTwo);
    await dialog.getByRole("button", { name: "上传新版本", exact: true }).click();
    await expect(dialog.getByText("新版本上传成功", { exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();

    await page.getByRole("button", { name: `查看 ${logicalDocumentName} 的版本历史` }).click();
    const versionsDialog = page.getByRole("dialog", { name: "版本历史" });
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "关闭抽屉" })).toHaveCount(1);
    await expect(versionsDialog.getByText("版本 2", { exact: true })).toBeVisible();
    await expect(versionsDialog.getByText("版本 1", { exact: true })).toBeVisible();
    await expect(versionsDialog.getByText("当前版本", { exact: true })).toHaveCount(1);
    await reviewScreenshot(page, "document-version-history.png");

    const active = await listDocuments(page, projectA.id);
    const document = active.documents.find(
      (candidate) => candidate.displayName === logicalDocumentName,
    );
    expect(document, "Manager 上传的资料应持久化到项目 A").toBeTruthy();
    projectADocumentId = document?.id ?? "";
    const versions = await listVersions(page, projectA.id, projectADocumentId);
    const first = versions.versions.find((version) => version.versionNumber === 1);
    const second = versions.versions.find((version) => version.versionNumber === 2);
    expect(first?.isCurrent).toBe(false);
    expect(second?.isCurrent).toBe(true);
    projectAVersionOneId = first?.id ?? "";
    projectAVersionTwoId = second?.id ?? "";
    expect(projectAVersionOneId).not.toBe("");
    expect(projectAVersionTwoId).not.toBe("");
  });

  test("Viewer 可以查看下载但没有写权限，直接上传返回 403", async ({ page }) => {
    await loginByApi(page, "viewerA");
    await page.goto(appPath(`/projects/${projectA.id}/documents`));

    await expect(page.getByText(logicalDocumentName, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "上传资料", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `为 ${logicalDocumentName} 上传新版本` })).toHaveCount(0);
    await expect(page.getByRole("button", { name: `归档 ${logicalDocumentName}` })).toHaveCount(0);
    await expect(page.getByText(/你拥有查看和下载权限/)).toBeVisible();
    await expectDownloadedHash(
      page,
      page.getByRole("button", { name: `下载 ${logicalDocumentName}` }),
      fixtureSha256(versionTwo),
    );
    await page.getByRole("button", { name: `查看 ${logicalDocumentName} 的版本历史` }).click();
    const versionsDialog = page.getByRole("dialog", { name: "版本历史" });
    await expect(versionsDialog.getByText("版本 1", { exact: true })).toBeVisible();
    await expect(versionsDialog.getByRole("button", { name: "设为当前", exact: true })).toHaveCount(0);
    await expect(versionsDialog.getByRole("button", { name: "上传新版本", exact: true })).toHaveCount(0);
    await versionsDialog.getByRole("button", { name: "关闭", exact: true }).last().click();
    await reviewScreenshot(page, "viewer-documents-readonly.png");

    const response = await uploadByApi(
      page,
      projectA.id,
      viewerForbiddenFile,
      { displayName: "虚构 Viewer 禁止上传" },
    );
    expect(response.status()).toBe(403);
    const body = await responseJson<{ error?: { code?: string } }>(response);
    expect(body.error?.code).toBe("FORBIDDEN");
  });

  test("跨项目 documentId、versionId 和下载地址统一返回 404", async ({ page }) => {
    await loginByApi(page, "managerB");
    const uploaded = await uploadByApi(
      page,
      projectB.id,
      fictitiousPdf("虚构-项目B-隔离验证.pdf", 1),
      { displayName: "虚构项目 B 隔离验证" },
    );
    expect(uploaded.status()).toBe(201);
    const projectBUpload = await responseJson<ProjectDocumentUploadResponse>(uploaded);

    await loginByApi(page, "managerA");
    const projectBResource = await page.request.get(
      appPath(`/api/projects/${projectB.id}/documents/${projectBUpload.document.id}`),
    );
    expect(projectBResource.status()).toBe(404);

    const projectBVersions = await page.request.get(
      appPath(`/api/projects/${projectB.id}/documents/${projectBUpload.document.id}/versions`),
    );
    expect(projectBVersions.status()).toBe(404);

    const projectBDownload = await page.request.get(
      appPath(`/api/projects/${projectB.id}/documents/${projectBUpload.document.id}/versions/${projectBUpload.version.id}/download`),
    );
    expect(projectBDownload.status()).toBe(404);

    const foreignDocumentInProjectA = await page.request.get(
      appPath(`/api/projects/${projectA.id}/documents/${projectBUpload.document.id}`),
    );
    expect(foreignDocumentInProjectA.status()).toBe(404);

    const foreignVersionInProjectA = await page.request.get(
      appPath(`/api/projects/${projectA.id}/documents/${projectADocumentId}/versions/${projectBUpload.version.id}/download`),
    );
    expect(foreignVersionInProjectA.status()).toBe(404);
  });

  test("扩展名伪造 PDF 被拒绝且没有 stored 版本", async ({ page, runtimeMonitor }) => {
    const before = await listDocuments(page, projectA.id);
    const beforeVersions = await listVersions(page, projectA.id, projectADocumentId);

    await page.goto(appPath(`/projects/${projectA.id}/documents`));
    await page.getByRole("button", { name: "上传资料", exact: true }).click();
    const dialog = await chooseUploadFile(page, "上传项目资料", {
      ...forgedPdf,
      mimeType: "application/pdf",
    });
    await dialog.getByLabel("资料名称").fill("虚构伪造文件");
    runtimeMonitor.allowConsoleErrorOnce({
      message: "Failed to load resource: the server responded with a status of 415 (Unsupported Media Type)",
      pathname: appPath(`/api/projects/${projectA.id}/documents`),
    });
    await dialog.getByRole("button", { name: "开始上传", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "文件内容与扩展名不匹配，请选择正确的文件。",
    );
    await reviewScreenshot(page, "document-upload-rejected.png");

    const after = await listDocuments(page, projectA.id);
    const afterVersions = await listVersions(page, projectA.id, projectADocumentId);
    expect(after.documents.map((document) => document.id).sort()).toEqual(
      before.documents.map((document) => document.id).sort(),
    );
    expect(after.documents.some((document) => document.displayName === "虚构伪造文件")).toBe(false);
    expect(afterVersions.versions).toHaveLength(beforeVersions.versions.length);
    expect(
      afterVersions.versions.some(
        (version) =>
          version.originalFilename === forgedPdf.name &&
          version.storageStatus === "stored",
      ),
    ).toBe(false);
  });
});
