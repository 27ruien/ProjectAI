import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { appPath } from "../e2e/support/app-url";

type Identity = "super-admin" | "admin" | "member";
type Space = {
  id: string;
  name: string;
  projectId: string | null;
  projectContextId: string | null;
  accessLevel: "view" | "edit";
};

const origin = "https://gridworks.cn";
const evidenceDir = path.resolve("test-results/product-v2-staging/evidence");
const memberProjectId = "kivisense-project-product-management-uat";

async function login(page: Page, identity: Identity) {
  const response = await page.request.post(appPath("/api/auth/sign-in/mock-wecom"), {
    data: { identity },
    headers: { origin },
  });
  expect(response.status(), `${identity} Mock WeCom login`).toBe(200);
  const body = await response.json() as Record<string, unknown>;
  expect(body).toEqual({ authenticated: true });
}

async function switchIdentity(page: Page, identity: Identity) {
  await page.context().clearCookies();
  await login(page, identity);
}

async function mutation(page: Page, pathname: string, method: "post" | "put" | "patch" | "delete", data: unknown) {
  return page.request[method](appPath(pathname), { data, headers: { origin } });
}

async function spaces(page: Page): Promise<Space[]> {
  const response = await page.request.get(appPath("/api/knowledge-spaces"));
  expect(response.status()).toBe(200);
  return (await response.json() as { knowledgeSpaces: Space[] }).knowledgeSpaces;
}

function observe(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return () => {
    expect(consoleErrors, "browser console errors").toEqual([]);
    expect(pageErrors, "uncaught page errors").toEqual([]);
  };
}

async function capture(page: Page, name: string) {
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true });
}

async function createDepartmentThroughUi(page: Page, input: {
  name: string;
  code: string;
  parentName?: string;
  headName?: string;
}) {
  await page.getByRole("button", { name: "新建部门" }).click();
  const dialog = page.getByRole("dialog", { name: "新建部门" });
  await dialog.getByLabel("部门名称").fill(input.name);
  await dialog.getByLabel("部门编码").fill(input.code);
  if (input.parentName) await selectOptionContaining(dialog.getByLabel("上级部门"), input.parentName);
  if (input.headName) await dialog.getByText(input.headName, { exact: true }).click();
  await dialog.getByRole("button", { name: "保存" }).click();
  return dialog;
}

async function selectOptionContaining(select: ReturnType<Page["getByLabel"]>, text: string) {
  const value = await select.locator("option").filter({ hasText: text }).getAttribute("value");
  expect(value, `option containing ${text}`).toBeTruthy();
  await select.selectOption(value!);
}

async function createProjectThroughUi(page: Page, input: { name: string; departmentName: string }) {
  await page.getByRole("button", { name: "新建项目空间" }).click();
  const dialog = page.getByRole("dialog", { name: "新建项目空间" });
  await dialog.getByLabel("所属部门").selectOption({ label: input.departmentName });
  await dialog.getByLabel("空间名称").fill(input.name);
  await dialog.getByLabel("说明").fill("仅包含虚构数据的 Product V2 Staging UI 验收空间。");
  await dialog.getByRole("button", { name: "创建" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: new RegExp(input.name) })).toBeVisible();
}

async function chooseSpace(page: Page, name: string) {
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

async function setMemberPermissionThroughUi(page: Page, input: { spaceName: string; access: "查看" | "编辑" }) {
  await chooseSpace(page, input.spaceName);
  await page.getByRole("button", { name: "管理空间成员" }).click();
  const dialog = page.getByRole("dialog", { name: new RegExp(`空间成员 · ${input.spaceName}`) });
  await dialog.getByLabel("组织成员").selectOption({ label: "Kivisense Member" });
  await dialog.getByLabel("空间权限").selectOption({ label: input.access });
  await dialog.getByRole("button", { name: "邀请/更新" }).click();
  await expect(dialog.getByText("Kivisense Member", { exact: false })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭" }).last().click();
  await expect(dialog).toBeHidden();
}

test("@auth @navigation Mock WeCom roles and debug admin stay inside the reviewed boundary", async ({ page }) => {
  const assertNoErrors = observe(page);
  await page.goto(appPath("/login"));
  await expect(page.getByRole("heading", { name: "企业微信测试登录" })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  for (const label of ["Kivisense Super Admin", "Kivisense Admin", "Kivisense Member"]) {
    await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
  }
  const legacy = await page.request.post(appPath("/api/auth/sign-in/email"), { data: {}, headers: { origin } });
  expect(legacy.status()).toBe(404);

  await page.getByRole("button", { name: /Kivisense Super Admin/ }).click();
  await expect(page).toHaveURL(/\/daily-report$/u);
  for (const label of ["工作日报", "AI 工作流", "知识库", "组织架构"]) {
    await expect(page.getByRole("link", { name: label })).toBeVisible();
  }
  for (const label of ["工作台", "审核中心", "Skills", "数据看板"]) {
    await expect(page.getByRole("link", { name: label })).toHaveCount(0);
  }
  const session = await (await page.request.get(appPath("/api/auth/get-session"))).json() as Record<string, unknown>;
  expect(JSON.stringify(session)).not.toMatch(/token/iu);

  await page.context().clearCookies();
  await page.goto(`${appPath("/")}?debug=admin`);
  await expect(page).toHaveURL(/\/daily-report$/u);
  await page.getByRole("button", { name: "账户菜单" }).click();
  await expect(page.getByText("Kivisense Admin", { exact: true }).first()).toBeVisible();
  await capture(page, "01-debug-admin-navigation.png");

  await switchIdentity(page, "member");
  await page.goto(appPath("/daily-report"));
  await expect(page.getByRole("link", { name: "组织架构" })).toHaveCount(0);
  expect((await page.request.get(appPath("/api/organization/departments"))).status()).toBe(404);
  assertNoErrors();
});

test("@organization four-level hierarchy is created, edited, moved, and rejected through the UI", async ({ page }) => {
  const assertNoErrors = observe(page);
  await login(page, "super-admin");
  await page.goto(appPath("/organization"));
  await expect(page.getByRole("heading", { name: "组织架构" })).toBeVisible();
  const marker = crypto.randomUUID().slice(0, 8).toUpperCase();
  const names = [1, 2, 3, 4].map((level) => `UAT 层级 ${marker}-${level}`);
  const createdIds: string[] = [];
  try {
    for (let index = 0; index < names.length; index += 1) {
      const dialog = await createDepartmentThroughUi(page, {
        name: names[index],
        code: `UAT-${marker}-${index + 1}`,
        parentName: index ? names[index - 1] : undefined,
        headName: index === 0 ? "Kivisense Super Admin" : undefined,
      });
      await expect(dialog).toBeHidden();
      await expect(page.getByText(names[index], { exact: true })).toBeVisible();
    }

    const treeResponse = await page.request.get(appPath("/api/organization/departments"));
    const tree = await treeResponse.json() as { departments: Array<{ id: string; name: string }> };
    createdIds.push(...names.map((name) => tree.departments.find((item) => item.name === name)!.id));

    const depthDialog = await createDepartmentThroughUi(page, {
      name: `UAT 层级 ${marker}-5`,
      code: `UAT-${marker}-5`,
      parentName: names[3],
    });
    await expect(depthDialog.getByRole("alert")).toContainText("部门最多支持四级");
    await depthDialog.getByRole("button", { name: "取消" }).click();

    await page.getByRole("button", { name: `编辑 ${names[0]}` }).click();
    let editDialog = page.getByRole("dialog", { name: "编辑部门" });
    await selectOptionContaining(editDialog.getByLabel("上级部门"), names[3]);
    await editDialog.getByRole("button", { name: "保存" }).click();
    await expect(editDialog.getByRole("alert")).toContainText("部门不能移动到自身或子部门下");
    await editDialog.getByRole("button", { name: "取消" }).click();

    await page.getByRole("button", { name: `编辑 ${names[3]}` }).click();
    editDialog = page.getByRole("dialog", { name: "编辑部门" });
    await editDialog.getByLabel("部门名称").fill(`${names[3]} 已重命名`);
    await selectOptionContaining(editDialog.getByLabel("上级部门"), names[1]);
    await editDialog.getByRole("button", { name: "保存" }).click();
    await expect(editDialog).toBeHidden();
    await expect(page.getByText(`${names[3]} 已重命名`, { exact: true })).toBeVisible();
    await capture(page, "02-organization-ui-lifecycle.png");
  } finally {
    if (!createdIds.length) {
      const response = await page.request.get(appPath("/api/organization/departments"));
      if (response.ok()) {
        const body = await response.json() as { departments: Array<{ id: string; name: string }> };
        createdIds.push(...body.departments.filter((item) => item.name.includes(marker)).map((item) => item.id));
      }
    }
    for (const departmentId of [...createdIds].reverse()) {
      const response = await mutation(page, "/api/organization/departments", "patch", { departmentId, status: "inactive" });
      expect(response.status(), `cleanup department ${departmentId}`).toBe(200);
    }
  }
  assertNoErrors();
});

test("@knowledge @knowledge-permissions project creation, sharing, upload, preview, and revoke use the UI", async ({ page }) => {
  const assertNoErrors = observe(page);
  await login(page, "admin");
  const marker = crypto.randomUUID().slice(0, 8);
  const projectName = `Product V2 ACL UAT ${marker}`;
  const displayName = `权限验收-${marker}.txt`;

  await page.goto(appPath("/knowledge"));
  await createProjectThroughUi(page, { name: projectName, departmentName: "产品管理部" });
  await setMemberPermissionThroughUi(page, { spaceName: projectName, access: "查看" });
  const target = (await spaces(page)).find((space) => space.name === projectName && space.projectId);
  expect(target).toBeTruthy();

  await switchIdentity(page, "member");
  await page.goto(`${appPath("/knowledge")}?projectId=${encodeURIComponent(target!.projectId!)}`);
  await expect(page.getByText(projectName, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "上传", exact: true })).toBeDisabled();

  await switchIdentity(page, "admin");
  await page.goto(`${appPath("/knowledge")}?projectId=${encodeURIComponent(target!.projectId!)}`);
  await setMemberPermissionThroughUi(page, { spaceName: projectName, access: "编辑" });

  await switchIdentity(page, "member");
  await page.goto(`${appPath("/knowledge")}?projectId=${encodeURIComponent(target!.projectId!)}`);
  await expect(page.getByRole("button", { name: "上传", exact: true })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({
    name: displayName,
    mimeType: "text/plain",
    buffer: Buffer.from(`虚构权限验收文件 ${marker}，不包含客户信息。`),
  });
  await expect(page.getByRole("status")).toContainText("文件已安全上传");
  await expect(page.getByText(displayName, { exact: true })).toBeVisible();
  await page.getByText(displayName, { exact: true }).click();
  const preview = page.getByRole("dialog", { name: new RegExp(`文件详情 · ${displayName}`) });
  await expect(preview).toContainText(displayName);
  await expect(preview.getByRole("button", { name: "下载并打开" })).toBeEnabled();
  await capture(page, "03-knowledge-ui-upload-preview.png");
  await preview.getByRole("button", { name: "关闭" }).last().click();

  const documentResponse = await page.request.get(appPath(`/api/projects/${target!.projectId}/documents?status=active`));
  const documents = await documentResponse.json() as { documents: Array<{ id: string; displayName: string }> };
  const uploaded = documents.documents.find((item) => item.displayName === displayName);
  expect(uploaded).toBeTruthy();

  await switchIdentity(page, "admin");
  await page.goto(`${appPath("/knowledge")}?projectId=${encodeURIComponent(target!.projectId!)}`);
  await chooseSpace(page, projectName);
  await page.getByRole("button", { name: "管理空间成员" }).click();
  const members = page.getByRole("dialog", { name: new RegExp(`空间成员 · ${projectName}`) });
  await members.getByRole("button", { name: "移除 Kivisense Member" }).click();
  await expect(members.getByRole("button", { name: "移除 Kivisense Member" })).toHaveCount(0);
  await members.getByRole("button", { name: "关闭" }).last().click();

  await switchIdentity(page, "member");
  expect((await spaces(page)).some((space) => space.id === target!.id)).toBe(false);
  expect((await page.request.get(appPath(`/api/projects/${target!.projectId}`))).status()).toBe(404);

  await switchIdentity(page, "admin");
  expect((await mutation(page, `/api/projects/${target!.projectId}/documents/${uploaded!.id}/archive`, "post", {})).status()).toBe(200);
  assertNoErrors();
});

test("@ai-retrieval-permissions real AI only cites an authorized, UI-uploaded fictional file", async ({ page }) => {
  const assertNoErrors = observe(page);
  await login(page, "member");
  const target = (await spaces(page)).find((space) => space.projectId === memberProjectId);
  expect(target).toBeTruthy();
  const marker = crypto.randomUUID().slice(0, 8);
  const displayName = `Product V2 AI UAT ${marker}.txt`;
  await page.goto(`${appPath("/knowledge")}?projectId=${memberProjectId}`);
  await chooseSpace(page, target!.name);
  await page.locator('input[type="file"]').setInputFiles({
    name: displayName,
    mimeType: "text/plain",
    buffer: Buffer.from(`虚构验收事实：计划代号 ${marker} 的发布窗口是 2037 年 11 月 18 日。`),
  });
  await expect(page.getByRole("status")).toContainText("文件已安全上传");
  await expect(page.getByText(displayName, { exact: true })).toBeVisible();
  await page.getByText(displayName, { exact: true }).click();
  const preview = page.getByRole("dialog", { name: new RegExp(displayName) });
  await expect(preview).toContainText(/已建立|处理中/u, { timeout: 120_000 });
  await preview.getByRole("button", { name: "关闭" }).last().click();

  let uploadedId = "";
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const documentsResponse = await page.request.get(appPath(`/api/projects/${memberProjectId}/documents?status=active`));
    const documents = await documentsResponse.json() as { documents: Array<{ id: string; displayName: string; currentVersion?: { ingestion?: { status?: string } } }> };
    const uploaded = documents.documents.find((item) => item.displayName === displayName);
    uploadedId = uploaded?.id ?? "";
    if (uploaded?.currentVersion?.ingestion?.status === "succeeded") break;
    await page.waitForTimeout(500);
  }
  expect(uploadedId, "UI-uploaded document id").toBeTruthy();

  await expect(page.getByTestId("project-ai-assistant")).toBeVisible();
  await page.getByPlaceholder("向当前项目资料提问…").fill(`计划代号 ${marker} 的发布窗口是什么时候？`);
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.locator('[data-message-role="assistant"]').last()).toContainText("2037", { timeout: 120_000 });
  await expect(page.getByTestId("assistant-citations").last()).toContainText(displayName);
  await capture(page, "04-real-ai-authorized-citation.png");

  expect((await mutation(page, `/api/projects/${memberProjectId}/documents/${uploadedId}/archive`, "post", {})).status()).toBe(200);
  assertNoErrors();
});

test("@ai-workflow Requirement Extraction uploads, generates, reviews, and saves through the UI", async ({ page }) => {
  const assertNoErrors = observe(page);
  await login(page, "member");
  const marker = crypto.randomUUID().slice(0, 8);
  const sourceName = `需求提取-${marker}.txt`;
  const savedProjectName = `需求结果空间 ${marker}`;
  await page.goto(appPath("/workflows"));
  await expect(page.getByRole("heading", { name: "AI 工作流" })).toBeVisible();
  await page.getByPlaceholder("搜索工作流或业务场景").fill("需求");
  await page.getByRole("button", { name: /^运行/u }).first().click();
  await expect(page.getByRole("heading", { name: /需求提取/u })).toBeVisible();

  const generate = page.getByRole("button", { name: "生成待审核草稿" });
  await expect(generate).toBeDisabled();
  await page.locator('input[type="file"]').setInputFiles({
    name: sourceName,
    mimeType: "text/plain",
    buffer: Buffer.from(`虚构需求：为内部项目 ${marker} 增加审批提醒。项目经理可以设置截止日期；到期前 24 小时提醒负责人；验收标准是提醒只发送一次并记录审计。`),
  });
  await expect(page.getByRole("status")).toContainText("临时附件已解析完成", { timeout: 120_000 });
  await expect(generate).toBeEnabled();
  const extractionResponse = page.waitForResponse((response) =>
    response.url().includes("/requirement-extractions") && response.request().method() === "POST",
  );
  await generate.click();
  expect((await extractionResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "当前页面审核" })).toBeVisible({ timeout: 120_000 });
  const firstTitle = page.getByLabel("需求标题").first();
  await firstTitle.fill(`${await firstTitle.inputValue()}（UAT 已复核）`);
  await capture(page, "05-requirement-ui-review.png");
  await page.getByRole("button", { name: "整批批准" }).click();
  const saveDialog = page.getByRole("dialog", { name: "保存到知识库" });
  await expect(saveDialog).toBeVisible();
  await saveDialog.getByRole("button", { name: "新建项目空间并保存" }).click();
  await saveDialog.getByLabel("新项目空间名称").fill(savedProjectName);
  await expect(saveDialog.getByLabel(/保存审核后的结果/u)).toBeChecked();
  await expect(saveDialog.getByLabel(/保存原始附件/u)).toBeChecked();
  await saveDialog.getByRole("button", { name: "确认" }).click();
  await expect(saveDialog).toBeHidden({ timeout: 120_000 });
  await expect(page.getByRole("status")).toContainText("已按选择保存到知识库");

  await page.goto(appPath("/knowledge"));
  await chooseSpace(page, savedProjectName);
  await expect(page.getByText(sourceName, { exact: true })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/需求提取审核结果/u).first()).toBeVisible({ timeout: 120_000 });
  await capture(page, "06-requirement-saved-knowledge.png");
  assertNoErrors();
});

test("@daily-report @global-search retained daily report and keyboard search remain usable", async ({ page }) => {
  const assertNoErrors = observe(page);
  await login(page, "member");
  await page.goto(appPath("/daily-report"));
  await expect(page.getByRole("heading", { name: "工作日报" })).toBeVisible();
  await expect(page.getByTestId("work-log-section")).toBeVisible();
  await expect(page.getByText("今日随记", { exact: false })).toBeVisible();
  await expect(page.getByText("日报草稿", { exact: false })).toBeVisible();
  await page.keyboard.press("ControlOrMeta+K");
  const search = page.getByPlaceholder("搜索已授权知识空间");
  await expect(search).toBeFocused();
  await search.fill("Product Management UAT");
  await expect(page.getByRole("dialog", { name: "全局搜索" })).toContainText("Product Management UAT");
  await search.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/knowledge\\?projectId=${memberProjectId}$`, "u"));
  await expect(page.getByText("Product Management UAT", { exact: true }).first()).toBeVisible();
  await capture(page, "07-global-search-result.png");
  assertNoErrors();
});
