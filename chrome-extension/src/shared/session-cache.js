(function registerSessionCache(globalScope) {
  "use strict";

  const namespace = (globalScope.ProjectAIUAT =
    globalScope.ProjectAIUAT || {});
  const STORAGE_KEY = "projectAiSyncedSkillsV1";
  const SCHEMA_VERSION = 1;

  function cleanSkill(value) {
    if (
      !value ||
      typeof value.id !== "string" ||
      typeof value.name !== "string" ||
      typeof value.version !== "string" ||
      typeof value.description !== "string" ||
      typeof value.status !== "string" ||
      typeof value.skillMarkdown !== "string" ||
      value.skillMarkdown.length === 0
    ) {
      return null;
    }
    return {
      id: value.id,
      name: value.name,
      version: value.version,
      description: value.description,
      status: value.status,
      category: typeof value.category === "string" ? value.category : null,
      tags: typeof value.tags === "string" ? value.tags : null,
      skillMarkdown: value.skillMarkdown,
    };
  }

  function cleanCache(value) {
    if (
      !value ||
      value.schemaVersion !== SCHEMA_VERSION ||
      value.source !== "project_ai" ||
      typeof value.sourceOrigin !== "string" ||
      typeof value.sourceBasePath !== "string" ||
      typeof value.syncedAt !== "string" ||
      !Array.isArray(value.skills)
    ) {
      return null;
    }
    const skills = value.skills.map(cleanSkill);
    if (skills.some((skill) => !skill) || skills.length === 0) return null;
    const selectedSkillId = skills.some(
      (skill) => skill.id === value.selectedSkillId,
    )
      ? value.selectedSkillId
      : skills[0].id;
    return {
      schemaVersion: SCHEMA_VERSION,
      source: "project_ai",
      sourceOrigin: value.sourceOrigin,
      sourceBasePath: value.sourceBasePath,
      syncedAt: value.syncedAt,
      selectedSkillId,
      skills,
    };
  }

  async function getSkillSessionCache(storageArea) {
    const stored = await storageArea.get(STORAGE_KEY);
    return cleanCache(stored && stored[STORAGE_KEY]);
  }

  async function saveSkillSessionCache(storageArea, syncPayload) {
    const previous = await getSkillSessionCache(storageArea);
    const candidate = cleanCache({
      schemaVersion: SCHEMA_VERSION,
      source: syncPayload && syncPayload.source,
      sourceOrigin: syncPayload && syncPayload.sourceOrigin,
      sourceBasePath: syncPayload && syncPayload.sourceBasePath,
      syncedAt: syncPayload && syncPayload.syncedAt,
      selectedSkillId: previous && previous.selectedSkillId,
      skills: syncPayload && syncPayload.skills,
    });
    if (!candidate) {
      throw new TypeError("Project AI Skill 同步数据无效。");
    }
    await storageArea.set({ [STORAGE_KEY]: candidate });
    return candidate;
  }

  async function selectSessionSkill(storageArea, skillId) {
    const cache = await getSkillSessionCache(storageArea);
    if (!cache || !cache.skills.some((skill) => skill.id === skillId)) {
      throw new TypeError("所选 Project AI Skill 不在当前会话缓存中。");
    }
    const next = { ...cache, selectedSkillId: skillId };
    await storageArea.set({ [STORAGE_KEY]: next });
    return next;
  }

  function selectedSessionSkill(cache) {
    if (!cache) return null;
    return cache.skills.find((skill) => skill.id === cache.selectedSkillId) || null;
  }

  namespace.sessionCache = {
    SCHEMA_VERSION,
    STORAGE_KEY,
    getSkillSessionCache,
    saveSkillSessionCache,
    selectSessionSkill,
    selectedSessionSkill,
  };
})(globalThis);
