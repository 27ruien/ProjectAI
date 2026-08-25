/* global chrome */
(function initializePopup(globalScope) {
  "use strict";

  const namespace = globalScope.ProjectAIUAT;
  const { formatInjection, parseSkillMetadata } = namespace.format;
  const {
    getSkillSessionCache,
    saveSkillSessionCache,
    selectSessionSkill,
    selectedSessionSkill,
  } = namespace.sessionCache;
  const {
    createUatResult,
    downloadFilename,
    exportUatResultsJson,
    exportUatResultsMarkdown,
    listUatResults,
    saveUatResult,
  } = namespace.uatResults;

  const elements = {
    siteStatus: document.querySelector("#site-status"),
    syncButton: document.querySelector("#sync-button"),
    lastSynced: document.querySelector("#last-synced"),
    skillSelect: document.querySelector("#skill-select"),
    skillMetadata: document.querySelector("#skill-metadata"),
    manualFallbackToggle: document.querySelector("#manual-fallback-toggle"),
    skillContent: document.querySelector("#skill-content"),
    taskInstruction: document.querySelector("#task-instruction"),
    injectButton: document.querySelector("#inject-button"),
    refreshButton: document.querySelector("#refresh-button"),
    responsePreview: document.querySelector("#response-preview"),
    copyButton: document.querySelector("#copy-button"),
    downloadButton: document.querySelector("#download-button"),
    taskLabel: document.querySelector("#task-label"),
    notes: document.querySelector("#notes"),
    saveButton: document.querySelector("#save-button"),
    savedCount: document.querySelector("#saved-count"),
    exportJsonButton: document.querySelector("#export-json-button"),
    exportMarkdownButton: document.querySelector("#export-markdown-button"),
    diagnostic: document.querySelector("#diagnostic"),
  };

  const sessionStorage = chrome.storage && chrome.storage.session;
  let pageStatus = null;
  let skillCache = null;
  let latestResponse = null;
  const responseLanguageInstruction =
    "请使用简体中文回复，包括所有标题、表头、状态说明和正文；仅保留 canonical ID、error code、版本号、证据标签及不可变技术标识。";

  const skillDisplayNames = Object.freeze({
    "project-weekly-report": "项目周报",
    "project-timeline-maker": "项目时间线生成",
    "project-requirement-analyst": "项目需求分析",
    "project-feasibility-research": "项目可行性研究",
  });

  const statusDisplayNames = Object.freeze({
    PASS: "通过",
    FAIL: "失败",
    BLOCKED: "阻塞",
    IMPLEMENTED: "已实现",
    MANUAL_VERIFIED: "已人工验证",
    NOT_VERIFIED: "未验证",
    NEEDS_MANUAL_VERIFICATION: "待人工验证",
    "MANUAL VERIFIED": "已人工验证",
    "NOT VERIFIED": "未验证",
    "NEEDS MANUAL VERIFICATION": "待人工验证",
    active: "已启用",
    experimental: "实验版",
  });

  function skillDisplayName(skillId) {
    return skillDisplayNames[skillId] || skillId || "手动 Skill";
  }

  function statusDisplayName(status) {
    return statusDisplayNames[status] || "状态未知";
  }

  function userErrorMessage(error, fallback) {
    const message = error instanceof Error ? error.message : String(error || "");
    return /[\u3400-\u9fff]/u.test(message) ? message : fallback;
  }

  function chineseResponseTaskInstruction(taskInstruction) {
    const task = String(taskInstruction || "").trim();
    return task
      ? `${responseLanguageInstruction}\n\n${task}`
      : responseLanguageInstruction;
  }

  function setDiagnostic(message, kind) {
    elements.diagnostic.textContent = message || "";
    elements.diagnostic.className = `diagnostic${kind ? ` ${kind}` : ""}`;
  }

  function selectedSyncedSkill() {
    return selectedSessionSkill(skillCache);
  }

  function currentSkillSelection() {
    if (elements.manualFallbackToggle.checked) {
      const content = elements.skillContent.value;
      if (!content.trim()) return null;
      const metadata = parseSkillMetadata(content);
      return {
        id: metadata.skillId,
        version: metadata.skillVersion,
        source: "manual",
        skillMarkdown: content,
      };
    }
    const skill = selectedSyncedSkill();
    return skill
      ? {
          id: skill.id,
          version: skill.version,
          source: "project_ai",
          skillMarkdown: skill.skillMarkdown,
        }
      : null;
  }

  function updateActionAvailability() {
    const chatReady = Boolean(
      pageStatus && pageStatus.supported && pageStatus.mode === "chat",
    );
    elements.injectButton.disabled = !chatReady || !currentSkillSelection();
    elements.refreshButton.disabled = !chatReady;
  }

  function setSiteStatus(status) {
    pageStatus = status;
    if (status && status.supported && status.mode === "project_ai") {
      elements.siteStatus.textContent = "Project AI：可同步";
      elements.siteStatus.className = "status status-supported";
      elements.syncButton.disabled = false;
      updateActionAvailability();
      return;
    }
    if (status && status.supported && status.mode === "chat") {
      elements.siteStatus.textContent = `${status.site}：已支持`;
      elements.siteStatus.className = "status status-supported";
      elements.syncButton.disabled = true;
      updateActionAvailability();
      return;
    }

    elements.siteStatus.textContent = "当前页面暂不支持";
    elements.siteStatus.className = "status status-unsupported";
    elements.syncButton.disabled = true;
    updateActionAvailability();
  }

  async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0] || typeof tabs[0].id !== "number") {
      throw new Error("未找到可用的浏览器标签页。");
    }
    return tabs[0];
  }

  async function sendToActiveTab(type, payload) {
    const tab = await activeTab();
    return chrome.tabs.sendMessage(tab.id, {
      source: "project-ai-uat-popup",
      type,
      ...(payload || {}),
    });
  }

  function responseError(response, fallback) {
    if (response && response.error) {
      const message = response.error.message || fallback;
      return response.error.code
        ? `错误：${message}\n错误代码：${response.error.code}`
        : `错误：${message}`;
    }
    return fallback;
  }

  function renderSkillCache() {
    elements.skillSelect.replaceChildren();
    if (!skillCache) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "请先从 Project AI 同步";
      elements.skillSelect.append(option);
      elements.skillSelect.disabled = true;
      elements.lastSynced.textContent = "本次浏览器会话尚未同步";
      elements.skillMetadata.textContent = "请选择 Project AI Skill";
      updateActionAvailability();
      return;
    }

    for (const skill of skillCache.skills) {
      const option = document.createElement("option");
      option.value = skill.id;
      option.textContent = `${skillDisplayName(skill.id)} · v${skill.version}`;
      elements.skillSelect.append(option);
    }
    elements.skillSelect.value = skillCache.selectedSkillId;
    elements.skillSelect.disabled = false;
    const syncedAt = new Date(skillCache.syncedAt);
    elements.lastSynced.textContent = Number.isNaN(syncedAt.getTime())
      ? `上次同步：${skillCache.syncedAt}`
      : `上次同步：${syncedAt.toLocaleString("zh-CN")}`;
    const selected = selectedSyncedSkill();
    elements.skillMetadata.textContent = selected
      ? `${skillDisplayName(selected.id)} · v${selected.version} · ${statusDisplayName(selected.status)}\nSkill ID：${selected.id} · 来源：Project AI`
      : "请选择 Project AI Skill";
    updateActionAvailability();
  }

  async function loadSessionSkills() {
    if (!sessionStorage) {
      skillCache = null;
      renderSkillCache();
      return;
    }
    skillCache = await getSkillSessionCache(sessionStorage);
    renderSkillCache();
  }

  async function refreshPageStatus() {
    try {
      const status = await sendToActiveTab("GET_STATUS");
      setSiteStatus(status);
      if (status && status.supported && status.mode === "project_ai") {
        setDiagnostic(
          "已识别 Project AI 测试环境。请确认已登录，然后同步 Skill。",
        );
      } else if (status && status.supported) {
        setDiagnostic(
          skillCache
            ? `已加载 ${status.site} 适配器。请选择已同步的 Skill，然后注入当前对话。`
            : "本次浏览器会话尚未同步 Skill。请先打开 Project AI 测试环境并完成登录，然后同步。",
        );
      }
    } catch {
      setSiteStatus(null);
      setDiagnostic(
        "请打开 Project AI 测试环境、ChatGPT、DeepSeek 或 Qwen 页面，然后重新打开浏览器插件。",
        "error",
      );
    }
  }

  async function syncProjectAiSkills() {
    try {
      if (!sessionStorage) {
        throw new Error("当前浏览器版本不支持会话缓存。");
      }
      elements.syncButton.disabled = true;
      setDiagnostic("正在通过当前 Project AI 会话同步正式 Skill…");
      const response = await sendToActiveTab("SYNC_PROJECT_AI_SKILLS");
      if (!response || !response.ok) {
        throw new Error(responseError(response, "Project AI Skill 同步失败。"));
      }
      skillCache = await saveSkillSessionCache(sessionStorage, response);
      renderSkillCache();
      setDiagnostic(
        `同步成功：本次浏览器会话已从 Project AI 同步 ${skillCache.skills.length} 个正式 Skill。`,
        "success",
      );
    } catch (error) {
      setDiagnostic(userErrorMessage(error, "同步失败，请确认已登录 Project AI 后重试。"), "error");
    } finally {
      elements.syncButton.disabled = !(
        pageStatus && pageStatus.supported && pageStatus.mode === "project_ai"
      );
    }
  }

  async function changeSelectedSkill() {
    try {
      if (!sessionStorage) throw new Error("浏览器会话缓存不可用。");
      skillCache = await selectSessionSkill(
        sessionStorage,
        elements.skillSelect.value,
      );
      renderSkillCache();
      const selected = selectedSyncedSkill();
      if (selected) {
        setDiagnostic(
          `已选择 ${skillDisplayName(selected.id)}（${selected.id}，v${selected.version}）。`,
          "success",
        );
      }
    } catch (error) {
      setDiagnostic(userErrorMessage(error, "Skill 选择失败，请重新同步后重试。"), "error");
    }
  }

  async function injectCurrentText() {
    try {
      const selection = currentSkillSelection();
      if (!selection) {
        throw new Error("请同步并选择一个 Project AI Skill，或启用手动备用方案。");
      }
      const text = formatInjection(
        selection.skillMarkdown,
        chineseResponseTaskInstruction(elements.taskInstruction.value),
      );
      const response = await sendToActiveTab("INJECT_TEXT", { text });
      if (!response || !response.ok) {
        throw new Error(responseError(response, "注入失败。"));
      }
      pageStatus = response;
      const skillLabel = selection.id
        ? `${skillDisplayName(selection.id)}${selection.version ? ` v${selection.version}` : ""}`
        : "手动 Skill";
      setDiagnostic(
        `已成功注入 ${skillLabel}，共 ${response.injectedLength} 个字符。AI 将使用简体中文回复；请检查后手动发送。`,
        "success",
      );
    } catch (error) {
      setDiagnostic(userErrorMessage(error, "注入失败，请确认当前页面受支持后重试。"), "error");
    }
  }

  function setLatestResponse(response) {
    latestResponse = response;
    elements.responsePreview.value = response ? response.text : "";
    const available = Boolean(response && response.text);
    elements.copyButton.disabled = !available;
    elements.downloadButton.disabled = !available;
    elements.saveButton.disabled = !available;
  }

  async function refreshLatestResponse() {
    try {
      const response = await sendToActiveTab("EXTRACT_LATEST_RESPONSE");
      if (!response || !response.ok) {
        throw new Error(responseError(response, "读取最新回复失败。"));
      }
      setLatestResponse(response);
      pageStatus = response;
      setDiagnostic(
        `已读取最新 AI 回复，共 ${response.text.length} 个字符。`,
        "success",
      );
    } catch (error) {
      setLatestResponse(null);
      setDiagnostic(userErrorMessage(error, "读取最新回复失败，请确认当前对话中已有 AI 回复。"), "error");
    }
  }

  async function copyLatestResponse() {
    try {
      await navigator.clipboard.writeText(latestResponse.text);
      setDiagnostic("已复制最新 AI 回复。", "success");
    } catch {
      setDiagnostic("复制失败，请重试。", "error");
    }
  }

  function triggerDownload(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function downloadLatestResponse() {
    triggerDownload(
      latestResponse.text,
      downloadFilename(pageStatus.site, new Date().toISOString(), "md"),
      "text/markdown;charset=utf-8",
    );
    setDiagnostic("已下载最新 AI 回复，内容保持原样。", "success");
  }

  async function updateSavedCount() {
    const results = await listUatResults(chrome.storage.local);
    elements.savedCount.textContent = `本地已保存 ${results.length} 条结果`;
    return results;
  }

  async function saveLatestResponse() {
    try {
      const selection = currentSkillSelection();
      if (!selection) {
        throw new Error("当前会话中已无法使用所选 Skill。");
      }
      const result = createUatResult({
        site: pageStatus.site,
        agent: pageStatus.agent,
        pageUrl: pageStatus.pageUrl,
        skillId: selection.id,
        skillVersion: selection.version,
        skillSource: selection.source,
        taskLabel: elements.taskLabel.value,
        rawResponse: latestResponse.text,
        notes: elements.notes.value,
      });
      const count = await saveUatResult(chrome.storage.local, result);
      elements.savedCount.textContent = `本地已保存 ${count} 条结果`;
      setDiagnostic(`已在本地保存 UAT 结果 ${result.id}。`, "success");
    } catch (error) {
      setDiagnostic(userErrorMessage(error, "保存失败，请重试。"), "error");
    }
  }

  async function exportResults(format) {
    try {
      const results = await updateSavedCount();
      const now = new Date().toISOString();
      if (format === "json") {
        triggerDownload(
          exportUatResultsJson(results, now),
          downloadFilename("results", now, "json"),
          "application/json;charset=utf-8",
        );
      } else {
        triggerDownload(
          exportUatResultsMarkdown(results, now),
          downloadFilename("summary", now, "md"),
          "text/markdown;charset=utf-8",
        );
      }
      setDiagnostic(`导出完成：共 ${results.length} 条已保存的 UAT 结果。`, "success");
    } catch {
      setDiagnostic("导出失败，请重试。", "error");
    }
  }

  function updateManualFallback() {
    elements.skillContent.disabled = !elements.manualFallbackToggle.checked;
    updateActionAvailability();
  }

  elements.syncButton.addEventListener("click", syncProjectAiSkills);
  elements.skillSelect.addEventListener("change", changeSelectedSkill);
  elements.manualFallbackToggle.addEventListener("change", updateManualFallback);
  elements.skillContent.addEventListener("input", updateActionAvailability);
  elements.injectButton.addEventListener("click", injectCurrentText);
  elements.refreshButton.addEventListener("click", refreshLatestResponse);
  elements.copyButton.addEventListener("click", copyLatestResponse);
  elements.downloadButton.addEventListener("click", downloadLatestResponse);
  elements.saveButton.addEventListener("click", saveLatestResponse);
  elements.exportJsonButton.addEventListener("click", () => exportResults("json"));
  elements.exportMarkdownButton.addEventListener("click", () => exportResults("markdown"));

  setLatestResponse(null);
  updateManualFallback();
  Promise.all([loadSessionSkills(), updateSavedCount()])
    .then(refreshPageStatus)
    .catch(() => {
      setDiagnostic("浏览器插件初始化失败，请关闭后重试。", "error");
    });
})(globalThis);
