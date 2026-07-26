import { createProjectAssistantGateway } from "@/lib/ai/project-assistant/gateway";
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

export class GatewayMeetingSummaryProvider implements MeetingSummaryProvider {
  async summarize(input: MeetingSummaryInput) {
    const gateway = createProjectAssistantGateway(requireAiAssistantEnabled());
    const systemPrompt = "你是 ProjectAI 的受控会议纪要助手。只根据给定转写生成 JSON。不得把建议或讨论写成 confirmed decision；只有转写明确确认的决定才可进入 decisions 且 confirmed=true。说话人姓名只能使用输入值。日期未知写 TBD。所有要点、决策、建议、风险和 Action 必须绑定 S 标签。只输出 JSON，字段严格为 background,topics,keyPoints,decisions,proposals,openQuestions,risks,actions。";
    const generated = await gateway.generate({ systemPrompt, userPrompt: `<transcript_json>${JSON.stringify(input)}</transcript_json>`, purpose: "meeting_summary" });
    const parsed = meetingSummarySchema.safeParse(parseJson(generated.text));
    const labels = new Set(input.map((segment) => segment.id));
    if (!parsed.success || !validateCitationLabels(parsed.success ? parsed.data : {}, labels)) throw new WorkflowError(422, "MEETING_SUMMARY_INVALID", "会议纪要未通过结构或时间戳校验");
    return { content: parsed.data, provider: generated.provider, actualModel: generated.actualModel, latencyMs: generated.latencyMs, inputTokens: generated.inputTokens, outputTokens: generated.outputTokens };
  }
}

export function createMeetingSummaryProvider(): MeetingSummaryProvider {
  return new GatewayMeetingSummaryProvider();
}
