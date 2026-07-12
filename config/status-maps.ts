import type {
  ActionItemStatus,
  AIExecutionStatus,
  AIModelProfileStatus,
  AIModelStatus,
  AIProviderStatus,
  DocumentParseStatus,
  Priority,
  ProjectDocumentStatus,
  ProjectHealthStatus,
  ProjectPhase,
  ProjectStatus,
  RequirementStatus,
  ReviewStatus,
  RiskLevel,
  RiskStatus,
  ScopeStatus,
  SkillStatus,
} from "@/types";

export type StatusTone =
  | "neutral"
  | "info"
  | "primary"
  | "success"
  | "warning"
  | "danger";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
  description?: string;
}

export const projectStatusMap: Record<ProjectStatus, StatusMeta> = {
  planning: { label: "规划中", tone: "neutral" },
  active: { label: "进行中", tone: "primary" },
  paused: { label: "已暂停", tone: "warning" },
  completed: { label: "已完成", tone: "success" },
  cancelled: { label: "已取消", tone: "neutral" },
  atRisk: { label: "有风险", tone: "danger" },
};

export const projectHealthMap: Record<ProjectHealthStatus, StatusMeta> = {
  healthy: { label: "正常", tone: "success" },
  attention: { label: "关注", tone: "warning" },
  atRisk: { label: "风险", tone: "danger" },
  critical: { label: "严重风险", tone: "danger" },
};

export const projectPhaseMap: Record<ProjectPhase, StatusMeta> = {
  discovery: { label: "需求调研", tone: "neutral" },
  planning: { label: "项目规划", tone: "info" },
  design: { label: "方案设计", tone: "primary" },
  development: { label: "开发联调", tone: "primary" },
  testing: { label: "测试验收", tone: "warning" },
  launch: { label: "上线准备", tone: "warning" },
  operation: { label: "运营维护", tone: "success" },
};

export const requirementStatusMap: Record<RequirementStatus, StatusMeta> = {
  draft: { label: "草稿", tone: "neutral" },
  pendingReview: { label: "待审核", tone: "warning" },
  confirmed: { label: "已确认", tone: "success" },
  rejected: { label: "已驳回", tone: "danger" },
  deprecated: { label: "已废弃", tone: "neutral" },
};

export const reviewStatusMap: Record<ReviewStatus, StatusMeta> = {
  generated: { label: "AI 已生成", tone: "info" },
  pendingReview: { label: "待人工审核", tone: "warning" },
  approved: { label: "已通过", tone: "success" },
  approvedWithChanges: { label: "修改后通过", tone: "success" },
  rejected: { label: "已驳回", tone: "danger" },
  superseded: { label: "已被替代", tone: "neutral" },
};

export const scopeStatusMap: Record<ScopeStatus, StatusMeta> = {
  draft: { label: "草稿", tone: "neutral" },
  pendingReview: { label: "待审核", tone: "warning" },
  approved: { label: "已批准", tone: "success" },
  active: { label: "当前有效", tone: "primary" },
  superseded: { label: "已被替代", tone: "neutral" },
  rejected: { label: "已驳回", tone: "danger" },
};

export const actionStatusMap: Record<ActionItemStatus, StatusMeta> = {
  todo: { label: "待处理", tone: "neutral" },
  inProgress: { label: "进行中", tone: "primary" },
  blocked: { label: "被阻塞", tone: "danger" },
  completed: { label: "已完成", tone: "success" },
  cancelled: { label: "已取消", tone: "neutral" },
  overdue: { label: "已逾期", tone: "danger" },
};

export const riskLevelMap: Record<RiskLevel, StatusMeta> = {
  low: { label: "低", tone: "neutral" },
  medium: { label: "中", tone: "warning" },
  high: { label: "高", tone: "danger" },
  critical: { label: "严重", tone: "danger" },
};

export const riskStatusMap: Record<RiskStatus, StatusMeta> = {
  open: { label: "待处理", tone: "danger" },
  monitoring: { label: "监控中", tone: "warning" },
  resolved: { label: "已解决", tone: "success" },
  accepted: { label: "已接受", tone: "info" },
  closed: { label: "已关闭", tone: "neutral" },
};

export const documentStatusMap: Record<ProjectDocumentStatus, StatusMeta> = {
  original: { label: "原始资料", tone: "neutral" },
  aiParsed: { label: "AI 已解析", tone: "info" },
  pendingConfirmation: { label: "待确认", tone: "warning" },
  confirmed: { label: "已确认", tone: "success" },
  invalid: { label: "已失效", tone: "danger" },
  superseded: { label: "被新版本替代", tone: "neutral" },
};

export const documentParseStatusMap: Record<DocumentParseStatus, StatusMeta> = {
  waiting: { label: "等待解析", tone: "neutral" },
  processing: { label: "解析中", tone: "primary" },
  parsed: { label: "解析完成", tone: "success" },
  failed: { label: "解析失败", tone: "danger" },
};

export const priorityMap: Record<Priority, StatusMeta> = {
  P0: { label: "P0 · 紧急", tone: "danger" },
  P1: { label: "P1 · 高", tone: "warning" },
  P2: { label: "P2 · 中", tone: "info" },
  P3: { label: "P3 · 低", tone: "neutral" },
};

export const skillStatusMap: Record<SkillStatus, StatusMeta> = {
  active: { label: "启用", tone: "success" },
  inactive: { label: "停用", tone: "neutral" },
  deprecated: { label: "已废弃", tone: "danger" },
  draft: { label: "草稿", tone: "warning" },
};

export const aiProviderStatusMap: Record<AIProviderStatus, StatusMeta> = {
  active: { label: "可用", tone: "success" },
  inactive: { label: "停用", tone: "neutral" },
  degraded: { label: "服务降级", tone: "warning" },
};

export const aiModelStatusMap: Record<AIModelStatus, StatusMeta> = {
  active: { label: "可用", tone: "success" },
  inactive: { label: "停用", tone: "neutral" },
  deprecated: { label: "已废弃", tone: "danger" },
};

export const aiModelProfileStatusMap: Record<AIModelProfileStatus, StatusMeta> = {
  active: { label: "启用", tone: "success" },
  inactive: { label: "停用", tone: "neutral" },
  draft: { label: "草稿", tone: "warning" },
};

export const aiExecutionStatusMap: Record<AIExecutionStatus, StatusMeta> = {
  queued: { label: "排队中", tone: "neutral" },
  running: { label: "执行中", tone: "primary" },
  succeeded: { label: "成功", tone: "success" },
  failed: { label: "失败", tone: "danger" },
  retrying: { label: "重试中", tone: "warning" },
  cancelled: { label: "已取消", tone: "neutral" },
};

export const PROJECT_STATUS_MAP = projectStatusMap;
export const PROJECT_HEALTH_MAP = projectHealthMap;
export const REQUIREMENT_STATUS_MAP = requirementStatusMap;
export const REVIEW_STATUS_MAP = reviewStatusMap;
export const SCOPE_STATUS_MAP = scopeStatusMap;
export const ACTION_STATUS_MAP = actionStatusMap;
export const RISK_LEVEL_MAP = riskLevelMap;
