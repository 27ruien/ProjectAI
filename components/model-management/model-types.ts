export interface AIProviderView {
  id: string;
  providerId: string;
  providerName: string;
  providerType: string;
  baseUrl: string;
  region: string;
  status: string;
  priority: number;
  timeout: number;
  concurrencyLimit: number;
  monthlyBudget: number;
  currentSpend: number;
  secretConfigured: boolean;
}

export interface AIModelView {
  id: string;
  modelId: string;
  displayName: string;
  provider: string;
  providerId?: string;
  providerModelName: string;
  modelType: string;
  capabilityTags: string[];
  contextWindow: number;
  maxOutputTokens: number;
  qualityLevel: string | number;
  speedLevel: string | number;
  costLevel: string | number;
  status: string;
}

export interface AIModelProfileView {
  id: string;
  profileId: string;
  displayName: string;
  description: string;
  primaryModelId: string;
  fallbackModelId: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutSeconds: number;
  retryCount: number;
  structuredOutput: boolean;
  toolCalling: boolean;
  visionRequired: boolean;
  costLimit: number;
  status: string;
  relatedSkillIds: string[];
}

export interface AIExecutionView {
  id: string;
  executionId: string;
  projectId?: string;
  workflowId?: string;
  skillId?: string;
  modelProfileId: string;
  modelId: string;
  providerId: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  retryCount: number;
  cost: number;
  currency: string;
  logs: string[];
  error?: string;
  createdAt: string;
}

export interface SkillRelationView {
  id: string;
  name: string;
  displayName: string;
  module: string;
  status: string;
  modelProfileId: string;
  fallbackModelProfileId: string;
  approvalRequired: boolean;
}

