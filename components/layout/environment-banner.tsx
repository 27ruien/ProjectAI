import { FlaskConical } from "lucide-react";
import { APP_RUNTIME } from "@/config/app-runtime";

export function EnvironmentBadge() {
  if (!APP_RUNTIME.isStaging) return null;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-warning/30 bg-warning-soft/60 px-2 py-1 text-[10px] font-semibold tracking-[0.1em] text-warning"
      data-testid="staging-badge"
      title={`环境：${APP_RUNTIME.environment} · 版本：${APP_RUNTIME.version} · Commit：${APP_RUNTIME.commitSha} · 构建：${APP_RUNTIME.buildTime}`}
    >
      <FlaskConical aria-hidden="true" className="size-3" />
      STAGING
    </span>
  );
}

export function EnvironmentBanner() {
  return null;
}
