export * from "./enums";
export * from "./users";
export * from "./sessions";
export * from "./auth-support";
export * from "./projects";
export * from "./project-members";
export * from "./audit-events";

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
