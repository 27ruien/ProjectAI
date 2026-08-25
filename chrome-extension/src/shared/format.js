(function registerFormat(globalScope) {
  "use strict";

  const namespace = (globalScope.ProjectAIUAT =
    globalScope.ProjectAIUAT || {});

  function formatInjection(rawSkill, taskInstruction) {
    if (typeof rawSkill !== "string" || rawSkill.trim().length === 0) {
      throw new TypeError("请输入 Skill 内容。");
    }

    const task = typeof taskInstruction === "string" ? taskInstruction : "";
    if (task.trim().length === 0) {
      return rawSkill;
    }

    const skillBoundary = rawSkill.endsWith("\n") ? "" : "\n";
    const taskBoundary = task.endsWith("\n") ? "" : "\n";

    return [
      "<SKILL>\n",
      rawSkill,
      skillBoundary,
      "</SKILL>\n\n<USER_TASK>\n",
      task,
      taskBoundary,
      "</USER_TASK>",
    ].join("");
  }

  function parseSkillMetadata(rawSkill) {
    if (typeof rawSkill !== "string" || rawSkill.length === 0) {
      return { skillId: null, skillVersion: null };
    }

    const frontmatterMatch = rawSkill.match(/^---\s*\n([\s\S]*?)\n---(?:\s*\n|$)/);
    const searchable = frontmatterMatch ? frontmatterMatch[1] : rawSkill;

    function firstValue(labels) {
      for (const label of labels) {
        const expression = new RegExp(
          `^\\s*${label}\\s*:\\s*["']?([^\\n"']+?)["']?\\s*$`,
          "im",
        );
        const match = searchable.match(expression);
        if (match && match[1].trim()) return match[1].trim();
      }
      return null;
    }

    return {
      skillId: firstValue(["id", "name", "skillId", "skill_id"]),
      skillVersion: firstValue(["version", "skillVersion", "skill_version"]),
    };
  }

  namespace.format = { formatInjection, parseSkillMetadata };
})(globalThis);
