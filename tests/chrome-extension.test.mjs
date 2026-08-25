import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const repositoryRoot = process.cwd();
const extensionRoot = path.join(repositoryRoot, "chrome-extension");

async function loadScripts(relativePaths, additions = {}) {
  const context = vm.createContext({
    URL,
    console,
    crypto: globalThis.crypto,
    Math,
    ...additions,
  });
  for (const relativePath of relativePaths) {
    const source = await readFile(path.join(extensionRoot, relativePath), "utf8");
    vm.runInContext(source, context, { filename: relativePath });
  }
  return context;
}

class FakeEvent {
  constructor(type, options = {}) {
    this.type = type;
    Object.assign(this, options);
  }
}

class FakeElement {
  constructor({ order = 0, text = "", tagName = "DIV", attributes = {} } = {}) {
    this.order = order;
    this.innerText = text;
    this.textContent = text;
    this.tagName = tagName;
    this.attributes = attributes;
    this.isConnected = true;
    this.hidden = false;
    this.disabled = false;
    this.readOnly = false;
    this.events = [];
    this.queryMap = new Map();
    this.ownerDocument = {
      defaultView: {
        Event: FakeEvent,
        InputEvent: FakeEvent,
      },
    };
  }

  addQuery(selector, elements) {
    this.queryMap.set(selector, elements);
    return this;
  }

  querySelectorAll(selector) {
    return this.queryMap.get(selector) || [];
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  compareDocumentPosition(other) {
    return this.order < other.order ? 4 : 2;
  }

  contains() {
    return false;
  }

  focus() {
    this.focused = true;
  }

  dispatchEvent(event) {
    this.events.push(event.type);
    return true;
  }
}

function fakeRoot(queryEntries) {
  const queryMap = new Map(queryEntries);
  return {
    querySelectorAll(selector) {
      return queryMap.get(selector) || [];
    },
  };
}

async function loadAdapters() {
  return loadScripts([
    "src/content/adapter-core.js",
    "src/content/chatgpt-adapter.js",
    "src/content/deepseek-adapter.js",
    "src/content/qwen-adapter.js",
  ]);
}

const officialSkillMetadata = [
  ["project-weekly-report", "1.2.0", "active"],
  ["project-timeline-maker", "0.1.0", "experimental"],
  ["project-requirement-analyst", "0.1.0", "experimental"],
  ["project-feasibility-research", "0.1.0", "experimental"],
].map(([id, version, status]) => ({
  id,
  name: id,
  version,
  description: `${id} description`,
  status,
  category: "project-management",
  tags: "PM",
}));

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function loadProjectAiBridge(fetchImplementation) {
  let listener = null;
  const context = await loadScripts(
    [
      "src/shared/project-ai-source.js",
      "src/content/project-ai-content-script.js",
    ],
    {
      location: new URL("https://gridworks.cn/tool/projectai-slim-uat/projects"),
      fetch: fetchImplementation,
      chrome: {
        runtime: {
          onMessage: {
            addListener(value) {
              listener = value;
            },
          },
        },
      },
    },
  );
  assert.equal(typeof listener, "function");
  return { context, listener };
}

function sendBridgeMessage(listener, type) {
  return new Promise((resolve) => {
    const keepChannelOpen = listener(
      { source: "project-ai-uat-popup", type },
      {},
      resolve,
    );
    if (type === "SYNC_PROJECT_AI_SKILLS") {
      assert.equal(keepChannelOpen, true);
    }
  });
}

test("Extension manifest is MV3 with exact chat hosts, the reviewed Staging path, and minimal permissions", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(extensionRoot, "manifest.json"), "utf8"),
  );
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.name, "Project AI 助手");
  assert.equal(manifest.version, "0.1.2");
  assert.match(manifest.description, /同步 Skill/u);
  assert.equal(manifest.action.default_title, "Project AI 助手");
  assert.deepEqual(manifest.permissions, ["activeTab", "storage"]);
  assert.deepEqual(manifest.host_permissions, [
    "https://chatgpt.com/*",
    "https://chat.deepseek.com/*",
    "https://chat.qwen.ai/*",
  ]);
  assert.equal(manifest.permissions.includes("cookies"), false);
  assert.equal(manifest.permissions.includes("tabs"), false);
  assert.equal(manifest.permissions.includes("unlimitedStorage"), false);
  assert.equal(
    manifest.content_scripts.some((entry) =>
      entry.matches.includes("https://gridworks.cn/tool/projectai-slim-uat/*"),
    ),
    true,
  );
  assert.equal(
    manifest.content_scripts.some((entry) =>
      entry.matches.some((match) => match.includes("projectai-staging")),
    ),
    false,
  );
});

test("every configured manifest script exists", async () => {
  const manifest = JSON.parse(
    await readFile(path.join(extensionRoot, "manifest.json"), "utf8"),
  );
  for (const entry of manifest.content_scripts) {
    for (const script of entry.js) {
      const source = await readFile(path.join(extensionRoot, script), "utf8");
      assert.ok(source.length > 0, script);
    }
  }
  const popup = await readFile(
    path.join(extensionRoot, manifest.action.default_popup),
    "utf8",
  );
  assert.match(popup, /src\/shared\/format\.js/);
  assert.match(popup, /src\/shared\/session-cache\.js/);
  assert.match(popup, /src\/shared\/uat-results\.js/);
  assert.match(popup, /<html lang="zh-CN">/u);
  assert.match(popup, /从 Project AI 同步 Skill/u);
  assert.match(popup, /注入当前对话/u);
  assert.match(popup, /最新 AI 回复/u);
  assert.doesNotMatch(
    popup,
    /Sync Skills from Project AI|Inject into current chat|Latest assistant response|Saved UAT Results/u,
  );
  assert.doesNotMatch(popup, /<script[^>]*>\s*[^<\s]/);
});

test("Extension UI keeps canonical values while displaying Chinese Skill names and statuses", async () => {
  const popupSource = await readFile(
    path.join(extensionRoot, "popup/popup.js"),
    "utf8",
  );
  for (const [skillId, displayName] of [
    ["project-weekly-report", "项目周报"],
    ["project-timeline-maker", "项目时间线生成"],
    ["project-requirement-analyst", "项目需求分析"],
    ["project-feasibility-research", "项目可行性研究"],
  ]) {
    assert.match(popupSource, new RegExp(`"${skillId}": "${displayName}"`, "u"));
  }
  for (const displayStatus of ["通过", "失败", "阻塞", "已实现", "已人工验证", "未验证", "待人工验证"]) {
    assert.match(popupSource, new RegExp(displayStatus, "u"));
  }
  assert.match(popupSource, /Skill ID：\$\{selected\.id\}/u);
  assert.doesNotMatch(
    popupSource,
    /Unsupported page|Syncing official Skills|Response extraction failed|Extension initialization failed/u,
  );
});

test("injection formatter preserves raw Skill content and omits wrappers when task is empty", async () => {
  const context = await loadScripts(["src/shared/format.js"]);
  const { formatInjection } = context.ProjectAIUAT.format;
  const rawSkill = "---\nname: project-weekly-report\n---\nKeep  two spaces.\n";
  assert.equal(formatInjection(rawSkill, "   "), rawSkill);

  const formatted = formatInjection(rawSkill, "Run UAT case 01.");
  assert.equal(
    formatted,
    `<SKILL>\n${rawSkill}</SKILL>\n\n<USER_TASK>\nRun UAT case 01.\n</USER_TASK>`,
  );
  assert.ok(formatted.includes(rawSkill));
});

test("injection formatter rejects missing Skill content", async () => {
  const context = await loadScripts(["src/shared/format.js"]);
  assert.throws(
    () => context.ProjectAIUAT.format.formatInjection("  ", "task"),
    /请输入 Skill 内容/u,
  );
});

test("Skill metadata parser reads generic frontmatter without storing the Skill", async () => {
  const context = await loadScripts(["src/shared/format.js"]);
  const parsed = context.ProjectAIUAT.format.parseSkillMetadata(
    "---\nname: project-requirement-analyst\nmetadata:\n  id: project-requirement-analyst\n  version: 0.1.0\n  status: experimental\n---\n# Body",
  );
  assert.equal(parsed.skillId, "project-requirement-analyst");
  assert.equal(parsed.skillVersion, "0.1.0");
});

test("Project AI source recognizes only the reviewed Staging deployment path", async () => {
  const context = await loadScripts(["src/shared/project-ai-source.js"]);
  const source = context.ProjectAIUAT.projectAiSource;
  const deployment = source.matchProjectAiDeployment(
    "https://gridworks.cn/tool/projectai-slim-uat/projects",
  );
  assert.equal(deployment.id, "project_ai_staging");
  assert.equal(deployment.origin, "https://gridworks.cn");
  assert.equal(deployment.basePath, "/tool/projectai-slim-uat");
  assert.equal(
    source.matchProjectAiDeployment("https://gridworks.cn/tool/projectai/projects"),
    null,
  );
  assert.equal(
    source.matchProjectAiDeployment("https://gridworks.cn/tool/projectai-staging/"),
    null,
  );
  assert.equal(source.matchProjectAiDeployment("https://chatgpt.com/"), null);
  assert.equal(
    source.skillApiUrl(deployment, "/api/skills"),
    "https://gridworks.cn/tool/projectai-slim-uat/api/skills",
  );
  assert.throws(
    () => source.skillApiUrl(deployment, "/api/skills/../projects"),
    /路径无效/u,
  );
});

test("Project AI content bridge syncs official list and exact SKILL.md through same-origin Session fetch", async () => {
  const calls = [];
  const exactMarkdown = new Map(
    officialSkillMetadata.map((skill) => [
      skill.id,
      `---\nname: ${skill.id}\nmetadata:\n  id: \"${skill.id}\"\n  version: \"${skill.version}\"\n---\n# Exact ${skill.id}\n`,
    ]),
  );
  const { listener } = await loadProjectAiBridge(async (url, options) => {
    calls.push({ url, options });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith("/api/skills")) {
      return jsonResponse({ source: "project_ai", skills: officialSkillMetadata });
    }
    const id = decodeURIComponent(parsed.pathname.split("/").at(-1));
    const metadata = officialSkillMetadata.find((skill) => skill.id === id);
    return jsonResponse({
      source: "project_ai",
      skill: { ...metadata, skillMarkdown: exactMarkdown.get(id) },
    });
  });

  const response = await sendBridgeMessage(listener, "SYNC_PROJECT_AI_SKILLS");
  assert.equal(response.ok, true);
  assert.equal(response.source, "project_ai");
  assert.equal(response.sourceOrigin, "https://gridworks.cn");
  assert.equal(response.sourceBasePath, "/tool/projectai-slim-uat");
  assert.equal(response.skills.length, 4);
  assert.equal(
    response.skills[2].skillMarkdown,
    exactMarkdown.get("project-requirement-analyst"),
  );
  assert.equal(calls.length, 5);
  for (const call of calls) {
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.method, "GET");
    assert.equal(new URL(call.url).origin, "https://gridworks.cn");
    assert.match(new URL(call.url).pathname, /^\/tool\/projectai-slim-uat\/api\/skills/u);
    assert.doesNotMatch(
      call.url,
      /\/api\/projects|\/knowledge(?:\/|$)|\/documents(?:\/|$)|\/api\/timeline/u,
    );
  }
});

test("Project AI content bridge returns the explicit login diagnostic for a 401", async () => {
  const { listener } = await loadProjectAiBridge(async () =>
    jsonResponse(
      { error: { code: "UNAUTHENTICATED", message: "请先登录" } },
      401,
    ),
  );
  const response = await sendBridgeMessage(listener, "SYNC_PROJECT_AI_SKILLS");
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "PROJECT_AI_UNAUTHENTICATED");
  assert.match(response.error.message, /请先打开 Project AI 并完成登录/u);
});

test("Skill session cache preserves the selected official Skill across popup reopen", async () => {
  const values = {};
  const storage = {
    async get(key) {
      return { [key]: values[key] };
    },
    async set(update) {
      Object.assign(values, update);
    },
  };
  const syncPayload = {
    source: "project_ai",
    sourceOrigin: "https://gridworks.cn",
    sourceBasePath: "/tool/projectai-slim-uat",
    syncedAt: "2026-08-25T12:00:00.000Z",
    skills: officialSkillMetadata.map((skill) => ({
      ...skill,
      skillMarkdown: `exact:${skill.id}`,
    })),
  };

  const firstPopup = await loadScripts(["src/shared/session-cache.js"]);
  const firstApi = firstPopup.ProjectAIUAT.sessionCache;
  const saved = await firstApi.saveSkillSessionCache(storage, syncPayload);
  assert.equal(saved.selectedSkillId, "project-weekly-report");
  await firstApi.selectSessionSkill(storage, "project-requirement-analyst");

  const reopenedPopup = await loadScripts(["src/shared/session-cache.js"]);
  const reopenedApi = reopenedPopup.ProjectAIUAT.sessionCache;
  const reopened = await reopenedApi.getSkillSessionCache(storage);
  assert.equal(reopened.selectedSkillId, "project-requirement-analyst");
  assert.equal(
    reopenedApi.selectedSessionSkill(reopened).skillMarkdown,
    "exact:project-requirement-analyst",
  );
  assert.deepEqual(Object.keys(values), [reopenedApi.STORAGE_KEY]);
});

test("synced exact SKILL.md is injected without business-content rewriting or auto-send", async () => {
  const context = await loadScripts([
    "src/shared/format.js",
    "src/content/adapter-core.js",
    "src/content/chatgpt-adapter.js",
  ]);
  const exactSkill = "# Exact Skill\n\nKeep  two spaces and symbols: <>&.\n";
  const formatted = context.ProjectAIUAT.format.formatInjection(
    exactSkill,
    "Analyze this fixture.",
  );
  const adapter = context.ProjectAIUAT.adapters[0];
  const textarea = new FakeElement({ tagName: "TEXTAREA" });
  const root = fakeRoot([[adapter.selectors.composer[0], [textarea]]]);
  const result = adapter.injectText(formatted, root);
  assert.equal(
    textarea.value,
    `<SKILL>\n${exactSkill}</SKILL>\n\n<USER_TASK>\nAnalyze this fixture.\n</USER_TASK>`,
  );
  assert.ok(textarea.value.includes(exactSkill));
  assert.equal(result.autoSent, false);
});

test("site adapters support only their exact HTTPS hosts", async () => {
  const context = await loadAdapters();
  const adapters = context.ProjectAIUAT.adapters;
  const chatgpt = adapters.find((adapter) => adapter.id === "chatgpt");
  const deepseek = adapters.find((adapter) => adapter.id === "deepseek");
  const qwen = adapters.find((adapter) => adapter.id === "qwen");

  assert.equal(chatgpt.isSupportedPage("https://chatgpt.com/c/123"), true);
  assert.equal(chatgpt.isSupportedPage("https://evil.chatgpt.com/c/123"), false);
  assert.equal(deepseek.isSupportedPage("https://chat.deepseek.com/a/chat/s/123"), true);
  assert.equal(deepseek.isSupportedPage("http://chat.deepseek.com/"), false);
  assert.equal(qwen.isSupportedPage("https://chat.qwen.ai/c/123"), true);
  assert.equal(qwen.isSupportedPage("https://qianwen.aliyun.com/"), false);
});

test("adapter composer lookup uses selector fallback and injection does not send", async () => {
  const context = await loadAdapters();
  const adapter = context.ProjectAIUAT.adapters.find(
    (candidate) => candidate.id === "chatgpt",
  );
  const textarea = new FakeElement({ tagName: "TEXTAREA" });
  const root = fakeRoot([
    [adapter.selectors.composer[0], []],
    [adapter.selectors.composer[1], [textarea]],
  ]);

  const result = adapter.injectText("<SKILL>\nraw\n</SKILL>", root);
  assert.equal(textarea.value, "<SKILL>\nraw\n</SKILL>");
  assert.equal(textarea.focused, true);
  assert.deepEqual(textarea.events, ["input", "change"]);
  assert.equal(result.composerSelector, adapter.selectors.composer[1]);
  assert.equal(result.autoSent, false);
});

test("adapter returns an explicit composer diagnostic when selectors fail", async () => {
  const context = await loadAdapters();
  const adapter = context.ProjectAIUAT.adapters[0];
  const root = fakeRoot([]);
  assert.throws(
    () => adapter.findComposer(root),
    (error) =>
      error.code === "COMPOSER_NOT_FOUND" &&
      error.details.attemptedSelectors.length === adapter.selectors.composer.length,
  );
});

test("latest response extraction scans assistant blocks newest to oldest and skips empty blocks", async () => {
  const context = await loadAdapters();
  const adapter = context.ProjectAIUAT.adapters.find(
    (candidate) => candidate.id === "deepseek",
  );
  const olderContent = new FakeElement({ order: 1, text: "Older response" });
  const olderBlock = new FakeElement({ order: 1, text: "Older response" }).addQuery(
    adapter.selectors.responseContent[0],
    [olderContent],
  );
  const newestEmpty = new FakeElement({ order: 2, text: "  " });
  for (const selector of adapter.selectors.responseContent) {
    if (!olderBlock.queryMap.has(selector)) olderBlock.addQuery(selector, []);
    newestEmpty.addQuery(selector, []);
  }
  const root = fakeRoot([
    [adapter.selectors.assistant[0], [olderBlock, newestEmpty]],
  ]);

  const result = adapter.extractLatestResponse(root);
  assert.equal(result.text, "Older response");
  assert.equal(result.format, "rendered_text");
});

test("DeepSeek extraction preserves the complete assistant block instead of markdown fragments", async () => {
  const context = await loadAdapters();
  const adapter = context.ProjectAIUAT.adapters.find(
    (candidate) => candidate.id === "deepseek",
  );
  const completeResponse = new FakeElement({
    text: "Requirement Analysis Pack\nRequirement Matrix\nRM-001 Business Goal",
  });
  const fragmentedParagraph = new FakeElement({
    text: "RM-001 Business Goal",
  });
  const responseBlock = new FakeElement({
    order: 1,
    text: "Requirement Analysis Pack\nRequirement Matrix\nRM-001 Business Goal",
  });
  for (const selector of adapter.selectors.responseContent) {
    responseBlock.addQuery(selector, []);
  }
  responseBlock.addQuery("[class*='content']", [completeResponse]);
  responseBlock.addQuery(".ds-markdown", [fragmentedParagraph]);
  responseBlock.addQuery("[class*='markdown']", [fragmentedParagraph]);
  const root = fakeRoot([
    [adapter.selectors.assistant[0], [responseBlock]],
  ]);

  const result = adapter.extractLatestResponse(root);
  assert.equal(
    result.text,
    "Requirement Analysis Pack\nRequirement Matrix\nRM-001 Business Goal",
  );
  assert.equal(result.contentSelector, null);
});

test("latest response extraction prefers the newest valid assistant block in DOM order", async () => {
  const context = await loadAdapters();
  const adapter = context.ProjectAIUAT.adapters.find(
    (candidate) => candidate.id === "qwen",
  );
  const older = new FakeElement({ order: 1 });
  const newer = new FakeElement({ order: 4 });
  const olderText = new FakeElement({ text: "First" });
  const newerText = new FakeElement({ text: "Latest exact text" });
  for (const selector of adapter.selectors.responseContent) {
    older.addQuery(selector, []);
    newer.addQuery(selector, []);
  }
  older.addQuery(adapter.selectors.responseContent[0], [olderText]);
  newer.addQuery(adapter.selectors.responseContent[0], [newerText]);
  const root = fakeRoot([
    [adapter.selectors.assistant[0], [newer, older]],
  ]);

  assert.equal(adapter.extractLatestResponse(root).text, "Latest exact text");
});

test("adapter returns an explicit latest-response diagnostic when no response exists", async () => {
  const context = await loadAdapters();
  const adapter = context.ProjectAIUAT.adapters[0];
  assert.throws(
    () => adapter.extractLatestResponse(fakeRoot([])),
    (error) =>
      error.code === "ASSISTANT_RESPONSE_NOT_FOUND" &&
      error.details.attemptedSelectors.length === adapter.selectors.assistant.length,
  );
});

test("UAT Result sanitizes URL, retains raw response, and excludes Skill content", async () => {
  const context = await loadScripts(["src/shared/uat-results.js"]);
  const result = context.ProjectAIUAT.uatResults.createUatResult(
    {
      site: "ChatGPT",
      agent: "chatgpt",
      pageUrl: "https://chatgpt.com/c/abc?token=sensitive#fragment",
      skillId: "project-weekly-report",
      skillVersion: "1.2.0",
      skillSource: "project_ai",
      taskLabel: "Case 01",
      rawResponse: "# Raw response\n\nExact body",
      notes: "Manual note",
      skillContent: "must never persist",
    },
    { timestamp: "2026-08-25T12:34:56.000Z", uuid: "uat-fixed-id" },
  );

  assert.equal(result.id, "uat-fixed-id");
  assert.equal(result.pageUrl, "https://chatgpt.com/c/abc");
  assert.equal(result.rawResponse, "# Raw response\n\nExact body");
  assert.equal(result.responseLength, result.rawResponse.length);
  assert.equal(result.skillSource, "project_ai");
  assert.equal(Object.hasOwn(result, "skillContent"), false);
});

test("local UAT storage appends only on explicit save", async () => {
  const context = await loadScripts(["src/shared/uat-results.js"]);
  const api = context.ProjectAIUAT.uatResults;
  const values = {};
  const storage = {
    async get(key) {
      return { [key]: values[key] };
    },
    async set(update) {
      Object.assign(values, update);
    },
  };
  const result = api.createUatResult(
    { site: "DeepSeek", rawResponse: "answer" },
    { timestamp: "2026-08-25T00:00:00.000Z", uuid: "result-1" },
  );

  assert.equal((await api.listUatResults(storage)).length, 0);
  assert.equal(await api.saveUatResult(storage, result), 1);
  const saved = await api.listUatResults(storage);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].rawResponse, "answer");
});

test("JSON export contains raw responses while Markdown export stays a concise summary", async () => {
  const context = await loadScripts(["src/shared/uat-results.js"]);
  const api = context.ProjectAIUAT.uatResults;
  const results = [
    {
      id: "result-1",
      timestamp: "2026-08-25T00:00:00.000Z",
      site: "Qwen",
      skillId: "project-feasibility-research",
      skillVersion: "0.1.0",
      skillSource: "project_ai",
      taskLabel: "Live web case",
      rawResponse: "RAW-ONLY-CONTENT",
      responseLength: 16,
      notes: "Needs review",
    },
  ];
  const json = api.exportUatResultsJson(
    results,
    "2026-08-25T01:00:00.000Z",
  );
  const markdown = api.exportUatResultsMarkdown(
    results,
    "2026-08-25T01:00:00.000Z",
  );

  assert.equal(JSON.parse(json).results[0].rawResponse, "RAW-ONLY-CONTENT");
  assert.match(markdown, /project-feasibility-research v0\.1\.0/);
  assert.match(markdown, /Project AI/);
  assert.match(markdown, /原始回复保存在 JSON 导出文件中/u);
  assert.doesNotMatch(markdown, /RAW-ONLY-CONTENT/);
});

test("generic download filenames are safe and deterministic", async () => {
  const context = await loadScripts(["src/shared/uat-results.js"]);
  const filename = context.ProjectAIUAT.uatResults.downloadFilename(
    "ChatGPT / External Agent",
    "2026-08-25T12:34:56.000Z",
    "md",
  );
  assert.equal(filename, "uat-chatgpt-external-agent-20260825-123456.md");
  assert.doesNotMatch(filename, /[/:?]/);
});

test("Extension contains no cookie, token, Project Knowledge, or automatic-send access", async () => {
  const contentBridge = await readFile(
    path.join(extensionRoot, "src/content/content-script.js"),
    "utf8",
  );
  const projectAiBridge = await readFile(
    path.join(extensionRoot, "src/content/project-ai-content-script.js"),
    "utf8",
  );
  const projectAiSource = await readFile(
    path.join(extensionRoot, "src/shared/project-ai-source.js"),
    "utf8",
  );
  const sessionCache = await readFile(
    path.join(extensionRoot, "src/shared/session-cache.js"),
    "utf8",
  );
  const popup = await readFile(
    path.join(extensionRoot, "popup/popup.js"),
    "utf8",
  );
  const combined = `${contentBridge}\n${projectAiBridge}\n${projectAiSource}\n${sessionCache}\n${popup}`;
  assert.doesNotMatch(combined, /\.submit\s*\(/);
  assert.doesNotMatch(combined, /dispatchEvent\([^)]*KeyboardEvent/);
  assert.doesNotMatch(combined, /chrome\.cookies|document\.cookie|localStorage/u);
  assert.doesNotMatch(combined, /authorization\s*:|bearer\s+/iu);
  assert.doesNotMatch(combined, /\/api\/projects|ProjectKnowledgeService/);
  assert.match(projectAiBridge, /\/api\/skills/);
  assert.doesNotMatch(contentBridge, /fetch\s*\(/);
});
