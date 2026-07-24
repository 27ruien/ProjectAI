export type SelectorConfig = {
  persistenceMode: "explicit-save" | "auto-save";
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
  submitterValue: string;
  regularHoursInput: string;
  overtimeHoursInput: string;
  statusControl: string;
  statusOptions: string;
  statusSelectedValue: string;
  urgencyControl: string;
  urgencyOptions: string;
  urgencySelectedValue: string;
  progressInput: string;
  itemSaveButton: string;
  saveSuccess: string;
  saveFailure: string;
  recordRows: string;
  recordDescription: string;
  recordProject: string;
  recordSubmitter: string;
  recordRegularHours: string;
  recordOvertimeHours: string;
  recordStatus: string;
  recordUrgency: string;
  recordProgress: string;
};

const SELECTOR_KEYS: Array<Exclude<keyof SelectorConfig, "persistenceMode">> = [
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
  "submitterValue",
  "regularHoursInput",
  "overtimeHoursInput",
  "statusControl",
  "statusOptions",
  "statusSelectedValue",
  "urgencyControl",
  "urgencyOptions",
  "urgencySelectedValue",
  "progressInput",
  "itemSaveButton",
  "saveSuccess",
  "saveFailure",
  "recordRows",
  "recordDescription",
  "recordProject",
  "recordSubmitter",
  "recordRegularHours",
  "recordOvertimeHours",
  "recordStatus",
  "recordUrgency",
  "recordProgress",
];

const FORBIDDEN_SELECTOR_CONTENT =
  /(?:javascript|vbscript)\s*:|data\s*:\s*text\/html|<\s*script\b|\bon[a-z]+\s*=|\[\s*on[a-z]+(?:\s|\]|[~|^$*]?=)|\beval\s*\(|\bfunction\s*\(|=>|\b(?:window|document|globalThis)\s*\.|[`;{}]|[\u0000-\u001f\u007f]/iu;

const BROAD_ACTION_SELECTOR = /^(?:\*|html|body|:root|form|button|input|textarea|select)$/i;
const ACTION_KEYS = new Set<keyof SelectorConfig>([
  "createTaskButton",
  "taskForm",
  "descriptionInput",
  "projectControl",
  "regularHoursInput",
  "overtimeHoursInput",
  "statusControl",
  "urgencyControl",
  "progressInput",
  "itemSaveButton",
]);

function safeSelector(key: keyof SelectorConfig, selector: string): boolean {
  if (selector !== selector.trim() || FORBIDDEN_SELECTOR_CONTENT.test(selector)) return false;
  if (ACTION_KEYS.has(key) && (selector.includes(",") || BROAD_ACTION_SELECTOR.test(selector))) {
    return false;
  }
  let square = 0;
  let round = 0;
  let quote = "";
  for (let index = 0; index < selector.length; index += 1) {
    const character = selector[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") quote = character;
    else if (character === "[") square += 1;
    else if (character === "]") square -= 1;
    else if (character === "(") round += 1;
    else if (character === ")") round -= 1;
    if (square < 0 || round < 0) return false;
  }
  return !quote && square === 0 && round === 0;
}

export function validateSelectorConfig(value: unknown): { ok: true; value: SelectorConfig } | { ok: false; code: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, code: "SELECTOR_CONFIG_MISSING" };
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some((key) => /final|submit.?all|daily.?submit/i.test(key))) {
    return { ok: false, code: "FINAL_SUBMIT_SELECTOR_FORBIDDEN" };
  }
  if (record.persistenceMode !== "explicit-save" && record.persistenceMode !== "auto-save") {
    return { ok: false, code: "SELECTOR_CONFIG_INVALID" };
  }
  for (const key of SELECTOR_KEYS) {
    if (typeof record[key] !== "string" || !record[key] || record[key].length > 500) {
      return { ok: false, code: "SELECTOR_CONFIG_INVALID" };
    }
    if (!safeSelector(key, record[key] as string)) {
      return { ok: false, code: "SELECTOR_CONFIG_UNSAFE" };
    }
  }
  if (Object.keys(record).length !== SELECTOR_KEYS.length + 1) {
    return { ok: false, code: "SELECTOR_CONFIG_UNKNOWN_FIELD" };
  }
  return { ok: true, value: record as SelectorConfig };
}
