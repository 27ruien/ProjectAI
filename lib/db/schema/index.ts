export * from "./enums";
export * from "./users";
export * from "./sessions";
export * from "./auth-support";
export * from "./projects";
export * from "./project-members";
export * from "./organizations";
export * from "./knowledge-spaces";
export * from "./knowledge-grants";
export * from "./requirements-scope";
export * from "./work-management";
export * from "./audit-events";
export * from "./project-documents";
export * from "./document-ingestion";
export * from "./ai-assistant";
export * from "./document-embeddings";
export * from "./ai-retrieval-profile";
export * from "./ai-retrieval";

import { account, rateLimit, verification } from "./auth-support";
import { session } from "./sessions";
import { user } from "./users";

// Better Auth looks up these singular model keys. Table names stay plural.
export const betterAuthSchema = {
  user,
  session,
  account,
  verification,
  rateLimit,
};
