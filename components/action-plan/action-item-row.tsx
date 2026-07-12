"use client";

import { AlertTriangle, CalendarDays, Check, ExternalLink, Link2, MoreHorizontal } from "lucide-react";

export const ACTION_REFERENCE_TIME = new Date("2026-07-12T12:00:00+08:00").getTime();

export interface ActionItemView {
  id: string;
  actionId: string;
  title: string;
  description?: string;
  projectId: string;
  source: string;
  owner: string;
  dueDate: string;
  status: string;
  priority: string;
  requirementIds: string[];
  meetingIds: string[];
  riskIds: string[];
  blockerIds: string[];
  updatedAt: string;
}

interface ActionItemRowProps {
  item: ActionItemView;
  projectName: string;
  selected: boolean;
  onSelectedChange: (selected: boolean) => void;
  onStatusChange: (status: string) => void;
  onOpenSource?: () => void;
}

export const actionStatusConfig: Record<string, { label: string; style: string }> = {
  todo: { label: "待处理", style: "bg-slate-500/10 text-slate-700" },
  inProgress: { label: "进行中", style: "bg-sky-500/10 text-sky-700" },
  blocked: { label: "已阻塞", style: "bg-rose-500/10 text-rose-700" },
  completed: { label: "已完成", style: "bg-emerald-500/10 text-emerald-700" },
  cancelled: { label: "已取消", style: "bg-muted text-muted-foreground" },
  overdue: { label: "已逾期", style: "bg-amber-500/10 text-amber-800" },
};

export const priorityConfig: Record<string, { label: string; style: string; dot: string }> = {
  P0: { label: "P0", style: "text-rose-700", dot: "bg-rose-500" },
  P1: { label: "P1", style: "text-amber-700", dot: "bg-amber-500" },
  P2: { label: "P2", style: "text-sky-700", dot: "bg-sky-500" },
  P3: { label: "P3", style: "text-muted-foreground", dot: "bg-slate-400" },
};

export function ActionItemRow({ item, projectName, selected, onSelectedChange, onStatusChange, onOpenSource }: ActionItemRowProps) {
  const overdue = new Date(item.dueDate).getTime() < ACTION_REFERENCE_TIME && !["completed", "cancelled"].includes(item.status);
  const priority = priorityConfig[item.priority] ?? priorityConfig.P2;

  return (
    <tr className={`group border-b border-border transition hover:bg-muted/25 ${selected ? "bg-primary/[0.035]" : ""}`}>
      <td className="w-10 px-3 py-3 align-top">
        <input aria-label={`选择 ${item.actionId}`} type="checkbox" checked={selected} onChange={(event) => onSelectedChange(event.target.checked)} className="size-3.5 accent-[var(--primary)]" />
      </td>
      <td className="min-w-72 px-2 py-3 align-top">
        <div className="flex items-start gap-2">
          <button type="button" onClick={() => onStatusChange(item.status === "completed" ? "todo" : "completed")} className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border ${item.status === "completed" ? "border-emerald-600 bg-emerald-600 text-white" : "border-muted-foreground/40 text-transparent hover:border-emerald-500 hover:text-emerald-500"}`}>
            <Check className="size-2.5" />
          </button>
          <div className="min-w-0">
            <p className={`text-xs font-medium leading-5 ${item.status === "completed" ? "text-muted-foreground line-through" : "text-foreground"}`}>{item.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[9px] text-muted-foreground">
              <span className="font-mono">{item.actionId}</span>
              {item.requirementIds.length ? <span className="flex items-center gap-1"><Link2 className="size-2.5" />{item.requirementIds.length} 需求</span> : null}
              {item.blockerIds.length ? <span className="flex items-center gap-1 text-rose-700"><AlertTriangle className="size-2.5" />{item.blockerIds.length} 阻塞项</span> : null}
            </div>
          </div>
        </div>
      </td>
      <td className="whitespace-nowrap px-2 py-3 align-top text-[11px] text-muted-foreground">{projectName}</td>
      <td className="whitespace-nowrap px-2 py-3 align-top">
        <div className="flex items-center gap-2 text-[11px] text-foreground"><span className="flex size-6 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">{item.owner.slice(0, 1)}</span>{item.owner}</div>
      </td>
      <td className="whitespace-nowrap px-2 py-3 align-top">
        <div className={`flex items-center gap-1 text-[10px] ${overdue ? "font-medium text-rose-700" : "text-muted-foreground"}`}><CalendarDays className="size-3" />{formatDate(item.dueDate)}</div>
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 align-top">
        <select aria-label={`${item.actionId} 状态`} value={item.status} onChange={(event) => onStatusChange(event.target.value)} className={`h-7 rounded-full border-0 px-2 text-[10px] font-medium outline-none ${actionStatusConfig[item.status]?.style ?? "bg-muted text-muted-foreground"}`}>
          {Object.entries(actionStatusConfig).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}
        </select>
      </td>
      <td className="whitespace-nowrap px-2 py-3 align-top"><span className={`inline-flex items-center gap-1.5 text-[10px] font-medium ${priority.style}`}><span className={`size-1.5 rounded-full ${priority.dot}`} />{priority.label}</span></td>
      <td className="whitespace-nowrap px-2 py-3 align-top">
        <button type="button" onClick={onOpenSource} className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-primary"><ExternalLink className="size-3" />{sourceLabel(item.source)}</button>
      </td>
      <td className="w-9 px-2 py-2.5 align-top"><button type="button" onClick={onOpenSource} aria-label="更多操作" className="rounded-md p-1 text-muted-foreground opacity-0 hover:bg-muted group-hover:opacity-100"><MoreHorizontal className="size-3.5" /></button></td>
    </tr>
  );
}

export function sourceLabel(source: string) {
  const labels: Record<string, string> = { meeting: "会议", ai: "AI 提取", manual: "手动", requirement: "需求", risk: "风险", scope: "Scope" };
  return labels[source] ?? source;
}

export function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}
