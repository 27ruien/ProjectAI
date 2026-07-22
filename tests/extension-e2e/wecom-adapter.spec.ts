import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

let server: Server;
let origin: string;
let selectors: Record<string, string>;
const bundlePath = path.resolve("dist/wecom-timesheet-extension/wecom-content.js");
const projectBridgePath = path.resolve("dist/wecom-timesheet-extension/projectai-content.js");
const serviceWorkerPath = path.resolve("dist/wecom-timesheet-extension/service-worker.js");
const mockRoot = path.resolve("extensions/wecom-timesheet/mock");
const extensionRoot = path.resolve("dist/wecom-timesheet-extension");

const task = {
  id: "task-001",
  description: "完成虚构 EARN 页面跳转逻辑确认",
  project: { id: "project-001", name: "CHAGEE Valley Fair Campaign" },
  submitter: { id: null, name: null, source: "authenticated-user" },
  regularHours: 1,
  overtimeHours: 0,
  category: { id: "communication", name: "项目沟通" },
  status: { id: null, name: "已完成" },
  urgency: null,
  progress: 100,
};

test.beforeAll(async () => {
  selectors = JSON.parse(
    await readFile("extensions/wecom-timesheet/static/selector-config.example.json", "utf8"),
  ) as Record<string, string>;
  server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const files: Record<string, { root: string; filename: string }> = {
      "/wecom-board.html": { root: mockRoot, filename: "wecom-board.html" },
      "/wecom-form.html": { root: mockRoot, filename: "wecom-form.html" },
      "/projectai.html": { root: mockRoot, filename: "projectai.html" },
      "/popup.html": { root: extensionRoot, filename: "popup.html" },
      "/popup.js": { root: extensionRoot, filename: "popup.js" },
      "/options.html": { root: extensionRoot, filename: "options.html" },
      "/options.js": { root: extensionRoot, filename: "options.js" },
      "/selector-config.default.json": { root: extensionRoot, filename: "selector-config.default.json" },
      "/extension.css": { root: extensionRoot, filename: "extension.css" },
    };
    const file = files[pathname];
    if (!file) {
      response.writeHead(404).end("not found");
      return;
    }
    const body = await readFile(path.join(file.root, file.filename));
    const contentType = file.filename.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : file.filename.endsWith(".css")
        ? "text/css; charset=utf-8"
        : "text/html; charset=utf-8";
    response.writeHead(200, {
      "content-type": contentType,
      "cache-control": "no-store",
    });
    response.end(body);
  });
  await new Promise<void>((resolve) => server.listen(4173, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:4173";
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

async function loadAdapter(page: Page, query = "", config = selectors) {
  await page.addInitScript((selectorConfig) => {
    const configKey = "projectai.timesheet.config.v1";
    Object.defineProperty(window, "chrome", {
      value: {
        storage: {
          local: {
            get: async () => ({
              [configKey]: { boardUrl: window.location.href, selectors: selectorConfig },
            }),
            set: async () => undefined,
            remove: async () => undefined,
          },
        },
        runtime: { onMessage: { addListener: () => undefined } },
      },
    });
  }, config);
  await page.goto(`${origin}/wecom-board.html${query}`);
  await page.addScriptTag({ path: bundlePath });
}

async function execute(page: Page, dryRun: boolean) {
  return page.evaluate(
    ({ taskValue, dryRunValue }) =>
      window.__PROJECTAI_WECOM_TEST__?.execute({
        kind: "EXECUTE_TASK",
        task: taskValue,
        dryRun: dryRunValue,
      }),
    { taskValue: task, dryRunValue: dryRun },
  ) as Promise<{ status: string; code: string; fieldResults: Record<string, string> }>;
}

test("Dry Run 精确填写 iframe 字段且不点击任何保存/最终提交", async ({ page }) => {
  await loadAdapter(page);
  const result = await execute(page, true);
  expect(result.status).toBe("validated");
  expect(result.fieldResults).toEqual({
    description: "filled",
    project: "matched",
    submitter: "verified",
    regularHours: "filled",
    overtimeHours: "filled",
    status: "matched",
    progress: "filled",
  });
  const frame = page.frameLocator("iframe[data-testid='mock-task-frame']");
  await expect(frame.locator("textarea[name='description']")).toHaveValue(task.description);
  await expect(frame.locator("input[name='regular-hours']")).toHaveValue("1");
  await expect(frame.locator("input[name='overtime-hours']")).toHaveValue("0");
  await expect(frame.locator("[data-testid='mock-unmapped-category']")).toHaveValue("企业微信未映射");
  await expect(frame.locator("[data-testid='mock-save-success']")).toHaveCount(0);
  await expect(page.locator("#final-submit-count")).toHaveText("0");
});

test("Mock ProjectAI 合法消息经桥接转发并接收扩展进度", async ({ page }) => {
  await page.addInitScript(() => {
    const runtimeMessages: unknown[] = [];
    const runtimeListeners: Array<(message: unknown, sender: unknown, respond: (value: unknown) => void) => unknown> = [];
    Object.assign(window, { __runtimeMessages: runtimeMessages, __runtimeListeners: runtimeListeners });
    Object.defineProperty(window, "chrome", {
      value: {
        runtime: {
          sendMessage: async (message: unknown) => {
            runtimeMessages.push(message);
            return { ok: true };
          },
          onMessage: { addListener: (listener: typeof runtimeListeners[number]) => runtimeListeners.push(listener) },
        },
      },
    });
  });
  await page.goto(`${origin}/projectai.html`);
  await page.addScriptTag({ path: projectBridgePath });
  await expect(page.locator("#events")).toContainText("PROJECT_AI_EXTENSION_READY");
  await page.locator("#send").click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __runtimeMessages: unknown[] }).__runtimeMessages.length)).toBe(1);
  const forwarded = await page.evaluate(() => (window as unknown as { __runtimeMessages: Array<Record<string, unknown>> }).__runtimeMessages[0]);
  expect(forwarded.kind).toBe("START_SYNC");
  expect((forwarded.payload as { sync_batch_id: string }).sync_batch_id).toBe("22222222-2222-4222-8222-222222222222");

  await page.evaluate(() => {
    const listeners = (window as unknown as { __runtimeListeners: Array<(message: unknown, sender: unknown, respond: (value: unknown) => void) => void> }).__runtimeListeners;
    for (const listener of listeners) {
      listener({
        kind: "STATUS_UPDATE",
        message: {
          type: "PROJECT_AI_SYNC_ACCEPTED",
          request_id: "11111111-1111-4111-8111-111111111111",
          sync_batch_id: "22222222-2222-4222-8222-222222222222",
          timestamp: "2026-07-22T10:01:00+08:00",
          status: "validating",
          items: [],
        },
      }, {}, () => undefined);
    }
  });
  await expect(page.locator("#events")).toContainText("PROJECT_AI_SYNC_ACCEPTED");
});

test("Popup 手动 JSON 入口执行严格预览且默认 Dry Run", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "chrome", {
      value: {
        storage: { local: { get: async () => ({}), set: async () => undefined, remove: async () => undefined } },
        runtime: {
          getURL: (value: string) => value,
          sendMessage: async () => ({ ok: true }),
          openOptionsPage: async () => undefined,
          onMessage: { addListener: () => undefined },
        },
      },
    });
  });
  await page.goto(`${origin}/popup.html`);
  const payload = {
    version: 1,
    request_id: "11111111-1111-4111-8111-111111111111",
    sync_batch_id: "22222222-2222-4222-8222-222222222222",
    date: "2026-07-22",
    source: "project-ai",
    confirmed_at: "2026-07-22T10:00:00+08:00",
    draft_version: 1,
    dry_run: true,
    tasks: [task],
  };
  await page.locator("#payload").fill(JSON.stringify(payload));
  await page.locator("#validate").click();
  await expect(page.locator("#preview")).toHaveText("2026-07-22 · 1 条任务 · 1.00 小时");
  await expect(page.locator("#dry-run")).toBeChecked();
});

test("真实看板访问参数只保存在本机配置且不会被拒绝", async ({ page }) => {
  await page.addInitScript(() => {
    const store: Record<string, unknown> = {};
    Object.assign(window, { __extensionStore: store });
    Object.defineProperty(window, "chrome", {
      value: {
        storage: {
          local: {
            get: async (name: string) => ({ [name]: store[name] }),
            set: async (values: Record<string, unknown>) => Object.assign(store, values),
          },
        },
        runtime: { getURL: (value: string) => value },
        permissions: {
          contains: async () => true,
          request: async () => true,
        },
      },
    });
  });
  await page.goto(`${origin}/options.html`);
  const localUrl = `${origin}/wecom-board.html?access=redacted&tab=daily#view`;
  await page.locator("#board-url").fill(localUrl);
  await page.locator("#save").click();
  await expect(page.locator("#status")).toContainText("配置已保存");
  const storedUrl = await page.evaluate(() => {
    const store = (window as unknown as { __extensionStore: Record<string, { boardUrl?: string }> }).__extensionStore;
    return store["projectai.timesheet.config.v1"]?.boardUrl;
  });
  expect(storedUrl).toBe(localUrl);
});

test("Service Worker 重启把中断中的保存标记为 unknown 并暂停", async ({ page }) => {
  const interrupted = {
    version: 1,
    requestId: "11111111-1111-4111-8111-111111111111",
    syncBatchId: "22222222-2222-4222-8222-222222222222",
    payloadDigest: "rehearsal-digest",
    payload: {
      version: 1,
      request_id: "11111111-1111-4111-8111-111111111111",
      sync_batch_id: "22222222-2222-4222-8222-222222222222",
      date: "2026-07-22",
      source: "project-ai",
      confirmed_at: "2026-07-22T10:00:00+08:00",
      draft_version: 1,
      dry_run: false,
      tasks: [task],
    },
    status: "syncing",
    items: [{
      taskId: task.id,
      idempotencyKey: "22222222-2222-4222-8222-222222222222:task-001",
      status: "running",
      attemptCount: 1,
      updatedAt: "2026-07-22T10:00:01.000Z",
      externalReference: null,
      errorCode: null,
      errorMessage: null,
    }],
    createdAt: "2026-07-22T10:00:00.000Z",
    updatedAt: "2026-07-22T10:00:01.000Z",
  };
  await page.addInitScript((batch) => {
    const key = "projectai.timesheet.batches.v1";
    const store: Record<string, unknown> = { [key]: { [batch.syncBatchId]: batch } };
    const runtimeListeners: Array<(message: unknown, sender: unknown, respond: (value: unknown) => void) => unknown> = [];
    Object.assign(window, { __extensionStore: store, __extensionRuntimeListeners: runtimeListeners });
    const event = { addListener: () => undefined, removeListener: () => undefined };
    Object.defineProperty(window, "chrome", {
      value: {
        storage: {
          local: {
            get: async (name: string) => ({ [name]: store[name] }),
            set: async (values: Record<string, unknown>) => Object.assign(store, values),
            remove: async () => undefined,
          },
        },
        runtime: {
          sendMessage: async () => undefined,
          openOptionsPage: async () => undefined,
          onMessage: { addListener: (listener: typeof runtimeListeners[number]) => runtimeListeners.push(listener) },
          onStartup: event,
          onInstalled: event,
        },
        tabs: {
          query: async () => [],
          sendMessage: async () => undefined,
          create: async () => ({}),
          update: async () => ({}),
          get: async () => ({ status: "complete" }),
          onUpdated: event,
        },
        scripting: { executeScript: async () => undefined },
      },
    });
  }, interrupted);
  await page.goto(`${origin}/projectai.html`);
  await page.addScriptTag({ path: serviceWorkerPath, type: "module" });
  await expect.poll(() =>
    page.evaluate(() => {
      const store = (window as unknown as { __extensionStore: Record<string, unknown> }).__extensionStore;
      return store["projectai.timesheet.batches.v1"];
    }),
  ).toMatchObject({
    "22222222-2222-4222-8222-222222222222": {
      status: "paused",
      items: [{ status: "unknown", errorCode: "SERVICE_WORKER_INTERRUPTED" }],
    },
  });
  const rejectedSender = await page.evaluate(() => new Promise((resolve) => {
    const listener = (window as unknown as {
      __extensionRuntimeListeners: Array<(message: unknown, sender: unknown, respond: (value: unknown) => void) => unknown>;
    }).__extensionRuntimeListeners[0];
    listener({ kind: "START_SYNC", source: "popup" }, { url: "https://invalid.example/popup.html" }, resolve);
  }));
  expect(rejectedSender).toEqual({ ok: false, code: "MESSAGE_SENDER_REJECTED" });
  const resolution = await page.evaluate(() => new Promise((resolve) => {
    const listener = (window as unknown as {
      __extensionRuntimeListeners: Array<(message: unknown, sender: unknown, respond: (value: unknown) => void) => unknown>;
    }).__extensionRuntimeListeners[0];
    listener({
      kind: "RESOLVE_UNKNOWN",
      source: "popup",
      requestId: "11111111-1111-4111-8111-111111111111",
      syncBatchId: "22222222-2222-4222-8222-222222222222",
      taskId: "task-001",
      resolution: "saved",
    }, { url: "chrome-extension://projectai-test/popup.html" }, resolve);
  }));
  expect(resolution).toEqual({ ok: true });
  await expect.poll(() =>
    page.evaluate(() => {
      const store = (window as unknown as { __extensionStore: Record<string, unknown> }).__extensionStore;
      return store["projectai.timesheet.batches.v1"];
    }),
  ).toMatchObject({
    "22222222-2222-4222-8222-222222222222": {
      status: "completed",
      items: [{ status: "saved", externalReference: "manual-reconciliation" }],
    },
  });
});

test("正式模式只保存单条任务，不触碰最终提交", async ({ page }) => {
  await loadAdapter(page);
  const result = await execute(page, false);
  expect(result.status).toBe("saved");
  await expect(page.frameLocator("iframe").locator("[data-testid='mock-save-success']")).toHaveCount(1);
  await expect(page.locator("[data-testid='mock-record-row']")).toHaveCount(1);
  await expect(page.locator("[data-field='description']")).toHaveText(task.description);
  await expect(page.locator("[data-field='submitter']")).toHaveText("当前登录用户");
  await expect(page.locator("[data-field='regular-hours']")).toHaveText("1");
  await expect(page.locator("[data-field='overtime-hours']")).toHaveText("0");
  await expect(page.locator("[data-field='progress']")).toHaveText("100");
  await expect(page.frameLocator("iframe").locator("[data-testid='mock-unmapped-category']")).toHaveValue("企业微信未映射");
  await expect(page.locator("#final-submit-count")).toHaveText("0");
});

test("保存反馈与列表回读不一致时拒绝宣布成功", async ({ page }) => {
  await loadAdapter(page, "?mismatch=1");
  const result = await execute(page, false);
  expect(result.status).toBe("failed");
  expect(result.code).toBe("RECORD_PROJECT_MISMATCH");
  await expect(page.locator("#final-submit-count")).toHaveText("0");
});

test("自动保存页面在任何字段写入前安全停止", async ({ page }) => {
  await loadAdapter(page, "", { ...selectors, persistenceMode: "auto-save" });
  const result = await execute(page, true);
  expect(result.status).toBe("failed");
  expect(result.code).toBe("AUTO_SAVE_UNSUPPORTED");
  await expect(page.locator("iframe[data-testid='mock-task-frame']")).toBeHidden();
  await expect(page.locator("#final-submit-count")).toHaveText("0");
});

test("误配到最终提交语义的按钮时硬拒绝点击", async ({ page }) => {
  await loadAdapter(page);
  await page.frameLocator("iframe").locator("[data-testid='mock-save-item']").evaluate((element) => {
    element.textContent = "最终提交日报";
  });
  const result = await execute(page, false);
  expect(result.status).toBe("failed");
  expect(result.code).toBe("FINAL_SUBMIT_CONTROL_FORBIDDEN");
  await expect(page.locator("#final-submit-count")).toHaveText("0");
});

test("登录、遮罩和重复选项均安全停止", async ({ page }) => {
  await loadAdapter(page, "?login=0");
  expect((await execute(page, false)).status).toBe("waiting_for_login");

  await loadAdapter(page, "?overlay=1");
  expect((await execute(page, false)).code).toBe("PAGE_OVERLAY_BLOCKING");

  await loadAdapter(page, "?duplicate=1");
  expect((await execute(page, false)).code).toBe("OPTION_AMBIGUOUS");
  await expect(page.locator("#final-submit-count")).toHaveText("0");
});

test("单条失败与未知保存结果不会继续宣布成功", async ({ page }) => {
  await loadAdapter(page, "?failure=1");
  expect((await execute(page, false)).code).toBe("ITEM_SAVE_FAILED");

  await loadAdapter(page, "?unknown=1");
  const unknown = await execute(page, false);
  expect(unknown.status).toBe("unknown");
  expect(unknown.code).toBe("SAVE_RESULT_UNKNOWN");
  await expect(page.locator("#final-submit-count")).toHaveText("0");
});

test("页面结构变化时明确失败，不猜测相似控件", async ({ page }) => {
  await loadAdapter(page, "", { ...selectors, descriptionInput: "textarea[name='removed-field']" });
  const result = await execute(page, false);
  expect(result.status).toBe("failed");
  expect(result.code).toBe("ELEMENT_TIMEOUT");
  await expect(page.locator("#final-submit-count")).toHaveText("0");
});
