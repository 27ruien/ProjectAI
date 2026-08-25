(function registerUatResults(globalScope) {
  "use strict";

  const namespace = (globalScope.ProjectAIUAT =
    globalScope.ProjectAIUAT || {});
  const STORAGE_KEY = "projectAiUatResultsV1";
  const SCHEMA_VERSION = 2;

  function sanitizePageUrl(value) {
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return null;
      }
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return null;
    }
  }

  function fallbackId(timestamp) {
    return `uat-${timestamp.replace(/[^0-9]/g, "")}-${Math.random()
      .toString(36)
      .slice(2, 10)}`;
  }

  function createUatResult(input, options) {
    const source = input || {};
    const settings = options || {};
    const timestamp = settings.timestamp || new Date().toISOString();
    const uuid =
      settings.uuid ||
      (globalScope.crypto &&
      typeof globalScope.crypto.randomUUID === "function"
        ? globalScope.crypto.randomUUID()
        : null);
    const rawResponse =
      typeof source.rawResponse === "string" ? source.rawResponse : "";

    if (rawResponse.trim().length === 0) {
      throw new TypeError("请先读取最新 AI 回复。");
    }

    return {
      id: uuid || fallbackId(timestamp),
      timestamp,
      site: typeof source.site === "string" ? source.site : "Unknown",
      agent: typeof source.agent === "string" ? source.agent : "Unknown",
      pageUrl: sanitizePageUrl(source.pageUrl),
      skillId:
        typeof source.skillId === "string" && source.skillId.trim()
          ? source.skillId.trim()
          : null,
      skillVersion:
        typeof source.skillVersion === "string" && source.skillVersion.trim()
          ? source.skillVersion.trim()
          : null,
      skillSource:
        source.skillSource === "project_ai" || source.skillSource === "manual"
          ? source.skillSource
          : null,
      taskLabel:
        typeof source.taskLabel === "string" && source.taskLabel.trim()
          ? source.taskLabel.trim()
          : null,
      rawResponse,
      responseLength: rawResponse.length,
      notes:
        typeof source.notes === "string" && source.notes.trim()
          ? source.notes.trim()
          : null,
    };
  }

  async function listUatResults(storageArea) {
    const stored = await storageArea.get(STORAGE_KEY);
    const records = stored && stored[STORAGE_KEY];
    return Array.isArray(records) ? records : [];
  }

  async function saveUatResult(storageArea, result) {
    const current = await listUatResults(storageArea);
    const next = [...current, result];
    await storageArea.set({ [STORAGE_KEY]: next });
    return next.length;
  }

  function exportUatResultsJson(results, exportedAt) {
    return JSON.stringify(
      {
        schemaVersion: SCHEMA_VERSION,
        exportedAt: exportedAt || new Date().toISOString(),
        resultCount: results.length,
        results,
      },
      null,
      2,
    );
  }

  function escapeMarkdownCell(value) {
    if (value === null || value === undefined || value === "") return "—";
    const displayValue = value === "Unknown" ? "未知" : value;
    return String(displayValue).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  }

  function exportUatResultsMarkdown(results, exportedAt) {
    const lines = [
      "# Project AI 跨 AI 平台 UAT 结果",
      "",
      `导出时间：${exportedAt || new Date().toISOString()}`,
      `结果数量：${results.length}`,
      "",
      "| 时间 | 站点 | Skill | 来源 | 任务 | 回复长度 | 备注 |",
      "|---|---|---|---|---|---:|---|",
    ];

    for (const result of results) {
      const skill = result.skillId
        ? `${result.skillId}${result.skillVersion ? ` v${result.skillVersion}` : ""}`
        : "—";
      const source = result.skillSource === "project_ai"
        ? "Project AI"
        : result.skillSource === "manual"
          ? "手动"
          : result.skillSource;
      lines.push(
        `| ${escapeMarkdownCell(result.timestamp)} | ${escapeMarkdownCell(
          result.site,
        )} | ${escapeMarkdownCell(skill)} | ${escapeMarkdownCell(
          source,
        )} | ${escapeMarkdownCell(
          result.taskLabel,
        )} | ${Number(result.responseLength) || 0} | ${escapeMarkdownCell(
          result.notes,
        )} |`,
      );
    }

    lines.push("", "原始回复保存在 JSON 导出文件中。", "");
    return lines.join("\n");
  }

  function downloadFilename(site, timestamp, extension) {
    const safeSite = String(site || "agent")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "agent";
    const date = new Date(timestamp || Date.now());
    const pad = (value) => String(value).padStart(2, "0");
    const stamp = `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
      date.getUTCDate(),
    )}-${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(
      date.getUTCSeconds(),
    )}`;
    return `uat-${safeSite}-${stamp}.${extension}`;
  }

  namespace.uatResults = {
    SCHEMA_VERSION,
    STORAGE_KEY,
    createUatResult,
    downloadFilename,
    exportUatResultsJson,
    exportUatResultsMarkdown,
    listUatResults,
    sanitizePageUrl,
    saveUatResult,
  };
})(globalThis);
