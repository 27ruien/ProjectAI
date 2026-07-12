import type { AIModel, AIModelCapability, AIModelProfile } from "@/types";
import { AIModelRegistry } from "../registry/model-registry";
import { ModelProfileRegistry } from "../registry/model-profile-registry";
import { AIProviderRegistry } from "../registry/provider-registry";

export interface ModelRoute {
  profile: AIModelProfile;
  primaryModel: AIModel;
  fallbackModel: AIModel;
}

export class ModelRouter {
  constructor(
    private readonly models: AIModelRegistry,
    private readonly profiles: ModelProfileRegistry,
    private readonly providers: AIProviderRegistry,
  ) {}

  route(profileId: string, requiredCapability?: AIModelCapability): ModelRoute {
    const profile = this.profiles.require(profileId);
    if (profile.status !== "active") throw new Error(`Model profile is not active: ${profileId}`);
    const primaryModel = this.models.require(profile.primaryModelId);
    const fallbackModel = this.models.require(profile.fallbackModelId);
    this.assertModel(primaryModel, requiredCapability);
    this.assertModel(fallbackModel, requiredCapability);
    return { profile, primaryModel, fallbackModel };
  }

  private assertModel(model: AIModel, capability?: AIModelCapability): void {
    if (model.status !== "active") throw new Error(`AI model is not active: ${model.id}`);
    const provider = this.providers.require(model.providerId);
    if (provider.status === "inactive") throw new Error(`AI provider is inactive: ${provider.id}`);
    if (capability && !model.capabilityTags.includes(capability)) {
      throw new Error(`AI model ${model.id} does not support ${capability}`);
    }
  }
}
