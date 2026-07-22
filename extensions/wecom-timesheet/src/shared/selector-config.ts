export type SelectorConfig = {
  boardReady: string;
  loggedOutIndicator: string;
  overlay: string;
  formIframe: string;
  createTaskButton: string;
  taskForm: string;
  descriptionInput: string;
  projectControl: string;
  projectOptions: string;
  projectSelectedValue: string;
  hoursInput: string;
  categoryControl: string;
  categoryOptions: string;
  categorySelectedValue: string;
  statusControl: string;
  statusOptions: string;
  statusSelectedValue: string;
  itemSaveButton: string;
  saveSuccess: string;
  saveFailure: string;
};

const KEYS: Array<keyof SelectorConfig> = [
  "boardReady",
  "loggedOutIndicator",
  "overlay",
  "formIframe",
  "createTaskButton",
  "taskForm",
  "descriptionInput",
  "projectControl",
  "projectOptions",
  "projectSelectedValue",
  "hoursInput",
  "categoryControl",
  "categoryOptions",
  "categorySelectedValue",
  "statusControl",
  "statusOptions",
  "statusSelectedValue",
  "itemSaveButton",
  "saveSuccess",
  "saveFailure",
];

export function validateSelectorConfig(value: unknown): { ok: true; value: SelectorConfig } | { ok: false; code: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "SELECTOR_CONFIG_MISSING" };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => /final|submit.?all|daily.?submit/i.test(key))) {
    return { ok: false, code: "FINAL_SUBMIT_SELECTOR_FORBIDDEN" };
  }
  for (const key of KEYS) {
    if (typeof record[key] !== "string" || !record[key] || record[key].length > 500) {
      return { ok: false, code: "SELECTOR_CONFIG_INVALID" };
    }
  }
  if (Object.keys(record).length !== KEYS.length) return { ok: false, code: "SELECTOR_CONFIG_UNKNOWN_FIELD" };
  return { ok: true, value: record as SelectorConfig };
}
