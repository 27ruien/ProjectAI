import {
  PROJECT_ASSISTANT_PROFILE_ID,
  requireAiAssistantEnabled,
  type AiRuntimeConfig,
} from "@/lib/ai/project-assistant/config";
import type { WorkflowType } from "./contracts";
import { WorkflowError } from "./errors";

type TrustedWorkflowModelProfile = {
  id: string;
  runtimeProfileId: typeof PROJECT_ASSISTANT_PROFILE_ID;
};

const TRUSTED_WORKFLOW_MODEL_PROFILES: Record<WorkflowType, TrustedWorkflowModelProfile> = {
  requirement_framework: {
    id: "qwen-requirement-framework-cn-v1",
    runtimeProfileId: PROJECT_ASSISTANT_PROFILE_ID,
  },
  meeting_minutes: {
    id: "qwen-meeting-minutes-cn-v1",
    runtimeProfileId: PROJECT_ASSISTANT_PROFILE_ID,
  },
};

export function requireWorkflowModelProfile(
  workflowType: string,
  modelProfileId: string,
): AiRuntimeConfig {
  const trusted = TRUSTED_WORKFLOW_MODEL_PROFILES[workflowType as WorkflowType];
  if (!trusted || modelProfileId !== trusted.id) {
    throw new WorkflowError(
      503,
      "WORKFLOW_MODEL_PROFILE_INVALID",
      "工作流模型配置无效",
    );
  }
  const runtime = requireAiAssistantEnabled();
  if (runtime.profileId !== trusted.runtimeProfileId) {
    throw new WorkflowError(
      503,
      "WORKFLOW_MODEL_PROFILE_INVALID",
      "工作流模型配置与 AI Gateway 不一致",
    );
  }
  return runtime;
}

export function isTrustedWorkflowModelProfile(
  workflowType: string,
  modelProfileId: string,
): boolean {
  return TRUSTED_WORKFLOW_MODEL_PROFILES[workflowType as WorkflowType]?.id === modelProfileId;
}
