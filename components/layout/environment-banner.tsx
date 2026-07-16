import { AlertTriangle, FlaskConical } from "lucide-react";
import { APP_RUNTIME } from "@/config/app-runtime";

export function EnvironmentBadge() {
  if (!APP_RUNTIME.isStaging) return null;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-500/35 bg-amber-100 px-2 py-1 text-[10px] font-bold tracking-[0.12em] text-amber-900"
      data-testid="staging-badge"
      title={`环境：${APP_RUNTIME.environment} · 版本：${APP_RUNTIME.version} · Commit：${APP_RUNTIME.commitSha} · 构建：${APP_RUNTIME.buildTime}`}
    >
      <FlaskConical aria-hidden="true" className="size-3" />
      STAGING
    </span>
  );
}

export function EnvironmentBanner() {
  if (!APP_RUNTIME.isStaging) return null;

  return (
    <aside
      className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-amber-950 sm:px-6"
      aria-label="Staging 环境信息"
      data-testid="staging-banner"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] leading-5">
        <strong className="inline-flex items-center gap-1.5 text-xs">
          <AlertTriangle aria-hidden="true" className="size-3.5" />
          STAGING · v0.5 文档处理与知识索引基础
        </strong>
        <span>版本 {APP_RUNTIME.version}</span>
        <span title={APP_RUNTIME.commitSha}>Commit {APP_RUNTIME.shortCommitSha}</span>
        <span>构建时间 {APP_RUNTIME.buildTime}</span>
        <span className="font-semibold">
          项目文件会真实存储并建立词法知识索引；OCR、Embedding、RAG 和 AI 综合回答尚未启用。仅允许上传虚构测试资料，禁止上传真实客户项目资料。
        </span>
      </div>
    </aside>
  );
}
