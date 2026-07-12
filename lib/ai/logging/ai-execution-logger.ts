import type { AIExecution, AIExecutionLogEntry, TokenUsage } from "@/types";

export interface StartExecutionInput {
  projectId?: string;
  skillId?: string;
  modelProfileId: string;
  modelId: string;
  providerId: string;
  sourceIds?: string[];
}

function createRuntimeId(): string {
  return `runtime-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class AIExecutionLogger {
  private readonly executions = new Map<string, AIExecution>();

  constructor(seed: AIExecution[] = []) {
    seed.forEach((execution) => this.executions.set(execution.id, execution));
  }

  start(input: StartExecutionInput): AIExecution {
    const now = new Date().toISOString();
    const id = createRuntimeId();
    const execution: AIExecution = {
      id,
      executionId: id,
      projectId: input.projectId,
      skillId: input.skillId,
      modelProfileId: input.modelProfileId,
      modelId: input.modelId,
      providerId: input.providerId,
      status: "running",
      startedAt: now,
      durationMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      retryCount: 0,
      cost: 0,
      currency: "CNY",
      logs: [],
      version: 1,
      sourceIds: input.sourceIds ?? [],
      createdAt: now,
      updatedAt: now,
      createdBy: "Mock AI Gateway",
    };
    this.executions.set(id, execution);
    this.append(id, "info", `开始执行，使用 Model Profile：${input.modelProfileId}`);
    return execution;
  }

  append(executionId: string, level: AIExecutionLogEntry["level"], message: string, metadata?: Record<string, unknown>): void {
    const execution = this.require(executionId);
    const timestamp = new Date().toISOString();
    execution.logs.push({ id: `${executionId}-log-${execution.logs.length + 1}`, timestamp, level, message, metadata });
    execution.updatedAt = timestamp;
  }

  setRoute(executionId: string, modelId: string, providerId: string): void {
    const execution = this.require(executionId);
    execution.modelId = modelId;
    execution.providerId = providerId;
  }

  retry(executionId: string, reason: string): void {
    const execution = this.require(executionId);
    execution.status = "retrying";
    execution.retryCount += 1;
    this.append(executionId, "warning", `调用失败，准备重试：${reason}`);
  }

  succeed(executionId: string, usage: TokenUsage, cost: number, durationMs: number): AIExecution {
    const execution = this.require(executionId);
    const now = new Date().toISOString();
    execution.status = "succeeded";
    execution.completedAt = now;
    execution.durationMs = durationMs;
    execution.inputTokens = usage.inputTokens;
    execution.outputTokens = usage.outputTokens;
    execution.totalTokens = usage.totalTokens;
    execution.cost = cost;
    execution.updatedAt = now;
    this.append(executionId, "info", "执行成功，结果已作为 AI 临时产出保存");
    return execution;
  }

  fail(executionId: string, error: string): AIExecution {
    const execution = this.require(executionId);
    const now = new Date().toISOString();
    execution.status = "failed";
    execution.error = error;
    execution.completedAt = now;
    execution.durationMs = Date.now() - new Date(execution.startedAt).getTime();
    execution.updatedAt = now;
    this.append(executionId, "error", `执行失败：${error}`);
    return execution;
  }

  get(executionId: string): AIExecution | undefined {
    return this.executions.get(executionId);
  }

  list(): AIExecution[] {
    return [...this.executions.values()];
  }

  private require(executionId: string): AIExecution {
    const execution = this.executions.get(executionId);
    if (!execution) throw new Error(`AI execution not found: ${executionId}`);
    return execution;
  }
}
