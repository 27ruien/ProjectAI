import { RagflowClient } from "./client";
import { getRagflowConfig, readRagflowApiKey } from "./config";

export * from "./client";
export * from "./config";
export * from "./errors";
export * from "./types";

export async function createRagflowClient(): Promise<RagflowClient> {
  return new RagflowClient(getRagflowConfig(), await readRagflowApiKey());
}
