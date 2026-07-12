"use client";

import { AlertCircle, CheckCircle2, Clock3, Cpu, FileText, Loader2, RotateCcw, Sparkles } from "lucide-react";
import { WorkflowStepper, type WorkflowStepItem } from "./workflow-stepper";

export type WorkflowRunStatus = "idle" | "running" | "failed" | "completed";

export interface WorkflowLog {
  id: string;
  time: string;
  message: string;
  tone?: "default" | "success" | "warning";
}

interface AIGeneratingStateProps {
  status: WorkflowRunStatus;
  steps: WorkflowStepItem[];
  progress: number;
  logs: WorkflowLog[];
  onRetry?: () => void;
  modelProfile?: string;
  skillName?: string;
}

export function AIGeneratingState({
  status,
  steps,
  progress,
  logs,
  onRetry,
  modelProfile = "requirement-analysis",
  skillName = "requirement-extraction",
}: AIGeneratingStateProps) {
  const activeStep = steps.find((step) => step.status === "running" || step.status === "failed");
  const title =
    status === "completed"
      ? "AI 处理完成，等待人工审核"
      : status === "failed"
        ? "执行遇到可恢复错误"
        : status === "running"
          ? activeStep?.title ?? "正在准备执行"
          : "准备提取需求";

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card" aria-live="polite">
      <div className="border-b border-border bg-muted/25 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`flex size-10 items-center justify-center rounded-lg ${
                status === "failed"
                  ? "bg-destructive/10 text-destructive"
                  : status === "completed"
                    ? "bg-emerald-500/10 text-emerald-700"
                    : "bg-primary/10 text-primary"
              }`}
            >
              {status === "running" ? (
                <Loader2 className="size-5 animate-spin" />
              ) : status === "failed" ? (
                <AlertCircle className="size-5" />
              ) : status === "completed" ? (
                <CheckCircle2 className="size-5" />
              ) : (
                <Sparkles className="size-5" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {status === "failed" ? "已保留当前上下文，重试将从失败步骤继续。" : "AI 输出不会直接写入正式项目数据。"}
              </p>
            </div>
          </div>
          {status === "failed" && onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              <RotateCcw className="size-4" />
              从此步骤重试
            </button>
          ) : null}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border/70">
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{progress}%</span>
        </div>
      </div>

      <div className="grid min-h-[460px] lg:grid-cols-[minmax(260px,0.8fr)_minmax(360px,1.2fr)]">
        <div className="border-b border-border p-5 lg:border-b-0 lg:border-r">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">执行流程</p>
          <WorkflowStepper steps={steps} />
        </div>
        <div className="flex min-h-0 flex-col p-5">
          <div className="grid grid-cols-2 gap-3">
            <InfoChip icon={Cpu} label="Model Profile" value={modelProfile} />
            <InfoChip icon={Sparkles} label="Skill" value={skillName} />
          </div>
          <div className="mt-5 flex min-h-0 flex-1 flex-col rounded-lg border border-border bg-background/60">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <FileText className="size-4 text-muted-foreground" />
                <p className="text-xs font-semibold text-foreground">实时执行日志</p>
              </div>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className={`size-1.5 rounded-full ${status === "running" ? "animate-pulse bg-emerald-500" : "bg-muted-foreground/40"}`} />
                {status === "running" ? "实时更新" : "已暂停"}
              </span>
            </div>
            <div className="max-h-[310px] flex-1 space-y-1 overflow-auto p-3 font-mono text-[11px] leading-5">
              {logs.length ? (
                logs.map((log) => (
                  <div key={log.id} className="grid grid-cols-[62px_1fr] gap-2 rounded px-1 py-1 hover:bg-muted/50">
                    <span className="text-muted-foreground/70">{log.time}</span>
                    <span
                      className={
                        log.tone === "success"
                          ? "text-emerald-700"
                          : log.tone === "warning"
                            ? "text-destructive"
                            : "text-foreground/80"
                      }
                    >
                      {log.message}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex h-full min-h-32 items-center justify-center text-muted-foreground">等待工作流启动…</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function InfoChip({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Clock3;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="size-3" />
        {label}
      </div>
      <p className="mt-1 truncate text-xs font-medium text-foreground">{value}</p>
    </div>
  );
}

