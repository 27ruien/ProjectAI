"use client";

import { useMemo, useState } from "react";
import { Braces, CheckCircle2, FileDiff, PencilLine, Sparkles } from "lucide-react";
import { DiffPanel, type DiffItem } from "./diff-panel";

export interface ReviewPanelTask {
  id: string;
  title: string;
  type: string;
  generatedContent: unknown;
  editableContent: unknown;
  changeSummary?: string;
  confidence: number;
  version?: number;
}

interface ReviewPanelProps {
  task: ReviewPanelTask;
  value: string;
  onChange: (value: string) => void;
  reviewNote: string;
  onReviewNoteChange: (value: string) => void;
  regenerating?: boolean;
  readOnly?: boolean;
}

export function stringifyContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}

function makeDiffItems(original: string, current: string): DiffItem[] {
  const originalLines = original.split("\n").filter((line) => line.trim());
  const currentLines = current.split("\n").filter((line) => line.trim());
  const max = Math.max(originalLines.length, currentLines.length);
  return Array.from({ length: Math.min(max, 7) }, (_, index) => {
    const before = originalLines[index];
    const after = currentLines[index];
    return {
      id: `review-diff-${index}`,
      label: index === 0 ? "核心结论" : `结构化字段 ${index}`,
      type: before === after ? "unchanged" : !before ? "added" : !after ? "removed" : "modified",
      before,
      after,
    };
  });
}

export function ReviewPanel({
  task,
  value,
  onChange,
  reviewNote,
  onReviewNoteChange,
  regenerating = false,
  readOnly = false,
}: ReviewPanelProps) {
  const [tab, setTab] = useState<"edit" | "diff">("edit");
  const original = stringifyContent(task.generatedContent);
  const diffItems = useMemo(() => makeDiffItems(original, value), [original, value]);

  return (
    <section className="flex min-h-0 flex-col bg-card">
      <header className="border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-semibold text-primary">{reviewTypeLabel(task.type)}</span>
              <span className="text-[10px] text-muted-foreground">v{task.version ?? 1}</span>
            </div>
            <h2 className="mt-2 text-base font-semibold text-foreground">{task.title}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {readOnly
                  ? "当前项目为只读权限，可核对 AI 输出与来源证据，但不能修改或审核。"
                  : task.changeSummary ?? "请核对 AI 输出与来源证据，必要时直接修改。"}
              </p>
          </div>
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-right">
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">置信度</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">{Math.round(task.confidence * (task.confidence <= 1 ? 100 : 1))}%</p>
          </div>
        </div>
        <div className="mt-4 flex items-center gap-1 rounded-lg bg-muted/60 p-1">
          <TabButton active={tab === "edit"} onClick={() => setTab("edit")} icon={PencilLine}>编辑结果</TabButton>
          <TabButton active={tab === "diff"} onClick={() => setTab("diff")} icon={FileDiff}>修改对比</TabButton>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-5">
        {regenerating ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
            <span className="relative flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="size-6 animate-pulse" />
              <span className="absolute inset-0 animate-ping rounded-full border border-primary/20" />
            </span>
            <p className="mt-4 text-sm font-medium text-foreground">正在重新生成审核草稿</p>
            <p className="mt-1 text-xs text-muted-foreground">保留原始结果与执行记录，不会覆盖正式数据。</p>
          </div>
        ) : tab === "edit" ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-primary/20 bg-primary/[0.035] p-3">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground"><CheckCircle2 className="size-3.5 text-emerald-600" /> AI 已完成结构校验</div>
              <p className="mt-1 pl-5.5 text-[11px] leading-4 text-muted-foreground">系统标注仅供辅助判断，审核人对最终内容负责。</p>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <label htmlFor="review-content" className="flex items-center gap-1.5 text-xs font-semibold text-foreground"><Braces className="size-3.5" /> 结构化内容</label>
                <span className="text-[10px] text-muted-foreground">
                  {readOnly ? "只读" : "自动保存草稿"}
                </span>
              </div>
              <textarea
                id="review-content"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                readOnly={readOnly}
                spellCheck={false}
                className="min-h-[330px] w-full resize-y rounded-lg border border-border bg-background p-4 font-mono text-xs leading-6 text-foreground outline-none transition read-only:cursor-default read-only:bg-muted/25 focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>
            <div>
              <label htmlFor="review-note" className="mb-2 block text-xs font-semibold text-foreground">审核备注</label>
              <textarea
                id="review-note"
                value={reviewNote}
                onChange={(event) => onReviewNoteChange(event.target.value)}
                readOnly={readOnly}
                placeholder={readOnly ? "当前项目为只读权限" : "记录修改原因、待补充信息或驳回依据…"}
                className="min-h-24 w-full resize-none rounded-lg border border-border bg-background px-3 py-2.5 text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground read-only:cursor-default read-only:bg-muted/25 focus:border-primary"
              />
            </div>
          </div>
        ) : (
          <DiffPanel items={diffItems} />
        )}
      </div>
    </section>
  );
}

function TabButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof PencilLine; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-medium transition ${active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
      <Icon className="size-3.5" /> {children}
    </button>
  );
}

export function reviewTypeLabel(type: string) {
  const labels: Record<string, string> = {
    requirement: "需求提取",
    requirementExtraction: "需求提取",
    scopeChange: "Scope 变更",
    actionPlan: "Action Plan",
    risk: "项目风险",
    meeting: "会议纪要",
    meetingSummary: "会议纪要",
    weeklyReport: "项目周报",
    projectSummary: "项目摘要",
  };
  return labels[type] ?? type;
}
