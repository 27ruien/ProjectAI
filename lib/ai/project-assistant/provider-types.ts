export type ProjectAssistantProviderPurpose =
  | "answer"
  | "repair"
  | "probe"
  | "requirement_extraction"
  | "requirement_repair"
  | "requirement_document"
  | "requirement_document_repair"
  | "requirement_overview"
  | "action_generation"
  | "risk_generation"
  | "weekly_report"
  | "timesheet_generation"
  | "timesheet_repair";

export type ProjectAssistantProviderRequest = {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  purpose: ProjectAssistantProviderPurpose;
  responseFormat: "text" | "json_object";
  /** Stored server-side per model; never accepted from the browser. */
  disableThinkingForJson?: boolean;
  timeoutMs: number;
  temperature: number;
  maxOutputTokens: number;
};

export type ProjectAssistantProviderResult = {
  text: string;
  actualModel: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  providerRequestId: string | null;
  latencyMs: number;
};

export interface ProjectAssistantProvider {
  readonly provider: "qwen" | "fake";
  generate(
    request: ProjectAssistantProviderRequest,
  ): Promise<ProjectAssistantProviderResult>;
}
