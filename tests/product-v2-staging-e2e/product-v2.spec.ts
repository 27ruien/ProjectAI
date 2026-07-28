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

const origin = new URL(
  process.env.PLAYWRIGHT_BASE_URL ??
    "https://gridworks.cn/tool/projectai-staging",
).origin;
const evidenceDir = path.resolve("test-results/product-v2-staging/evidence");
const memberProjectId = "kivisense-project-projectai-product";
const fixtureRunId = `uat-product-v2-${crypto.randomUUID()}`;
const fixtureExpiresAt = new Date(
  Date.now() + 6 * 60 * 60 * 1_000,
).toISOString();

async function login(page: Page, identity: Identity) {
  const response = await page.request.post(appPath("/api/auth/sign-in/mock-wecom"), {
    data: { identity },
    headers: { origin },
  });
  expect(response.status(), `${identity} Mock WeCom login`).toBe(200);
  const body = await response.json() as Record<string, unknown>;
  expect(body).toEqual({ authenticated: true });
}

const syntheticProjectName =
  /^(?:Member Creator UAT [a-f0-9]{8}(?: 已更新)?|Product V2 ACL UAT [a-f0-9]{8}|需求结果空间 [a-f0-9]{8})$/iu;

test.afterEach(async ({ page }) => {
  await switchIdentity(page, "super-admin");
  const response = await page.request.get(appPath("/api/projects"));
  expect(response.status(), "fixture cleanup project list").toBe(200);
  const body = (await response.json()) as {
    projects: Array<{ id: string; name: string }>;
  };
  for (const project of body.projects.filter((item) =>
    syntheticProjectName.test(item.name),
  )) {
    const fixtureHeaders = {
      origin,
      "x-projectai-fixture-run-id": fixtureRunId,
      "x-projectai-fixture-expires-at": fixtureExpiresAt,
    };
    const registered = await page.request.post(
      appPath("/api/test-fixtures/projects"),
      {
        data: { projectId: project.id },
        headers: fixtureHeaders,
      },
    );
    expect(registered.status(), `register fixture ${project.id}`).toBe(200);
    const deleted = await page.request.delete(
      appPath("/api/test-fixtures/projects"),
      {
        data: { projectId: project.id },
        headers: fixtureHeaders,
      },
    );
    expect(deleted.status(), `delete fixture ${project.id}`).toBe(200);
  }
});

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
    const unexpectedConsoleErrors = consoleErrors.filter((message) =>
      !/^Failed to load resource: the server responded with a status of (?:401 \(Unauthorized\)|404 \(Not Found\)|409 \(Conflict\))$/u.test(message),
    );
    expect(unexpectedConsoleErrors, "browser console errors").toEqual([]);
    expect(pageErrors, "uncaught page errors").toEqual([]);
  };
}

async function capture(page: Page, name: string) {
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important}" });
  await page.screenshot({ path: path.join(evidenceDir, name), fullPage: true });
}

async function gotoInteractive(page: Page, url: string) {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
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

function timesheetTaskCards(page: Page) {
  return page.locator("article").filter({ has: page.getByText(/^任务 \d+ ·/u) });
}

async function createTimesheetNote(page: Page, note: string) {
  const section = page.getByTestId("work-log-section");
  await section.getByRole("textbox", { name: "随记内容（必填）" }).fill(note);
  await section
    .getByRole("combobox", { name: "项目（可选）" })
    .selectOption(memberProjectId);
  const response = page.waitForResponse(
    (candidate) =>
      candidate.url().endsWith(appPath("/api/timesheets/work-logs")) &&
      candidate.request().method() === "POST",
  );
  await section.getByRole("button", { name: "保存随记" }).click();
  expect((await response).status()).toBe(201);
  await expect(section.getByText(note, { exact: true })).toBeVisible();
}

async function editTimesheetNote(page: Page, current: string, updated: string) {
  const section = page.getByTestId("work-log-section");
  const row = section.locator("article").filter({ hasText: current });
  await row.getByRole("button", { name: "编辑" }).click();
  await row.getByRole("textbox").fill(updated);
  const response = page.waitForResponse(
    (candidate) =>
      /\/api\/timesheets\/work-logs\/[^/]+$/u.test(
        new URL(candidate.url()).pathname,
      ) && candidate.request().method() === "PATCH",
  );
  await row.getByRole("button", { name: "保存", exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(section.getByText(updated, { exact: true })).toBeVisible();
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
  await expect(dialog.locator("p").filter({ hasText: /^Kivisense Member$/u })).toBeVisible();
  await dialog.getByRole("button", { name: "关闭" }).last().click();
  await expect(dialog).toBeHidden();
}

test("@auth @navigation explicit Staging login, logout, and Mock roles stay inside the reviewed boundary", async ({ page }) => {
  const assertNoErrors = observe(page);
  await gotoInteractive(page, appPath("/login"));
  await expect(page.getByRole("heading", { name: "企业微信测试登录" })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.getByText("仅用于 Staging 产品验收", { exact: true })).toBeVisible();
  const enterStaging = page.getByRole("button", { name: "进入测试环境" });
  await expect(enterStaging).toBeVisible();
  await expect(enterStaging).toBeEnabled();
  for (const label of ["Kivisense Super Admin", "Kivisense Admin", "Kivisense Member"]) {
    await expect(page.getByRole("button", { name: new RegExp(label) })).toBeVisible();
  }
  const legacy = await page.request.post(appPath("/api/auth/sign-in/email"), { data: {}, headers: { origin } });
  expect(legacy.status()).toBe(404);

  const stagingLoginResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/auth/sign-in/staging-test") &&
    response.request().method() === "POST",
  );
  await enterStaging.click();
  expect((await stagingLoginResponse).status(), "explicit Staging login response").toBe(200);
  await expect(page).toHaveURL(/\/daily-report$/u);
  await expect(page.getByRole("heading", { name: "工作日报" })).toBeVisible();
  await page.getByRole("button", { name: "账户菜单" }).click();
  await expect(page.getByText("Kivisense Admin", { exact: true }).first()).toBeVisible();
  const projectsResponse = await page.request.get(appPath("/api/projects"));
  expect(projectsResponse.status()).toBe(200);
  const projectList = await projectsResponse.json() as {
    projects: Array<{ permissions?: { canViewProject?: boolean; canEditProject?: boolean; canManageMembers?: boolean } }>;
  };
  expect(projectList.projects.length).toBeGreaterThan(0);
  for (const project of projectList.projects) {
    expect(project.permissions).toMatchObject({
      canViewProject: true,
      canEditProject: true,
      canManageMembers: true,
    });
  }
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/u);
  await gotoInteractive(page, appPath("/daily-report"));
  await expect(page).toHaveURL(/\/login\?returnTo=%2Fdaily-report$/u);
  expect(await (await page.request.get(appPath("/api/auth/get-session"))).json()).toBeNull();
  await capture(page, "01-staging-test-login-logout.png");

  await switchIdentity(page, "super-admin");
  await gotoInteractive(page, appPath("/daily-report"));
  for (const label of ["工作日报", "AI 工作流", "知识库", "组织架构"]) {
    await expect(page.getByRole("link", { name: label })).toBeVisible();
  }
  for (const label of ["工作台", "审核中心", "Skills", "数据看板"]) {
    await expect(page.getByRole("link", { name: label })).toHaveCount(0);
  }
  const session = await (await page.request.get(appPath("/api/auth/get-session"))).json() as Record<string, unknown>;
  expect(JSON.stringify(session)).not.toMatch(/token/iu);

  await switchIdentity(page, "member");
  await gotoInteractive(page, appPath("/daily-report"));
  await expect(page.getByRole("link", { name: "组织架构" })).toHaveCount(0);
  expect((await page.request.get(appPath("/api/organization/departments"))).status()).toBe(404);
  assertNoErrors();
});

test("@organization four-level hierarchy is created, edited, moved, and rejected through the UI", async ({ page }) => {
  const assertNoErrors = observe(page);
  await login(page, "super-admin");
  await gotoInteractive(page, appPath("/organization"));
  await expect(page.getByRole("heading", { name: "组织架构" })).toBeVisible();
  const marker = crypto.randomUUID().slice(0, 8).toUpperCase();
  await page.setExtraHTTPHeaders({
    "x-projectai-fixture-run-id": fixtureRunId,
    "x-projectai-fixture-expires-at": fixtureExpiresAt,
  });
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
      const deleted = await page.request.delete(
        appPath("/api/organization/departments"),
        {
          data: { departmentId },
          headers: {
            origin,
            "x-projectai-fixture-run-id": fixtureRunId,
            "x-projectai-fixture-expires-at": fixtureExpiresAt,
          },
        },
      );
      expect(
        deleted.status(),
        `delete department fixture ${departmentId}`,
      ).toBe(200);
    }
  }
  assertNoErrors();
});

test("@knowledge @knowledge-permissions Member creator keeps edit rights after refresh", async ({ page }) => {
  const assertNoErrors = observe(page);
  await login(page, "member");
  const marker = crypto.randomUUID().slice(0, 8);
  const projectName = `Member Creator UAT ${marker}`;
  const renamedProject = `${projectName} 已更新`;
  const displayName = `创建者权限-${marker}`;
  await gotoInteractive(page, appPath("/knowledge"));

  const createResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/api/projects") && response.request().method() === "POST",
  );
  await createProjectThroughUi(page, { name: projectName, departmentName: "Product Management" });
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(201);
  const created = await createResponse.json() as {
    project: { id: string; permissions?: { canEditProject?: boolean; canManageMembers?: boolean; canUploadDocuments?: boolean } };
  };
  expect(created.project.permissions, "create permission contract").toMatchObject({
    canEditProject: true,
    canManageMembers: true,
    canUploadDocuments: true,
  });

  await page.reload();
  const projectsResponse = await page.request.get(appPath("/api/projects"));
  expect(projectsResponse.status()).toBe(200);
  const projectList = await projectsResponse.json() as {
    projects: Array<{ id: string; permissions?: { canEditProject?: boolean; canManageMembers?: boolean } }>;
  };
  const listed = projectList.projects.find((item) => item.id === created.project.id);
  expect(listed?.permissions, "list permission contract").toMatchObject({
    canEditProject: true,
    canManageMembers: true,
  });
  const detailResponse = await page.request.get(appPath(`/api/projects/${created.project.id}`));
  expect(detailResponse.status()).toBe(200);
  const detail = await detailResponse.json() as {
    project: { permissions?: { canEditProject?: boolean; canManageMembers?: boolean } };
  };
  expect(detail.project.permissions).toEqual(listed!.permissions);

  await chooseSpace(page, projectName);
  await expect(page.getByRole("button", { name: "编辑项目信息" })).toBeVisible();
  await expect(page.getByRole("button", { name: "管理空间成员" })).toBeVisible();
  await page.getByRole("button", { name: "编辑项目信息" }).click();
  const editDialog = page.getByRole("dialog", { name: "编辑项目信息" });
  await editDialog.getByLabel("空间名称").fill(renamedProject);
  await editDialog.getByLabel("说明").fill(`虚构创建者权限验收 ${marker}`);
  await editDialog.getByRole("button", { name: "保存" }).click();
  await expect(editDialog).toBeHidden();
  await expect(page.getByRole("heading", { name: renamedProject, exact: true })).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: `${displayName}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(`虚构创建者权限验收文件 ${marker}，不包含客户信息。`),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "文件已安全上传" }),
  ).toBeVisible();
  await expect(page.getByText(displayName, { exact: true })).toBeVisible();
  await capture(page, "03-member-creator-refresh-edit-upload.png");

  const documentsResponse = await page.request.get(appPath(`/api/projects/${created.project.id}/documents?status=active`));
  const documents = await documentsResponse.json() as { documents: Array<{ id: string; displayName: string }> };
  const uploaded = documents.documents.find((item) => item.displayName === displayName);
  expect(uploaded).toBeTruthy();
  expect((await mutation(page, `/api/projects/${created.project.id}/documents/${uploaded!.id}/archive`, "post", {})).status()).toBe(200);
  assertNoErrors();
});

test("@knowledge @knowledge-permissions project creation, sharing, upload, preview, and revoke use the UI", async ({ page }) => {
  const assertNoErrors = observe(page);
  await login(page, "admin");
  const marker = crypto.randomUUID().slice(0, 8);
  const projectName = `Product V2 ACL UAT ${marker}`;
  const displayName = `权限验收-${marker}`;

  await gotoInteractive(page, appPath("/knowledge"));
  await createProjectThroughUi(page, { name: projectName, departmentName: "Product Management" });
  await setMemberPermissionThroughUi(page, { spaceName: projectName, access: "查看" });
  const target = (await spaces(page)).find((space) => space.name === projectName && space.projectId);
  expect(target).toBeTruthy();

  await switchIdentity(page, "member");
  await gotoInteractive(page, `${appPath("/knowledge")}?projectId=${encodeURIComponent(target!.projectId!)}`);
  await expect(page.getByText(projectName, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "上传", exact: true })).toBeDisabled();

  await switchIdentity(page, "admin");
  await gotoInteractive(page, `${appPath("/knowledge")}?projectId=${encodeURIComponent(target!.projectId!)}`);
  await setMemberPermissionThroughUi(page, { spaceName: projectName, access: "编辑" });

  await switchIdentity(page, "member");
  await gotoInteractive(page, `${appPath("/knowledge")}?projectId=${encodeURIComponent(target!.projectId!)}`);
  await expect(page.getByRole("button", { name: "上传", exact: true })).toBeEnabled();
  await page.locator('input[type="file"]').setInputFiles({
    name: `${displayName}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(`虚构权限验收文件 ${marker}，不包含客户信息。`),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "文件已安全上传" }),
  ).toBeVisible();
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
  await gotoInteractive(page, `${appPath("/knowledge")}?projectId=${encodeURIComponent(target!.projectId!)}`);
  await chooseSpace(page, projectName);
  await page.getByRole("button", { name: "管理空间成员" }).click();
  const members = page.getByRole("dialog", { name: new RegExp(`空间成员 · ${projectName}`) });
  await members.getByRole("button", { name: "移除 Kivisense Member" }).click();
  await expect(members.getByRole("button", { name: "移除 Kivisense Member" })).toHaveCount(0);
  await members.getByRole("button", { name: "关闭" }).last().click();

  await switchIdentity(page, "member");
  expect((await spaces(page)).some((space) => space.id === target!.id)).toBe(false);
  expect((await page.request.get(appPath(`/api/projects/${target!.projectId}`))).status()).toBe(404);
  expect((await page.request.get(appPath(`/api/projects/${target!.projectId}/ai/threads`))).status()).toBe(404);
  await gotoInteractive(page, appPath("/daily-report"));
  await page.keyboard.press("ControlOrMeta+K");
  const unauthorizedSearch = page.getByPlaceholder("搜索已授权知识空间");
  await unauthorizedSearch.fill(projectName);
  await expect(page.getByRole("dialog", { name: "全局搜索" })).not.toContainText(projectName);
  await unauthorizedSearch.press("Escape");

  await switchIdentity(page, "admin");
  expect((await mutation(page, `/api/projects/${target!.projectId}/documents/${uploaded!.id}/archive`, "post", {})).status()).toBe(200);
  assertNoErrors();
});

test("@knowledge-race rapid project switching aborts the old file request without replacing the active project", async ({ page }) => {
  const assertNoErrors = observe(page);
  await login(page, "admin");
  await gotoInteractive(page, appPath("/knowledge"));
  const markerA = crypto.randomUUID().slice(0, 8);
  const markerB = crypto.randomUUID().slice(0, 8);
  const projectAName = `Product V2 ACL UAT ${markerA}`;
  const projectBName = `Product V2 ACL UAT ${markerB}`;
  const documentName = `切换竞态-${markerB}`;
  await createProjectThroughUi(page, {
    name: projectAName,
    departmentName: "Product Management",
  });
  await createProjectThroughUi(page, {
    name: projectBName,
    departmentName: "Product Management",
  });
  const availableSpaces = await spaces(page);
  const projectA = availableSpaces.find(
    (space) => space.name === projectAName && space.projectId,
  );
  const projectB = availableSpaces.find(
    (space) => space.name === projectBName && space.projectId,
  );
  expect(projectA).toBeTruthy();
  expect(projectB).toBeTruthy();

  await chooseSpace(page, projectBName);
  await page.locator('input[type="file"]').setInputFiles({
    name: `${documentName}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(`虚构快速切换验收 ${markerB}，不包含客户信息。`),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "文件已安全上传" }),
  ).toBeVisible();
  await expect(page.getByText(documentName, { exact: true })).toBeVisible();

  let releaseOldRequest!: () => void;
  let oldRequestReached!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseOldRequest = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    oldRequestReached = resolve;
  });
  const oldProjectDocuments = new RegExp(
    `/api/projects/${projectA!.projectId}/documents\\?status=active$`,
    "u",
  );
  await page.route(oldProjectDocuments, async (route) => {
    oldRequestReached();
    await release;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ documents: [] }),
    });
  });

  await page.getByRole("button", { name: new RegExp(projectAName) }).click();
  await reached;
  await page.getByRole("button", { name: new RegExp(projectBName) }).click();
  await expect(
    page.getByRole("heading", { name: projectBName, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(documentName, { exact: true })).toBeVisible();
  releaseOldRequest();
  await page.waitForTimeout(250);
  await expect(
    page.getByRole("heading", { name: projectBName, exact: true }),
  ).toBeVisible();
  await expect(page.getByText(documentName, { exact: true })).toBeVisible();
  await expect(page.getByText("文件列表加载失败")).toHaveCount(0);
  await expect(
    page.getByRole("alert").filter({ hasText: /AbortError/iu }),
  ).toHaveCount(0);
  await page.unroute(oldProjectDocuments);
  assertNoErrors();
});

test("@ai-retrieval-permissions real AI only cites an authorized, UI-uploaded fictional file", async ({ page }) => {
  const assertNoErrors = observe(page);
  await login(page, "member");
  const target = (await spaces(page)).find((space) => space.projectId === memberProjectId);
  expect(target).toBeTruthy();
  const marker = crypto.randomUUID().slice(0, 8);
  const displayName = `Product V2 AI UAT ${marker}`;
  await gotoInteractive(page, `${appPath("/knowledge")}?projectId=${memberProjectId}`);
  await chooseSpace(page, target!.name);
  await page.locator('input[type="file"]').setInputFiles({
    name: `${displayName}.txt`,
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
  const sourceName = `需求提取-${marker}`;
  const savedProjectName = `需求结果空间 ${marker}`;
  await gotoInteractive(page, appPath("/workflows"));
  await expect(page.getByRole("heading", { name: "AI 工作流" })).toBeVisible();
  await page.getByPlaceholder("搜索工作流或业务场景").fill("需求");
  await page.getByRole("button", { name: /^运行/u }).first().click();
  await expect(page.getByRole("heading", { name: /需求提取/u })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传附件" })).toBeEnabled();

  const generate = page.getByRole("button", { name: "生成待审核草稿" });
  await expect(generate).toBeDisabled();
  await page.locator('input[type="file"]').setInputFiles({
    name: `${sourceName}.txt`,
    mimeType: "text/plain",
    buffer: Buffer.from(`虚构需求：为内部项目 ${marker} 增加审批提醒。项目经理可以设置截止日期；到期前 24 小时提醒负责人；验收标准是提醒只发送一次并记录审计。`),
  });
  await expect(page.getByRole("status")).toContainText("临时附件已解析完成", { timeout: 120_000 });
  await expect(generate).toBeEnabled();
  const extractionResponse = page.waitForResponse(
    (response) => response.url().includes("/requirement-extractions") && response.request().method() === "POST",
    { timeout: 120_000 },
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

  await gotoInteractive(page, appPath("/knowledge"));
  await chooseSpace(page, savedProjectName);
  await expect(page.getByRole("button", { name: new RegExp(`^${sourceName}(?:\\s|$)`, "u") })).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(/需求提取审核结果/u).first()).toBeVisible({ timeout: 120_000 });
  await capture(page, "06-requirement-saved-knowledge.png");
  assertNoErrors();
});

test("@daily-report @global-search retained daily report and keyboard search remain usable", async ({ page }) => {
  const assertNoErrors = observe(page);
  await login(page, "member");
  await gotoInteractive(page, appPath("/daily-report"));
  await expect(page.getByRole("heading", { name: "工作日报" })).toBeVisible();
  await expect(page.getByTestId("work-log-section")).toBeVisible();
  await expect(page.getByRole("heading", { name: "今日随记", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "AI 整理今日工时", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "腾讯文档同步中心", exact: true })).toBeVisible();
  const searchTrigger = page.getByRole("button", { name: "全局搜索" }).first();
  await searchTrigger.focus();
  await page.keyboard.press("ControlOrMeta+K");
  let search = page.getByPlaceholder("搜索已授权知识空间");
  await expect(search).toBeFocused();
  await search.press("Escape");
  await expect(page.getByRole("dialog", { name: "全局搜索" })).toHaveCount(0);
  await expect(searchTrigger).toBeFocused();

  await page.keyboard.press("ControlOrMeta+K");
  search = page.getByPlaceholder("搜索已授权知识空间");
  await search.fill("ProjectAI 产品重构");
  await expect(page.getByRole("dialog", { name: "全局搜索" })).toContainText("ProjectAI 产品重构");
  await search.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/knowledge\\?projectId=${memberProjectId}$`, "u"));
  await expect(page.getByText("ProjectAI 产品重构", { exact: true }).first()).toBeVisible();
  await capture(page, "07-global-search-result.png");
  assertNoErrors();
});

test("@fixture-isolation registered projects stay out of ordinary UI, Search, and unauthorized AI access before exact cleanup", async ({ page }) => {
  const assertNoErrors = observe(page);
  const marker = crypto.randomUUID().slice(0, 8);
  const projectName = `Product V2 ACL UAT ${marker}`;
  const runId = `uat-fixture-isolation-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1_000).toISOString();
  const headers = {
    origin,
    "x-projectai-fixture-run-id": runId,
    "x-projectai-fixture-expires-at": expiresAt,
  };
  let projectId = "";

  try {
    await login(page, "super-admin");
    const created = await page.request.post(appPath("/api/projects"), {
      data: {
        name: projectName,
        clientName: "[TEST] Synthetic fixture client",
        description: "仅用于 Round 1 Fixture 隔离验收。",
        status: "planning",
        stage: "discovery",
        health: "healthy",
        departmentId: "kivisense-dept-product-management",
      },
      headers,
    });
    expect(created.status()).toBe(201);
    projectId = ((await created.json()) as { project: { id: string } }).project.id;

    const projectsResponse = await page.request.get(appPath("/api/projects"));
    expect(projectsResponse.status()).toBe(200);
    const projectList = (await projectsResponse.json()) as {
      projects: Array<{ id: string; name: string }>;
    };
    expect(projectList.projects).not.toContainEqual(
      expect.objectContaining({ id: projectId }),
    );
    expect(projectList.projects.map((project) => project.name)).not.toContain(
      projectName,
    );
    expect((await spaces(page)).some((space) => space.projectId === projectId))
      .toBe(false);

    await gotoInteractive(page, appPath("/projects"));
    await expect(page.getByText(projectName, { exact: true })).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+K");
    const search = page.getByPlaceholder("搜索已授权知识空间");
    await search.fill(projectName);
    await expect(page.getByRole("dialog", { name: "全局搜索" })).not.toContainText(
      projectName,
    );
    await search.press("Escape");

    await switchIdentity(page, "member");
    expect(
      (
        await page.request.get(
          appPath(`/api/projects/${projectId}/ai/threads`),
        )
      ).status(),
    ).toBe(404);
    assertNoErrors();
  } finally {
    if (projectId) {
      await switchIdentity(page, "super-admin");
      const deleted = await page.request.delete(
        appPath("/api/test-fixtures/projects"),
        {
          data: { projectId },
          headers,
        },
      );
      expect(deleted.status(), "exact isolated project cleanup").toBe(200);
    }
  }
});

test("@daily-report-async durable AI job survives navigation, reports completion, and retries a source-change failure", async ({ page }) => {
  test.slow();
  const assertNoErrors = observe(page);
  const reportDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const runId = `uat-daily-report-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1_000).toISOString();
  const fixtureHeaders = {
    origin,
    "x-projectai-fixture-run-id": runId,
    "x-projectai-fixture-expires-at": expiresAt,
  };
  const marker = crypto.randomUUID().slice(0, 8);
  const note = `[UAT] Round 1 async ${marker}，完成虚构验收，1 小时，已完成，进度 100%，无加班。`;
  const updatedNote = `${note} 已更新。`;
  let successfulElapsedSeconds = 0;
  const candidates = [
    { identity: "member", userId: "kivisense-mock-member" },
    { identity: "admin", userId: "kivisense-mock-admin" },
    { identity: "super-admin", userId: "kivisense-mock-super-admin" },
  ] as const;
  let selected: (typeof candidates)[number] | null = null;
  let fixtureStarted = false;

  try {
    for (const candidate of candidates) {
      await switchIdentity(page, candidate.identity);
      const projectResponse = await page.request.get(appPath("/api/projects"));
      expect(projectResponse.status()).toBe(200);
      const projects = (await projectResponse.json()) as {
        projects: Array<{ id: string; organizationId: string }>;
      };
      const target = projects.projects.find(
        (project) => project.id === memberProjectId,
      );
      expect(target, `${candidate.identity} daily-report project`).toBeTruthy();
      const query = new URLSearchParams({
        organizationId: target!.organizationId,
        date: reportDate,
      });
      const [workLogResponse, draftResponse, jobResponse] = await Promise.all([
        page.request.get(
          appPath(`/api/timesheets/work-logs?${query.toString()}`),
        ),
        page.request.get(
          appPath(`/api/timesheets/drafts?${query.toString()}`),
        ),
        page.request.get(
          appPath(`/api/timesheets/ai-jobs?${query.toString()}`),
        ),
      ]);
      expect(workLogResponse.status()).toBe(200);
      expect(draftResponse.status()).toBe(200);
      expect(jobResponse.status()).toBe(200);
      const workLogBody = (await workLogResponse.json()) as {
        records: unknown[];
      };
      const draftBody = (await draftResponse.json()) as {
        draft: unknown | null;
      };
      const jobBody = (await jobResponse.json()) as { job: unknown | null };
      if (
        workLogBody.records.length === 0 &&
        draftBody.draft === null &&
        jobBody.job === null
      ) {
        selected = candidate;
        break;
      }
    }
    expect(
      selected,
      `one controlled identity must have an empty ${reportDate} daily report`,
    ).toBeTruthy();
    await page.setExtraHTTPHeaders({
      "x-projectai-fixture-run-id": runId,
      "x-projectai-fixture-expires-at": expiresAt,
    });
    fixtureStarted = true;
    await gotoInteractive(page, appPath("/daily-report"));
    const workLogs = page.getByTestId("work-log-section");
    await expect(workLogs).toContainText("今天还没有随记");
    await expect(page.getByTestId("ai-generate")).toBeDisabled();

    await createTimesheetNote(page, note);
    const startedAt = performance.now();
    const enqueue = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith(appPath("/api/timesheets/drafts/generate")) &&
        candidate.request().method() === "POST",
    );
    await page.getByTestId("ai-generate").click();
    expect((await enqueue).status()).toBe(202);
    await expect(page.getByTestId("ai-job-status")).toHaveAttribute(
      "data-state",
      /^(?:queued|reading_notes|matching_projects|merging_duplicates|generating_draft|validating_result)$/u,
    );
    await expect(page.getByTestId("ai-generate")).toBeDisabled();

    await gotoInteractive(page, appPath("/knowledge"));
    await expect(page.getByRole("heading", { name: "知识库" })).toBeVisible();
    await gotoInteractive(page, appPath("/daily-report"));
    await expect(page.getByTestId("ai-job-status")).toBeVisible();
    const completedToast = page
      .getByRole("status")
      .filter({ hasText: "AI 整理完成" });
    const initialFailureToast = page
      .getByRole("alert")
      .filter({ hasText: "AI 整理失败" });
    await expect(completedToast.or(initialFailureToast)).toBeVisible({
      timeout: 120_000,
    });
    if (await initialFailureToast.isVisible()) {
      await expect(initialFailureToast).toContainText("失败阶段");
      await expect(initialFailureToast).toContainText(
        /脱敏请求编号：[a-f0-9]{8}…[a-f0-9]{4}/iu,
      );
      const initialRetry = page.waitForResponse(
        (candidate) =>
          /\/api\/timesheets\/ai-jobs\/[^/]+\/retry$/u.test(
            new URL(candidate.url()).pathname,
          ) && candidate.request().method() === "POST",
      );
      await initialFailureToast
        .getByRole("button", { name: "重试" })
        .click();
      expect((await initialRetry).status()).toBe(202);
    }
    await expect(completedToast).toContainText(
      "AI 工时草稿已生成 1 条，共 1 小时，待确认 1 条",
      { timeout: 120_000 },
    );
    successfulElapsedSeconds =
      Math.round((performance.now() - startedAt) / 100) / 10;
    test.info().annotations.push({
      type: "real-ai-elapsed-seconds",
      description: String(successfulElapsedSeconds),
    });
    await completedToast
      .getByRole("button", { name: "查看并确认" })
      .click();
    await expect(timesheetTaskCards(page)).toHaveCount(1);
    await expect(timesheetTaskCards(page).first()).toContainText(note);
    await expect(workLogs.getByText(note, { exact: true })).toBeVisible();
    const completedDraftDescription = await timesheetTaskCards(page)
      .first()
      .getByRole("textbox", { name: /任务详情（必填）/u })
      .inputValue();
    expect(completedDraftDescription.trim()).not.toBe("");

    await gotoInteractive(page, appPath("/daily-report"));
    await expect(
      page.getByRole("status").filter({ hasText: "AI 整理完成" }),
    ).toHaveCount(0);

    const failingEnqueue = page.waitForResponse(
      (candidate) =>
        candidate.url().endsWith(appPath("/api/timesheets/drafts/generate")) &&
        candidate.request().method() === "POST",
    );
    await page.getByTestId("ai-generate").click();
    expect((await failingEnqueue).status()).toBe(202);
    await editTimesheetNote(page, note, updatedNote);

    const failedJob = page.getByTestId("ai-job-status");
    await expect(failedJob).toHaveAttribute("data-state", "failed", {
      timeout: 120_000,
    });
    await expect(failedJob).toContainText("整理失败");
    await expect(failedJob).toContainText("失败阶段");
    await expect(failedJob).toContainText(
      /脱敏请求编号：[a-f0-9]{8}…[a-f0-9]{4}/iu,
    );
    await expect(failedJob).not.toContainText(
      /[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/iu,
    );
    const failedToast = page
      .getByRole("alert")
      .filter({ hasText: "AI 整理失败" });
    await expect(failedToast).toContainText("失败阶段", {
      timeout: 20_000,
    });
    await expect(
      timesheetTaskCards(page)
        .first()
        .getByRole("textbox", { name: /任务详情（必填）/u }),
    ).toHaveValue(completedDraftDescription);
    await expect(workLogs.getByText(updatedNote, { exact: true })).toBeVisible();

    const retry = page.waitForResponse(
      (candidate) =>
        /\/api\/timesheets\/ai-jobs\/[^/]+\/retry$/u.test(
          new URL(candidate.url()).pathname,
        ) && candidate.request().method() === "POST",
    );
    await failedToast.getByRole("button", { name: "重试" }).click();
    expect((await retry).status()).toBe(202);
    const retryToast = page
      .getByRole("status")
      .filter({ hasText: "AI 整理完成" });
    await expect(retryToast).toContainText(
      "AI 工时草稿已生成 1 条，共 1 小时，待确认 1 条",
      { timeout: 120_000 },
    );
    await retryToast.getByRole("button", { name: "查看并确认" }).click();
    await expect(timesheetTaskCards(page)).toHaveCount(1);
    await expect(timesheetTaskCards(page).first()).toContainText(updatedNote);
    expect(successfulElapsedSeconds).toBeGreaterThan(0);
    assertNoErrors();
  } finally {
    if (fixtureStarted && selected) {
      await switchIdentity(page, "super-admin");
      const cleanup = await page.request.delete(
        appPath("/api/test-fixtures/timesheets"),
        {
          data: { userId: selected.userId, reportDate },
          headers: fixtureHeaders,
        },
      );
      expect(cleanup.status(), "exact daily-report fixture cleanup").toBe(200);
      const body = (await cleanup.json()) as {
        deleted: {
          workLogs: number;
          executions: number;
          drafts: number;
          tasks: number;
        };
      };
      expect(body.deleted.workLogs).toBe(1);
      expect(body.deleted.executions).toBeGreaterThanOrEqual(1);
      if (successfulElapsedSeconds > 0) {
        expect(body.deleted.drafts).toBe(1);
        expect(body.deleted.tasks).toBe(1);
      }
    }
  }
});
