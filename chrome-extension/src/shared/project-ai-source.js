(function registerProjectAiSource(globalScope) {
  "use strict";

  const namespace = (globalScope.ProjectAIUAT =
    globalScope.ProjectAIUAT || {});

  const DEPLOYMENTS = Object.freeze([
    Object.freeze({
      id: "project_ai_staging",
      label: "Project AI 测试环境",
      origin: "https://gridworks.cn",
      basePath: "/tool/projectai-slim-uat",
    }),
  ]);

  function matchProjectAiDeployment(value) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return null;
    }

    return (
      DEPLOYMENTS.find(
        (deployment) =>
          parsed.protocol === "https:" &&
          parsed.origin === deployment.origin &&
          (parsed.pathname === deployment.basePath ||
            parsed.pathname.startsWith(`${deployment.basePath}/`)),
      ) || null
    );
  }

  function skillApiUrl(deployment, relativePath) {
    if (!DEPLOYMENTS.includes(deployment)) {
      throw new TypeError("当前 Project AI 环境不在允许列表中。");
    }
    if (
      typeof relativePath !== "string" ||
      !(
        relativePath === "/api/skills" ||
        /^\/api\/skills\/[a-z0-9-]+$/.test(relativePath)
      ) ||
      relativePath.includes("..") ||
      relativePath.includes("\\")
    ) {
      throw new TypeError("Project AI Skill API 路径无效。");
    }
    return `${deployment.origin}${deployment.basePath}${relativePath}`;
  }

  namespace.projectAiSource = {
    DEPLOYMENTS,
    matchProjectAiDeployment,
    skillApiUrl,
  };
})(globalThis);
