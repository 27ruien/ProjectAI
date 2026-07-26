import type { WorkflowArtifactKind } from "./contracts";

function cell(value: unknown): string {
  return String(value ?? "").replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

export function renderArtifactMarkdown(kind: WorkflowArtifactKind, value: Record<string, unknown>): string {
  const lines: string[] = [];
  if (kind === "project_overview") {
    lines.push("# 项目需求概览", "");
    for (const section of value.sections as Array<{ title: string; fields: Array<{ name: string; value: string; classification: string; citations: string[] }> }>) {
      lines.push(`## ${section.title}`, "", "| 字段 | 内容 | 类型 | 来源 |", "| --- | --- | --- | --- |");
      for (const field of section.fields) lines.push(`| ${cell(field.name)} | ${cell(field.value)} | ${cell(field.classification)} | ${field.citations.join(", ") || "—"} |`);
      lines.push("");
    }
    lines.push("## 待确认事项", "", ...((value.pendingQuestions as string[]).map((item) => `- ${item}`)));
  } else if (kind === "requirements_document") {
    lines.push("# 需求文档", "");
    for (const section of value.sections as Array<{ number: number; title: string; body: string; classification: string; citations: string[] }>) {
      lines.push(`## ${section.number}. ${section.title}`, "", section.body, "", `类型：${section.classification}；来源：${section.citations.join(", ") || "—"}`, "");
    }
    lines.push("## Acceptance Criteria", "", ...((value.acceptanceCriteria as string[]).map((item) => `- ${item}`)));
  } else if (kind === "ga4_measurement_plan") {
    lines.push("# GA4 埋点文档", "", "## 概览", "", "```json", JSON.stringify(value.overview, null, 2), "```", "", "## 公共参数", "", "```json", JSON.stringify(value.publicParameters, null, 2), "```", "", "## 自定义参数/事件", "", "```json", JSON.stringify(value.events, null, 2), "```", "", "## Requirement → Event Coverage Matrix", "", "```json", JSON.stringify(value.requirementEventCoverage, null, 2), "```", "", "## 页面 → Event Matrix", "", "```json", JSON.stringify(value.pageEventMatrix, null, 2), "```");
  } else if (kind === "action_plan") {
    lines.push("# Action Plan", "", "| 中文任务 | Owner | 开始 | 结束 | 进度 | Milestone | 依赖 | 最晚确认 | 影响 | 关键路径 | 来源 |", "| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |");
    for (const task of value.tasks as Array<Record<string, unknown>>) lines.push(`| ${cell(task.taskCn)} | ${cell(task.owner)} | ${cell(task.startDate)} | ${cell(task.endDate)} | ${cell(task.progress)}% | ${task.milestone ? "是" : "否"} | ${cell((task.dependency as string[]).join("、") || "—")} | ${cell(task.latestConfirmationDate)} | ${cell(task.delayImpact)} | ${task.criticalPath ? "是" : "否"} | ${cell(task.sourceCitation)} |`);
  } else if (kind === "meeting_transcript") {
    lines.push("# 完整会议转写", "");
    for (const segment of value.segments as Array<Record<string, unknown>>) lines.push(`- [${Math.floor(Number(segment.startMs) / 1000)}s–${Math.floor(Number(segment.endMs) / 1000)}s] **${cell(segment.speakerName)}**：${String(segment.text)}`);
  } else if (kind === "meeting_minutes") {
    const summary = value as Record<string, unknown> & { topics: string[]; keyPoints: Array<{ text: string; segmentIds: string[] }>; decisions: Array<{ text: string; segmentIds: string[] }>; proposals: Array<{ text: string; segmentIds: string[] }>; openQuestions: string[]; risks: Array<{ text: string; segmentIds: string[] }> };
    lines.push("# 会议纪要", "", "## 会议背景", "", String(summary.background), "", "## 讨论主题", "", ...summary.topics.map((item) => `- ${item}`), "", "## 核心讨论要点", "", ...summary.keyPoints.map((item) => `- ${item.text}（${item.segmentIds.join(", ")}）`), "", "## 已确认决策", "", ...(summary.decisions.length ? summary.decisions.map((item) => `- ${item.text}（${item.segmentIds.join(", ")}）`) : ["- 无明确已确认决策"]), "", "## 建议", "", ...summary.proposals.map((item) => `- ${item.text}（${item.segmentIds.join(", ")}）`), "", "## 未确认问题", "", ...summary.openQuestions.map((item) => `- ${item}`), "", "## 风险和阻塞", "", ...summary.risks.map((item) => `- ${item.text}（${item.segmentIds.join(", ")}）`));
  } else {
    lines.push("# 会议待办", "", "| 待办 | Owner | Deadline | 依赖 | 来源 |", "| --- | --- | --- | --- | --- |");
    for (const item of value.actions as Array<{ text: string; owner: string; deadline: string; dependencies: string[]; segmentIds: string[] }>) lines.push(`| ${cell(item.text)} | ${cell(item.owner)} | ${cell(item.deadline)} | ${cell(item.dependencies.join("、") || "—")} | ${item.segmentIds.join(", ")} |`);
  }
  return `${lines.join("\n").trim()}\n`;
}
