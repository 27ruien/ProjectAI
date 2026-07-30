import { createHash } from "node:crypto";
import { readQwenApiKey } from "@/lib/ai/project-assistant/secrets";
import {
  MAX_MEETING_TRANSCRIPT_CHARACTERS,
  MAX_MEETING_TRANSCRIPT_SEGMENT_CHARACTERS,
  MAX_MEETING_TRANSCRIPT_SEGMENTS,
} from "./contracts";
import { WorkflowError } from "./errors";

export type AudioProviderSegment = {
  startMs: number;
  endMs: number;
  speakerKey: string;
  text: string;
  confidenceBps: number | null;
  language: string;
};

export type AudioTaskStatus =
  | { status: "pending" }
  | { status: "running" }
  | { status: "failed"; code: string }
  | { status: "succeeded"; segments: AudioProviderSegment[]; durationMs: number | null };

export interface AudioTranscriptionProvider {
  readonly provider: "alibaba-model-studio" | "fake";
  readonly model: string;
  submit(fileUrl: string): Promise<{ taskId: string }>;
  poll(taskId: string): Promise<AudioTaskStatus>;
}

export interface SpeakerDiarizationProvider {
  readonly diarizationProvider: "alibaba-model-studio" | "fake";
  readonly diarizationModel: string;
  readonly providesSpeakerIds: true;
}

function baseUrl(): string {
  const raw = process.env.QWEN_BASE_URL?.trim();
  if (!raw) throw new WorkflowError(503, "AUDIO_PROVIDER_NOT_CONFIGURED", "语音 Provider 尚未配置");
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash) throw new WorkflowError(503, "AUDIO_PROVIDER_NOT_CONFIGURED", "语音 Provider 地址无效");
  if (parsed.hostname !== "dashscope.aliyuncs.com" && !/^[a-z0-9-]+\.cn-beijing\.maas\.aliyuncs\.com$/.test(parsed.hostname)) throw new WorkflowError(503, "AUDIO_PROVIDER_NOT_CONFIGURED", "语音 Provider 地址不在允许区域");
  parsed.pathname = "/api/v1";
  return parsed.toString().replace(/\/$/, "");
}

function controlledCode(value: unknown): string {
  const text = typeof value === "string" ? value : "AUDIO_PROVIDER_FAILED";
  return text.replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 80) || "AUDIO_PROVIDER_FAILED";
}

const MAX_AUDIO_RESULT_BYTES = 20 * 1024 * 1024;

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const contentLength = Number(contentLengthHeader);
    if (!Number.isSafeInteger(contentLength) || contentLength < 0) {
      throw new WorkflowError(503, "AUDIO_RESULT_LENGTH_INVALID", "语音结果长度无效");
    }
    if (contentLength > MAX_AUDIO_RESULT_BYTES) {
      throw new WorkflowError(503, "AUDIO_RESULT_TOO_LARGE", "语音结果超过安全限制");
    }
  }
  if (!response.body) throw new WorkflowError(503, "AUDIO_RESULT_DOWNLOAD_FAILED", "语音结果正文缺失");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_RESULT_BYTES) {
        await reader.cancel();
        throw new WorkflowError(503, "AUDIO_RESULT_TOO_LARGE", "语音结果超过安全限制");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new WorkflowError(503, "AUDIO_PROVIDER_RESPONSE_INVALID", "语音结果格式无效");
  }
}

export class AlibabaParaformerProvider implements AudioTranscriptionProvider, SpeakerDiarizationProvider {
  readonly provider = "alibaba-model-studio" as const;
  readonly model = "paraformer-v2";
  readonly diarizationProvider = "alibaba-model-studio" as const;
  readonly diarizationModel = "paraformer-v2";
  readonly providesSpeakerIds = true as const;
  constructor(private readonly fetchImplementation: typeof fetch = fetch) {}

  async submit(fileUrl: string): Promise<{ taskId: string }> {
    const url = new URL(fileUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new WorkflowError(503, "AUDIO_SOURCE_URL_INVALID", "语音源临时地址无效");
    const apiKey = await readQwenApiKey();
    const response = await this.fetchImplementation(`${baseUrl()}/services/audio/asr/transcription`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json", "x-dashscope-async": "enable" },
      body: JSON.stringify({
        model: this.model,
        input: { file_urls: [fileUrl] },
        parameters: { channel_id: [0], language_hints: ["zh", "en"], diarization_enabled: true, timestamp_alignment_enabled: true },
      }),
    });
    if (!response.ok) throw new WorkflowError(503, `AUDIO_PROVIDER_HTTP_${response.status}`, "语音任务提交失败");
    const body = await response.json() as { output?: { task_id?: unknown } };
    const taskId = body.output?.task_id;
    if (typeof taskId !== "string" || !/^[A-Za-z0-9-]{16,160}$/.test(taskId)) throw new WorkflowError(503, "AUDIO_PROVIDER_RESPONSE_INVALID", "语音 Provider 返回无效任务");
    return { taskId };
  }

  async poll(taskId: string): Promise<AudioTaskStatus> {
    if (!/^[A-Za-z0-9-]{16,160}$/.test(taskId)) throw new WorkflowError(503, "AUDIO_PROVIDER_TASK_INVALID", "语音任务标识无效");
    const apiKey = await readQwenApiKey();
    const response = await this.fetchImplementation(`${baseUrl()}/tasks/${encodeURIComponent(taskId)}`, { headers: { authorization: `Bearer ${apiKey}` } });
    if (!response.ok) throw new WorkflowError(503, `AUDIO_PROVIDER_HTTP_${response.status}`, "语音任务查询失败");
    const body = await response.json() as { code?: unknown; output?: { task_status?: unknown; results?: Array<{ subtask_status?: unknown; transcription_url?: unknown; code?: unknown }> } };
    const status = body.output?.task_status;
    if (status === "PENDING") return { status: "pending" };
    if (status === "RUNNING") return { status: "running" };
    if (status !== "SUCCEEDED") return { status: "failed", code: controlledCode(body.code ?? status) };
    const result = body.output?.results?.find((item) => item.subtask_status === "SUCCEEDED");
    if (!result || typeof result.transcription_url !== "string") return { status: "failed", code: controlledCode(body.output?.results?.[0]?.code) };
    const resultUrl = new URL(result.transcription_url);
    if (resultUrl.protocol !== "https:" || resultUrl.username || resultUrl.password || !/(^|\.)aliyuncs\.com$/.test(resultUrl.hostname)) throw new WorkflowError(503, "AUDIO_RESULT_URL_INVALID", "语音结果地址无效");
    const resultResponse = await this.fetchImplementation(resultUrl, { redirect: "error" });
    if (!resultResponse.ok) throw new WorkflowError(503, "AUDIO_RESULT_DOWNLOAD_FAILED", "语音结果下载失败");
    const resultBody = await readBoundedJson(resultResponse) as {
      properties?: { original_duration_in_milliseconds?: unknown };
      transcripts?: Array<{ sentences?: Array<{ begin_time?: unknown; end_time?: unknown; text?: unknown; speaker_id?: unknown }> }>;
    };
    const sentences = resultBody.transcripts?.flatMap((transcript) => transcript.sentences ?? []) ?? [];
    const segments = sentences.map((sentence) => ({
      startMs: Number(sentence.begin_time),
      endMs: Number(sentence.end_time),
      text: typeof sentence.text === "string" ? sentence.text.trim() : "",
      speakerKey: `speaker-${Number(sentence.speaker_id) + 1}`,
      confidenceBps: null,
      language: "zh-CN",
    })).filter((segment) => Number.isInteger(segment.startMs) && Number.isInteger(segment.endMs) && segment.startMs >= 0 && segment.endMs > segment.startMs && segment.text && /^speaker-[1-9][0-9]*$/.test(segment.speakerKey));
    const totalCharacters = segments.reduce((total, segment) => total + segment.text.length, 0);
    if (!segments.length) return { status: "failed", code: "AUDIO_TRANSCRIPT_EMPTY" };
    if (
      segments.length > MAX_MEETING_TRANSCRIPT_SEGMENTS ||
      totalCharacters > MAX_MEETING_TRANSCRIPT_CHARACTERS ||
      segments.some((segment) => segment.text.length > MAX_MEETING_TRANSCRIPT_SEGMENT_CHARACTERS)
    ) return { status: "failed", code: "AUDIO_TRANSCRIPT_TOO_LARGE" };
    const duration = resultBody.properties?.original_duration_in_milliseconds;
    return { status: "succeeded", segments, durationMs: typeof duration === "number" && Number.isFinite(duration) ? Math.round(duration) : null };
  }
}

export class FakeAudioTranscriptionProvider implements AudioTranscriptionProvider, SpeakerDiarizationProvider {
  readonly provider = "fake" as const;
  readonly model = "fake-paraformer-v2";
  readonly diarizationProvider = "fake" as const;
  readonly diarizationModel = "fake-paraformer-v2";
  readonly providesSpeakerIds = true as const;
  async submit(fileUrl: string) { return { taskId: `fake-${createHash("sha256").update(fileUrl).digest("hex").slice(0, 32)}` }; }
  async poll(): Promise<AudioTaskStatus> { return { status: "succeeded", durationMs: 8_000, segments: [
    { startMs: 0, endMs: 3_500, speakerKey: "speaker-1", text: "我们今天确认虚构项目的验收范围。", confidenceBps: 9300, language: "zh-CN" },
    { startMs: 3_500, endMs: 8_000, speakerKey: "speaker-2", text: "我建议下周完成，但最终日期还需要确认。", confidenceBps: 9100, language: "zh-CN" },
  ] }; }
}

export function createAudioTranscriptionProvider(): AudioTranscriptionProvider & SpeakerDiarizationProvider {
  const environment = process.env.NEXT_PUBLIC_APP_ENV?.trim() || "development";
  const nodeEnvironment = process.env.NODE_ENV?.trim() || "";
  const provider = process.env.AUDIO_TRANSCRIPTION_PROVIDER?.trim() || "alibaba-model-studio";
  if (provider === "fake") {
    if (environment !== "test" || nodeEnvironment !== "test") throw new WorkflowError(503, "AUDIO_PROVIDER_NOT_CONFIGURED", "Mock 语音 Provider 仅允许测试环境");
    return new FakeAudioTranscriptionProvider();
  }
  if (provider !== "alibaba-model-studio") throw new WorkflowError(503, "AUDIO_PROVIDER_NOT_CONFIGURED", "语音 Provider 配置无效");
  return new AlibabaParaformerProvider();
}
