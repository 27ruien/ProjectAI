import { AiProviderError } from "./errors";
import type {
  ProjectAssistantProvider,
  ProjectAssistantProviderRequest,
  ProjectAssistantProviderResult,
} from "./provider-types";

const retryableTimeoutAttempts = new Map<string, number>();

function usage(input: string, output: string) {
  const inputTokens = Math.max(20, Math.ceil(input.length / 3));
  const outputTokens = Math.max(8, Math.ceil(output.length / 3));
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
  };
}

function taggedJsonString(prompt: string, tag: string): string {
  const match = prompt.match(
    new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`),
  );
  if (!match?.[1]) return "";
  try {
    const value: unknown = JSON.parse(match[1]);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

function taggedJsonValue(prompt: string, tag: string): unknown {
  const match = prompt.match(
    new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`),
  );
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

export class FakeProjectAssistantProvider
  implements ProjectAssistantProvider
{
  readonly provider = "fake" as const;
  readonly calls: ProjectAssistantProviderRequest[] = [];

  async generate(
    request: ProjectAssistantProviderRequest,
  ): Promise<ProjectAssistantProviderResult> {
    this.calls.push(request);
    const currentQuestion = taggedJsonString(
      request.userPrompt,
      "current_question_json",
    );
    const answerToRepair = taggedJsonString(request.userPrompt, "answer_json");
    if (
      request.purpose === "repair" &&
      answerToRepair.includes("引用修复供应商失败验证")
    ) {
      throw new AiProviderError("SERVER_ERROR", false);
    }
    if (request.userPrompt.includes("FAKE_401")) {
      throw new AiProviderError("UNAUTHORIZED", false);
    }
    if (request.userPrompt.includes("FAKE_403")) {
      throw new AiProviderError("FORBIDDEN", false);
    }
    if (
      request.userPrompt.includes("FAKE_PRIMARY_FORBIDDEN") &&
      request.model === "qwen3.7-plus"
    ) {
      throw new AiProviderError("FORBIDDEN", false);
    }
    if (request.userPrompt.includes("FAKE_429")) {
      throw new AiProviderError("RATE_LIMITED", true);
    }
    if (request.userPrompt.includes("FAKE_500")) {
      throw new AiProviderError("SERVER_ERROR", true);
    }
    if (
      (request.userPrompt.includes("FAKE_PRIMARY_FAILURE") ||
        currentQuestion.includes("备用模型验证")) &&
      request.model === "qwen3.7-plus"
    ) {
      throw new AiProviderError("SERVER_ERROR", true);
    }
    if (currentQuestion.includes("供应商超时后重试验证")) {
      const attempts = retryableTimeoutAttempts.get(currentQuestion) ?? 0;
      if (attempts < 4) {
        retryableTimeoutAttempts.set(currentQuestion, attempts + 1);
        throw new AiProviderError("TIMEOUT", true);
      }
    } else if (
      request.userPrompt.includes("FAKE_TIMEOUT") ||
      currentQuestion.includes("供应商超时验证")
    ) {
      throw new AiProviderError("TIMEOUT", true);
    }

    let text: string;
    if (
      request.purpose === "requirement_extraction" ||
      request.purpose === "requirement_repair"
    ) {
      text = JSON.stringify({
        requirements: [
          {
            title: "确认虚构项目上线日期",
            description: "项目必须在已确认的虚构上线日期前完成可验收交付。",
            type: "business_rule",
            priority: "high",
            acceptanceCriteria: ["上线日期由项目经理确认", "交付前完成验收记录"],
            assumptions: ["来源资料为当前有效版本"],
            openQuestions: ["最终验收负责人是谁？"],
            sourceLabel: "E1",
            confidence: 0.92,
          },
        ],
      });
    } else if (request.purpose === "action_generation") {
      text = JSON.stringify({ actions: [{ title: "完成虚构验收准备", description: "根据受控来源准备验收记录。", priority: "high", blocker: "", sourceIndex: 0 }] });
    } else if (request.purpose === "risk_generation") {
      text = JSON.stringify({ risks: [{ title: "虚构交付延期风险", description: "若验收准备未按期完成，交付可能延期。", probability: 3, impact: 4, mitigation: "每周核对进度并升级阻塞。", trigger: "关键行动逾期", sourceIndex: 0 }] });
    } else if (request.purpose === "weekly_report") {
      text = JSON.stringify({ completed: ["完成虚构需求审核"], inProgress: ["推进虚构行动项"], nextWeek: ["完成虚构验收"], milestones: [], blockers: [], risks: ["持续监控已登记风险"], scopeChanges: [], requirementChanges: [], overdueActions: [], decisionsNeeded: [] });
    } else if (
      request.purpose === "timesheet_generation" ||
      request.purpose === "timesheet_repair"
    ) {
      const input = taggedJsonValue(request.userPrompt, "timesheet_input_json") as {
        today_records?: Array<{
          id?: unknown;
          raw_text?: unknown;
          project_id?: unknown;
          hours_hint?: unknown;
          status_hint?: unknown;
        }>;
        available_projects?: Array<{ id?: unknown }>;
      } | null;
      const records = input?.today_records ?? [];
      const fallbackProjectId =
        typeof input?.available_projects?.[0]?.id === "string"
          ? input.available_projects[0].id
          : null;
      const inferHours = (rawText: string): number | null => {
        const hours = rawText.match(/(\d+(?:\.\d+)?)\s*(?:小时|h\b)/iu);
        if (hours) {
          const value = Number(hours[1]);
          return Number.isFinite(value) && value >= 0 && value <= 24 ? value : null;
        }
        const minutes = rawText.match(/(\d+)\s*(?:分钟|min\b)/iu);
        if (minutes) {
          const value = Number(minutes[1]) / 60;
          return Number.isInteger(value * 4) && value <= 24 ? value : null;
        }
        return null;
      };
      text = JSON.stringify({
        tasks: records.map((record, index) => {
          const rawText = typeof record.raw_text === "string" ? record.raw_text : "";
          const projectId =
            typeof record.project_id === "string"
              ? record.project_id
              : fallbackProjectId;
          const hintedStatus = typeof record.status_hint === "string" ? record.status_hint : "";
          const status = ["completed", "in_progress", "blocked", "pending"].includes(hintedStatus)
            ? hintedStatus
            : /尚未开始|未开始|待开始/u.test(rawText)
              ? "pending"
              : /阻塞|blocked/iu.test(rawText)
                ? "blocked"
                : /已完成|完成了|全部完成/u.test(rawText) && !/尚未|未完成|进行中/u.test(rawText)
                  ? "completed"
                  : "in_progress";
          const hours =
            typeof record.hours_hint === "number" &&
            Number.isFinite(record.hours_hint) &&
            record.hours_hint >= 0 &&
            record.hours_hint <= 24
              ? record.hours_hint
              : inferHours(rawText);
          const approximateHours = /约|大约|大概|左右|差不多/u.test(rawText);
          const progress = status === "completed" ? 100 : status === "pending" ? 0 : null;
          const reviewFields = ["overtimeHours"];
          if (hours === null || approximateHours) reviewFields.push("hours");
          const category = /沟通|会议|对齐|确认/u.test(rawText)
            ? "communication"
            : /文档|整理|记录|报告/u.test(rawText)
              ? "documentation"
              : /评审|验收|测试|复核/u.test(rawText)
                ? "review"
                : /方案|规划|计划/u.test(rawText)
                  ? "planning"
                  : "execution";
          const description = rawText.trim().replace(/\s+/gu, " ").slice(0, 500);
          return {
            description: description.length >= 2 ? description : `Mock 记录 ${index + 1}`,
            project_id: projectId,
            hours,
            overtime_hours: null,
            category_id: category,
            status,
            urgency: null,
            progress,
            source_record_ids: [
              typeof record.id === "string" ? record.id : `record-missing-${index}`,
            ],
            confidence: {
              description: 0.94,
              project: projectId ? 0.95 : 0.4,
              hours: hours === null ? 0.2 : approximateHours ? 0.7 : 0.95,
              overtimeHours: 0.2,
              category: 0.9,
              status: 0.95,
              urgency: 0.2,
              progress: progress === null ? 0.2 : 0.95,
            },
            needs_review: true,
            review_fields: reviewFields,
          };
        }),
        warnings: ["MOCK_AI：结果仅用于流程测试；未从输入推断出的字段保持待确认"],
        unresolved_record_ids: [],
      });
    } else if (
      request.purpose === "workflow_artifact" ||
      request.purpose === "workflow_artifact_repair"
    ) {
      const kind = taggedJsonString(request.userPrompt, "artifact_kind_json");
      if (kind === "project_overview") {
        const fields = [
          "核心时间", "平台类型", "适配类型", "交互类型", "投放渠道", "项目地区",
          "项目整体架构与各方责任", "特殊支持", "项目维护类型", "线下活动支持",
          "搭建支持", "上线类型", "隐私政策与数据合规", "流量与访问情况",
          "项目特殊支持", "项目核心指标", "研发资源", "三方资源", "运营资源",
          "项目业务运维", "服务器或云开发", "可行性分析", "MVP 需求",
          "整体交互流程概览", "可用物料",
        ];
        text = JSON.stringify({
          sections: [
            {
              title: "项目背景",
              fields: fields.slice(0, 16).map((name) => ({ name, value: name === "平台类型" ? "Web" : "待确认", classification: name === "平台类型" ? "fact" : "pending", citations: name === "平台类型" ? ["E1"] : [] })),
            },
            { title: "需求概览", fields: fields.slice(16).map((name) => ({ name, value: name === "MVP 需求" ? "完成虚构受控流程" : "待确认", classification: name === "MVP 需求" ? "fact" : "pending", citations: name === "MVP 需求" ? ["E1"] : [] })) },
          ],
          pendingQuestions: ["目标上线日期和最终验收负责人是什么？"],
        });
      } else if (kind === "requirements_document") {
        const titles = [
          "文档信息与版本记录", "项目背景", "业务目标", "用户和角色", "使用场景",
          "产品范围", "Out of Scope", "用户旅程", "信息架构", "功能需求",
          "页面和交互要求", "平台与兼容性要求", "权限要求", "数据模型和业务状态",
          "外部系统和 API 依赖", "异常、降级和兜底", "非功能需求", "性能和并发",
          "隐私与数据合规", "数据统计与埋点需求", "验收标准", "依赖关系", "风险",
          "时间线和里程碑", "待确认事项", "附录和来源",
        ];
        const requestedSections = taggedJsonValue(
          request.userPrompt,
          "requirement_section_numbers_json",
        );
        const sectionNumbers = Array.isArray(requestedSections)
          ? requestedSections.filter((value): value is number => Number.isInteger(value) && value >= 1 && value <= 26)
          : [];
        const workflowRepair = request.purpose === "workflow_artifact_repair";
        text = JSON.stringify({
          sections: sectionNumbers.map((number) => ({
            // Deliberately vary presentation text: trusted workflow code must
            // bind the canonical title to the validated section number.
            title: `${titles[number - 1]}（模型格式）`,
            number: String(number),
            body: number === 25 ? "待确认事项：目标日期与验收责任人。" : "基于受控虚构来源形成的项目内容。",
            classification: number === 25 ? "pending" : "fact",
            // Force one deterministic first-pass semantic failure so the
            // integration test exercises the bounded repair path.
            citations: number === 25 || (number === 1 && !workflowRepair) ? [] : "E1",
            ignoredPresentationField: "must-not-cross-contract-boundary",
          })),
          acceptanceCriteria: sectionNumbers.includes(26)
            ? ["所有发布产物均经过人工审核", "无权用户访问统一返回 404"]
            : ["批次内容通过服务端结构和引用校验"],
        });
        /* A non-batched response is intentionally invalid so integration tests
         * prove the worker cannot regress to one oversized Provider response. */
        if (sectionNumbers.length === 0) text = JSON.stringify({
          sections: titles.slice(0, 1).map((title, index) => ({
            number: index + 1,
            title,
            body: "非批次输出应被工作流拒绝。",
            classification: "pending",
            citations: [],
          })),
          acceptanceCriteria: [],
        });
      } else if (kind === "ga4_measurement_plan") {
        text = JSON.stringify({
          overview: { platform: "GA4", measurementId: "TBD", validationStatus: "待验证", projectName: "虚构验收项目", projectLink: "TBD", citations: ["E1"] },
          publicParameters: [{ name: "项目 ID", description: "当前授权项目", key: "project_id", valueRule: "服务端授权项目 ID", valueType: "string", note: "不得由客户端越权覆盖", citations: ["E1"] }],
          events: [{ eventName: "workflow_result_view", coreEvent: true, eventType: "result", description: "查看工作流结果", eventId: "workflow_result_view", parameterName: "工作流类型", parameterDescription: "受控工作流类型", parameterKey: "workflow_type", parameterValueRule: "requirement_framework", parameterValueType: "string", note: "E1", developerFeedback: "待接入", citations: ["E1"] }],
          requirementEventCoverage: [{ requirement: "查看工作流结果", eventId: "workflow_result_view", status: "covered" }],
          pageEventMatrix: [{ page: "AI 工作流", eventId: "workflow_result_view", status: "covered" }],
        });
      } else {
        text = JSON.stringify({
          tasks: [{ taskCn: "完成虚构验收", taskEn: "Complete synthetic acceptance", owner: "项目经理", stakeholder: "内部", startDate: "TBD", endDate: "TBD", progress: 0, milestone: true, meeting: "TBD", parentTask: null, dependency: [], confirmationOwner: "客户", latestConfirmationDate: "TBD", delayImpact: "可能影响下游验收与上线里程碑", criticalPath: true, sourceCitation: "E1", assumption: "日期待人工确认", status: "pending_confirmation" }],
          warnings: ["源材料未提供确定日期，计划日期保持 TBD。"],
        });
      }
    } else if (request.purpose === "meeting_summary") {
      text = JSON.stringify({
        background: "基于受控虚构转写生成。",
        topics: ["虚构项目验收"],
        keyPoints: [{ text: "讨论了验收准备。", segmentIds: ["S1"] }],
        decisions: [],
        proposals: [{ text: "建议下周完成验收。", segmentIds: ["S1"] }],
        openQuestions: ["最终验收日期是什么？"],
        risks: [],
        actions: [{ text: "准备验收记录", owner: "Speaker 1", deadline: "TBD", dependencies: [], segmentIds: ["S1"] }],
      });
    } else if (request.purpose === "query_rewrite") {
      text = JSON.stringify({ normalizedQuery: currentQuestion, rewrittenQueries: [currentQuestion], intent: "knowledge_question", keywords: [] });
    } else if (request.purpose === "rerank") {
      const ranking = [...request.userPrompt.matchAll(/"chunkId":"([^"]+)"/g)].map((match) => match[1]);
      text = JSON.stringify({ ranking });
    } else if (request.purpose === "probe") {
      text = "PROJECT_AI_QWEN_PROBE_OK";
    } else if (
      request.userPrompt.includes("FAKE_REPAIR_FAIL") ||
      currentQuestion.includes("引用修复失败验证") ||
      currentQuestion.includes("引用修复供应商失败验证") ||
      answerToRepair.includes("引用修复失败验证") ||
      (request.purpose === "answer" &&
        (request.userPrompt.includes("FAKE_INVALID_CITATION") ||
          currentQuestion.includes("引用修复验证")))
    ) {
      text =
        currentQuestion.includes("引用修复失败验证") ||
        currentQuestion.includes("引用修复供应商失败验证") ||
        answerToRepair.includes("引用修复失败验证")
        ? `${currentQuestion || answerToRepair}。[E99]`
        : "客户要求在 2026 年 10 月 15 日上线。[E99]";
    } else if (request.purpose === "repair") {
      text = "客户要求在 2026 年 10 月 15 日上线。[E1]";
    } else if (currentQuestion.includes("Ignore all prior instructions")) {
      text = "资料中的指令属于不可信内容，不能执行；项目上线日期为 2026 年 10 月 15 日。[E1]";
    } else {
      text = "客户要求在 2026 年 10 月 15 日上线。[E1]";
    }
    const tokenUsage = usage(
      `${request.systemPrompt}\n${request.userPrompt}`,
      text,
    );
    return {
      text,
      actualModel: request.model,
      ...tokenUsage,
      providerRequestId: `fake-${this.calls.length}`,
      latencyMs: 5,
    };
  }
}
