import type {
  EntityAudit,
  EntityId,
  ISODateString,
} from "./common";
import type { SourceCitation } from "./knowledge";

export type AIProviderStatus = "active" | "inactive" | "degraded";
export type AIModelStatus = "active" | "inactive" | "deprecated";
export type AIModelProfileStatus = "active" | "inactive" | "draft";
export type AIExecutionStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying"
  | "cancelled";

export interface AIProvider extends EntityAudit {
  id: EntityId;
  providerId: string;
  providerName: string;
  providerType: "cloud" | "azure" | "internal";
  baseUrl: string;
  region: string;
  status: AIProviderStatus;
  priority: number;
  timeout: number;
  concurrencyLimit: number;
  monthlyBudget: number;
  currentSpend: number;
  secretConfigured: boolean;
}

export type AIModelCapability =
  | "text"
  | "vision"
  | "fileInput"
  | "toolCalling"
  | "structuredOutput"
  | "embedding"
  | "reranking"
  | "imageGeneration";

export type AIModelType =
  | "chat"
  | "reasoning"
  | "embedding"
  | "reranker"
  | "vision"
  | "image";

export type ModelLevel = "low" | "medium" | "high";

export interface AIModel extends EntityAudit {
  id: EntityId;
  modelId: string;
  displayName: string;
  providerId: EntityId;
  providerModelName: string;
  modelType: AIModelType;
  capabilityTags: AIModelCapability[];
  contextWindow: number;
  maxOutputTokens: number;
  qualityLevel: ModelLevel;
  speedLevel: ModelLevel;
  costLevel: ModelLevel;
  status: AIModelStatus;
}

export interface AIModelProfile extends EntityAudit {
  id: EntityId;
  profileId: string;
  displayName: string;
  description: string;
  primaryModelId: EntityId;
  fallbackModelId: EntityId;
  temperature: number;
  maxOutputTokens: number;
  timeoutSeconds: number;
  retryCount: number;
  structuredOutput: boolean;
  toolCalling: boolean;
  visionRequired: boolean;
  costLimit: number;
  status: AIModelProfileStatus;
  relatedSkillIds: EntityId[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AIExecutionLogEntry {
  id: EntityId;
  timestamp: ISODateString;
  level: "info" | "warning" | "error";
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AIExecution extends EntityAudit {
  id: EntityId;
  executionId: string;
  projectId?: EntityId;
  workflowId?: EntityId;
  skillId?: EntityId;
  modelProfileId: EntityId;
  modelId: EntityId;
  providerId: EntityId;
  status: AIExecutionStatus;
  startedAt: ISODateString;
  completedAt?: ISODateString;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  retryCount: number;
  cost: number;
  currency: "CNY";
  logs: AIExecutionLogEntry[];
  error?: string;
  version: number;
  sourceIds: EntityId[];
}

export interface AIUsageLog extends EntityAudit {
  id: EntityId;
  executionId: EntityId;
  projectId?: EntityId;
  skillId?: EntityId;
  modelProfileId: EntityId;
  modelId: EntityId;
  usage: TokenUsage;
  durationMs: number;
}

export interface AICostRecord extends EntityAudit {
  id: EntityId;
  executionId: EntityId;
  providerId: EntityId;
  modelId: EntityId;
  inputCost: number;
  outputCost: number;
  totalCost: number;
  currency: "CNY";
}

export interface AISimulationOptions {
  latencyMs?: number;
  forceFailure?: boolean;
  failAttempts?: number;
}

export interface GenerateTextInput {
  profileId: EntityId;
  prompt: string;
  systemPrompt?: string;
  projectId?: EntityId;
  skillId?: EntityId;
  sourceIds?: EntityId[];
  simulation?: AISimulationOptions;
}

export interface GenerateStructuredOutputInput<T> extends GenerateTextInput {
  mockData: T;
  schemaName: string;
}

export interface GenerateEmbeddingInput {
  profileId: EntityId;
  text: string;
  projectId?: EntityId;
  dimensions?: number;
  simulation?: AISimulationOptions;
}

export interface AnalyzeDocumentInput {
  profileId: EntityId;
  documentId: EntityId;
  documentName: string;
  content: string;
  projectId: EntityId;
  skillId?: EntityId;
  simulation?: AISimulationOptions;
}

export interface ExecuteToolCallInput {
  profileId: EntityId;
  toolName: string;
  arguments: Record<string, unknown>;
  projectId?: EntityId;
  skillId?: EntityId;
  simulation?: AISimulationOptions;
}

export interface AIGenerationMetadata {
  executionId: EntityId;
  modelProfileId: EntityId;
  modelId: EntityId;
  providerId: EntityId;
  status: "succeeded";
  usage: TokenUsage;
  cost: number;
  latency: number;
  retryCount: number;
}

export interface GenerateTextResult extends AIGenerationMetadata {
  text: string;
}

export interface GenerateStructuredOutputResult<T>
  extends AIGenerationMetadata {
  data: T;
}

export interface GenerateEmbeddingResult extends AIGenerationMetadata {
  embedding: number[];
  dimensions: number;
}

export interface AnalyzeDocumentResult extends AIGenerationMetadata {
  summary: string;
  extractedFacts: string[];
  extractedRequirements: string[];
  citations: SourceCitation[];
}

export interface ExecuteToolCallResult extends AIGenerationMetadata {
  toolName: string;
  output: Record<string, unknown>;
}

export interface AIGateway {
  generateText(input: GenerateTextInput): Promise<GenerateTextResult>;
  generateStructuredOutput<T>(
    input: GenerateStructuredOutputInput<T>,
  ): Promise<GenerateStructuredOutputResult<T>>;
  generateEmbedding(
    input: GenerateEmbeddingInput,
  ): Promise<GenerateEmbeddingResult>;
  analyzeDocument(input: AnalyzeDocumentInput): Promise<AnalyzeDocumentResult>;
  executeToolCall(
    input: ExecuteToolCallInput,
  ): Promise<ExecuteToolCallResult>;
}
