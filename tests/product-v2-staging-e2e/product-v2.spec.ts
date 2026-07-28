import { expect, test, type Page } from "@playwright/test";
import { mkdir, stat } from "node:fs/promises";
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
type WorkflowArtifact = {
  id: string;
  kind: string;
  title: string;
  status: string;
  currentVersion: number;
  content: Record<string, unknown>;
  sourceReferences: Array<Record<string, unknown>>;
};
type WorkflowDetail = {
  run: { id: string; status: string; failureCode: string | null };
  artifacts: WorkflowArtifact[];
};

const origin = "https://gridworks.cn";
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

const syntheticProjectName = /^(?:Member Creator UAT [a-f0-9]{8}(?: 已更新)?|Product V2 ACL UAT [a-f0-9]{8}|V3 Requirement UAT [a-f0-9]{8}|V3 Meeting UAT [a-f0-9]{8})$/iu;

test.afterEach(async ({ page }) => {
  await switchIdentity(page, "super-admin");
  const response = await page.request.get(appPath("/api/projects"));
  expect(response.status(), "fixture cleanup project list").toBe(200);
  const body = await response.json() as {
    projects: Array<{ id: string; name: string }>;
  };
  for (const project of body.projects.filter((item) => syntheticProjectName.test(item.name))) {
    const registered = await page.request.post(appPath("/api/test-fixtures/projects"), {
      data: { projectId: project.id },
      headers: {
        origin,
        "x-projectai-fixture-run-id": fixtureRunId,
        "x-projectai-fixture-expires-at": fixtureExpiresAt,
      },
    });
    expect(registered.status(), `register fixture ${project.id}`).toBe(200);
    const deleted = await page.request.delete(appPath("/api/test-fixtures/projects"), {
      data: { projectId: project.id },
      headers: {
        origin,
        "x-projectai-fixture-run-id": fixtureRunId,
        "x-projectai-fixture-expires-at": fixtureExpiresAt,
      },
    });
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

function workflowRunId(page: Page, workflowRoute: "requirement-framework" | "meeting-minutes") {
  const match = new URL(page.url()).pathname.match(new RegExp(`/workflows/${workflowRoute}/([^/]+)$`, "u"));
  expect(match?.[1], `${workflowRoute} run id in URL`).toBeTruthy();
  return decodeURIComponent(match![1]!);
}

async function waitForWorkflow(page: Page, projectId: string, runId: string, expectedStatus: string, timeoutMs = 12 * 60_000) {
  const deadline = Date.now() + timeoutMs;
  let latest = "not-observed";
  while (Date.now() < deadline) {
    const response = await page.request.get(appPath(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}`));
    expect(response.status(), "workflow detail response").toBe(200);
    const detail = await response.json() as WorkflowDetail;
    latest = `${detail.run.status}${detail.run.failureCode ? `:${detail.run.failureCode}` : ""}`;
    if (detail.run.status === expectedStatus) return detail;
    if (["failed", "cancelled"].includes(detail.run.status)) {
      throw new Error(`WORKFLOW_UAT_TERMINATED:${latest}`);
    }
    await page.waitForTimeout(2_000);
  }
  throw new Error(`WORKFLOW_UAT_TIMEOUT:${latest}`);
}

async function assertArtifactExport(page: Page, input: {
  projectId: string;
  runId: string;
  artifactId: string;
  format: "md" | "docx" | "xlsx" | "txt";
  contentType: string;
}) {
  const response = await page.request.get(appPath(
    `/api/projects/${encodeURIComponent(input.projectId)}/workflows/${encodeURIComponent(input.runId)}/artifacts/${encodeURIComponent(input.artifactId)}/export?format=${input.format}`,
  ));
  expect(response.status(), `${input.format} export response`).toBe(200);
  expect(response.headers()["content-type"]).toContain(input.contentType);
  expect(response.headers()["content-disposition"]).toMatch(/^attachment;/u);
  expect((await response.body()).byteLength, `${input.format} export bytes`).toBeGreaterThan(100);
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
  await expect(page.getByRole("button", { name: `${input.name} 项目`, exact: true })).toBeVisible();
}

async function chooseSpace(page: Page, name: string) {
  await page.getByRole("button", { name: `${name} 项目`, exact: true }).click();
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
}

function isApiResponse(response: { url(): string; request(): { method(): string } }, pathname: string, method: string) {
  return new URL(response.url()).pathname === appPath(pathname) && response.request().method() === method;
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
      const deleted = await page.request.delete(appPath("/api/organization/departments"), {
        data: { departmentId },
        headers: {
          origin,
          "x-projectai-fixture-run-id": fixtureRunId,
          "x-projectai-fixture-expires-at": fixtureExpiresAt,
        },
      });
      expect(deleted.status(), `delete department fixture ${departmentId}`).toBe(200);
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
  await expect(page.getByRole("status")).toContainText("文件已安全上传");
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

test("@ai-workflow @requirement-workflow V3 requirement framework generates, versions, exports, and publishes through the UI", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const assertNoErrors = observe(page);
  await login(page, "member");
  const marker = crypto.randomUUID().slice(0, 8);
  const projectName = `V3 Requirement UAT ${marker}`;
  const sources = [
    {
      name: `虚构项目概览-${marker}`,
      content: [
        `虚构项目代号：${marker}。`,
        "目标：为内部项目经理提供移动 Web 审批提醒。",
        "平台：移动 Web；地区：仅虚构测试环境；上线日期：2037-11-18。",
      ].join("\n"),
    },
    {
      name: `虚构埋点约束-${marker}`,
      content: [
        "GA4 必须记录 reminder_created、reminder_sent、approval_completed 三个事件。",
        "事件参数不得写入姓名、审批正文或其他个人信息。",
        "无权用户访问项目时统一得到 404，并写入脱敏审计。",
      ].join("\n"),
    },
    {
      name: `虚构交付计划-${marker}`,
      content: [
        "项目经理可以设置审批截止日期，系统在截止前 24 小时仅提醒负责人一次。",
        "里程碑：2037-10-15 完成提醒幂等验收；最晚确认日期：2037-09-25。",
        "验收：重复触发不产生第二条提醒；所有 AI 草稿必须人工审核后发布。",
      ].join("\n"),
    },
  ];

  await gotoInteractive(page, appPath("/knowledge"));
  await createProjectThroughUi(page, { name: projectName, departmentName: "Product Management" });
  const target = (await spaces(page)).find((space) => space.name === projectName && space.projectId);
  expect(target?.projectId, "new requirement UAT project").toBeTruthy();

  await gotoInteractive(page, appPath("/workflows"));
  await expect(page.getByRole("heading", { name: "AI 工作流" })).toBeVisible();
  await expect(page.locator("article")).toHaveCount(2);
  await page.getByLabel("运行项目").selectOption(target!.projectId!);
  const requirementCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "搭建需求框架" }) });
  await requirementCard.getByRole("button", { name: "开始运行" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`搭建需求框架 · ${projectName}`, "u") })).toBeVisible();
  await expect(page.getByRole("button", { name: "上传临时附件" })).toBeEnabled();

  const generate = page.getByRole("button", { name: "开始生成四类产物" });
  await expect(generate).toBeDisabled();
  for (const source of sources) {
    const uploadResponse = page.waitForResponse(
      (response) => isApiResponse(response, `/api/projects/${target!.projectId}/documents`, "POST"),
      { timeout: 30_000 },
    );
    await page.locator('input[type="file"]').setInputFiles({
      name: `${source.name}.txt`,
      mimeType: "text/plain",
      buffer: Buffer.from(source.content),
    });
    expect((await uploadResponse).status()).toBe(201);
    await expect(page.getByText("临时附件已解析并选中。未经确认不会进入正式知识库。", { exact: true })).toBeVisible({ timeout: 120_000 });
    await expect(page.getByText(source.name, { exact: true })).toBeVisible();
  }
  await expect(generate).toBeEnabled();
  const workflowResponse = page.waitForResponse(
    (response) => isApiResponse(response, `/api/projects/${target!.projectId}/workflows`, "POST"),
    { timeout: 30_000 },
  );
  await generate.click();
  expect((await workflowResponse).status()).toBe(202);
  await page.waitForURL(/\/workflows\/requirement-framework\/[^?]+\?projectId=/u, { timeout: 30_000 });
  const runUrl = page.url();
  const runId = workflowRunId(page, "requirement-framework");
  await expect(page.getByText("任务在后台继续运行，可以安全离开本页面；返回后会恢复当前状态，不会重复调用 Provider。")).toBeVisible();
  await gotoInteractive(page, appPath("/workflows"));
  await gotoInteractive(page, runUrl);

  let detail = await waitForWorkflow(page, target!.projectId!, runId, "awaiting_review");
  await page.reload();
  await expect(page.getByRole("heading", { name: "产物已生成，等待人工审核" })).toBeVisible({ timeout: 30_000 });
  expect(detail.artifacts.map((artifact) => artifact.title)).toEqual([
    "项目需求概览", "需求文档", "GA4 埋点文档", "Action Plan",
  ]);
  for (const artifact of detail.artifacts) {
    expect(artifact.sourceReferences.length, `${artifact.title} source references`).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: new RegExp(`^${artifact.title} · v1$`, "u") })).toBeVisible();
  }
  const citedDocumentIds = new Set(detail.artifacts.flatMap((artifact) => artifact.sourceReferences)
    .map((reference) => reference.documentId)
    .filter((documentId): documentId is string => typeof documentId === "string"));
  expect(citedDocumentIds.size, "all three selected fixtures are cited").toBe(3);
  const requirements = detail.artifacts.find((artifact) => artifact.kind === "requirements_document")!;
  expect((requirements.content.sections as unknown[]).length, "26-section requirement document").toBe(26);
  const ga4 = detail.artifacts.find((artifact) => artifact.kind === "ga4_measurement_plan")!;
  const ga4EventIds = new Set((ga4.content.events as Array<{ eventId?: string }>).map((event) => event.eventId));
  for (const eventId of ["reminder_created", "reminder_sent", "approval_completed"]) expect(ga4EventIds.has(eventId), `GA4 ${eventId}`).toBe(true);
  const actionPlan = detail.artifacts.find((artifact) => artifact.kind === "action_plan")!;
  const actionTasks = actionPlan.content.tasks as Array<{ milestone?: boolean; latestConfirmationDate?: string }>;
  expect(actionTasks.length, "Action Plan tasks").toBeGreaterThan(0);
  expect(actionTasks.some((task) => task.milestone === true), "Action Plan milestone").toBe(true);
  expect(actionTasks.every((task) => typeof task.latestConfirmationDate === "string" && task.latestConfirmationDate.length > 0), "Action Plan latest confirmation dates").toBe(true);

  const overview = detail.artifacts.find((artifact) => artifact.kind === "project_overview")!;
  await page.getByRole("button", { name: /^项目需求概览 · v1$/u }).click();
  const editor = page.getByLabel("项目需求概览 结构化编辑器");
  const edited = structuredClone(overview.content) as { pendingQuestions?: string[] };
  edited.pendingQuestions = [...(edited.pendingQuestions ?? []), `UAT 人工复核待确认 ${marker}`];
  await editor.fill(JSON.stringify(edited, null, 2));
  await page.getByRole("button", { name: "保存新版本" }).click();
  await expect(page.getByText("已保存为版本 v2，发布前仍需审核。")).toBeVisible();
  await expect(page.getByRole("button", { name: /^项目需求概览 · v2$/u })).toBeVisible();
  detail = await waitForWorkflow(page, target!.projectId!, runId, "awaiting_review");

  for (const artifact of detail.artifacts) {
    await assertArtifactExport(page, { projectId: target!.projectId!, runId, artifactId: artifact.id, format: "md", contentType: "text/markdown" });
    if (["project_overview", "requirements_document"].includes(artifact.kind)) {
      await assertArtifactExport(page, { projectId: target!.projectId!, runId, artifactId: artifact.id, format: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    } else {
      await assertArtifactExport(page, { projectId: target!.projectId!, runId, artifactId: artifact.id, format: "xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    }
  }
  await capture(page, "05-v3-requirement-review.png");
  await page.getByRole("button", { name: "审核并发布" }).click();
  await expect(page.getByText("四类产物已发布；审核和版本记录已保存。")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "已发布" })).toBeVisible();
  await gotoInteractive(page, appPath("/workflows"));
  await gotoInteractive(page, runUrl);
  await expect(page.getByRole("heading", { name: "已发布" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^项目需求概览 · v2$/u })).toBeVisible();
  await capture(page, "06-v3-requirement-published.png");
  assertNoErrors();
});

test("@ai-workflow @meeting-workflow V3 meeting workflow uses real ASR, confirms speakers, exports, publishes, and deletes audio", async ({ page }) => {
  test.setTimeout(15 * 60_000);
  const audioPath = process.env.STAGING_MEETING_AUDIO_PATH?.trim();
  if (!audioPath || !path.isAbsolute(audioPath)) throw new Error("STAGING_MEETING_AUDIO_PATH_REQUIRED");
  const audio = await stat(audioPath);
  if (!audio.isFile() || audio.size <= 44 || audio.size > 50 * 1024 * 1024) throw new Error("STAGING_MEETING_AUDIO_INVALID");

  const assertNoErrors = observe(page);
  await login(page, "member");
  const marker = crypto.randomUUID().slice(0, 8);
  const projectName = `V3 Meeting UAT ${marker}`;
  await gotoInteractive(page, appPath("/knowledge"));
  await createProjectThroughUi(page, { name: projectName, departmentName: "Product Management" });
  const target = (await spaces(page)).find((space) => space.name === projectName && space.projectId);
  expect(target?.projectId, "new meeting UAT project").toBeTruthy();

  await gotoInteractive(page, appPath("/workflows"));
  await expect(page.locator("article")).toHaveCount(2);
  await page.getByLabel("运行项目").selectOption(target!.projectId!);
  const meetingCard = page.locator("article").filter({ has: page.getByRole("heading", { name: "提取会议纪要" }) });
  await meetingCard.getByRole("button", { name: "开始运行" }).click();
  await expect(page.getByRole("heading", { name: new RegExp(`提取会议纪要 · ${projectName}`, "u") })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles(audioPath);
  const uploadResponse = page.waitForResponse(
    (response) => isApiResponse(response, `/api/projects/${target!.projectId}/workflows/meeting-minutes`, "POST"),
    { timeout: 120_000 },
  );
  await page.getByRole("button", { name: "上传并开始处理" }).click();
  expect((await uploadResponse).status()).toBe(202);
  await page.waitForURL(/\/workflows\/meeting-minutes\/[^?]+\?projectId=/u, { timeout: 30_000 });
  const runUrl = page.url();
  const runId = workflowRunId(page, "meeting-minutes");
  await expect(page.getByText("任务在后台继续处理，可安全离开页面。系统不会因刷新或返回页面重复提交语音任务。")).toBeVisible();
  await gotoInteractive(page, appPath("/workflows"));
  await gotoInteractive(page, runUrl);

  let detail = await waitForWorkflow(page, target!.projectId!, runId, "awaiting_review");
  await page.reload();
  await expect(page.getByRole("heading", { name: "等待人工审核" })).toBeVisible({ timeout: 30_000 });
  expect(detail.artifacts.map((artifact) => artifact.title)).toEqual(["完整会议转写", "会议纪要", "会议待办"]);
  const transcript = detail.artifacts.find((artifact) => artifact.kind === "meeting_transcript")!;
  const transcriptSpeakers = (transcript.content.speakers ?? []) as Array<{ id?: string; displayName?: string }>;
  expect(transcriptSpeakers.length, "real ASR speaker separation").toBeGreaterThanOrEqual(2);

  const speakerSection = page.locator("section").filter({ has: page.getByRole("heading", { name: "确认说话人" }) });
  const speakerInputs = speakerSection.locator("input");
  expect(await speakerInputs.count(), "speaker editors").toBeGreaterThanOrEqual(2);
  for (let index = 0; index < await speakerInputs.count(); index += 1) {
    const name = `虚构发言人${index + 1}`;
    const speakerId = transcriptSpeakers[index]?.id;
    expect(speakerId, `speaker ${index + 1} id`).toBeTruthy();
    const input = speakerInputs.nth(index);
    await input.fill(name);
    const confirm = input.locator("..").getByRole("button", { name: "确认" });
    const renameResponse = page.waitForResponse(
      (response) => isApiResponse(response, `/api/projects/${target!.projectId}/workflows/${runId}/speakers/${speakerId}`, "PATCH"),
      { timeout: 30_000 },
    );
    await confirm.click();
    expect((await renameResponse).status(), `rename speaker ${index + 1}`).toBe(200);
    await expect(speakerSection.locator("input").nth(index)).toHaveValue(name);
    await expect(speakerSection.locator("input").nth(index).locator("..").getByRole("button", { name: "确认" })).toBeDisabled();
  }

  detail = await waitForWorkflow(page, target!.projectId!, runId, "awaiting_review");
  const renamedTranscript = detail.artifacts.find((artifact) => artifact.kind === "meeting_transcript")!;
  const renamedSpeakers = (renamedTranscript.content.speakers ?? []) as Array<{ displayName?: string }>;
  expect(renamedSpeakers.every((speaker) => speaker.displayName?.startsWith("虚构发言人"))).toBe(true);
  for (const artifact of detail.artifacts) {
    await expect(page.getByRole("button", { name: new RegExp(`^${artifact.title} · v\\d+$`, "u") })).toBeVisible();
    await assertArtifactExport(page, { projectId: target!.projectId!, runId, artifactId: artifact.id, format: "md", contentType: "text/markdown" });
    if (["meeting_transcript", "meeting_minutes"].includes(artifact.kind)) {
      await assertArtifactExport(page, { projectId: target!.projectId!, runId, artifactId: artifact.id, format: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    }
    if (artifact.kind === "meeting_transcript") {
      await assertArtifactExport(page, { projectId: target!.projectId!, runId, artifactId: artifact.id, format: "txt", contentType: "text/markdown" });
    }
  }
  await capture(page, "07-v3-meeting-review.png");
  await page.getByRole("button", { name: "审核并发布" }).click();
  await expect(page.getByText("会议纪要已发布。AI 生成的待办仍是审核产物，不会自动成为正式项目任务。")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByRole("heading", { name: "已发布" })).toBeVisible();
  await page.getByRole("button", { name: "删除原始音视频" }).click();
  await expect(page.getByText("原始音视频已从私有对象存储删除；审核产物和审计记录保留。")).toBeVisible({ timeout: 30_000 });
  await capture(page, "08-v3-meeting-published.png");
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
