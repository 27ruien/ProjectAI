import { APP_RUNTIME } from "@/config/app-runtime";

const STORAGE_NAMESPACE = APP_RUNTIME.isStaging
  ? "project-ai-os:staging"
  : "project-ai-os";

export function storageKey(name: string): string {
  return `${STORAGE_NAMESPACE}:${name}`;
}
