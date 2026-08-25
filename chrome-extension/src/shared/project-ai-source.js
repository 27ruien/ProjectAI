(function registerProjectAiSource(globalScope) {
  "use strict";

  const namespace = (globalScope.ProjectAIUAT =
    globalScope.ProjectAIUAT || {});

  const DEPLOYMENTS = Object.freeze([
    Object.freeze({
      id: "project_ai_staging",
      label: "Project AI Staging",
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
      throw new TypeError("Project AI deployment is not allowlisted.");
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
      throw new TypeError("Project AI Skill API path is invalid.");
    }
    return `${deployment.origin}${deployment.basePath}${relativePath}`;
  }

  namespace.projectAiSource = {
    DEPLOYMENTS,
    matchProjectAiDeployment,
    skillApiUrl,
  };
})(globalThis);
