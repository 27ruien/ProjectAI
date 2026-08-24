import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  WEEKLY_REPORT_SKILL_ID,
  WEEKLY_REPORT_SKILL_VERSION,
} from "./contracts";
import { WeeklyReportError } from "./errors";

export type WeeklyReportSkillAsset = {
  id: typeof WEEKLY_REPORT_SKILL_ID;
  version: typeof WEEKLY_REPORT_SKILL_VERSION;
  sha256: string;
  content: string;
  files: Record<string, string>;
  contentType: "text/markdown";
};

function frontmatterValue(content: string, key: string): string | null {
  const frontmatter = /^---\n([\s\S]*?)\n---/u.exec(content)?.[1];
  if (!frontmatter) return null;
  const pattern = new RegExp("^" + key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") + ":\\s*[\"']?([^\\n\"']+)[\"']?\\s*$", "mu");
  return pattern.exec(frontmatter)?.[1]?.trim() ?? null;
}

export async function loadWeeklyReportSkill(): Promise<WeeklyReportSkillAsset> {
  const skillDirectory = join(
    process.cwd(),
    "skills",
    WEEKLY_REPORT_SKILL_ID,
  );
  const assetPaths = [
    "SKILL.md",
    "agents/openai.yaml",
    "references/schema.md",
    "references/examples.md",
  ];
  let files: Record<string, string>;
  try {
    files = Object.fromEntries(await Promise.all(
      assetPaths.map(async (assetPath) => [
        assetPath,
        await readFile(join(skillDirectory, assetPath), "utf8"),
      ] as const),
    ));
  } catch {
    throw new WeeklyReportError(500, "WEEKLY_REPORT_SKILL_UNAVAILABLE", "周报 Skill 资产不可用");
  }
  const content = files["SKILL.md"];
  if (
    frontmatterValue(content, "name") !== WEEKLY_REPORT_SKILL_ID ||
    !content.includes("version: \"" + WEEKLY_REPORT_SKILL_VERSION + "\"")
  ) {
    throw new WeeklyReportError(500, "WEEKLY_REPORT_SKILL_INVALID", "周报 Skill 版本或元数据无效");
  }
  return {
    id: WEEKLY_REPORT_SKILL_ID,
    version: WEEKLY_REPORT_SKILL_VERSION,
    sha256: createHash("sha256")
      .update(assetPaths.map((assetPath) => assetPath + "\0" + files[assetPath]).join("\0"))
      .digest("hex"),
    content,
    files,
    contentType: "text/markdown",
  };
}
