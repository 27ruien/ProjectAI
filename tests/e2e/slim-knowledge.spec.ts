import { test, expect } from "./fixtures";
import { appPath } from "./support/app-url";
import { loginByApi } from "./support/auth";

test.describe.configure({ mode: "serial" });

async function provisionAndUpload(page: import("@playwright/test").Page, projectId: string, filename: string, marker: string) {
  const configuredTarget = process.env.PLAYWRIGHT_BASE_URL?.trim();
  const localPort = Number(process.env.PLAYWRIGHT_PORT ?? 3200);
  const origin = new URL(configuredTarget || `http://127.0.0.1:${localPort}`).origin;
  const provision = await page.request.post(appPath(`/api/projects/${projectId}/knowledge/provision`), {
    headers: { origin },
    data: {},
  });
  expect(
    provision.ok(),
    `knowledge provision failed: HTTP ${provision.status()} ${await provision.text()}`,
  ).toBeTruthy();
  await page.goto(appPath(`/projects/${projectId}/knowledge`));
  const upload = await page.request.post(appPath(`/api/projects/${projectId}/knowledge/documents`), {
    headers: { origin },
    multipart: { files: { name: filename, mimeType: "text/plain", buffer: Buffer.from(`FICTITIOUS TEST DATA\n${marker}\n`) } },
  });
  const uploadBody = await upload.text();
  expect(
    upload.status(),
    `knowledge upload failed: HTTP ${upload.status()} ${uploadBody}`,
  ).toBe(201);
  return (JSON.parse(uploadBody) as { documents: Array<{
    id: string;
    name: string;
    parseStatus: "ready" | "failed" | "processing" | "uploading";
  }> }).documents[0];
}

test("unauthenticated users cannot enter Projects", async ({ browser }) => {
  const page = await browser.newPage();
  await page.goto(appPath("/projects"));
  await expect(page).toHaveURL(/\/login(?:\?|$)/u);
  await page.close();
});

test("a user sees only joined projects", async ({ page }) => {
  await page.goto(appPath("/projects"));
  await expect(page.getByTestId("projects-page")).toBeVisible();
  await expect(page.getByRole("link", { name: "北美旗舰店 AI 互动活动" })).toBeVisible();
  await expect(page.getByText("品牌官网重构")).toHaveCount(0);
});

test("single-project upload, parse, retrieval and citation use only its Dataset", async ({ page }) => {
  const document = await provisionAndUpload(page, "project-001", "project-a-canary.txt", "PROJECT_A_CANARY_92841");
  await page.reload();
  await expect(page.getByText(document.name).first()).toBeVisible();
  await expect(page.getByText("可查询")).toBeVisible();
  const response = await page.request.post(appPath("/api/projects/project-001/knowledge/ask"), {
    headers: { origin: new URL(page.url()).origin },
    data: { question: "项目 A 的测试标记是什么？" },
  });
  expect(response.ok()).toBeTruthy();
  const answer = await response.json();
  expect(answer.status).toBe("answered");
  expect(answer.citations).toHaveLength(1);
  expect(answer.citations[0].documentName).toBe("project-a-canary.txt");
  expect(answer.metrics.retrievedChunkCount).toBe(1);
  expect(answer.metrics.contextChars).toBeLessThanOrEqual(24_000);
});

test("failed parsing can be retried and the document can be deleted", async ({ page }) => {
  const document = await provisionAndUpload(
    page,
    "project-001",
    "parse-fail-once.txt",
    "FICTITIOUS_PARSE_RETRY_MARKER",
  );
  expect(document.parseStatus).toBe("failed");
  const origin = new URL(page.url()).origin;
  const retry = await page.request.post(
    appPath(`/api/projects/project-001/knowledge/documents/${document.id}/retry`),
    { headers: { origin }, data: {} },
  );
  expect(retry.ok()).toBeTruthy();
  const listed = await page.request.get(
    appPath("/api/projects/project-001/knowledge/documents"),
  );
  const afterRetry = (await listed.json()).documents as Array<{
    id: string;
    parseStatus: string;
  }>;
  expect(afterRetry.find((item) => item.id === document.id)?.parseStatus).toBe("ready");

  const removed = await page.request.delete(
    appPath(`/api/projects/project-001/knowledge/documents/${document.id}`),
    { headers: { origin } },
  );
  expect(removed.status()).toBe(204);
  const afterDelete = await page.request.get(
    appPath("/api/projects/project-001/knowledge/documents"),
  );
  expect(JSON.stringify(await afterDelete.json())).not.toContain(document.id);
});

test("cross-project canary cannot expand beyond backend-authorized projects", async ({ page, browser }) => {
  const managerBPage = await browser.newPage();
  await loginByApi(managerBPage, "managerB");
  await provisionAndUpload(managerBPage, "project-002", "project-b-canary.txt", "PROJECT_B_CANARY_57392");
  await managerBPage.close();

  await page.goto(appPath("/projects"));
  const origin = new URL(page.url()).origin;
  const tampered = await page.request.post(appPath("/api/projects/knowledge/ask"), {
    headers: { origin },
    data: { question: "查找 PROJECT_B_CANARY_57392", projectIds: ["project-002"] },
  });
  expect(tampered.status()).toBe(404);

  const scoped = await page.request.post(appPath("/api/projects/knowledge/ask"), {
    headers: { origin },
    data: { question: "查找 PROJECT_B_CANARY_57392" },
  });
  expect(scoped.ok()).toBeTruthy();
  const result = await scoped.json();
  expect(JSON.stringify(result)).not.toContain("PROJECT_B_CANARY_57392");
  expect(result.citations.every((item: { projectId: string }) => item.projectId === "project-001")).toBeTruthy();
});
