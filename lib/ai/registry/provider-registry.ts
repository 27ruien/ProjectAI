import type { AIProvider } from "@/types";
import type { AIProviderAdapter } from "../providers/ai-provider";

export class AIProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();
  private readonly adapters = new Map<string, AIProviderAdapter>();

  constructor(providers: AIProvider[] = []) {
    providers.forEach((provider) => this.register(provider));
  }

  register(provider: AIProvider, adapter?: AIProviderAdapter): void {
    this.providers.set(provider.id, provider);
    if (adapter) this.adapters.set(provider.id, adapter);
  }

  setAdapter(providerId: string, adapter: AIProviderAdapter): void {
    this.adapters.set(providerId, adapter);
  }

  get(providerId: string): AIProvider | undefined {
    return this.providers.get(providerId) ?? [...this.providers.values()].find((provider) => provider.providerId === providerId);
  }

  require(providerId: string): AIProvider {
    const provider = this.get(providerId);
    if (!provider) throw new Error(`AI provider not found: ${providerId}`);
    return provider;
  }

  requireAdapter(providerId: string): AIProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new Error(`AI provider adapter not found: ${providerId}`);
    return adapter;
  }

  list(): AIProvider[] {
    return [...this.providers.values()];
  }
}
