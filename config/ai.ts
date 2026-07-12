export const AI_GATEWAY_DEFAULTS = {
  defaultTextProfileId: "fast-summary",
  defaultKnowledgeProfileId: "project-qa",
  defaultEmbeddingProfileId: "project-embedding",
  defaultRerankerProfileId: "project-reranker",
  currency: "CNY",
  mockMinLatencyMs: 180,
  mockMaxLatencyMs: 720,
} as const;

export const PRESET_PROJECT_QUESTIONS = [
  "当前有效 Scope 是哪一个版本？",
  "客户提出了哪些关键目标？",
  "最近新增了哪些需求？",
  "当前最大的项目风险是什么？",
  "哪些 Action Items 已经过期？",
  "这个需求是什么时候提出的？",
  "为什么上线日期发生了变化？",
  "最近一次客户确认了哪些内容？",
] as const;
