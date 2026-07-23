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
    if (request.purpose === "requirement_extraction") {
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
