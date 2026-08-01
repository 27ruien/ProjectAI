export type AssistantIntent =
  | "general_chat"
  | "project_question"
  | "company_question"
  | "mixed_context_question"
  | "skill_request"
  | "artifact_request";

/**
 * This router only decides whether protected context is relevant. The model
 * remains responsible for understanding and answering the user's request.
 * Protected scope is computed server-side from the current principal, so a
 * linked-project picker is never a prerequisite for a fact question.
 */
export function classifyAssistantIntent(input: { question: string; hasAssociatedProject?: boolean }): AssistantIntent {
  const text = input.question.trim().toLocaleLowerCase("zh-CN");
  if (/(需求概览|根据模板生成|补充需求概览)/.test(text)) return "skill_request";
  if (/(下载|导出|保存到项目|创建新版本|生成markdown)/.test(text)) return "artifact_request";
  const company = /(公司|制度|sop|规范|隐私|uat|交付要求|模板)/.test(text);
  const project = /(项目|当前|上线|需求|风险|项目资料|这份文档)/.test(text);
  if (company && project) return "mixed_context_question";
  if (company) return "company_question";
  if (project) return "project_question";
  return "general_chat";
}

export function intentNeedsProjectEvidence(intent: AssistantIntent): boolean {
  return intent === "project_question" || intent === "mixed_context_question" || intent === "skill_request";
}
