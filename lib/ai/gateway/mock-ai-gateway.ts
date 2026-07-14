import type {
  AIGateway,
  AIGenerationMetadata,
  AIModel,
  AnalyzeDocumentInput,
  AnalyzeDocumentResult,
  ExecuteToolCallInput,
  ExecuteToolCallResult,
  GenerateEmbeddingInput,
  GenerateEmbeddingResult,
  GenerateStructuredOutputInput,
  GenerateStructuredOutputResult,
  GenerateTextInput,
  GenerateTextResult,
  TokenUsage,
} from "@/types";
import { AICostCalculator } from "../cost/ai-cost-calculator";
import {
  safeMockAIModelProfiles,
  safeMockAIModels,
  safeMockAIProviders,
} from "../fixtures/non-project-catalog";
import { AIExecutionLogger } from "../logging/ai-execution-logger";
import type { ProviderResult } from "../providers/ai-provider";
import { MockAIProvider } from "../providers/mock-ai-provider";
import { AIModelRegistry } from "../registry/model-registry";
import { ModelProfileRegistry } from "../registry/model-profile-registry";
import { AIProviderRegistry } from "../registry/provider-registry";
import { ModelRouter } from "../router/model-router";

export class AIGatewayError extends Error {
  constructor(
    message: string,
    public readonly executionId: string,
  ) {
    super(message);
    this.name = "AIGatewayError";
  }
}

interface GatewayRunResult<T> {
  data: T;
  metadata: AIGenerationMetadata;
}

interface RunInput {
  profileId: string;
  projectId?: string;
  skillId?: string;
  sourceIds?: string[];
}

export interface MockAIGatewayDependencies {
  modelRegistry?: AIModelRegistry;
  profileRegistry?: ModelProfileRegistry;
  providerRegistry?: AIProviderRegistry;
  router?: ModelRouter;
  logger?: AIExecutionLogger;
  costCalculator?: AICostCalculator;
  provider?: MockAIProvider;
}

export class MockAIGateway implements AIGateway {
  readonly modelRegistry: AIModelRegistry;
  readonly profileRegistry: ModelProfileRegistry;
  readonly providerRegistry: AIProviderRegistry;
  readonly router: ModelRouter;
  readonly logger: AIExecutionLogger;
  readonly costCalculator: AICostCalculator;

  constructor(dependencies: MockAIGatewayDependencies = {}) {
    this.modelRegistry = dependencies.modelRegistry ?? new AIModelRegistry(safeMockAIModels);
    this.profileRegistry = dependencies.profileRegistry ?? new ModelProfileRegistry(safeMockAIModelProfiles);
    this.providerRegistry = dependencies.providerRegistry ?? new AIProviderRegistry(safeMockAIProviders);
    const provider = dependencies.provider ?? new MockAIProvider();
    this.providerRegistry.list().forEach((item) => this.providerRegistry.setAdapter(item.id, provider));
    this.router = dependencies.router ?? new ModelRouter(this.modelRegistry, this.profileRegistry, this.providerRegistry);
    this.logger = dependencies.logger ?? new AIExecutionLogger();
    this.costCalculator = dependencies.costCalculator ?? new AICostCalculator();
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const result = await this.run(input, "text", (model, attempt, executionId) =>
      this.providerRegistry.requireAdapter(model.providerId).generateText({
        executionId, model, profile: this.profileRegistry.require(input.profileId), attempt,
        projectId: input.projectId, skillId: input.skillId, simulation: input.simulation,
        prompt: input.prompt, systemPrompt: input.systemPrompt,
      }),
    );
    return { text: result.data, ...result.metadata };
  }

  async generateStructuredOutput<T>(input: GenerateStructuredOutputInput<T>): Promise<GenerateStructuredOutputResult<T>> {
    const result = await this.run(input, "structuredOutput", (model, attempt, executionId) =>
      this.providerRegistry.requireAdapter(model.providerId).generateStructuredOutput({
        executionId, model, profile: this.profileRegistry.require(input.profileId), attempt,
        projectId: input.projectId, skillId: input.skillId, simulation: input.simulation,
        prompt: input.prompt, systemPrompt: input.systemPrompt, schemaName: input.schemaName, mockData: input.mockData,
      }),
    );
    return { data: result.data, ...result.metadata };
  }

  async generateEmbedding(input: GenerateEmbeddingInput): Promise<GenerateEmbeddingResult> {
    const dimensions = input.dimensions ?? 32;
    const result = await this.run(input, "embedding", (model, attempt, executionId) =>
      this.providerRegistry.requireAdapter(model.providerId).generateEmbedding({
        executionId, model, profile: this.profileRegistry.require(input.profileId), attempt,
        projectId: input.projectId, simulation: input.simulation, text: input.text, dimensions,
      }),
    );
    return { embedding: result.data, dimensions, ...result.metadata };
  }

  async analyzeDocument(input: AnalyzeDocumentInput): Promise<AnalyzeDocumentResult> {
    const result = await this.run({ ...input, sourceIds: [input.documentId] }, "fileInput", (model, attempt, executionId) =>
      this.providerRegistry.requireAdapter(model.providerId).analyzeDocument({
        executionId, model, profile: this.profileRegistry.require(input.profileId), attempt,
        projectId: input.projectId, skillId: input.skillId, simulation: input.simulation,
        documentId: input.documentId, documentName: input.documentName, content: input.content,
      }),
    );
    return {
      summary: result.data.summary,
      extractedFacts: result.data.extractedFacts,
      extractedRequirements: result.data.extractedRequirements,
      citations: [],
      ...result.metadata,
    };
  }

  async executeToolCall(input: ExecuteToolCallInput): Promise<ExecuteToolCallResult> {
    const result = await this.run(input, "toolCalling", (model, attempt, executionId) =>
      this.providerRegistry.requireAdapter(model.providerId).executeToolCall({
        executionId, model, profile: this.profileRegistry.require(input.profileId), attempt,
        projectId: input.projectId, skillId: input.skillId, simulation: input.simulation,
        toolName: input.toolName, arguments: input.arguments,
      }),
    );
    return { toolName: input.toolName, output: result.data, ...result.metadata };
  }

  private async run<T>(
    input: RunInput,
    capability: "text" | "structuredOutput" | "embedding" | "fileInput" | "toolCalling",
    invoke: (model: AIModel, attempt: number, executionId: string) => Promise<ProviderResult<T>>,
  ): Promise<GatewayRunResult<T>> {
    const route = this.router.route(input.profileId, capability);
    const execution = this.logger.start({
      projectId: input.projectId,
      skillId: input.skillId,
      modelProfileId: route.profile.id,
      modelId: route.primaryModel.id,
      providerId: route.primaryModel.providerId,
      sourceIds: input.sourceIds,
    });
    const started = Date.now();
    let lastError: unknown;

    for (let attempt = 0; attempt <= route.profile.retryCount; attempt += 1) {
      const model = attempt === 0 ? route.primaryModel : route.fallbackModel;
      this.logger.setRoute(execution.id, model.id, model.providerId);
      this.logger.append(execution.id, "info", `第 ${attempt + 1} 次调用：${model.displayName}`);
      try {
        const providerResult = await invoke(model, attempt, execution.id);
        const cost = this.costCalculator.calculate(model, providerResult.usage);
        const completed = this.logger.succeed(execution.id, providerResult.usage, cost.totalCost, Date.now() - started);
        return {
          data: providerResult.data,
          metadata: this.metadata(completed.id, completed.modelProfileId, model, providerResult.usage, cost.totalCost, providerResult.latency, completed.retryCount),
        };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : "未知 Mock AI 错误";
        if (attempt < route.profile.retryCount) {
          this.logger.retry(execution.id, message);
          continue;
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : "Mock AI 执行失败";
    this.logger.fail(execution.id, message);
    throw new AIGatewayError(message, execution.id);
  }

  private metadata(
    executionId: string,
    modelProfileId: string,
    model: AIModel,
    usage: TokenUsage,
    cost: number,
    latency: number,
    retryCount: number,
  ): AIGenerationMetadata {
    return {
      executionId,
      modelProfileId,
      modelId: model.id,
      providerId: model.providerId,
      status: "succeeded",
      usage,
      cost,
      latency,
      retryCount,
    };
  }
}

export function createMockAIGateway(dependencies?: MockAIGatewayDependencies): MockAIGateway {
  return new MockAIGateway(dependencies);
}

export const mockAIGateway = createMockAIGateway();
