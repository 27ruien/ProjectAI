import type { SourceLocator } from "@/lib/documents/processing/source-locator";

export const PROJECT_ASSISTANT_MODEL_PROFILE_ID =
  "qwen-project-assistant-cn-v1" as const;

export type ProjectAssistantCitationDto = {
  index: number;
  displayName: string;
  versionNumber: number;
  mimeType: string;
  headingPath: string[];
  source: SourceLocator;
  excerpt: string;
  documentId: string;
  versionId: string;
};

export type ProjectAssistantMessageDto = {
  id: string;
  role: "user" | "assistant";
  status: "pending" | "completed" | "failed" | "insufficient_evidence";
  content: string;
  createdAt: string;
  citations: ProjectAssistantCitationDto[];
  fallbackUsed: boolean;
};

export type ProjectAssistantThreadSummaryDto = {
  id: string;
  title: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  messageCount: number;
};

export type ProjectAssistantThreadDto = ProjectAssistantThreadSummaryDto & {
  messages: ProjectAssistantMessageDto[];
};

export type ProjectAssistantThreadsResponse = {
  threads: ProjectAssistantThreadSummaryDto[];
};

export type ProjectAssistantThreadResponse = {
  thread: ProjectAssistantThreadDto;
};

export type ProjectAssistantMessageResponse = {
  thread: ProjectAssistantThreadSummaryDto;
  userMessage: ProjectAssistantMessageDto;
  assistantMessage: ProjectAssistantMessageDto;
  execution: {
    id: string;
    status:
      | "reserved"
      | "retrieving"
      | "calling_provider"
      | "validating"
      | "succeeded"
      | "failed"
      | "insufficient_evidence";
    replayed: boolean;
    fallbackUsed: boolean;
  };
};

export type ProjectAssistantQuestionRequest = {
  question: string;
  modelProfileId: typeof PROJECT_ASSISTANT_MODEL_PROFILE_ID;
};
