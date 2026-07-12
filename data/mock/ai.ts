import type {
  AICostRecord,
  AIExecution,
  AIModel,
  AIModelProfile,
  AIProvider,
  AIUsageLog,
  Skill,
} from "@/types";

const AUDIT = {
  createdAt: "2026-01-05T09:00:00+08:00",
  updatedAt: "2026-07-01T09:00:00+08:00",
  createdBy: "AI 平台组",
};

export const mockAIProviders: AIProvider[] = [
  { id: "provider-openai", providerId: "openai", providerName: "OpenAI", providerType: "cloud", baseUrl: "由服务端安全配置", region: "Global", status: "active", priority: 1, timeout: 45_000, concurrencyLimit: 30, monthlyBudget: 30_000, currentSpend: 12_840, secretConfigured: true, ...AUDIT },
  { id: "provider-azure", providerId: "azure-openai", providerName: "Azure OpenAI", providerType: "azure", baseUrl: "由服务端安全配置", region: "East Asia", status: "active", priority: 2, timeout: 50_000, concurrencyLimit: 20, monthlyBudget: 24_000, currentSpend: 8_260, secretConfigured: true, ...AUDIT },
  { id: "provider-alibaba", providerId: "alibaba-model-studio", providerName: "Alibaba Cloud Model Studio", providerType: "cloud", baseUrl: "由服务端安全配置", region: "华东 1", status: "active", priority: 3, timeout: 45_000, concurrencyLimit: 40, monthlyBudget: 18_000, currentSpend: 6_420, secretConfigured: true, ...AUDIT },
  { id: "provider-internal", providerId: "internal-gateway", providerName: "Internal Gateway", providerType: "internal", baseUrl: "企业内网服务", region: "上海", status: "degraded", priority: 4, timeout: 30_000, concurrencyLimit: 60, monthlyBudget: 10_000, currentSpend: 3_150, secretConfigured: false, ...AUDIT },
];

export const mockAIModels: AIModel[] = [
  { id: "model-primary-reasoning", modelId: "primary-reasoning", displayName: "Primary Reasoning Model", providerId: "provider-openai", providerModelName: "server-configured-reasoning", modelType: "reasoning", capabilityTags: ["text", "toolCalling", "structuredOutput", "fileInput"], contextWindow: 128_000, maxOutputTokens: 16_000, qualityLevel: "high", speedLevel: "medium", costLevel: "high", status: "active", ...AUDIT },
  { id: "model-fast-general", modelId: "fast-general", displayName: "Fast General Model", providerId: "provider-alibaba", providerModelName: "server-configured-fast", modelType: "chat", capabilityTags: ["text", "structuredOutput", "toolCalling"], contextWindow: 64_000, maxOutputTokens: 8_000, qualityLevel: "medium", speedLevel: "high", costLevel: "low", status: "active", ...AUDIT },
  { id: "model-long-context", modelId: "long-context", displayName: "Long Context Model", providerId: "provider-azure", providerModelName: "server-configured-long-context", modelType: "chat", capabilityTags: ["text", "fileInput", "structuredOutput"], contextWindow: 256_000, maxOutputTokens: 16_000, qualityLevel: "high", speedLevel: "medium", costLevel: "medium", status: "active", ...AUDIT },
  { id: "model-vision-analysis", modelId: "vision-analysis", displayName: "Vision Analysis Model", providerId: "provider-openai", providerModelName: "server-configured-vision", modelType: "vision", capabilityTags: ["text", "vision", "fileInput", "structuredOutput"], contextWindow: 128_000, maxOutputTokens: 8_000, qualityLevel: "high", speedLevel: "medium", costLevel: "high", status: "active", ...AUDIT },
  { id: "model-project-embedding", modelId: "project-embedding", displayName: "Project Embedding Model", providerId: "provider-internal", providerModelName: "server-configured-embedding", modelType: "embedding", capabilityTags: ["embedding"], contextWindow: 8_192, maxOutputTokens: 0, qualityLevel: "high", speedLevel: "high", costLevel: "low", status: "active", ...AUDIT },
  { id: "model-hybrid-reranker", modelId: "hybrid-reranker", displayName: "Hybrid Reranker", providerId: "provider-internal", providerModelName: "server-configured-reranker", modelType: "reranker", capabilityTags: ["reranking"], contextWindow: 16_384, maxOutputTokens: 0, qualityLevel: "high", speedLevel: "high", costLevel: "low", status: "active", ...AUDIT },
];

export const mockAIModelProfiles: AIModelProfile[] = [
  { id: "fast-summary", profileId: "fast-summary", displayName: "快速摘要", description: "低延迟生成会议、文档和周报摘要。", primaryModelId: "model-fast-general", fallbackModelId: "model-long-context", temperature: 0.25, maxOutputTokens: 3_000, timeoutSeconds: 30, retryCount: 1, structuredOutput: true, toolCalling: false, visionRequired: false, costLimit: 2, status: "active", relatedSkillIds: ["project-document-summary", "meeting-summary", "weekly-status-report"], ...AUDIT },
  { id: "document-extraction", profileId: "document-extraction", displayName: "文档结构化提取", description: "解析长文档并提取事实、章节和引用。", primaryModelId: "model-long-context", fallbackModelId: "model-primary-reasoning", temperature: 0.1, maxOutputTokens: 8_000, timeoutSeconds: 60, retryCount: 2, structuredOutput: true, toolCalling: false, visionRequired: false, costLimit: 8, status: "active", relatedSkillIds: ["project-document-summary"], ...AUDIT },
  { id: "requirement-analysis", profileId: "requirement-analysis", displayName: "需求分析", description: "提取、澄清、去重并识别需求冲突。", primaryModelId: "model-primary-reasoning", fallbackModelId: "model-long-context", temperature: 0.15, maxOutputTokens: 10_000, timeoutSeconds: 75, retryCount: 2, structuredOutput: true, toolCalling: true, visionRequired: false, costLimit: 12, status: "active", relatedSkillIds: ["requirement-extraction", "requirement-clarification", "requirement-deduplication"], ...AUDIT },
  { id: "project-qa", profileId: "project-qa", displayName: "项目问答", description: "基于当前有效项目知识回答问题并给出引用。", primaryModelId: "model-long-context", fallbackModelId: "model-fast-general", temperature: 0.2, maxOutputTokens: 4_000, timeoutSeconds: 35, retryCount: 1, structuredOutput: false, toolCalling: true, visionRequired: false, costLimit: 4, status: "active", relatedSkillIds: ["project-question-answering"], ...AUDIT },
  { id: "risk-analysis", profileId: "risk-analysis", displayName: "项目风险分析", description: "结合证据识别风险等级、影响与缓解动作。", primaryModelId: "model-primary-reasoning", fallbackModelId: "model-long-context", temperature: 0.15, maxOutputTokens: 6_000, timeoutSeconds: 50, retryCount: 2, structuredOutput: true, toolCalling: true, visionRequired: false, costLimit: 8, status: "active", relatedSkillIds: ["project-risk-analysis"], ...AUDIT },
  { id: "scope-comparison", profileId: "scope-comparison", displayName: "Scope 对比", description: "对比 Scope 版本并生成可审核的影响分析。", primaryModelId: "model-primary-reasoning", fallbackModelId: "model-long-context", temperature: 0.1, maxOutputTokens: 8_000, timeoutSeconds: 60, retryCount: 2, structuredOutput: true, toolCalling: true, visionRequired: false, costLimit: 10, status: "active", relatedSkillIds: ["scope-diff"], ...AUDIT },
  { id: "action-plan-generation", profileId: "action-plan-generation", displayName: "Action Plan 生成", description: "从会议、需求和风险中生成可执行计划。", primaryModelId: "model-primary-reasoning", fallbackModelId: "model-fast-general", temperature: 0.2, maxOutputTokens: 6_000, timeoutSeconds: 45, retryCount: 1, structuredOutput: true, toolCalling: true, visionRequired: false, costLimit: 7, status: "active", relatedSkillIds: ["action-plan-extraction"], ...AUDIT },
  { id: "project-embedding", profileId: "project-embedding", displayName: "项目向量化", description: "为项目知识分块生成检索向量。", primaryModelId: "model-project-embedding", fallbackModelId: "model-project-embedding", temperature: 0, maxOutputTokens: 0, timeoutSeconds: 15, retryCount: 2, structuredOutput: false, toolCalling: false, visionRequired: false, costLimit: 1, status: "active", relatedSkillIds: ["project-question-answering"], ...AUDIT },
  { id: "project-reranker", profileId: "project-reranker", displayName: "项目混合检索重排", description: "对关键词和向量召回结果进行统一重排。", primaryModelId: "model-hybrid-reranker", fallbackModelId: "model-hybrid-reranker", temperature: 0, maxOutputTokens: 0, timeoutSeconds: 10, retryCount: 1, structuredOutput: false, toolCalling: false, visionRequired: false, costLimit: 1, status: "active", relatedSkillIds: ["project-question-answering"], ...AUDIT },
];

interface SkillSeed {
  id: string;
  displayName: string;
  module: string;
  description: string;
  modelProfileId: string;
  fallbackModelProfileId: string;
  approvalRequired: boolean;
  duration: number;
  cost: number;
  usage: number;
  approval: number;
  edit: number;
}

const skillSeeds: SkillSeed[] = [
  { id: "project-document-summary", displayName: "项目文档摘要", module: "知识与资产", description: "提炼项目文档结构、事实与待确认问题。", modelProfileId: "document-extraction", fallbackModelProfileId: "fast-summary", approvalRequired: true, duration: 18_400, cost: 1.26, usage: 286, approval: 0.91, edit: 0.16 },
  { id: "requirement-extraction", displayName: "需求提取", module: "需求中心", description: "从项目资料提取结构化需求与来源证据。", modelProfileId: "requirement-analysis", fallbackModelProfileId: "document-extraction", approvalRequired: true, duration: 31_200, cost: 2.84, usage: 214, approval: 0.87, edit: 0.22 },
  { id: "requirement-clarification", displayName: "需求澄清", module: "需求中心", description: "发现信息缺口并生成面向项目经理的澄清问题。", modelProfileId: "requirement-analysis", fallbackModelProfileId: "project-qa", approvalRequired: true, duration: 12_600, cost: 1.18, usage: 168, approval: 0.9, edit: 0.18 },
  { id: "requirement-deduplication", displayName: "需求去重与冲突识别", module: "需求中心", description: "识别语义重复、规则矛盾和 Scope 冲突。", modelProfileId: "requirement-analysis", fallbackModelProfileId: "project-qa", approvalRequired: true, duration: 22_800, cost: 2.05, usage: 152, approval: 0.88, edit: 0.2 },
  { id: "scope-diff", displayName: "Scope 版本对比", module: "Scope 管理", description: "生成版本差异、工期影响与风险建议。", modelProfileId: "scope-comparison", fallbackModelProfileId: "requirement-analysis", approvalRequired: true, duration: 27_500, cost: 2.62, usage: 96, approval: 0.93, edit: 0.14 },
  { id: "action-plan-extraction", displayName: "Action Plan 提取", module: "Action Plan", description: "从会议与需求中提取负责人、期限和阻塞关系。", modelProfileId: "action-plan-generation", fallbackModelProfileId: "requirement-analysis", approvalRequired: true, duration: 15_800, cost: 1.42, usage: 244, approval: 0.89, edit: 0.19 },
  { id: "meeting-summary", displayName: "会议摘要", module: "会议与决策", description: "生成摘要并提取决策、需求、Action 与风险。", modelProfileId: "fast-summary", fallbackModelProfileId: "document-extraction", approvalRequired: true, duration: 14_200, cost: 0.92, usage: 328, approval: 0.92, edit: 0.13 },
  { id: "project-risk-analysis", displayName: "项目风险分析", module: "风险与状态", description: "基于最新证据识别项目风险与建议动作。", modelProfileId: "risk-analysis", fallbackModelProfileId: "requirement-analysis", approvalRequired: true, duration: 24_100, cost: 2.36, usage: 132, approval: 0.86, edit: 0.24 },
  { id: "weekly-status-report", displayName: "项目周报", module: "工作台", description: "汇总项目本周进展、风险和下周计划。", modelProfileId: "fast-summary", fallbackModelProfileId: "project-qa", approvalRequired: true, duration: 19_700, cost: 1.08, usage: 176, approval: 0.94, edit: 0.12 },
  { id: "project-question-answering", displayName: "项目知识问答", module: "项目知识", description: "通过混合检索回答问题并展示当前有效来源。", modelProfileId: "project-qa", fallbackModelProfileId: "fast-summary", approvalRequired: false, duration: 4_800, cost: 0.48, usage: 842, approval: 0.96, edit: 0.05 },
];

export const mockSkills: Skill[] = skillSeeds.map((seed) => ({
  id: seed.id,
  name: seed.id,
  displayName: seed.displayName,
  version: "1.4.0",
  owner: "AI 平台组",
  module: seed.module,
  status: "active",
  description: seed.description,
  useCases: [`项目经理需要${seed.displayName}时`, "需要保留来源与执行记录时"],
  excludedUseCases: ["未经人工审核直接覆盖正式项目数据", "缺少访问权限的跨项目数据处理"],
  inputSchema: { type: "object", required: ["projectId", "sourceIds"] },
  outputSchema: { type: "object", required: ["result", "citations", "confidence"] },
  steps: [
    { id: `${seed.id}-step-1`, name: "校验输入", description: "检查项目、权限和当前版本", order: 1 },
    { id: `${seed.id}-step-2`, name: "执行分析", description: "通过 Model Profile 调用统一 AI Gateway", order: 2 },
    { id: `${seed.id}-step-3`, name: "验证输出", description: "校验结构、证据和置信度", order: 3 },
  ],
  validators: [
    { id: `${seed.id}-validator-1`, name: "来源完整性", rule: "正式结论至少包含一条可访问来源", severity: "error" },
    { id: `${seed.id}-validator-2`, name: "版本有效性", rule: "优先引用当前有效版本并标识历史版本", severity: "warning" },
  ],
  modelProfileId: seed.modelProfileId,
  fallbackModelProfileId: seed.fallbackModelProfileId,
  approvalRequired: seed.approvalRequired,
  averageDurationMs: seed.duration,
  averageCost: seed.cost,
  usageCount: seed.usage,
  approvalRate: seed.approval,
  manualEditRate: seed.edit,
  versionHistory: [
    { version: "1.4.0", updatedAt: "2026-07-01", summary: "增强当前有效版本校验与引用完整性。" },
    { version: "1.3.0", updatedAt: "2026-05-18", summary: "加入失败重试和备用 Model Profile。" },
  ],
  ...AUDIT,
}));

const executionSkills = [
  "requirement-extraction", "scope-diff", "project-risk-analysis", "action-plan-extraction", "meeting-summary",
  "weekly-status-report", "requirement-deduplication", "project-document-summary", "project-question-answering", "meeting-summary",
  "requirement-extraction", "project-risk-analysis", "project-question-answering", "action-plan-extraction", "scope-diff",
  "weekly-status-report", "project-document-summary", "project-question-answering", "requirement-clarification", "meeting-summary",
] as const;

const profileBySkill: Record<string, string> = Object.fromEntries(
  skillSeeds.map((skill) => [skill.id, skill.modelProfileId]),
);

export const mockAIExecutions: AIExecution[] = executionSkills.map((skillId, index) => {
  const number = String(index + 1).padStart(3, "0");
  const failed = index === 11;
  const retried = index === 4 || index === 14;
  const modelProfileId = profileBySkill[skillId] ?? "fast-summary";
  const profile = mockAIModelProfiles.find((item) => item.id === modelProfileId) ?? mockAIModelProfiles[0];
  const model = mockAIModels.find((item) => item.id === profile.primaryModelId) ?? mockAIModels[0];
  const inputTokens = 1_800 + index * 137;
  const outputTokens = 420 + (index % 6) * 88;
  const startedAt = `2026-07-${String(12 - Math.floor(index / 3)).padStart(2, "0")}T${String(8 + (index % 9)).padStart(2, "0")}:10:00+08:00`;
  const durationMs = 4_200 + index * 610;
  const cost = Number(((inputTokens * 0.00018 + outputTokens * 0.00052) * (model.costLevel === "high" ? 2 : 1)).toFixed(4));
  return {
    id: `ai-exec-${number}`,
    executionId: `AI-${number}`,
    projectId: `project-${String((index % 8) + 1).padStart(3, "0")}`,
    skillId,
    modelProfileId,
    modelId: model.id,
    providerId: model.providerId,
    status: failed ? "failed" : "succeeded",
    startedAt,
    completedAt: startedAt,
    durationMs,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    retryCount: retried ? 1 : 0,
    cost,
    currency: "CNY",
    logs: [
      { id: `ai-log-${number}-1`, timestamp: startedAt, level: "info", message: `读取 Model Profile：${modelProfileId}` },
      ...(retried ? [{ id: `ai-log-${number}-2`, timestamp: startedAt, level: "warning" as const, message: "首次调用超时，正在切换备用模型重试" }] : []),
      { id: `ai-log-${number}-3`, timestamp: startedAt, level: failed ? "error" : "info", message: failed ? "模拟供应商暂时不可用，执行失败" : "结构化结果与引用校验完成" },
    ],
    error: failed ? "MockProviderUnavailableError" : undefined,
    version: 1,
    sourceIds: [`doc-${String((index % 15) + 1).padStart(3, "0")}`],
    createdAt: startedAt,
    updatedAt: startedAt,
    createdBy: "Mock AI Gateway",
  };
});

export const mockAIUsageLogs: AIUsageLog[] = mockAIExecutions.map((execution) => ({
  id: `usage-${execution.id}`,
  executionId: execution.id,
  projectId: execution.projectId,
  skillId: execution.skillId,
  modelProfileId: execution.modelProfileId,
  modelId: execution.modelId,
  usage: { inputTokens: execution.inputTokens, outputTokens: execution.outputTokens, totalTokens: execution.totalTokens },
  durationMs: execution.durationMs,
  createdAt: execution.createdAt,
  updatedAt: execution.updatedAt,
  createdBy: "Mock AI Gateway",
}));

export const mockAICostRecords: AICostRecord[] = mockAIExecutions.map((execution) => ({
  id: `cost-${execution.id}`,
  executionId: execution.id,
  providerId: execution.providerId,
  modelId: execution.modelId,
  inputCost: Number((execution.cost * 0.42).toFixed(4)),
  outputCost: Number((execution.cost * 0.58).toFixed(4)),
  totalCost: execution.cost,
  currency: "CNY",
  createdAt: execution.createdAt,
  updatedAt: execution.updatedAt,
  createdBy: "Mock AI Gateway",
}));
