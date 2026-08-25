import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const OFFICIAL_SKILL_IDS = [
  "project-weekly-report",
  "project-timeline-maker",
  "project-requirement-analyst",
  "project-feasibility-research",
] as const;

export type OfficialSkillId = (typeof OFFICIAL_SKILL_IDS)[number];

export type OfficialSkillMetadata = {
  id: OfficialSkillId;
  name: string;
  version: string;
  description: string;
  status: string;
  category: string | null;
  tags: string | null;
};

export type OfficialSkillAsset = OfficialSkillMetadata & {
  skillMarkdown: string;
  contentType: "text/markdown";
};

type CatalogEntry = {
  id: OfficialSkillId;
  directory: OfficialSkillId;
};

const catalogEntries: readonly CatalogEntry[] = OFFICIAL_SKILL_IDS.map((id) => ({
  id,
  directory: id,
}));

const catalogById = new Map(catalogEntries.map((entry) => [entry.id, entry]));

export class OfficialSkillCatalogError extends Error {
  constructor(
    public readonly status: 404 | 500,
    public readonly code: "SKILL_NOT_FOUND" | "SKILL_ASSET_UNAVAILABLE" | "SKILL_METADATA_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "OfficialSkillCatalogError";
  }
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function frontmatter(content: string): string | null {
  return /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content)?.[1] ?? null;
}

function topLevelValue(source: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^${escaped}:\\s*(.+?)\\s*$`, "mu").exec(source);
  return match ? unquoteYamlScalar(match[1]) : null;
}

function metadataValue(source: string, key: string): string | null {
  const block = /^metadata:\s*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))*)/mu.exec(source)?.[1];
  if (!block) return null;
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`^[ \\t]+${escaped}:\\s*(.+?)\\s*$`, "mu").exec(block);
  return match ? unquoteYamlScalar(match[1]) : null;
}

function parseMetadata(
  expectedId: OfficialSkillId,
  content: string,
): OfficialSkillMetadata {
  const source = frontmatter(content);
  if (!source) {
    throw new OfficialSkillCatalogError(
      500,
      "SKILL_METADATA_INVALID",
      `正式 Skill ${expectedId} 的元数据无效`,
    );
  }
  const id = metadataValue(source, "id");
  const name = topLevelValue(source, "name");
  const version = metadataValue(source, "version");
  const description = topLevelValue(source, "description");
  const status = metadataValue(source, "status");

  if (
    id !== expectedId ||
    name !== expectedId ||
    !version ||
    !description ||
    !status
  ) {
    throw new OfficialSkillCatalogError(
      500,
      "SKILL_METADATA_INVALID",
      `正式 Skill ${expectedId} 的元数据无效`,
    );
  }

  return {
    id: expectedId,
    name,
    version,
    description,
    status,
    category: metadataValue(source, "category"),
    tags: metadataValue(source, "tags"),
  };
}

export function isOfficialSkillId(value: string): value is OfficialSkillId {
  return catalogById.has(value as OfficialSkillId);
}

export async function loadOfficialSkill(skillId: string): Promise<OfficialSkillAsset> {
  const entry = catalogById.get(skillId as OfficialSkillId);
  if (!entry) {
    throw new OfficialSkillCatalogError(404, "SKILL_NOT_FOUND", "Skill 不存在");
  }

  let skillMarkdown: string;
  try {
    skillMarkdown = await readFile(
      join(process.cwd(), "skills", entry.directory, "SKILL.md"),
      "utf8",
    );
  } catch {
    throw new OfficialSkillCatalogError(
      500,
      "SKILL_ASSET_UNAVAILABLE",
      `正式 Skill ${entry.id} 资产不可用`,
    );
  }

  return {
    ...parseMetadata(entry.id, skillMarkdown),
    skillMarkdown,
    contentType: "text/markdown",
  };
}

export async function listOfficialSkills(): Promise<OfficialSkillMetadata[]> {
  const assets = await Promise.all(
    catalogEntries.map((entry) => loadOfficialSkill(entry.id)),
  );
  return assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    version: asset.version,
    description: asset.description,
    status: asset.status,
    category: asset.category,
    tags: asset.tags,
  }));
}
