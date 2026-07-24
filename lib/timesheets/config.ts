import { TimesheetError } from "./errors";

function booleanEnvironment(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new TimesheetError(
    503,
    "TIMESHEET_CONFIGURATION_INVALID",
    "工作日报配置无效",
  );
}

export type TimesheetFeatureConfig = {
  dailyReportEnabled: boolean;
  wecomSyncEnabled: boolean;
  confidenceThreshold: number;
  aiMode: "mock" | "real";
  aiProvider: "fake" | "qwen";
  aiModelProfileId: string;
  syncProvider: "mock_smartsheet" | "wecom_extension";
};

export function getTimesheetFeatureConfig(): TimesheetFeatureConfig {
  const rawThreshold = process.env.PM_DAILY_REPORT_CONFIDENCE_THRESHOLD?.trim();
  const confidenceThreshold = rawThreshold ? Number(rawThreshold) : 0.85;
  if (
    !Number.isFinite(confidenceThreshold) ||
    confidenceThreshold < 0.5 ||
    confidenceThreshold > 1
  ) {
    throw new TimesheetError(
      503,
      "TIMESHEET_CONFIGURATION_INVALID",
      "工作日报配置无效",
    );
  }
  const aiProvider = process.env.AI_PROVIDER?.trim() || "qwen";
  if (aiProvider !== "fake" && aiProvider !== "qwen") {
    throw new TimesheetError(503, "TIMESHEET_CONFIGURATION_INVALID", "工作日报配置无效");
  }
  const configuredUatMode = process.env.UAT_AI_PROVIDER?.trim();
  if (configuredUatMode && configuredUatMode !== "mock" && configuredUatMode !== "real") {
    throw new TimesheetError(503, "TIMESHEET_CONFIGURATION_INVALID", "工作日报配置无效");
  }
  const aiMode: "mock" | "real" =
    configuredUatMode === "mock" || configuredUatMode === "real"
      ? configuredUatMode
      : aiProvider === "fake"
        ? "mock"
        : "real";
  if ((aiMode === "mock") !== (aiProvider === "fake")) {
    throw new TimesheetError(
      503,
      "TIMESHEET_AI_MODE_MISMATCH",
      "人工验收 AI 模式与服务端 Provider 配置不一致",
    );
  }
  const syncProviderValue =
    process.env.WECOM_TIMESHEET_SYNC_PROVIDER?.trim() || "wecom_extension";
  if (syncProviderValue !== "mock_smartsheet" && syncProviderValue !== "wecom_extension") {
    throw new TimesheetError(503, "TIMESHEET_CONFIGURATION_INVALID", "工作日报配置无效");
  }
  if (
    syncProviderValue === "mock_smartsheet" &&
    (process.env.NEXT_PUBLIC_APP_ENV?.trim() !== "test" ||
      process.env.PROJECTAI_UAT_ENVIRONMENT?.trim() !== "local")
  ) {
    throw new TimesheetError(
      503,
      "TIMESHEET_MOCK_PROVIDER_FORBIDDEN",
      "Mock SmartSheet 仅允许用于隔离的本地人工验收",
    );
  }
  return {
    dailyReportEnabled: booleanEnvironment("PM_DAILY_REPORT_ENABLED"),
    wecomSyncEnabled: booleanEnvironment("WECOM_TIMESHEET_SYNC_ENABLED"),
    confidenceThreshold,
    aiMode,
    aiProvider,
    aiModelProfileId:
      process.env.AI_PROJECT_ASSISTANT_PROFILE_ID?.trim() ||
      "qwen-project-assistant-cn-v1",
    syncProvider: syncProviderValue,
  };
}

export function requireDailyReportEnabled(): TimesheetFeatureConfig {
  const config = getTimesheetFeatureConfig();
  if (!config.dailyReportEnabled) {
    throw new TimesheetError(
      404,
      "TIMESHEET_FEATURE_DISABLED",
      "工作日报功能尚未启用",
    );
  }
  return config;
}

export function requireWecomSyncEnabled(): TimesheetFeatureConfig {
  const config = requireDailyReportEnabled();
  if (!config.wecomSyncEnabled) {
    throw new TimesheetError(
      404,
      "WECOM_SYNC_FEATURE_DISABLED",
      "企业微信同步功能尚未启用",
    );
  }
  return config;
}
