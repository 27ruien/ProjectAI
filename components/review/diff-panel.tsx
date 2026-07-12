"use client";

import { ArrowRight, Minus, Pencil, Plus } from "lucide-react";

export interface DiffItem {
  id: string;
  type: "added" | "removed" | "modified" | "unchanged";
  label?: string;
  before?: string;
  after?: string;
}

interface DiffPanelProps {
  items?: DiffItem[];
  before?: string;
  after?: string;
  className?: string;
}

function buildLineDiff(before = "", after = ""): DiffItem[] {
  const beforeLines = before.split("\n").filter(Boolean);
  const afterLines = after.split("\n").filter(Boolean);
  const max = Math.max(beforeLines.length, afterLines.length);
  return Array.from({ length: max }, (_, index) => {
    const oldLine = beforeLines[index];
    const newLine = afterLines[index];
    if (oldLine === newLine) return { id: `line-${index}`, type: "unchanged", before: oldLine, after: newLine };
    if (!oldLine) return { id: `line-${index}`, type: "added", after: newLine };
    if (!newLine) return { id: `line-${index}`, type: "removed", before: oldLine };
    return { id: `line-${index}`, type: "modified", before: oldLine, after: newLine };
  });
}

const tone = {
  added: {
    label: "新增",
    icon: Plus,
    badge: "bg-emerald-500/10 text-emerald-700",
    panel: "border-emerald-500/25 bg-emerald-500/[0.06]",
  },
  removed: {
    label: "删除",
    icon: Minus,
    badge: "bg-rose-500/10 text-rose-700",
    panel: "border-rose-500/25 bg-rose-500/[0.06]",
  },
  modified: {
    label: "修改",
    icon: Pencil,
    badge: "bg-amber-500/10 text-amber-700",
    panel: "border-amber-500/25 bg-amber-500/[0.06]",
  },
  unchanged: {
    label: "未变更",
    icon: ArrowRight,
    badge: "bg-muted text-muted-foreground",
    panel: "border-border bg-card",
  },
} as const;

export function DiffPanel({ items, before, after, className = "" }: DiffPanelProps) {
  const changes = items ?? buildLineDiff(before, after);

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
        <span>AI 原始结果</span>
        <span />
        <span>当前审核版本</span>
      </div>
      {changes.map((item) => {
        const styles = tone[item.type];
        const Icon = styles.icon;
        return (
          <div key={item.id} className="rounded-lg border border-border bg-muted/15 p-2.5">
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="truncate text-[11px] font-medium text-foreground">{item.label ?? `内容段落 ${item.id.replace(/\D/g, "") || ""}`}</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium ${styles.badge}`}>
                <Icon className="size-2.5" /> {styles.label}
              </span>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-stretch">
              <div className={`min-h-16 rounded-md border p-2.5 text-xs leading-5 ${item.type === "removed" || item.type === "modified" ? "border-rose-500/20 bg-rose-500/[0.05]" : "border-border bg-card"}`}>
                {item.before ? <p className={item.type === "removed" ? "text-rose-800 line-through decoration-rose-400" : "text-foreground/75"}>{item.before}</p> : <p className="text-muted-foreground/50">—</p>}
              </div>
              <div className="flex items-center justify-center text-muted-foreground"><ArrowRight className="size-3.5" /></div>
              <div className={`min-h-16 rounded-md border p-2.5 text-xs leading-5 ${styles.panel}`}>
                {item.after ? <p className={item.type === "added" ? "text-emerald-800" : item.type === "modified" ? "text-amber-900" : "text-foreground/75"}>{item.after}</p> : <p className="text-muted-foreground/50">—</p>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

