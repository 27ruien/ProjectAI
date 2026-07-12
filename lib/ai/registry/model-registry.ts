import type { AIModel } from "@/types";

export class AIModelRegistry {
  private readonly models = new Map<string, AIModel>();

  constructor(models: AIModel[] = []) {
    models.forEach((model) => this.register(model));
  }

  register(model: AIModel): void {
    this.models.set(model.id, model);
  }

  get(modelId: string): AIModel | undefined {
    return this.models.get(modelId) ?? [...this.models.values()].find((model) => model.modelId === modelId);
  }

  require(modelId: string): AIModel {
    const model = this.get(modelId);
    if (!model) throw new Error(`AI model not found: ${modelId}`);
    return model;
  }

  list(): AIModel[] {
    return [...this.models.values()];
  }

  listActive(): AIModel[] {
    return this.list().filter((model) => model.status === "active");
  }
}
