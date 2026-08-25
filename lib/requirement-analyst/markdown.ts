import {
  requirementAnalysisPackSchema,
  type RequirementAnalysisDomain,
  type RequirementAnalysisPack,
} from "./contracts";

function cell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ").trim() || "/";
}

function refs(values: string[]): string {
  return values.join(", ") || "/";
}

function row(values: string[]): string {
  return `| ${values.map(cell).join(" | ")} |`;
}

function separator(columns: number): string {
  return `|${Array.from({ length: columns }, () => "---").join("|")}|`;
}

const DOMAIN_LABELS: Record<RequirementAnalysisDomain, string> = {
  business_goal: "业务目标",
  user: "用户",
  scenario: "使用场景",
  deliverable: "交付物",
  success_metric: "成功指标",
  channel: "渠道",
  deadline: "截止日期",
  constraint: "约束条件",
  user_journey: "用户流程",
  functional_scope: "功能范围",
  identity_permission: "身份与权限",
  data: "数据",
  ai_behavior: "AI 行为",
  third_party_integration: "第三方集成",
  content_asset: "内容与素材",
  operations_rules: "运营规则",
  test_launch: "测试与上线",
  project_dependency: "项目依赖",
};

const COVERAGE_LABELS = {
  COMPLETE: "已覆盖",
  PARTIAL: "部分覆盖",
  MISSING: "缺失",
  ASSUMED: "基于待确认假设",
  NOT_APPLICABLE: "明确不适用",
} as const;

const STATUS_LABELS = {
  CONFIRMED: "已确认",
  MISSING: "缺失",
  ASSUMED: "待确认假设",
  OUT_OF_SCOPE: "不在范围内",
} as const;

const DISPOSITION_LABELS = {
  IN_SCOPE: "已确认纳入",
  OUT_OF_SCOPE: "明确不纳入",
  DEFERRED: "延后",
  UNRESOLVED: "待确认",
} as const;

export const REQUIREMENT_ANALYSIS_MARKDOWN_SECTIONS = [
  "## 需求摘要",
  "## 核心业务概念",
  "## 用户流程",
  "## 功能范围",
  "## 信息架构",
  "## 需求矩阵",
  "## 分析依据与覆盖检查",
  "## 待确认信息",
  "## 关键问题",
  "## 依赖",
  "## 风险与未知项",
  "## 初始范围边界",
  "## 建议下一步",
] as const;

function renderArchitecture(pack: RequirementAnalysisPack): string[] {
  if (pack.informationArchitecture.length === 0) return ["/"];
  const children = new Map<string | null, RequirementAnalysisPack["informationArchitecture"]>();
  for (const item of [...pack.informationArchitecture].sort((a, b) => a.order - b.order)) {
    const siblings = children.get(item.parentId) ?? [];
    siblings.push(item);
    children.set(item.parentId, siblings);
  }
  const lines: string[] = [];
  const rendered = new Set<string>();
  const append = (parentId: string | null, depth: number) => {
    for (const item of children.get(parentId) ?? []) {
      if (rendered.has(item.id)) continue;
      rendered.add(item.id);
      const suffix = item.notes === "/" ? "" : `；备注：${item.notes}`;
      lines.push(
        `${"  ".repeat(depth)}- ${item.label}（${item.surface}）— ${item.description} ` +
          `[${item.basis}:${item.id}]（${refs(item.statementIds)}${suffix}）`,
      );
      append(item.id, depth + 1);
    }
  };
  append(null, 0);
  return lines.length > 0 ? lines : ["/"];
}

export function renderRequirementAnalysisMarkdown(input: RequirementAnalysisPack): string {
  const pack = requirementAnalysisPackSchema.parse(input);
  return [
    "# 需求分析产出包",
    "",
    `**标题：** ${pack.title}`,
    `**来源材料 ID：** ${refs(pack.sourceMaterialIds)}`,
    "",
    "## 需求摘要",
    "",
    pack.requirementSummary.summary,
    "",
    "## 核心业务概念",
    "",
    "| 序号 | 核心业务概念 | 概念定义 | 关键属性/状态 | 关系 | 依据 | 备注 |",
    separator(7),
    ...(pack.businessConcepts.length > 0
      ? [...pack.businessConcepts]
        .sort((a, b) => a.order - b.order)
        .map((item) => row([
          String(item.order),
          item.name,
          item.definition,
          refs(item.keyAttributes),
          refs(item.relationships),
          `[${item.basis}:${item.id}] ${refs(item.statementIds)}`,
          item.notes,
        ]))
      : [row(["/", "/", "/", "/", "/", "/", "材料不足，暂时无法抽象可靠的业务概念"])]),
    "",
    "## 用户流程",
    "",
    "| 序号 | 角色 | 操作/步骤 | 结果/反馈 | 依据 | 备注 |",
    separator(6),
    ...(pack.userJourneyDraft.length > 0
      ? [...pack.userJourneyDraft]
        .sort((a, b) => a.order - b.order)
        .map((item) => row([
          String(item.order),
          item.actor,
          item.action,
          item.outcome,
          `[${item.basis}:${item.id}] ${refs(item.statementIds)}`,
          item.notes,
        ]))
      : [row(["/", "/", "/", "/", "/", "用户流程待确认"])]),
    "",
    "## 功能范围",
    "",
    "| 序号 | 端 | 功能模块 | 功能说明 | 范围状态 | 依据 | 备注 |",
    separator(7),
    ...(pack.functionalScopeDraft.length > 0
      ? [...pack.functionalScopeDraft]
        .sort((a, b) => a.order - b.order)
        .map((item) => row([
          String(item.order),
          item.surface,
          item.module,
          item.description,
          DISPOSITION_LABELS[item.disposition],
          `[${item.basis}:${item.id}] ${refs(item.statementIds)}`,
          item.notes,
        ]))
      : [row(["/", "/", "/", "/", "待确认", "/", "材料不足，无法形成可靠的功能范围"])]),
    "",
    "## 信息架构",
    "",
    ...renderArchitecture(pack),
    "",
    "## 需求矩阵",
    "",
    "| ID | 领域 | 需求 | 依据类型 | 状态 | 优先级 | 验收信号 | 依据陈述 ID |",
    separator(8),
    ...pack.requirementMatrix.map((item) => row([
      item.id,
      DOMAIN_LABELS[item.domain],
      item.requirement,
      item.basis,
      STATUS_LABELS[item.status],
      item.priority,
      item.acceptanceSignal ?? "/",
      refs(item.statementIds),
    ])),
    "",
    "## 分析依据与覆盖检查",
    "",
    "### 证据与推导登记",
    "",
    ...pack.statements.map((item) =>
      `- [${item.basis}:${item.id}][${DOMAIN_LABELS[item.domain]}] ${item.statement} — ${item.reason}` +
      (item.sourceEvidence ? ` — 原文证据：${item.sourceEvidence}` : "")),
    "",
    "### 领域覆盖检查",
    "",
    "| 领域 | 覆盖状态 | 陈述 ID | 说明 |",
    separator(4),
    ...pack.domainAssessments.map((item) => row([
      DOMAIN_LABELS[item.domain],
      COVERAGE_LABELS[item.coverage],
      refs(item.statementIds),
      item.rationale,
    ])),
    "",
    "## 待确认信息",
    "",
    ...(pack.missingInformation.length > 0
      ? pack.missingInformation.map((item) =>
        `- [${item.priority}:${item.id}] ${item.description} — 影响：${item.impact}（${refs(item.gapStatementIds)}）`)
      : ["/"]),
    "",
    "## 关键问题",
    "",
    ...(pack.criticalQuestions.length > 0
      ? pack.criticalQuestions.map((item) =>
        `- [${item.priority}:${item.id}] ${item.question} — 原因：${item.why} — 解决：${refs(item.resolvesGapStatementIds)}`)
      : ["/"]),
    "",
    "## 依赖",
    "",
    ...(pack.dependencies.length > 0
      ? pack.dependencies.map((item) =>
        `- [${item.basis}:${item.id}] ${item.description} — 影响：${item.impact}（${refs(item.statementIds)}）`)
      : ["/"]),
    "",
    "## 风险与未知项",
    "",
    ...(pack.risksUnknowns.length > 0
      ? pack.risksUnknowns.map((item) =>
        `- [${item.priority}:${item.kind}:${item.basis}:${item.id}] ${item.description} — 影响：${item.impact}（${refs(item.statementIds)}）`)
      : ["/"]),
    "",
    "## 初始范围边界",
    "",
    `- 已确认纳入：${refs(pack.initialScopeBoundary.inScopeIds)}`,
    `- 明确不纳入：${refs(pack.initialScopeBoundary.outOfScopeIds)}`,
    `- 延后：${refs(pack.initialScopeBoundary.deferredIds)}`,
    `- 待确认：${refs(pack.initialScopeBoundary.unresolvedIds)}`,
    "",
    "## 建议下一步",
    "",
    `[${pack.suggestedNextStep.basis}] ${pack.suggestedNextStep.action} ` +
      `（${refs(pack.suggestedNextStep.statementIds)}；` +
      `需要用户确认：${pack.suggestedNextStep.requiresUserConfirmation ? "是" : "否"}）`,
    "",
    ...(pack.warnings.length > 0 ? ["### 提醒", "", ...pack.warnings.map((item) => `- ${item}`), ""] : []),
  ].join("\n");
}
