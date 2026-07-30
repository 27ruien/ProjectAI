import { createProjectAssistantGateway, type AiGatewayResult, type ProjectAssistantGateway } from "@/lib/ai/project-assistant/gateway";
import type { AiRuntimeConfig } from "@/lib/ai/project-assistant/config";
import {
  MAX_MEETING_TRANSCRIPT_CHARACTERS,
  MAX_MEETING_TRANSCRIPT_SEGMENT_CHARACTERS,
  MAX_MEETING_TRANSCRIPT_SEGMENTS,
  meetingSummarySchema,
  validateCitationLabels,
} from "./contracts";
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
    totalTokens: number | null;
    costUsdMicros: number | null;
  }>;
}

function parseJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(trimmed); } catch { throw new WorkflowError(422, "MEETING_SUMMARY_INVALID", "会议纪要不是有效 JSON"); }
}

function normalizeMeetingSummary(value: unknown, speakers: Set<string>): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const arrayOrEmpty = (candidate: unknown) => candidate === null || candidate === undefined ? [] : candidate;
  const citedItems = (candidate: unknown) => Array.isArray(candidate) ? candidate.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const item = entry as Record<string, unknown>;
    const segmentIds = typeof item.segmentIds === "string" && /^S[1-9][0-9]*$/.test(item.segmentIds.trim())
      ? [item.segmentIds.trim()]
      : item.segmentIds;
    return { ...item, segmentIds };
  }) : arrayOrEmpty(candidate);
  const actions = Array.isArray(record.actions) ? record.actions.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const item = entry as Record<string, unknown>;
    const rawOwner = typeof item.owner === "string" ? item.owner.trim() : item.owner;
    const owner = typeof rawOwner === "string"
      ? rawOwner === "TBD" || speakers.has(rawOwner) ? rawOwner : "TBD"
      : rawOwner ?? "TBD";
    const deadline = typeof item.deadline === "string" && /^(?:tbd|待确认|待定|未知|未确认)$/i.test(item.deadline.trim())
      ? "TBD"
      : item.deadline;
    const dependencies = typeof item.dependencies === "string"
      ? item.dependencies.trim() ? [item.dependencies.trim()] : []
      : arrayOrEmpty(item.dependencies);
    const segmentIds = typeof item.segmentIds === "string" && /^S[1-9][0-9]*$/.test(item.segmentIds.trim())
      ? [item.segmentIds.trim()]
      : item.segmentIds;
    return { ...item, owner, deadline, dependencies, segmentIds };
  }) : arrayOrEmpty(record.actions);
  return {
    ...record,
    topics: arrayOrEmpty(record.topics),
    keyPoints: citedItems(record.keyPoints),
    decisions: citedItems(record.decisions),
    proposals: citedItems(record.proposals),
    openQuestions: arrayOrEmpty(record.openQuestions),
    risks: citedItems(record.risks),
    actions,
  };
}

function parsedSummary(text: string, labels: Set<string>, speakers: Set<string>) {
  try {
    const parsed = meetingSummarySchema.safeParse(normalizeMeetingSummary(parseJson(text), speakers));
    if (
      !parsed.success ||
      !validateCitationLabels(parsed.data, labels) ||
      parsed.data.actions.some((action) => action.owner !== "TBD" && !speakers.has(action.owner))
    ) return null;
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
    costUsdMicros: sumUsage(
      first.costUsdMicros ?? null,
      second.costUsdMicros ?? null,
    ),
    latencyMs: first.latencyMs + second.latencyMs,
  };
}

const meetingSummaryContract = `只输出一个 JSON 对象，不得输出 Markdown、代码块或额外字段。严格结构为：
{"background":"字符串","topics":["字符串"],"keyPoints":[{"text":"字符串","segmentIds":["S1"]}],"decisions":[{"text":"字符串","segmentIds":["S1"],"confirmed":true}],"proposals":[{"text":"字符串","segmentIds":["S1"]}],"openQuestions":["字符串"],"risks":[{"text":"字符串","segmentIds":["S1"]}],"actions":[{"text":"字符串","owner":"输入中出现的说话人姓名或 TBD","deadline":"YYYY-MM-DD 或 TBD","dependencies":["字符串"],"segmentIds":["S1"]}]}。
没有内容的数组必须输出 []。segmentIds 只能使用输入中存在的 S 标签。不得把建议或讨论写成 confirmed decision；只有转写明确确认的决定才可进入 decisions 且 confirmed=true。说话人姓名只能使用输入值；负责人未明确时写 TBD。日期未知写 TBD。`;

const SUMMARY_CHUNK_CHARACTERS = 24_000;
const MAX_SUMMARY_CHUNKS = 12;

function validateSummaryInput(input: MeetingSummaryInput): void {
  if (!input.length || input.length > MAX_MEETING_TRANSCRIPT_SEGMENTS) {
    throw new WorkflowError(422, "MEETING_TRANSCRIPT_TOO_LARGE", "会议转写超过受控摘要范围");
  }
  const labels = new Set<string>();
  let totalCharacters = 0;
  for (const segment of input) {
    totalCharacters += segment.text.length;
    if (
      !/^S[1-9][0-9]*$/.test(segment.id) ||
      labels.has(segment.id) ||
      !Number.isInteger(segment.startMs) ||
      !Number.isInteger(segment.endMs) ||
      segment.startMs < 0 ||
      segment.endMs <= segment.startMs ||
      !segment.speaker.trim() ||
      !segment.text.trim() ||
      segment.text.length > MAX_MEETING_TRANSCRIPT_SEGMENT_CHARACTERS
    ) {
      throw new WorkflowError(422, "MEETING_TRANSCRIPT_INVALID", "会议转写未通过摘要输入校验");
    }
    labels.add(segment.id);
  }
  if (totalCharacters > MAX_MEETING_TRANSCRIPT_CHARACTERS) {
    throw new WorkflowError(422, "MEETING_TRANSCRIPT_TOO_LARGE", "会议转写超过受控摘要范围");
  }
}

function chunkSummaryInput(input: MeetingSummaryInput): MeetingSummaryInput[] {
  const chunks: MeetingSummaryInput[] = [];
  let current: MeetingSummaryInput = [];
  let currentCharacters = 0;
  for (const segment of input) {
    const segmentCharacters = JSON.stringify(segment).length;
    if (current.length && currentCharacters + segmentCharacters > SUMMARY_CHUNK_CHARACTERS) {
      chunks.push(current);
      current = [];
      currentCharacters = 0;
    }
    current.push(segment);
    currentCharacters += segmentCharacters;
  }
  if (current.length) chunks.push(current);
  if (chunks.length > MAX_SUMMARY_CHUNKS) {
    throw new WorkflowError(422, "MEETING_TRANSCRIPT_TOO_LARGE", "会议转写分段数量超过受控摘要范围");
  }
  return chunks;
}

export class GatewayMeetingSummaryProvider implements MeetingSummaryProvider {
  constructor(
    private readonly gatewayFactory: () => Pick<ProjectAssistantGateway, "generate">,
    private readonly authorize: () => Promise<void> = async () => undefined,
  ) {}

  async summarize(input: MeetingSummaryInput) {
    validateSummaryInput(input);
    const gateway = this.gatewayFactory();
    const labels = new Set(input.map((segment) => segment.id));
    const speakers = new Set(input.map((segment) => segment.speaker));
    const generateValidated = async (
      source: unknown,
      allowedLabels: Set<string>,
      allowedSpeakers: Set<string>,
      mode: "transcript" | "partials",
      maxOutputTokens: number,
    ) => {
      const sourceTag = mode === "transcript" ? "transcript_json" : "partial_summaries_json";
      const systemPrompt = mode === "transcript"
        ? `你是 ProjectAI 的受控会议纪要助手。只根据给定转写生成可审核的会议纪要。${meetingSummaryContract}`
        : `你是 ProjectAI 的受控会议纪要合并器。只合并给定的分段摘要，不得新增事实、说话人或 S 标签。${meetingSummaryContract}`;
      const userPrompt = `<${sourceTag}>${JSON.stringify(source)}</${sourceTag}>`;
      await this.authorize();
      let generated = await gateway.generate({ systemPrompt, userPrompt, purpose: "meeting_summary", maxOutputTokens });
      let content = parsedSummary(generated.text, allowedLabels, allowedSpeakers);
      if (!content) {
        await this.authorize();
        const repaired = await gateway.generate({
          systemPrompt: `你是 ProjectAI 的受控会议纪要修复器。前一次结果未通过严格结构、说话人或 S 标签校验。不要沿用未验证结果。${meetingSummaryContract}`,
          userPrompt,
          purpose: "meeting_summary_repair",
          maxOutputTokens,
        });
        generated = combineGatewayResults(generated, repaired);
        content = parsedSummary(repaired.text, allowedLabels, allowedSpeakers);
      }
      if (!content) throw new WorkflowError(422, "MEETING_SUMMARY_INVALID", "会议纪要未通过结构或时间戳校验");
      return { generated, content };
    };

    const chunks = chunkSummaryInput(input);
    const partials: Array<ReturnType<typeof meetingSummarySchema.parse>> = [];
    let aggregate: AiGatewayResult | null = null;
    for (const chunk of chunks) {
      const generated = await generateValidated(
        chunk,
        new Set(chunk.map((segment) => segment.id)),
        new Set(chunk.map((segment) => segment.speaker)),
        "transcript",
        chunks.length === 1 ? 4_096 : 1_500,
      );
      partials.push(generated.content);
      aggregate = aggregate ? combineGatewayResults(aggregate, generated.generated) : generated.generated;
    }
    if (!aggregate) throw new WorkflowError(422, "MEETING_SUMMARY_INVALID", "会议纪要未生成");
    let content = partials[0]!;
    if (partials.length > 1) {
      const merged = await generateValidated(partials, labels, speakers, "partials", 4_096);
      aggregate = combineGatewayResults(aggregate, merged.generated);
      content = merged.content;
    }
    return { content, provider: aggregate.provider, actualModel: aggregate.actualModel, latencyMs: aggregate.latencyMs, inputTokens: aggregate.inputTokens, outputTokens: aggregate.outputTokens, totalTokens: aggregate.totalTokens, costUsdMicros: aggregate.costUsdMicros ?? null };
  }
}

export function createMeetingSummaryProvider(
  runtimeConfig: AiRuntimeConfig,
  authorize?: () => Promise<void>,
): MeetingSummaryProvider {
  return new GatewayMeetingSummaryProvider(
    () => createProjectAssistantGateway(runtimeConfig),
    authorize,
  );
}
