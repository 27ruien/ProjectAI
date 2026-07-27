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
  describeArtifactSchemaFailure,
  ga4MeasurementPlanSchema,
  meetingSummarySchema,
  normalizeActionPlan,
  normalizeGa4MeasurementPlan,
  normalizeRequirementsDocumentBatch,
  describeRequirementsBatchSchemaFailure,
  overviewArtifactSchema,
  requirementsDocumentBatchSchema,
  requirementsDocumentSchema,
  validateGa4MeasurementIdGrounding,
  validateActionPlanDateGrounding,
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

  it("normalizes only safe requirement batch presentation differences", () => {
    const normalized = normalizeRequirementsDocumentBatch({
      sections: [{
        number: "6",
        title: "模型自带标题格式",
        body: "只使用虚构来源形成的范围说明。",
        classification: "fact",
        citations: "E1",
        ignoredPresentationField: "discarded",
      }],
    });
    const parsed = requirementsDocumentBatchSchema.safeParse(normalized);
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.sections[0]!.number, 6);
    assert.equal(parsed.data.sections[0]!.title, REQUIREMENTS_SECTION_TITLES[5]);
    assert.deepEqual(parsed.data.sections[0]!.citations, ["E1"]);
    assert.deepEqual(parsed.data.acceptanceCriteria, []);
    assert.equal("ignoredPresentationField" in parsed.data.sections[0]!, false);
  });

  it("normalizes bounded requirement batch aliases without weakening citation scope", () => {
    const criterion = "由项目经理确认范围。";
    const normalized = normalizeRequirementsDocumentBatch({
      sections: [{
        number: "06",
        title: "任意展示标题",
        body: ["范围仅限虚构单店。", "公开上线日期待确认。"],
        classification: "事实",
        citations: ["E1、E2", "E2"],
      }],
      acceptanceCriteria: criterion,
    });
    const parsed = requirementsDocumentBatchSchema.safeParse(normalized);
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.sections[0]!.classification, "fact");
    assert.equal(parsed.data.sections[0]!.body, "范围仅限虚构单店。\n公开上线日期待确认。");
    assert.deepEqual(parsed.data.sections[0]!.citations, ["E1", "E2"]);
    assert.deepEqual(parsed.data.acceptanceCriteria, [criterion]);
  });

  it("normalizes unambiguous classification labels and rejects unknown semantics", () => {
    const normalized = normalizeRequirementsDocumentBatch({
      sections: [
        { number: 1, title: "x", body: "已确认范围。", classification: "已确认事实（fact）", citations: ["E1"] },
        { number: 2, title: "x", body: "日期尚未确认。", classification: "未知 / pending", citations: [] },
      ],
    });
    const parsed = requirementsDocumentBatchSchema.safeParse(normalized);
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.sections[0]!.classification, "fact");
    assert.equal(parsed.data.sections[1]!.classification, "pending");
    const unknown = normalizeRequirementsDocumentBatch({
      sections: [{ number: 1, title: "x", body: "内容", classification: "untrusted-label", citations: [] }],
    });
    assert.equal(requirementsDocumentBatchSchema.safeParse(unknown).success, false);
  });

  it("persists a bounded schema path instead of provider output", () => {
    const failure = describeRequirementsBatchSchemaFailure(normalizeRequirementsDocumentBatch({
      sections: [{ number: 1, title: "x", body: null, classification: "pending", citations: [] }],
    }));
    assert.equal(failure, "WORKFLOW_REQ_SCHEMA_sections_0_body");
    assert.ok(failure.length <= 80);
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

  it("normalizes bounded GA4 presentation aliases and grounds non-TBD ids", () => {
    const normalized = normalizeGa4MeasurementPlan({
      overview: { platform: "GA4", measurementId: "待确认", validationStatus: "pending", projectName: "虚构项目", projectLink: "TBD", citations: "E1" },
      publicParameters: [{ name: "项目", description: "虚构项目", key: "Project ID", valueRule: "稳定标识", valueType: "文本", citations: "E1" }],
      events: [{ eventName: "Submit Form", coreEvent: "是", eventType: "tap", description: "提交", eventId: "Submit Form", parameterName: "", parameterDescription: "", parameterKey: "Submit Result", parameterValueRule: "", parameterValueType: "enum", citations: "E1" }],
      requirementEventCoverage: [{ requirement: "提交", eventId: "Submit Form", status: "已覆盖" }],
      pageEventMatrix: [{ page: "表单", eventId: "Submit Form", status: "待确认" }],
      ignored: "discarded",
    });
    const parsed = ga4MeasurementPlanSchema.safeParse(normalized);
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.overview.measurementId, "TBD");
    assert.equal(parsed.data.events[0]!.eventId, "submit_form");
    assert.equal(parsed.data.events[0]!.coreEvent, true);
    assert.equal(parsed.data.events[0]!.eventType, "click");
    assert.equal(validateGa4MeasurementIdGrounding(parsed.data, ["Measurement ID remains TBD"]), true);
    const fabricated = { ...parsed.data, overview: { ...parsed.data.overview, measurementId: "G-FABRICATED" } };
    assert.equal(validateGa4MeasurementIdGrounding(fabricated, ["no identifier here"]), false);
    assert.equal(validateGa4MeasurementIdGrounding(fabricated, ["approved G-FABRICATED"]), true);
  });

  it("normalizes overlong GA4 identifiers without creating collisions", () => {
    const sharedPrefix = "recommendation_result_with_a_provider_generated_shared_prefix";
    const normalized = normalizeGa4MeasurementPlan({
      overview: { platform: "GA4", measurementId: "TBD", validationStatus: "pending", projectName: "虚构项目", projectLink: "TBD", citations: ["E1"] },
      publicParameters: [],
      events: [
        { eventName: `${sharedPrefix}_one`, coreEvent: true, eventType: "result", description: "结果一", eventId: `${sharedPrefix}_one`, parameterName: "推荐", parameterDescription: "推荐结果", parameterKey: `${sharedPrefix}_parameter_one`, parameterValueRule: "stable", parameterValueType: [{ type: "枚举" }], note: "", developerFeedback: "pending", citations: ["E1"] },
        { eventName: `${sharedPrefix}_two`, coreEvent: false, eventType: "result", description: "结果二", eventId: `${sharedPrefix}_two`, parameterName: "推荐", parameterDescription: "推荐结果", parameterKey: "推荐结果", parameterValueRule: "stable", parameterValueType: ["string"], note: "", developerFeedback: "pending", citations: ["E1"] },
      ],
      requirementEventCoverage: [{ requirement: { id: "REQ-001", title: "生成推荐" }, eventId: { eventName: `${sharedPrefix}_one` }, status: "covered" }],
      pageEventMatrix: [{ page: 12, eventId: { id: `${sharedPrefix}_two` }, status: "covered" }],
    });
    const parsed = ga4MeasurementPlanSchema.safeParse(normalized);
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.match(parsed.data.events[0]!.parameterKey, /^[a-z][a-z0-9_]{0,39}$/);
    assert.match(parsed.data.events[1]!.parameterKey, /^x_[a-f0-9]{8}$/);
    assert.equal(parsed.data.events[0]!.parameterValueType, "string");
    assert.notEqual(parsed.data.events[0]!.parameterKey, parsed.data.events[1]!.parameterKey);
    assert.notEqual(parsed.data.events[0]!.eventId, parsed.data.events[1]!.eventId);
    assert.equal(parsed.data.requirementEventCoverage[0]!.requirement, "REQ-001");
    assert.equal(parsed.data.pageEventMatrix[0]!.page, "12");
    assert.equal(ga4MeasurementPlanSchema.safeParse({ ...parsed.data, requirementEventCoverage: [{ requirement: "REQ-001", eventId: "missing_event", status: "covered" }] }).success, false);
  });

  it("resolves unique GA4 event-name coverage references without guessing ambiguous aliases", () => {
    const base = {
      overview: { platform: "GA4", measurementId: "TBD", validationStatus: "pending", projectName: "虚构项目", projectLink: "TBD", citations: ["E1"] },
      publicParameters: [],
      events: [
        { eventName: "Open Form", coreEvent: true, eventType: "click", description: "打开表单", eventId: "form_opened", parameterName: "入口", parameterDescription: "入口名称", parameterKey: "entry_name", parameterValueRule: "stable", parameterValueType: "string", note: "", developerFeedback: "pending", citations: ["E1"] },
      ],
      requirementEventCoverage: [{ requirement: "REQ-001", eventId: { eventName: "Open Form" }, status: "covered" }],
      pageEventMatrix: [{ page: "首页", eventId: "Open Form", status: "covered" }],
    };
    const normalized = normalizeGa4MeasurementPlan(base);
    const parsed = ga4MeasurementPlanSchema.safeParse(normalized);
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.requirementEventCoverage[0]!.eventId, "form_opened");
    assert.equal(parsed.data.pageEventMatrix[0]!.eventId, "form_opened");

    const ambiguous = normalizeGa4MeasurementPlan({
      ...base,
      events: [
        base.events[0],
        { ...base.events[0], eventId: "modal_opened", description: "打开弹窗" },
      ],
    });
    assert.equal(ga4MeasurementPlanSchema.safeParse(ambiguous).success, false);
  });

  it("expands bounded multi-event GA4 coverage into exact event-id rows", () => {
    const normalized = normalizeGa4MeasurementPlan({
      overview: { platform: "GA4", measurementId: "TBD", validationStatus: "pending", projectName: "虚构项目", projectLink: "TBD", citations: ["E1"] },
      publicParameters: [],
      events: [
        { eventName: "Open Form", coreEvent: true, eventType: "click", description: "打开表单", eventId: "form_opened", parameterName: "入口", parameterDescription: "入口名称", parameterKey: "entry_name", parameterValueRule: "stable", parameterValueType: "string", note: "", developerFeedback: "pending", citations: ["E1"] },
        { eventName: "Submit Form", coreEvent: true, eventType: "result", description: "提交表单", eventId: "form_submitted", parameterName: "结果", parameterDescription: "提交结果", parameterKey: "submit_result", parameterValueRule: "success|failed", parameterValueType: "string", note: "", developerFeedback: "pending", citations: ["E1"] },
      ],
      requirementEventCoverage: [{ requirements: [{ id: "REQ-001" }, "REQ-002"], eventIds: [{ eventName: "Open Form" }, "form_submitted"], status: "covered" }],
      pageEventMatrix: [{ pages: ["表单", { path: "/result" }], eventId: "Open Form, Submit Form", status: "covered" }],
    });
    const parsed = ga4MeasurementPlanSchema.safeParse(normalized);
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.deepEqual(parsed.data.requirementEventCoverage, [
      { requirement: "REQ-001", eventId: "form_opened", status: "covered" },
      { requirement: "REQ-001", eventId: "form_submitted", status: "covered" },
      { requirement: "REQ-002", eventId: "form_opened", status: "covered" },
      { requirement: "REQ-002", eventId: "form_submitted", status: "covered" },
    ]);
    assert.deepEqual(parsed.data.pageEventMatrix, [
      { page: "表单", eventId: "form_opened", status: "covered" },
      { page: "表单", eventId: "form_submitted", status: "covered" },
      { page: "/result", eventId: "form_opened", status: "covered" },
      { page: "/result", eventId: "form_submitted", status: "covered" },
    ]);

    const excessive = normalizeGa4MeasurementPlan({
      ...(normalized as Record<string, unknown>),
      requirementEventCoverage: [{ requirement: "REQ-001", eventId: Array.from({ length: 21 }, (_, index) => `event_${index}`), status: "covered" }],
    });
    assert.equal(ga4MeasurementPlanSchema.safeParse(excessive).success, false);
    const excessiveLabels = normalizeGa4MeasurementPlan({
      ...(normalized as Record<string, unknown>),
      requirementEventCoverage: [{ requirements: Array.from({ length: 21 }, (_, index) => `REQ-${index}`), eventId: "form_opened", status: "covered" }],
    });
    assert.equal(ga4MeasurementPlanSchema.safeParse(excessiveLabels).success, false);
  });

  it("describes GA4 schema failures without provider content", () => {
    const failure = describeArtifactSchemaFailure("ga4_measurement_plan", normalizeGa4MeasurementPlan({
      overview: { platform: "GA4", measurementId: "TBD", validationStatus: "pending", projectName: "虚构", projectLink: "TBD", citations: [] },
      publicParameters: [], events: [{ eventId: "invalid id" }], requirementEventCoverage: [], pageEventMatrix: [],
    }));
    assert.match(failure, /^WORKFLOW_GA4_SCHEMA_events_0_/);
    assert.ok(failure.length <= 80);
  });

  it("keeps unknown dates as TBD and rejects date inversions and dependency cycles", () => {
    assert.equal(ACTION_PLAN_SCHEMA_VERSION, "projectai-action-plan-v1");
    const task = (name: string, dependency: string[] = []) => ({ taskCn: name, taskEn: "", owner: "TBD", stakeholder: "待确认", startDate: "TBD", endDate: "TBD", progress: 0, milestone: false, meeting: "", parentTask: null, dependency, confirmationOwner: "TBD", latestConfirmationDate: "TBD", delayImpact: "可能影响下游里程碑", criticalPath: false, sourceCitation: "待确认", assumption: "", status: "pending_confirmation" });
    assert.equal(actionPlanSchema.safeParse({ tasks: [task("任务 A")], warnings: [] }).success, true);
    assert.equal(actionPlanSchema.safeParse({ tasks: [task("任务 A", ["任务 B"]), task("任务 B", ["任务 A"])], warnings: [] }).success, false);
    assert.equal(actionPlanSchema.safeParse({ tasks: [{ ...task("任务 A"), startDate: "2026-08-02", endDate: "2026-08-01" }], warnings: [] }).success, false);
  });

  it("normalizes conservative Action Plan defaults and rejects ungrounded dates", () => {
    const normalized = normalizeActionPlan({ tasks: [{
      taskCn: "确认范围", owner: "PM", stakeholder: "Client", startDate: "待确认", endDate: "TBD",
      progress: "25%", milestone: "是", parentTask: "无", dependency: [], latestConfirmationDate: "2031-03-09",
      criticalPath: "false", sourceCitation: ["E1"], status: "进行中",
    }] });
    const parsed = actionPlanSchema.safeParse(normalized);
    assert.equal(parsed.success, true);
    if (!parsed.success) return;
    assert.equal(parsed.data.tasks[0]!.progress, 25);
    assert.equal(parsed.data.tasks[0]!.milestone, true);
    assert.equal(parsed.data.tasks[0]!.startDate, "TBD");
    assert.equal(parsed.data.tasks[0]!.status, "in_progress");
    assert.equal(validateActionPlanDateGrounding(parsed.data, ["最晚于 2031-03-09 确认"]), true);
    assert.equal(validateActionPlanDateGrounding(parsed.data, ["没有日期"]), false);
    const suggested = { ...parsed.data, tasks: [{ ...parsed.data.tasks[0]!, latestConfirmationDate: "2031-03-08", sourceCitation: "AI 建议", assumption: "AI 建议在实现前两日确认" }] };
    assert.equal(validateActionPlanDateGrounding(suggested, ["没有日期"]), true);
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
