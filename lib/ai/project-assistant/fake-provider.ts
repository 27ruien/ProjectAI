import { AiProviderError } from "./errors";
import type {
  ProjectAssistantProvider,
  ProjectAssistantProviderRequest,
  ProjectAssistantProviderResult,
} from "./provider-types";

function taggedQuestion(prompt: string): string {
  const match = prompt.match(/<current_question_json>\s*([\s\S]*?)\s*<\/current_question_json>/u);
  if (!match?.[1]) return "";
  try {
    const value: unknown = JSON.parse(match[1]);
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export class FakeProjectAssistantProvider implements ProjectAssistantProvider {
  readonly provider = "fake" as const;
  readonly calls: ProjectAssistantProviderRequest[] = [];

  async generate(request: ProjectAssistantProviderRequest): Promise<ProjectAssistantProviderResult> {
    this.calls.push(request);
    if (request.userPrompt.includes("FAKE_TIMEOUT")) throw new AiProviderError("TIMEOUT", true);
    if (request.userPrompt.includes("FAKE_401")) throw new AiProviderError("UNAUTHORIZED", false);
    const question = taggedQuestion(request.userPrompt);
    const text = request.purpose === "probe"
      ? "PROJECT_AI_QWEN_PROBE_OK"
      : `根据当前授权项目资料，对“${question || "当前问题"}”的回答如下。[E1]`;
    const inputTokens = Math.max(20, Math.ceil((request.systemPrompt.length + request.userPrompt.length) / 3));
    const outputTokens = Math.max(8, Math.ceil(text.length / 3));
    return {
      text,
      actualModel: request.model,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      providerRequestId: `fake-${this.calls.length}`,
      latencyMs: 5,
    };
  }
}
