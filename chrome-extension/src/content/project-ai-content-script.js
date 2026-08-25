/* global chrome */
(function registerProjectAiContentBridge(globalScope) {
  "use strict";

  const namespace = globalScope.ProjectAIUAT;
  const { matchProjectAiDeployment, skillApiUrl } = namespace.projectAiSource;
  const deployment = matchProjectAiDeployment(globalScope.location.href);

  class ProjectAiSyncError extends Error {
    constructor(code, message, details) {
      super(message);
      this.name = "ProjectAiSyncError";
      this.code = code;
      this.details = details || {};
    }
  }

  function statusPayload() {
    if (!deployment) {
      return {
        ok: true,
        supported: false,
        mode: "project_ai",
        site: "Unsupported",
      };
    }
    return {
      ok: true,
      supported: true,
      mode: "project_ai",
      site: deployment.label,
      source: "project_ai",
      sourceId: deployment.id,
      sourceOrigin: deployment.origin,
      sourceBasePath: deployment.basePath,
      pageUrl: `${globalScope.location.origin}${globalScope.location.pathname}`,
    };
  }

  async function responseJson(response) {
    const contentType = response.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) return null;
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  async function fetchSkillJson(relativePath) {
    const response = await globalScope.fetch(skillApiUrl(deployment, relativePath), {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    const body = await responseJson(response);

    if (response.status === 401) {
      throw new ProjectAiSyncError(
        "PROJECT_AI_UNAUTHENTICATED",
        "请先登录 Project AI，然后重试 Sync。",
      );
    }
    if (!response.ok) {
      const remoteCode = body && body.error && body.error.code;
      throw new ProjectAiSyncError(
        "PROJECT_AI_SKILL_API_FAILED",
        "Project AI Skill 同步失败，请在 Staging 页面重试。",
        { status: response.status, remoteCode: remoteCode || null },
      );
    }
    if (!body || body.source !== "project_ai") {
      throw new ProjectAiSyncError(
        "PROJECT_AI_RESPONSE_INVALID",
        "Project AI 返回了无效的 Skill 响应。",
      );
    }
    return body;
  }

  function cleanMetadata(value) {
    if (
      !value ||
      typeof value.id !== "string" ||
      !/^project-[a-z0-9-]+$/.test(value.id) ||
      typeof value.name !== "string" ||
      typeof value.version !== "string" ||
      typeof value.description !== "string" ||
      typeof value.status !== "string"
    ) {
      throw new ProjectAiSyncError(
        "PROJECT_AI_RESPONSE_INVALID",
        "Project AI 返回了无效的 Skill metadata。",
      );
    }
    return {
      id: value.id,
      name: value.name,
      version: value.version,
      description: value.description,
      status: value.status,
      category: typeof value.category === "string" ? value.category : null,
      tags: typeof value.tags === "string" ? value.tags : null,
    };
  }

  async function syncOfficialSkills() {
    if (!deployment) {
      throw new ProjectAiSyncError(
        "UNSUPPORTED_PROJECT_AI_PAGE",
        "请在当前 Project AI Staging 页面打开 Extension。",
      );
    }

    const listBody = await fetchSkillJson("/api/skills");
    if (!Array.isArray(listBody.skills) || listBody.skills.length === 0) {
      throw new ProjectAiSyncError(
        "PROJECT_AI_RESPONSE_INVALID",
        "Project AI 没有返回可分发的正式 Skill。",
      );
    }
    const metadata = listBody.skills.map(cleanMetadata);
    const uniqueIds = new Set(metadata.map((skill) => skill.id));
    if (uniqueIds.size !== metadata.length) {
      throw new ProjectAiSyncError(
        "PROJECT_AI_RESPONSE_INVALID",
        "Project AI 返回了重复的 Skill ID。",
      );
    }

    const skills = await Promise.all(
      metadata.map(async (listedSkill) => {
        const readBody = await fetchSkillJson(
          `/api/skills/${encodeURIComponent(listedSkill.id)}`,
        );
        const readSkill = cleanMetadata(readBody.skill);
        if (
          readSkill.id !== listedSkill.id ||
          readSkill.version !== listedSkill.version ||
          typeof readBody.skill.skillMarkdown !== "string" ||
          readBody.skill.skillMarkdown.length === 0
        ) {
          throw new ProjectAiSyncError(
            "PROJECT_AI_RESPONSE_INVALID",
            `Project AI 返回的 ${listedSkill.id} 内容与列表不一致。`,
          );
        }
        return {
          ...readSkill,
          skillMarkdown: readBody.skill.skillMarkdown,
        };
      }),
    );

    return {
      ok: true,
      ...statusPayload(),
      syncedAt: new Date().toISOString(),
      skills,
    };
  }

  function diagnostic(error) {
    if (error instanceof ProjectAiSyncError) {
      return {
        code: error.code,
        message: error.message,
        details: error.details,
      };
    }
    return {
      code: "PROJECT_AI_SYNC_FAILED",
      message: "Project AI Skill 同步失败，请确认已登录并重试。",
      details: {},
    };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.source !== "project-ai-uat-popup") return false;
    if (message.type === "GET_STATUS") {
      sendResponse(statusPayload());
      return false;
    }
    if (message.type === "SYNC_PROJECT_AI_SKILLS") {
      syncOfficialSkills()
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: diagnostic(error) }));
      return true;
    }
    sendResponse({
      ok: false,
      error: {
        code: "UNKNOWN_MESSAGE",
        message: "The Extension received an unknown Project AI operation.",
      },
    });
    return false;
  });
})(globalThis);
