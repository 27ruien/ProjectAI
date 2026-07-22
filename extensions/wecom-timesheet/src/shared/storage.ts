import type { SafeLogEntry } from "./logging";
import type { SelectorConfig } from "./selector-config";
import type { PersistedBatch } from "./state-machine";

const STATE_KEY = "projectai.timesheet.batches.v1";
const CONFIG_KEY = "projectai.timesheet.config.v1";
const LOG_KEY = "projectai.timesheet.logs.v1";

type StoredConfig = { boardUrl: string; selectors: SelectorConfig | null };

export async function loadBatches(): Promise<Record<string, PersistedBatch>> {
  const value = await chrome.storage.local.get(STATE_KEY);
  const stored = value[STATE_KEY];
  return stored && typeof stored === "object" && !Array.isArray(stored)
    ? (stored as Record<string, PersistedBatch>)
    : {};
}

export async function saveBatch(batch: PersistedBatch): Promise<void> {
  const batches = await loadBatches();
  batches[batch.syncBatchId] = batch;
  await chrome.storage.local.set({ [STATE_KEY]: batches });
}

export async function loadConfig(): Promise<StoredConfig> {
  const value = await chrome.storage.local.get(CONFIG_KEY);
  const stored = value[CONFIG_KEY];
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { boardUrl: "", selectors: null };
  }
  const config = stored as Partial<StoredConfig>;
  return {
    boardUrl: typeof config.boardUrl === "string" ? config.boardUrl : "",
    selectors: config.selectors ?? null,
  };
}

export async function saveConfig(config: StoredConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

export async function appendLog(entry: SafeLogEntry): Promise<void> {
  const value = await chrome.storage.local.get(LOG_KEY);
  const logs = Array.isArray(value[LOG_KEY]) ? (value[LOG_KEY] as SafeLogEntry[]) : [];
  await chrome.storage.local.set({ [LOG_KEY]: [...logs.slice(-499), entry] });
}

export async function loadLogs(): Promise<SafeLogEntry[]> {
  const value = await chrome.storage.local.get(LOG_KEY);
  return Array.isArray(value[LOG_KEY]) ? (value[LOG_KEY] as SafeLogEntry[]) : [];
}

export async function clearLocalData(confirmed: boolean): Promise<void> {
  if (!confirmed) throw new Error("CLEAR_CONFIRMATION_REQUIRED");
  await chrome.storage.local.remove([STATE_KEY, LOG_KEY]);
}
