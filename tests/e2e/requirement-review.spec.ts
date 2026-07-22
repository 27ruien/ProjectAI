import { randomUUID } from "node:crypto";
import type { APIResponse, Page } from "@playwright/test";
import type {
  ProjectDocumentUploadResponse,
  ProjectDocumentVersionsResponse,
} from "@/types/documents";
import { expect, test } from "./fixtures";
import { appPath } from "./support/app-url";
import { fictitiousText } from "./support/file-fixtures";

const projectId = "project-001";

function appOrigin(): string {
  const configured = process.env.PLAYWRIGHT_BASE_URL?.trim();
  const port = Number(process.env.PLAYWRIGHT_PORT ?? 3200);
  return new URL(configured || `http://127.0.0.1:${port}`).origin;
}

async function responseJson<T>(response: APIResponse): Promise<T> {
  return (await response.json()) as T;
}

async function uploadIndexedRequirementSource(page: Page, displayName: string) {
  const response = await page.request.post(
    appPath(`/api/projects/${projectId}/documents`),
    {
      headers: {
        origin: appOrigin(),
        "Idempotency-Key": randomUUID(),
      },
      multipart: {
        file: fictitiousText(
          "虚构-第一阶段需求依据.txt",
          "[TEST] 项目必须在虚构上线日期前完成验收，并由项目经理确认验收记录。",
        ),
        displayName,
      },
    },
  );
  expect(response.status()).toBe(201);
  const uploaded = await responseJson<ProjectDocumentUploadResponse>(response);

  await expect
    .poll(
      async () => {
        const versions = await page.request.get(
          appPath(
            `/api/projects/${projectId}/documents/${uploaded.document.id}/versions`,
          ),
        );
        expect(versions.status()).toBe(200);
        const payload = await responseJson<ProjectDocumentVersionsResponse>(
          versions,
        );
        return payload.versions.find(
          (version) => version.id === uploaded.version.id,
        )?.ingestion.status;
      },
      { timeout: 45_000, intervals: [250, 500, 1_000, 2_000] },
    )
    .toBe("succeeded");
}

test("真实需求提取经人工编辑审核后才写入正式需求", async ({ page }) => {
  test.setTimeout(90_000);
  const marker = Date.now();
  const displayName = `[TEST] 需求审核来源 ${marker}`;
  const acceptedTitle = `[TEST] 经人工审核的需求 ${marker}`;
  await uploadIndexedRequirementSource(page, displayName);

  await page.goto(appPath(`/projects/${projectId}/requirements`));
  await page.waitForLoadState("networkidle");
  await expect(
    page.getByRole("heading", { name: "需求提取与审核" }),
  ).toBeVisible();

  await page
    .locator("label")
    .filter({ hasText: displayName })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "生成草稿" }).click();
  await expect(page.getByRole("status")).toContainText("已生成 1 条草稿", {
    timeout: 20_000,
  });

  const draft = page.locator("article").filter({ hasText: displayName }).first();
  await expect(draft).toBeVisible();
  await draft.locator('input:not([type="checkbox"])').fill(acceptedTitle);
  await draft
    .locator("textarea")
    .fill("[TEST] 已由项目经理核对来源并补充可验收描述。");
  await draft.getByRole("button", { name: "接受" }).click();

  await expect(page.getByRole("status")).toContainText(
    "草稿已人工确认并生成正式需求",
  );
  await expect(page.getByText(acceptedTitle, { exact: true })).toBeVisible();
});
