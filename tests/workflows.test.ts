import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { unzipSync } from "fflate";
import {
  ACTION_PLAN_SCHEMA_VERSION,
  GA4_SCHEMA_VERSION,
  OVERVIEW_FIELDS,
  REQUIREMENTS_SECTION_TITLES,
  actionPlanSchema,
  ga4MeasurementPlanSchema,
  meetingSummarySchema,
  overviewArtifactSchema,
  requirementsDocumentSchema,
  validateCitationLabels,
} from "../lib/workflows/contracts";
import { buildArtifactExport } from "../lib/workflows/export";
import {
  AlibabaParaformerProvider,
  FakeAudioTranscriptionProvider,
  createAudioTranscriptionProvider,
} from "../lib/workflows/audio-provider";
import { buildAudioProviderUrl } from "../lib/workflows/audio-service";
import { buildArtifactPrompt } from "../lib/workflows/prompt";
import type { WorkflowArtifactPayload } from "../lib/workflows/service";

let directory = "";

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "projectai-workflows-test-"));
  const qwen = path.join(directory, "qwen");
  const audio = path.join(directory, "audio-signing");
  await writeFile(qwen, "test-only-provider-key\n", { mode: 0o600 });
  await writeFile(audio, Buffer.alloc(48, 7).toString("base64") + "\n", { mode: 0o600 });
  await chmod(qwen, 0o600);
  await chmod(audio, 0o600);
  process.env.QWEN_API_KEY_FILE = qwen;
  process.env.AUDIO_DOWNLOAD_SIGNING_KEY_FILE = audio;
  process.env.AUDIO_PROVIDER_PUBLIC_BASE_URL = "https://example.invalid/tool/projectai";
});

after(async () => {
  delete process.env.QWEN_API_KEY_FILE;
  delete process.env.AUDIO_DOWNLOAD_SIGNING_KEY_FILE;
  delete process.env.AUDIO_PROVIDER_PUBLIC_BASE_URL;
  await rm(directory, { recursive: true, force: true });
});

function artifact(kind: string, content: Record<string, unknown>, markdown: string): WorkflowArtifactPayload {
  return {
    id: `artifact-${kind}`,
    projectId: "project-fixture",
    kind,
    title: kind,
    status: "awaiting_review",
    currentVersion: 1,
    content,
    markdown,
    sourceReferences: [],
    contentDigest: "a".repeat(64),
    updatedAt: new Date(0).toISOString(),
  };
}

describe("V3 workflow artifact contracts", () => {
  it("requires every overview field and a citation for facts", () => {
    const value = {
      sections: [
        { title: "项目背景", fields: OVERVIEW_FIELDS.slice(0, 16).map((name) => ({ name, value: "已确认", classification: "fact", citations: ["E1"] })) },
        { title: "需求概览", fields: OVERVIEW_FIELDS.slice(16).map((name) => ({ name, value: "待确认", classification: "pending", citations: [] })) },
      ],
      pendingQuestions: ["待确认虚构项目上线时间"],
    };
    assert.equal(overviewArtifactSchema.safeParse(value).success, true);
    value.sections[0]!.fields[0]!.citations = [];
    assert.equal(overviewArtifactSchema.safeParse(value).success, false);
  });

  it("requires the exact ordered 26-section requirement document", () => {
    const sections: Array<{ number: number; title: string; body: string; classification: string; citations: string[] }> = REQUIREMENTS_SECTION_TITLES.map((title, index) => ({ number: index + 1, title, body: "待确认", classification: "pending", citations: [] }));
    const value = {
      sections,
      acceptanceCriteria: ["由项目经理人工确认"],
    };
    assert.equal(requirementsDocumentSchema.safeParse(value).success, true);
    value.sections[2]!.title = "错误标题";
    assert.equal(requirementsDocumentSchema.safeParse(value).success, false);
  });

  it("binds requirement batches to the requested section numbers without contradictory full-document instructions", () => {
    const prompt = buildArtifactPrompt({
      kind: "requirements_document",
      projectName: "虚构项目",
      evidence: [],
      requirementSectionNumbers: [6, 7, 8, 9, 10],
    });
    assert.match(prompt.userPrompt, /<requirement_section_numbers_json>\[6,7,8,9,10\]<\/requirement_section_numbers_json>/);
    assert.match(prompt.systemPrompt, /本次 sections 必须逐一且只覆盖：6\./);
    assert.doesNotMatch(prompt.systemPrompt, /必须正好 26 节/);
    assert.match(prompt.systemPrompt, /本批 acceptanceCriteria 可以为空/);
    assert.match(prompt.systemPrompt, /fact 必须至少引用一个/);
  });

  it("enforces versioned GA4 naming and rejects fabricated measurement ids", () => {
    assert.equal(GA4_SCHEMA_VERSION, "projectai-ga4-v1");
    const value = {
      overview: { platform: "GA4", measurementId: "TBD", validationStatus: "pending", projectName: "虚构项目", projectLink: "TBD", citations: ["E1"] },
      publicParameters: [{ name: "项目", description: "虚构项目", key: "project_id", valueRule: "stable id", valueType: "string", note: "", citations: ["E1"] }],
      events: [{ eventName: "submit_form", coreEvent: true, eventType: "click", description: "提交", eventId: "submit_form", parameterName: "结果", parameterDescription: "提交结果", parameterKey: "submit_result", parameterValueRule: "success|failed", parameterValueType: "string", note: "", developerFeedback: "pending", citations: ["E1"] }],
      requirementEventCoverage: [{ requirement: "提交", eventId: "submit_form", status: "covered" }],
      pageEventMatrix: [{ page: "表单", eventId: "submit_form", status: "covered" }],
    };
    assert.equal(ga4MeasurementPlanSchema.safeParse(value).success, true);
    value.events[0]!.eventId = "Submit Form";
    assert.equal(ga4MeasurementPlanSchema.safeParse(value).success, false);
    value.events[0]!.eventId = "submit_form";
    value.overview.measurementId = "G-FABRICATED-ID!";
    assert.equal(ga4MeasurementPlanSchema.safeParse(value).success, false);
  });

  it("keeps unknown dates as TBD and rejects date inversions and dependency cycles", () => {
    assert.equal(ACTION_PLAN_SCHEMA_VERSION, "projectai-action-plan-v1");
    const task = (name: string, dependency: string[] = []) => ({ taskCn: name, taskEn: "", owner: "TBD", stakeholder: "待确认", startDate: "TBD", endDate: "TBD", progress: 0, milestone: false, meeting: "", parentTask: null, dependency, confirmationOwner: "TBD", latestConfirmationDate: "TBD", delayImpact: "可能影响下游里程碑", criticalPath: false, sourceCitation: "待确认", assumption: "", status: "pending_confirmation" });
    assert.equal(actionPlanSchema.safeParse({ tasks: [task("任务 A")], warnings: [] }).success, true);
    assert.equal(actionPlanSchema.safeParse({ tasks: [task("任务 A", ["任务 B"]), task("任务 B", ["任务 A"])], warnings: [] }).success, false);
    assert.equal(actionPlanSchema.safeParse({ tasks: [{ ...task("任务 A"), startDate: "2026-08-02", endDate: "2026-08-01" }], warnings: [] }).success, false);
  });

  it("distinguishes confirmed decisions and validates every transcript citation", () => {
    const summary = { background: "虚构会议", topics: ["范围"], keyPoints: [{ text: "讨论范围", segmentIds: ["S1"] }], decisions: [], proposals: [{ text: "建议下周完成", segmentIds: ["S2"] }], openQuestions: ["日期待确认"], risks: [], actions: [{ text: "确认日期", owner: "Speaker 2", deadline: "TBD", dependencies: [], segmentIds: ["S2"] }] };
    assert.equal(meetingSummarySchema.safeParse(summary).success, true);
    assert.equal(validateCitationLabels(summary, new Set(["S1", "S2"])), true);
    summary.actions[0]!.segmentIds = ["S9"];
    assert.equal(validateCitationLabels(summary, new Set(["S1", "S2"])), false);
  });
});

describe("V3 artifact exports and audio provider boundary", () => {
  it("creates readable OOXML packages without embedding external files", async () => {
    const docx = await buildArtifactExport({ artifact: artifact("requirements_document", {}, "# 虚构需求\n\n## 背景\n\n仅用于测试。\n"), projectName: "虚构项目", format: "docx" });
    const docxFiles = unzipSync(docx.bytes);
    assert.ok(docxFiles["word/document.xml"]);
    assert.ok(docxFiles["word/header1.xml"]);
    const xlsx = await buildArtifactExport({ artifact: artifact("action_plan", { tasks: [{ taskCn: "确认范围", taskEn: "Confirm scope", owner: "PM", stakeholder: "Client", startDate: "TBD", endDate: "TBD", progress: 0, milestone: true, meeting: "Kickoff", parentTask: null, dependency: [], confirmationOwner: "Client", latestConfirmationDate: "TBD", delayImpact: "影响 UAT", criticalPath: true, sourceCitation: "待确认", assumption: "", status: "pending_confirmation" }] }, "# Action Plan\n"), projectName: "虚构项目", format: "xlsx" });
    const xlsxFiles = unzipSync(xlsx.bytes);
    assert.ok(xlsxFiles["xl/worksheets/sheet1.xml"]);
    assert.match(new TextDecoder().decode(xlsxFiles["xl/worksheets/sheet1.xml"]), /Latest Confirmation Date/);
  });

  it("allows Fake ASR only in the deterministic test boundary", async () => {
    Reflect.set(process.env, "NODE_ENV", "test");
    process.env.NEXT_PUBLIC_APP_ENV = "test";
    process.env.AUDIO_TRANSCRIPTION_PROVIDER = "fake";
    assert.ok(createAudioTranscriptionProvider() instanceof FakeAudioTranscriptionProvider);
    const result = await createAudioTranscriptionProvider().poll("fake-task");
    assert.equal(result.status, "succeeded");
    process.env.NEXT_PUBLIC_APP_ENV = "staging";
    assert.throws(() => createAudioTranscriptionProvider(), /Mock 语音 Provider 仅允许测试环境/);
    process.env.NEXT_PUBLIC_APP_ENV = "test";
  });

  it("submits Alibaba async ASR with diarization and accepts only controlled result hosts", async () => {
    process.env.QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new AlibabaParaformerProvider(async (input, init) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.endsWith("/services/audio/asr/transcription")) return new Response(JSON.stringify({ output: { task_id: "12345678-1234-1234-1234-123456789012" } }), { status: 200 });
      if (url.endsWith("/tasks/12345678-1234-1234-1234-123456789012")) return new Response(JSON.stringify({ output: { task_status: "SUCCEEDED", results: [{ subtask_status: "SUCCEEDED", transcription_url: "https://dashscope-result.oss-cn-beijing.aliyuncs.com/result.json" }] } }), { status: 200 });
      return new Response(JSON.stringify({ properties: { original_duration_in_milliseconds: 4000 }, transcripts: [{ sentences: [{ begin_time: 0, end_time: 2000, text: "范围已确认", speaker_id: 0 }, { begin_time: 2000, end_time: 4000, text: "日期待确认", speaker_id: 1 }] }] }), { status: 200 });
    });
    const submitted = await provider.submit("https://example.invalid/tool/projectai/api/workflows/audio-source?opaque=test");
    const result = await provider.poll(submitted.taskId);
    assert.equal(result.status, "succeeded");
    assert.equal(result.status === "succeeded" ? new Set(result.segments.map((item) => item.speakerKey)).size : 0, 2);
    const body = JSON.parse(String(requests[0]!.init?.body));
    assert.equal(body.model, "paraformer-v2");
    assert.equal(body.parameters.diarization_enabled, true);
    assert.equal(requests.some((item) => item.url.includes("/api/v1/tasks/")), true);
  });

  it("creates a one-hour HTTPS audio capability bound to run and source", async () => {
    const url = new URL(await buildAudioProviderUrl("run-123", "source-123"));
    assert.equal(url.protocol, "https:");
    assert.equal(url.pathname, "/tool/projectai/api/workflows/audio-source");
    assert.equal(url.searchParams.get("runId"), "run-123");
    assert.equal(url.searchParams.get("sourceId"), "source-123");
    assert.match(url.searchParams.get("signature") ?? "", /^[A-Za-z0-9_-]{43}$/);
    const ttl = Number(url.searchParams.get("expires")) - Math.floor(Date.now() / 1000);
    assert.ok(ttl >= 3598 && ttl <= 3600);
  });
});
