import type {
  AIModel,
  AIModelProfile,
  AISimulationOptions,
  TokenUsage,
} from "@/types";

export interface ProviderRequestContext {
  executionId: string;
  model: AIModel;
  profile: AIModelProfile;
  attempt: number;
  projectId?: string;
  skillId?: string;
  simulation?: AISimulationOptions;
}

export interface ProviderTextRequest extends ProviderRequestContext {
  prompt: string;
  systemPrompt?: string;
}

export interface ProviderStructuredRequest<T> extends ProviderTextRequest {
  schemaName: string;
  mockData: T;
}

export interface ProviderEmbeddingRequest extends ProviderRequestContext {
  text: string;
  dimensions: number;
}

export interface ProviderDocumentRequest extends ProviderRequestContext {
  documentId: string;
  documentName: string;
  content: string;
}

export interface ProviderToolRequest extends ProviderRequestContext {
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ProviderResult<T> {
  data: T;
  usage: TokenUsage;
  latency: number;
}

export interface ProviderDocumentAnalysis {
  summary: string;
  extractedFacts: string[];
  extractedRequirements: string[];
}

export interface AIProviderAdapter {
  generateText(request: ProviderTextRequest): Promise<ProviderResult<string>>;
  generateStructuredOutput<T>(
    request: ProviderStructuredRequest<T>,
  ): Promise<ProviderResult<T>>;
  generateEmbedding(
    request: ProviderEmbeddingRequest,
  ): Promise<ProviderResult<number[]>>;
  analyzeDocument(
    request: ProviderDocumentRequest,
  ): Promise<ProviderResult<ProviderDocumentAnalysis>>;
  executeToolCall(
    request: ProviderToolRequest,
  ): Promise<ProviderResult<Record<string, unknown>>>;
}
