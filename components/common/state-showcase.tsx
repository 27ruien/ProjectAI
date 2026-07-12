"use client";

import { useState } from "react";
import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import { Button } from "./button";
import { cn } from "@/lib/utils";

export type DemoState = "content" | "loading" | "empty" | "error";

export function StateShowcase({ value, onChange, compact = false, state, title, description, onRetry }: { value?: DemoState; onChange?: (state: DemoState) => void; compact?: boolean; state?: Exclude<DemoState, "content">; title?: string; description?: string; onRetry?: () => void }) {
  const [internal, setInternal] = useState<DemoState>(value ?? "content");
  if (state === "loading") return <LoadingState />;
  if (state === "empty") return <EmptyState title={title} description={description} />;
  if (state === "error") return <ErrorState onRetry={onRetry} />;
  const current = value ?? internal;
  const update = (state: DemoState) => {
    setInternal(state);
    onChange?.(state);
  };
  return (
    <div className={cn("inline-flex rounded-lg border bg-card p-1", compact && "scale-95 origin-right")} aria-label="页面状态演示">
      {(["content", "loading", "empty", "error"] as DemoState[]).map((state) => (
        <button
          key={state}
          onClick={() => update(state)}
          className={cn("rounded-md px-2 py-1 text-[11px] transition-colors", current === state ? "bg-foreground text-white" : "text-muted-foreground hover:bg-muted")}
        >
          {{ content: "数据", loading: "加载", empty: "空", error: "错误" }[state]}
        </button>
      ))}
    </div>
  );
}

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return <div className="space-y-3 py-4" role="status" aria-label="正在加载">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-12 rounded-lg" />)}</div>;
}

export function EmptyState({ title = "暂无内容", description = "调整筛选条件或创建一条新记录。", action }: { title?: string; description?: string; action?: React.ReactNode }) {
  return <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center"><span className="mb-4 grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground"><Inbox className="size-5" /></span><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>{action ? <div className="mt-4">{action}</div> : null}</div>;
}

export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center"><span className="mb-4 grid size-11 place-items-center rounded-xl bg-destructive-soft text-destructive"><AlertTriangle className="size-5" /></span><h3 className="text-sm font-semibold">数据加载失败</h3><p className="mt-1 text-sm text-muted-foreground">Mock 服务返回异常，请重试。</p>{onRetry ? <Button className="mt-4" size="sm" variant="outline" onClick={onRetry}><RotateCw className="size-3.5" />重新加载</Button> : null}</div>;
}
