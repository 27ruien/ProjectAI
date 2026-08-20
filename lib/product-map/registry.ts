import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { z } from "zod";
import {
  PRODUCT_MAP_ARTIFACT_KIND,
  PRODUCT_MAP_SCHEMA_VERSION,
  PRODUCT_MAP_SKILL_FILE_PATH,
  PRODUCT_MAP_SKILL_FILE_SHA256,
  PRODUCT_MAP_SKILL_ID,
  PRODUCT_MAP_SKILL_VERSION,
  PRODUCT_MAP_STEP_IDS,
  PRODUCT_MAP_STEP_LABELS,
  productMapArtifactSchema,
  productMapConfigInputSchema,
} from "./contracts";

export type SkillSchemaDescriptor = Readonly<{
  name: string;
  version: string;
  description: string;
  jsonSchema: Readonly<Record<string, unknown>>;
}>;

export type RegisteredSkillStep = Readonly<{
  id: string;
  name: string;
  order: number;
}>;

export type RegisteredSkill = Readonly<{
  id: string;
  version: string;
  name: string;
  displayName: string;
  description: string;
  enabled: boolean;
  status: "active" | "inactive" | "deprecated";
  skillFilePath: string;
  skillFileSha256: string;
  inputSchema: SkillSchemaDescriptor;
  outputSchema: SkillSchemaDescriptor;
  inputValidator: z.ZodTypeAny;
  outputValidator: z.ZodTypeAny;
  steps: readonly RegisteredSkillStep[];
  artifactKind: string;
  approvalRequired: boolean;
}>;

export type PublicSkillMetadata = Omit<
  RegisteredSkill,
  "inputValidator" | "outputValidator"
>;

const idPattern = /^[a-z][a-z0-9-]{1,79}$/;
const versionPattern = /^\d+\.\d+\.\d+$/;
const digestPattern = /^[a-f0-9]{64}$/;

function assertRegistryEntry(entry: RegisteredSkill): void {
  if (!idPattern.test(entry.id)) throw new Error(`SKILL_REGISTRY_INVALID_ID:${entry.id}`);
  if (!versionPattern.test(entry.version)) throw new Error(`SKILL_REGISTRY_INVALID_VERSION:${entry.version}`);
  if (!entry.skillFilePath || entry.skillFilePath.startsWith("/") || entry.skillFilePath.includes("..")) {
    throw new Error(`SKILL_REGISTRY_INVALID_FILE_PATH:${entry.id}`);
  }
  if (!digestPattern.test(entry.skillFileSha256)) throw new Error(`SKILL_REGISTRY_INVALID_FILE_DIGEST:${entry.id}`);
  if (entry.inputSchema.version !== entry.version || entry.outputSchema.version !== entry.version) {
    throw new Error(`SKILL_REGISTRY_SCHEMA_VERSION_MISMATCH:${entry.id}`);
  }
  const orders = new Set<number>();
  for (const step of entry.steps) {
    if (!idPattern.test(step.id.replaceAll("_", "-"))) throw new Error(`SKILL_REGISTRY_INVALID_STEP:${entry.id}`);
    if (!Number.isInteger(step.order) || step.order < 1 || orders.has(step.order)) {
      throw new Error(`SKILL_REGISTRY_INVALID_STEP_ORDER:${entry.id}`);
    }
    orders.add(step.order);
  }
}

function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

/**
 * Server-side registry for executable Skills.  A registry entry is immutable
 * after registration and a duplicate id/version is rejected, preventing a
 * browser payload or module import order from silently replacing a Skill.
 */
export class SkillRegistry {
  private readonly skills = new Map<string, Map<string, RegisteredSkill>>();

  constructor(entries: readonly RegisteredSkill[] = []) {
    entries.forEach((entry) => this.register(entry));
  }

  register(entry: RegisteredSkill): void {
    assertRegistryEntry(entry);
    const versions = this.skills.get(entry.id) ?? new Map<string, RegisteredSkill>();
    if (versions.has(entry.version)) throw new Error(`SKILL_REGISTRY_DUPLICATE:${entry.id}@${entry.version}`);
    versions.set(entry.version, Object.freeze({ ...entry, steps: Object.freeze([...entry.steps]) }));
    this.skills.set(entry.id, versions);
  }

  get(id: string, version?: string): RegisteredSkill | undefined {
    const versions = this.skills.get(id);
    if (!versions) return undefined;
    if (version) return versions.get(version);
    return [...versions.values()].sort((left, right) => compareVersions(right.version, left.version))[0];
  }

  require(id: string, version?: string): RegisteredSkill {
    const entry = this.get(id, version);
    if (!entry) throw new Error(`SKILL_NOT_FOUND:${id}${version ? `@${version}` : ""}`);
    return entry;
  }

  requireEnabled(id: string, version?: string): RegisteredSkill {
    const entry = this.require(id, version);
    if (!entry.enabled || entry.status !== "active") throw new Error(`SKILL_DISABLED:${id}@${entry.version}`);
    return entry;
  }

  list(options: { enabledOnly?: boolean } = {}): RegisteredSkill[] {
    const entries = [...this.skills.values()].flatMap((versions) => [...versions.values()]);
    return (options.enabledOnly ? entries.filter((entry) => entry.enabled && entry.status === "active") : entries)
      .sort((left, right) => left.id.localeCompare(right.id) || compareVersions(right.version, left.version));
  }

  listEnabled(): RegisteredSkill[] {
    return this.list({ enabledOnly: true });
  }

  has(id: string, version?: string): boolean {
    return this.get(id, version) !== undefined;
  }
}

const inputSchemaDescriptor: SkillSchemaDescriptor = Object.freeze({
  name: "ProductMapConfigInput",
  version: PRODUCT_MAP_SKILL_VERSION,
  description: "项目、授权资料、检索说明和可选用户输入；不包含 Provider、模型或凭据。",
  jsonSchema: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: ["projectId", "selectedSourceIds", "idempotencyKey"],
    properties: {
      projectId: { type: "string", minLength: 1, maxLength: 200 },
      selectedSourceIds: { type: "array", maxItems: 20, items: { type: "string" } },
      contextReferences: {
        type: "array",
        maxItems: 33,
        items: {
          oneOf: [
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "projectId", "label"],
              properties: {
                type: { const: "project" },
                projectId: { type: "string", minLength: 1, maxLength: 200 },
                label: { type: "string", minLength: 1, maxLength: 200 },
              },
            },
            {
              type: "object",
              additionalProperties: false,
              required: ["type", "documentId", "sourceType", "label"],
              properties: {
                type: { const: "document" },
                documentId: { type: "string", minLength: 1, maxLength: 200 },
                documentVersionId: { type: "string", minLength: 1, maxLength: 200 },
                sourceType: { enum: ["project", "company"] },
                label: { type: "string", minLength: 1, maxLength: 200 },
              },
            },
          ],
        },
        default: [],
      },
      retrievalInstruction: { type: "string", maxLength: 4_000 },
      userInput: { type: "string", maxLength: 20_000 },
      conversationId: { type: "string", maxLength: 200 },
      includeConversationContext: { type: "boolean", default: false },
      initialAttachment: { type: "boolean", default: false },
      idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
    },
  }),
});

const outputSchemaDescriptor: SkillSchemaDescriptor = Object.freeze({
  name: "ProductMapArtifact",
  version: PRODUCT_MAP_SKILL_VERSION,
  description: "可追溯的 PM 产品结构草案：JSON 含来源、目标/方案区分、范围、角色、主/异常路径与 Action/State；服务端据此生成等价 Markdown 和 Mermaid。",
  jsonSchema: Object.freeze({
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "integrityNote",
      "completeness",
      "materialInventory",
      "projectUnderstanding",
      "goals",
      "userPath",
      "productMap",
      "pages",
      "features",
      "risksAndQuestions",
      "quality",
      "citations",
      "stepOutputs",
      "handoffSummary",
      "analysisContract",
      "structureReview",
    ],
    properties: {
      schemaVersion: { const: PRODUCT_MAP_SCHEMA_VERSION },
      integrityNote: { type: "string", maxLength: 2_000 },
      completeness: { type: "object" },
      materialInventory: { type: "object" },
      projectUnderstanding: { type: "object" },
      goals: { type: "object" },
      userPath: { type: "object" },
      productMap: { type: "object" },
      pages: { type: "object", description: "最多 20 个页面" },
      features: { type: "object", description: "最多 40 个功能" },
      risksAndQuestions: { type: "object" },
      quality: { type: "object" },
      citations: { type: "array", maxItems: 33 },
      stepOutputs: { type: "array", minItems: PRODUCT_MAP_STEP_IDS.length, maxItems: PRODUCT_MAP_STEP_IDS.length },
      handoffSummary: { type: "object" },
      analysisContract: {
        type: "object",
        description: "新生成草案的 PM 分析合同：来源、业务目标/用户目标与方案区分、范围、角色、主/异常路径与五态证据覆盖。",
      },
      structureReview: {
        type: "object",
        description: "服务端确定性 PM/Design Lint 的版本、结果与结构化问题；不含模型推理或 Chain-of-Thought。",
      },
    },
  }),
});

export const PRODUCT_MAP_SKILL_DEFINITION: RegisteredSkill = Object.freeze({
  id: PRODUCT_MAP_SKILL_ID,
  version: PRODUCT_MAP_SKILL_VERSION,
  name: "Product Map",
  displayName: "Product Map｜产品结构",
  description: "从授权项目资料和用户输入整理可追溯的需求理解、用户路径与产品功能结构。",
  enabled: true,
  status: "active",
  skillFilePath: PRODUCT_MAP_SKILL_FILE_PATH,
  skillFileSha256: PRODUCT_MAP_SKILL_FILE_SHA256,
  inputSchema: inputSchemaDescriptor,
  outputSchema: outputSchemaDescriptor,
  inputValidator: productMapConfigInputSchema,
  outputValidator: productMapArtifactSchema,
  steps: Object.freeze(PRODUCT_MAP_STEP_IDS.map((id, index) => Object.freeze({
    id,
    name: PRODUCT_MAP_STEP_LABELS[id],
    order: index + 1,
  }))),
  artifactKind: PRODUCT_MAP_ARTIFACT_KIND,
  approvalRequired: true,
});
export const PRODUCT_MAP_SKILL = PRODUCT_MAP_SKILL_DEFINITION;

export const productMapSkillRegistry = new SkillRegistry([
  PRODUCT_MAP_SKILL_DEFINITION,
]);
// Generic alias for server code that needs the unified registry without
// knowing which built-in Skill supplied an entry.
export const skillRegistry = productMapSkillRegistry;

export function getProductMapSkill(version?: string): RegisteredSkill {
  return productMapSkillRegistry.requireEnabled(PRODUCT_MAP_SKILL_ID, version);
}

export function listPublicSkills(): PublicSkillMetadata[] {
  return productMapSkillRegistry.listEnabled().map((entry) => ({
    id: entry.id,
    version: entry.version,
    name: entry.name,
    displayName: entry.displayName,
    description: entry.description,
    enabled: entry.enabled,
    status: entry.status,
    skillFilePath: entry.skillFilePath,
    skillFileSha256: entry.skillFileSha256,
    inputSchema: entry.inputSchema,
    outputSchema: entry.outputSchema,
    steps: entry.steps,
    artifactKind: entry.artifactKind,
    approvalRequired: entry.approvalRequired,
  }));
}

let trustedProductMapInstructions: Promise<string> | null = null;

/**
 * Load the supplied Skill instructions from the fixed repository path and
 * verify their digest before they are sent to a model.  The browser can only
 * select a registry id/version; it can never provide a path or replace the
 * instructions.  A missing or drifted file fails closed rather than silently
 * running a different Product Map contract.
 */
export function loadTrustedProductMapInstructions(): Promise<string> {
  if (!trustedProductMapInstructions) {
    trustedProductMapInstructions = (async () => {
      const root = process.cwd();
      const filePath = resolve(root, PRODUCT_MAP_SKILL_FILE_PATH);
      const rel = relative(root, filePath);
      if (isAbsolute(rel) || rel.startsWith("..")) {
        throw new Error("PRODUCT_MAP_SKILL_PATH_INVALID");
      }
      const content = await readFile(filePath, "utf8");
      if (content.length === 0 || content.length > 64_000) {
        throw new Error("PRODUCT_MAP_SKILL_FILE_INVALID");
      }
      const actualDigest = createHash("sha256").update(content).digest("hex");
      if (actualDigest !== PRODUCT_MAP_SKILL_FILE_SHA256) {
        throw new Error("PRODUCT_MAP_SKILL_DIGEST_MISMATCH");
      }
      return content;
    })();
  }
  return trustedProductMapInstructions;
}
