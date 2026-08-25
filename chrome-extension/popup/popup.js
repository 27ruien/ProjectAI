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
      elements.siteStatus.textContent = "Project AI: Sync ready";
      elements.siteStatus.className = "status status-supported";
      elements.syncButton.disabled = false;
      updateActionAvailability();
      return;
    }
    if (status && status.supported && status.mode === "chat") {
      elements.siteStatus.textContent = `${status.site}: Supported`;
      elements.siteStatus.className = "status status-supported";
      elements.syncButton.disabled = true;
      updateActionAvailability();
      return;
    }

    elements.siteStatus.textContent = "Unsupported page";
    elements.siteStatus.className = "status status-unsupported";
    elements.syncButton.disabled = true;
    updateActionAvailability();
  }

  async function activeTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0] || typeof tabs[0].id !== "number") {
      throw new Error("No active browser tab is available.");
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
      const code = response.error.code ? `[${response.error.code}] ` : "";
      return `${code}${response.error.message || fallback}`;
    }
    return fallback;
  }

  function renderSkillCache() {
    elements.skillSelect.replaceChildren();
    if (!skillCache) {
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "Sync from Project AI first";
      elements.skillSelect.append(option);
      elements.skillSelect.disabled = true;
      elements.lastSynced.textContent = "Not synced in this browser session";
      elements.skillMetadata.textContent = "No Project AI Skill selected";
      updateActionAvailability();
      return;
    }

    for (const skill of skillCache.skills) {
      const option = document.createElement("option");
      option.value = skill.id;
      option.textContent = `${skill.id} v${skill.version}`;
      elements.skillSelect.append(option);
    }
    elements.skillSelect.value = skillCache.selectedSkillId;
    elements.skillSelect.disabled = false;
    const syncedAt = new Date(skillCache.syncedAt);
    elements.lastSynced.textContent = Number.isNaN(syncedAt.getTime())
      ? `Last synced: ${skillCache.syncedAt}`
      : `Last synced: ${syncedAt.toLocaleString()}`;
    const selected = selectedSyncedSkill();
    elements.skillMetadata.textContent = selected
      ? `${selected.name} · v${selected.version} · ${selected.status} · source = Project AI`
      : "No Project AI Skill selected";
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
          "Project AI Staging recognized. Confirm you are logged in, then click Sync Skills.",
        );
      } else if (status && status.supported) {
        setDiagnostic(
          skillCache
            ? `${status.site} adapter loaded. Select the synced Skill and inject when ready.`
            : "No Skill is synced in this browser session. Open Project AI Staging, log in, and Sync first.",
        );
      }
    } catch {
      setSiteStatus(null);
      setDiagnostic(
        "Open Project AI Staging, chatgpt.com, chat.deepseek.com, or chat.qwen.ai, then reopen the Extension.",
        "error",
      );
    }
  }

  async function syncProjectAiSkills() {
    try {
      if (!sessionStorage) {
        throw new Error("chrome.storage.session is unavailable in this Chrome version.");
      }
      elements.syncButton.disabled = true;
      setDiagnostic("Syncing official Skills through the current Project AI session…");
      const response = await sendToActiveTab("SYNC_PROJECT_AI_SKILLS");
      if (!response || !response.ok) {
        throw new Error(responseError(response, "Project AI Skill sync failed."));
      }
      skillCache = await saveSkillSessionCache(sessionStorage, response);
      renderSkillCache();
      setDiagnostic(
        `Synced ${skillCache.skills.length} official Skills from Project AI for this browser session.`,
        "success",
      );
    } catch (error) {
      setDiagnostic(error instanceof Error ? error.message : String(error), "error");
    } finally {
      elements.syncButton.disabled = !(
        pageStatus && pageStatus.supported && pageStatus.mode === "project_ai"
      );
    }
  }

  async function changeSelectedSkill() {
    try {
      if (!sessionStorage) throw new Error("Session cache is unavailable.");
      skillCache = await selectSessionSkill(
        sessionStorage,
        elements.skillSelect.value,
      );
      renderSkillCache();
      const selected = selectedSyncedSkill();
      if (selected) {
        setDiagnostic(
          `Selected ${selected.id} v${selected.version} from Project AI.`,
          "success",
        );
      }
    } catch (error) {
      setDiagnostic(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function injectCurrentText() {
    try {
      const selection = currentSkillSelection();
      if (!selection) {
        throw new Error("Sync and select a Project AI Skill, or enable the manual fallback.");
      }
      const text = formatInjection(
        selection.skillMarkdown,
        elements.taskInstruction.value,
      );
      const response = await sendToActiveTab("INJECT_TEXT", { text });
      if (!response || !response.ok) {
        throw new Error(responseError(response, "Injection failed."));
      }
      pageStatus = response;
      const skillLabel = selection.id
        ? `${selection.id}${selection.version ? ` v${selection.version}` : ""}`
        : "manual Skill";
      setDiagnostic(
        `Injected ${skillLabel} (${response.injectedLength} characters) using ${response.composerSelector}. Review and send manually.`,
        "success",
      );
    } catch (error) {
      setDiagnostic(error instanceof Error ? error.message : String(error), "error");
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
        throw new Error(responseError(response, "Response extraction failed."));
      }
      setLatestResponse(response);
      pageStatus = response;
      setDiagnostic(
        `Loaded ${response.text.length} characters from the newest non-empty assistant response.`,
        "success",
      );
    } catch (error) {
      setLatestResponse(null);
      setDiagnostic(error instanceof Error ? error.message : String(error), "error");
    }
  }

  async function copyLatestResponse() {
    try {
      await navigator.clipboard.writeText(latestResponse.text);
      setDiagnostic("Latest assistant response copied.", "success");
    } catch (error) {
      setDiagnostic(
        `Copy failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
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
    setDiagnostic("Latest assistant response downloaded without rewriting.", "success");
  }

  async function updateSavedCount() {
    const results = await listUatResults(chrome.storage.local);
    elements.savedCount.textContent = `${results.length} result${
      results.length === 1 ? "" : "s"
    } saved locally`;
    return results;
  }

  async function saveLatestResponse() {
    try {
      const selection = currentSkillSelection();
      if (!selection) {
        throw new Error("The selected Skill is no longer available in this session.");
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
      elements.savedCount.textContent = `${count} result${count === 1 ? "" : "s"} saved locally`;
      setDiagnostic(`Saved UAT Result ${result.id} locally.`, "success");
    } catch (error) {
      setDiagnostic(
        `Save failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
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
      setDiagnostic(`Exported ${results.length} saved UAT Result${results.length === 1 ? "" : "s"}.`, "success");
    } catch (error) {
      setDiagnostic(
        `Export failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
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
    .catch((error) => {
      setDiagnostic(
        `Extension initialization failed: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    });
})(globalThis);
