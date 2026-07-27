import { createProjectAssistantGateway, type AiGatewayResult, type ProjectAssistantGateway } from "@/lib/ai/project-assistant/gateway";
import { requireAiAssistantEnabled } from "@/lib/ai/project-assistant/config";
import { meetingSummarySchema, validateCitationLabels } from "./contracts";
import { WorkflowError } from "./errors";

export type MeetingSummaryInput = Array<{ id: string; startMs: number; endMs: number; speaker: string; text: string }>;

export interface MeetingSummaryProvider {
  summarize(input: MeetingSummaryInput): Promise<{
    content: ReturnType<typeof meetingSummarySchema.parse>;
    provider: string;
    actualModel: string;
    latencyMs: number;
    inputTokens: number | null;
    outputTokens: number | null;
  }>;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(trimmed); } catch { throw new WorkflowError(422, "MEETING_SUMMARY_INVALID", "会议纪要不是有效 JSON"); }
}

function parsedSummary(text: string, labels: Set<string>) {
  try {
    const parsed = meetingSummarySchema.safeParse(parseJson(text));
    if (!parsed.success || !validateCitationLabels(parsed.data, labels)) return null;
    return parsed.data;
  } catch (error) {
    if (error instanceof WorkflowError && error.code === "MEETING_SUMMARY_INVALID") return null;
    throw error;
  }
}

function sumUsage(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right;
}

function combineGatewayResults(first: AiGatewayResult, second: AiGatewayResult): AiGatewayResult {
  return {
    ...second,
    requestedModel: first.requestedModel,
    fallbackUsed: first.fallbackUsed || second.fallbackUsed,
    inputTokens: sumUsage(first.inputTokens, second.inputTokens),
    outputTokens: sumUsage(first.outputTokens, second.outputTokens),
    totalTokens: sumUsage(first.totalTokens, second.totalTokens),
    latencyMs: first.latencyMs + second.latencyMs,
  };
}

const meetingSummaryContract = `只输出一个 JSON 对象，不得输出 Markdown、代码块或额外字段。严格结构为：
{"background":"字符串","topics":["字符串"],"keyPoints":[{"text":"字符串","segmentIds":["S1"]}],"decisions":[{"text":"字符串","segmentIds":["S1"],"confirmed":true}],"proposals":[{"text":"字符串","segmentIds":["S1"]}],"openQuestions":["字符串"],"risks":[{"text":"字符串","segmentIds":["S1"]}],"actions":[{"text":"字符串","owner":"输入中出现的说话人姓名","deadline":"YYYY-MM-DD 或 TBD","dependencies":["字符串"],"segmentIds":["S1"]}]}。
没有内容的数组必须输出 []。segmentIds 只能使用输入中存在的 S 标签。不得把建议或讨论写成 confirmed decision；只有转写明确确认的决定才可进入 decisions 且 confirmed=true。说话人姓名只能使用输入值。日期未知写 TBD。`;

export class GatewayMeetingSummaryProvider implements MeetingSummaryProvider {
  constructor(
    private readonly gatewayFactory: () => Pick<ProjectAssistantGateway, "generate"> = () => createProjectAssistantGateway(requireAiAssistantEnabled()),
  ) {}

  async summarize(input: MeetingSummaryInput) {
    const gateway = this.gatewayFactory();
    const systemPrompt = `你是 ProjectAI 的受控会议纪要助手。只根据给定转写生成可审核的会议纪要。${meetingSummaryContract}`;
    const userPrompt = `<transcript_json>${JSON.stringify(input)}</transcript_json>`;
    let generated = await gateway.generate({ systemPrompt, userPrompt, purpose: "meeting_summary", maxOutputTokens: 4_096 });
    const labels = new Set(input.map((segment) => segment.id));
    let content = parsedSummary(generated.text, labels);
    if (!content) {
      const repaired = await gateway.generate({
        systemPrompt: `你是 ProjectAI 的受控会议纪要修复器。前一次结果未通过严格结构或 S 标签校验。不要沿用未验证结果，必须重新根据原始转写生成。${meetingSummaryContract}`,
        userPrompt,
        purpose: "meeting_summary_repair",
        maxOutputTokens: 4_096,
      });
      generated = combineGatewayResults(generated, repaired);
      content = parsedSummary(repaired.text, labels);
    }
    if (!content) throw new WorkflowError(422, "MEETING_SUMMARY_INVALID", "会议纪要未通过结构或时间戳校验");
    return { content, provider: generated.provider, actualModel: generated.actualModel, latencyMs: generated.latencyMs, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens };
  }
}

export function createMeetingSummaryProvider(): MeetingSummaryProvider {
  return new GatewayMeetingSummaryProvider();
}
