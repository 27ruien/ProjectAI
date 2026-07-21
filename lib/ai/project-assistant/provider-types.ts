export type ProjectAssistantProviderPurpose =
  | "answer"
  | "repair"
  | "probe"
  | "requirement_extraction"
  | "weekly_report";

export type ProjectAssistantProviderRequest = {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  purpose: ProjectAssistantProviderPurpose;
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
