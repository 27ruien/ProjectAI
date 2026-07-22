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
  return {
    dailyReportEnabled: booleanEnvironment("PM_DAILY_REPORT_ENABLED"),
    wecomSyncEnabled: booleanEnvironment("WECOM_TIMESHEET_SYNC_ENABLED"),
    confidenceThreshold,
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
