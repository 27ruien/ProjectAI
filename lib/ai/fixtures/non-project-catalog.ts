import type { AIModel, AIModelProfile, AIProvider } from "@/types";

const AUDIT = {
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  createdBy: "Mock AI Gateway",
};

/**
 * Minimal non-project fixtures used only to make the in-browser Mock Gateway
 * runnable. Product catalog screens receive their catalog from the server.
 */
export const safeMockAIProviders: AIProvider[] = [
  {
    id: "mock-provider",
    providerId: "mock-provider",
    providerName: "Local Mock Provider",
    providerType: "internal",
    baseUrl: "mock://local",
    region: "Local",
    status: "active",
    priority: 1,
    timeout: 5_000,
    concurrencyLimit: 10,
    monthlyBudget: 0,
    currentSpend: 0,
    secretConfigured: false,
    ...AUDIT,
  },
];

export const safeMockAIModels: AIModel[] = [
  {
    id: "mock-universal-model",
    modelId: "mock-universal-model",
    displayName: "Local Mock Model",
    providerId: "mock-provider",
    providerModelName: "mock-universal",
    modelType: "reasoning",
    capabilityTags: [
      "text",
      "structuredOutput",
      "toolCalling",
      "fileInput",
      "embedding",
    ],
    contextWindow: 16_384,
    maxOutputTokens: 4_096,
    qualityLevel: "medium",
    speedLevel: "high",
    costLevel: "low",
    status: "active",
    ...AUDIT,
  },
];

const profileNames: Record<string, string> = {
  "fast-summary": "快速摘要",
  "document-extraction": "文档结构化提取",
  "requirement-analysis": "需求分析",
  "project-qa": "项目问答",
  "risk-analysis": "项目风险分析",
  "scope-comparison": "Scope 对比",
  "action-plan-generation": "Action Plan 生成",
  "project-embedding": "项目向量化",
  "project-reranker": "项目混合检索重排",
};

export const safeMockAIModelProfiles: AIModelProfile[] = Object.entries(
  profileNames,
).map(([id, displayName]) => ({
  id,
  profileId: id,
  displayName,
  description: "仅用于本地 Mock 交互，不包含任何项目数据或真实模型配置。",
  primaryModelId: "mock-universal-model",
  fallbackModelId: "mock-universal-model",
  temperature: 0,
  maxOutputTokens: 4_096,
  timeoutSeconds: 5,
  retryCount: 1,
  structuredOutput: true,
  toolCalling: true,
  visionRequired: false,
  costLimit: 0,
  status: "active",
  relatedSkillIds: [],
  ...AUDIT,
}));
