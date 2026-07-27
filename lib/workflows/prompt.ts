import {
  OVERVIEW_FIELDS,
  REQUIREMENTS_SECTION_TITLES,
  type RequirementArtifactKind,
} from "./contracts";

export type WorkflowEvidence = {
  label: string;
  documentId: string;
  versionId: string;
  chunkId: string;
  documentName: string;
  headingPath: string[];
  locator: Record<string, unknown>;
  content: string;
};

const COMMON = `你是 ProjectAI 的受控项目经理文档助手。只允许使用 <evidence_json> 中的事实。
严禁编造日期、负责人、平台 ID、Measurement ID、客户确认和决策。缺失值必须写为“待确认”或“TBD”。
事实必须绑定本次 E 标签；推论标记 assumption，建议标记 advice，缺失标记 pending。
只输出单个 JSON 对象，不输出 Markdown fence、解释或额外字段。`;

function schemaInstruction(
  kind: RequirementArtifactKind,
  requirementSectionNumbers?: number[],
): string {
  if (kind === "project_overview") {
    return `输出 {sections:[{title,fields:[{name,value,classification,citations}]}],pendingQuestions:[]}。
sections 必须为“项目背景”和“需求概览”；fields 必须逐一且只覆盖：${OVERVIEW_FIELDS.join("、")}。`;
  }
  if (kind === "requirements_document") {
    if (requirementSectionNumbers?.length) {
      return `输出 {sections:[{number,title,body,classification,citations}],acceptanceCriteria:[]}。
本次 sections 必须逐一且只覆盖：${requirementSectionNumbers.map((number) => `${number}.${REQUIREMENTS_SECTION_TITLES[number - 1]}`).join("；")}。`;
    }
    return `输出 {sections:[{number,title,body,classification,citations}],acceptanceCriteria:[]}。
必须正好 26 节、顺序与标题完全一致：${REQUIREMENTS_SECTION_TITLES.map((title, index) => `${index + 1}.${title}`).join("；")}。验收标准必须可执行可测试。`;
  }
  if (kind === "ga4_measurement_plan") {
    return `输出 {overview:{platform,measurementId,validationStatus,projectName,projectLink,citations},publicParameters:[],events:[],requirementEventCoverage:[],pageEventMatrix:[]}。
publicParameters 字段为 name,description,key,valueRule,valueType,note,citations。
events 字段为 eventName,coreEvent,eventType,description,eventId,parameterName,parameterDescription,parameterKey,parameterValueRule,parameterValueType,note,developerFeedback,citations。
eventId/key 必须稳定 snake_case；eventType 只能是 page_view、click、select、permission、ai、result、error、custom；valueType 只能是 string、number、boolean、date、array；coreEvent 只能是 JSON boolean；Coverage status 只能是 covered、gap、pending。每条 requirementEventCoverage/pageEventMatrix 的 requirement/page/eventId 都必须是单个字符串，eventId 必须逐字复制当前 events[] 中某一项的 eventId；需求、页面或事件存在多对多关系时拆成多行，禁止数组、对象、事件名或不存在的 ID。未知 Measurement ID 写 TBD。`;
  }
  return `输出 {tasks:[],warnings:[]}。tasks 字段必须为 taskCn,taskEn,owner,stakeholder,startDate,endDate,progress,milestone,meeting,parentTask,dependency,confirmationOwner,latestConfirmationDate,delayImpact,criticalPath,sourceCitation,assumption,status。
日期只能 YYYY-MM-DD 或 TBD；来源无日期不得反推确定日期；建议日期须令 sourceCitation 为“AI 建议”并在 assumption 明确“AI 建议”。progress 只能是 0–100 的 JSON integer；milestone 和 criticalPath 只能是 JSON boolean；status 只能是 not_started、in_progress、blocked、completed、pending_confirmation。dependency 和 parentTask 只能引用同一输出中的 taskCn，严禁循环依赖。`;
}

export function buildArtifactPrompt(input: {
  kind: RequirementArtifactKind;
  projectName: string;
  evidence: WorkflowEvidence[];
  previousOutput?: string;
  validationFailure?: string;
  requirementSectionNumbers?: number[];
}) {
  const evidence = input.evidence.map((item) => ({
    label: item.label,
    documentName: item.documentName,
    headingPath: item.headingPath,
    locator: item.locator,
    content: item.content,
  }));
  const sectionNumbers = input.kind === "requirements_document"
    ? input.requirementSectionNumbers
    : undefined;
  const batchInstruction = sectionNumbers?.length
    ? `\n本次只输出章节 ${sectionNumbers.join("、")}，不得输出其他章节；每节 body 应简洁、可审核，控制在 80–500 字。classification 只能原样使用英文枚举 fact、assumption、advice、pending 之一，不得附加解释或使用其他值。fact 必须至少引用一个本次 evidence 中存在的 E 标签。${sectionNumbers.includes(26) ? "本批必须提供至少一条可测试的 acceptanceCriteria。" : "本批 acceptanceCriteria 可以为空，最终由服务端统一合并去重。"}`
    : "";
  return {
    systemPrompt: `${COMMON}\n${schemaInstruction(input.kind, sectionNumbers)}${batchInstruction}`,
    userPrompt: `<artifact_kind_json>${JSON.stringify(input.kind)}</artifact_kind_json>\n<project_name_json>${JSON.stringify(input.projectName)}</project_name_json>${sectionNumbers?.length ? `\n<requirement_section_numbers_json>${JSON.stringify(sectionNumbers)}</requirement_section_numbers_json>` : ""}\n<evidence_json>${JSON.stringify(evidence)}</evidence_json>${input.previousOutput ? `\n<invalid_output_json>${JSON.stringify(input.previousOutput.slice(0, 40_000))}</invalid_output_json>\n<validation_failure_json>${JSON.stringify(input.validationFailure ?? "SCHEMA_INVALID")}</validation_failure_json>\n请只修复结构和引用，不增加来源外事实。` : ""}`,
  };
}
