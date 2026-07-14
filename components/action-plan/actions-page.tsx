"use client";

import { useEffect, useMemo, useState } from "react";
import type { AuthorizedProjectSummary, ProjectMockPayload } from "@/lib/auth/ui-types";
import {
  setLocalStorageSnapshot,
  useLocalStorageSnapshot,
} from "@/lib/browser-snapshot";
import { storageKey } from "@/lib/storage-key";
import {
  AlertTriangle,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Columns3,
  Filter,
  ListTodo,
  Plus,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  ActionItemRow,
  ACTION_REFERENCE_TIME,
  actionStatusConfig,
  formatDate,
  priorityConfig,
  sourceLabel,
  type ActionItemView,
} from "./action-item-row";

type ViewMode = "table" | "timeline";

interface ActionsPageProps {
  project: AuthorizedProjectSummary;
  data: ProjectMockPayload;
}

function parseActionStatuses(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
}

function persistActionStatuses(items: ActionItemView[]) {
  return setLocalStorageSnapshot(
    storageKey("action-statuses"),
    JSON.stringify(Object.fromEntries(items.map((item) => [item.id, item.status]))),
  );
}

export function ActionsPage({ project, data }: ActionsPageProps) {
  const sourceActions = data.actions as unknown as ActionItemView[];
  const canEdit = project.permissions.canEditProject;
  const storedStatusesRaw = useLocalStorageSnapshot(storageKey("action-statuses"));
  const storedStatuses = useMemo(
    () => parseActionStatuses(storedStatusesRaw),
    [storedStatusesRaw],
  );
  const [view, setView] = useState<ViewMode>("table");
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);

  const projectName = () => project.name;
  const scopedItems = useMemo(
    () =>
      sourceActions.map((item) => {
        const status = storedStatuses[item.id];
        return status ? { ...item, status } : item;
      }),
    [sourceActions, storedStatuses],
  );
  const owners = Array.from(new Set(scopedItems.map((item) => item.owner)));
  const filtered = useMemo(() => {
    return scopedItems.filter((item) => {
      const overdue = new Date(item.dueDate).getTime() < ACTION_REFERENCE_TIME && !["completed", "cancelled"].includes(item.status);
      return (
        `${item.actionId} ${item.title} ${item.owner}`.toLowerCase().includes(search.toLowerCase()) &&
        (ownerFilter === "all" || item.owner === ownerFilter) &&
        (statusFilter === "all" || item.status === statusFilter) &&
        (priorityFilter === "all" || item.priority === priorityFilter) &&
        (!overdueOnly || overdue)
      );
    });
  }, [overdueOnly, ownerFilter, priorityFilter, scopedItems, search, statusFilter]);

  const updateStatus = (id: string, status: string) => {
    const next = scopedItems.map((item) =>
      item.id === id ? { ...item, status, updatedAt: new Date().toISOString() } : item,
    );
    setFeedback(
      persistActionStatuses(next)
        ? `Action 状态已更新为「${actionStatusConfig[status]?.label ?? status}」`
        : "浏览器未能保存 Action 状态",
    );
  };

  const bulkUpdate = (status: string) => {
    const next = scopedItems.map((item) =>
      selectedIds.includes(item.id) ? { ...item, status } : item,
    );
    setFeedback(
      persistActionStatuses(next)
        ? `已更新 ${selectedIds.length} 条 Action`
        : "浏览器未能保存 Action 状态",
    );
    setSelectedIds([]);
  };

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const overdueCount = scopedItems.filter((item) => new Date(item.dueDate).getTime() < ACTION_REFERENCE_TIME && !["completed", "cancelled"].includes(item.status)).length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><ListTodo className="size-3.5" /> 可执行交付计划</div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Action Plan</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">统一跟踪来自会议、需求、Scope 与风险的下一步行动。</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-9 items-center gap-1 rounded-lg border border-border bg-card p-1">
            <ViewButton active={view === "table"} onClick={() => setView("table")} icon={Columns3}>表格</ViewButton>
            <ViewButton active={view === "timeline"} onClick={() => setView("timeline")} icon={CalendarRange}>Timeline</ViewButton>
          </div>
          {canEdit ? <button type="button" onClick={() => setFeedback("已打开新建 Action 表单（演示）")} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground"><Plus className="size-4" /> 新建 Action</button> : null}
        </div>
      </div>

      <section className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 xl:grid-cols-4">
        <Summary label="全部 Action" value={scopedItems.length} detail={`${scopedItems.filter((item) => item.status === "inProgress").length} 项进行中`} icon={ListTodo} />
        <Summary label="本周到期" value={scopedItems.filter(isDueThisWeek).length} detail="需要关注交付" icon={CalendarRange} />
        <Summary label="已阻塞" value={scopedItems.filter((item) => item.status === "blocked").length} detail="关联风险待处理" icon={AlertTriangle} tone="text-rose-700" />
        <Summary label="已逾期" value={overdueCount} detail="建议今日跟进" icon={CircleDot} tone="text-amber-700" />
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-52 flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 Action、ID 或负责人" className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary" />
            </div>
            <SmallSelect label="负责人" value={ownerFilter} onChange={setOwnerFilter}><option value="all">全部负责人</option>{owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}</SmallSelect>
            <SmallSelect label="状态" value={statusFilter} onChange={setStatusFilter}><option value="all">全部状态</option>{Object.entries(actionStatusConfig).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}</SmallSelect>
            <SmallSelect label="优先级" value={priorityFilter} onChange={setPriorityFilter}><option value="all">全部优先级</option>{Object.entries(priorityConfig).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}</SmallSelect>
            <label className={`flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-medium ${overdueOnly ? "border-amber-500/30 bg-amber-500/10 text-amber-800" : "border-border text-muted-foreground"}`}><input type="checkbox" checked={overdueOnly} onChange={(event) => setOverdueOnly(event.target.checked)} className="sr-only" /><AlertTriangle className="size-3" /> 仅逾期</label>
          </div>
          {(search || ownerFilter !== "all" || statusFilter !== "all" || priorityFilter !== "all" || overdueOnly) ? (
            <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground"><SlidersHorizontal className="size-3" />找到 {filtered.length} 条记录<button type="button" onClick={() => { setSearch(""); setOwnerFilter("all"); setStatusFilter("all"); setPriorityFilter("all"); setOverdueOnly(false); }} className="text-primary hover:underline">清除筛选</button></div>
          ) : null}
        </div>

        {view === "table" ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead className="bg-muted/35 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                <tr><th className="w-10 px-3 py-2.5">{canEdit ? <input aria-label="选择全部" type="checkbox" checked={filtered.length > 0 && filtered.every((item) => selectedIds.includes(item.id))} onChange={(event) => setSelectedIds(event.target.checked ? filtered.map((item) => item.id) : [])} className="size-3.5 accent-[var(--primary)]" /> : null}</th><th className="px-2 py-2.5">Action 内容</th><th className="px-2 py-2.5">项目</th><th className="px-2 py-2.5">负责人</th><th className="px-2 py-2.5">截止日期</th><th className="px-2 py-2.5">状态</th><th className="px-2 py-2.5">优先级</th><th className="px-2 py-2.5">来源</th><th /></tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <ActionItemRow key={item.id} item={item} projectName={projectName()} readOnly={!canEdit} selected={selectedIds.includes(item.id)} onSelectedChange={(checked) => setSelectedIds((current) => checked ? [...current, item.id] : current.filter((id) => id !== item.id))} onStatusChange={(status) => updateStatus(item.id, status)} onOpenSource={() => setFeedback(`来源：${sourceLabel(item.source)} · ${item.actionId}`)} />
                ))}
              </tbody>
            </table>
            {!filtered.length ? <div className="p-12 text-center text-xs text-muted-foreground">当前筛选下没有 Action Items。</div> : null}
          </div>
        ) : (
          <TimelineView items={filtered} projectName={projectName} readOnly={!canEdit} onStatusChange={updateStatus} />
        )}
      </section>

      {canEdit && selectedIds.length ? (
        <div className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-border bg-foreground px-4 py-3 text-background shadow-xl">
          <span className="text-xs font-medium">已选 {selectedIds.length} 项</span><span className="h-4 w-px bg-background/20" />
          <button type="button" onClick={() => bulkUpdate("inProgress")} className="text-xs text-background/80 hover:text-background">标记进行中</button>
          <button type="button" onClick={() => bulkUpdate("completed")} className="inline-flex items-center gap-1 text-xs text-emerald-300"><Check className="size-3" /> 标记完成</button>
          <button type="button" onClick={() => setSelectedIds([])} className="ml-1 text-background/60 hover:text-background"><X className="size-3.5" /></button>
        </div>
      ) : null}

      {feedback ? <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-xs text-foreground shadow-xl"><CheckCircle2 className="size-4 text-emerald-600" />{feedback}</div> : null}
    </div>
  );
}

function TimelineView({ items, projectName, readOnly, onStatusChange }: { items: ActionItemView[]; projectName: (id: string) => string; readOnly: boolean; onStatusChange: (id: string, status: string) => void }) {
  const dates = items.map((item) => new Date(item.dueDate).getTime()).filter(Number.isFinite);
  const min = Math.min(...dates, ACTION_REFERENCE_TIME);
  const max = Math.max(...dates, min + 86_400_000);
  return (
    <div className="min-w-[760px] overflow-x-auto p-4">
      <div className="grid grid-cols-[250px_1fr] border-b border-border pb-2 text-[9px] uppercase tracking-wide text-muted-foreground"><span>Action</span><div className="grid grid-cols-4 text-center"><span>本周</span><span>下周</span><span>第 3 周</span><span>第 4 周</span></div></div>
      <div className="divide-y divide-border">
        {items.map((item) => {
          const position = Math.max(2, Math.min(88, ((new Date(item.dueDate).getTime() - min) / (max - min)) * 88));
          const statusStyle = item.status === "completed" ? "bg-emerald-500" : item.status === "blocked" ? "bg-rose-500" : "bg-primary";
          return (
            <div key={item.id} className="grid min-h-14 grid-cols-[250px_1fr] items-center">
              <div className="pr-4"><p className="truncate text-xs font-medium text-foreground">{item.title}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{projectName(item.projectId)} · {item.owner}</p></div>
              <div className="relative h-7 rounded bg-[repeating-linear-gradient(to_right,transparent,transparent_calc(25%-1px),var(--border)_25%)]">
                {readOnly ? <span className={`absolute top-1/2 flex h-5 -translate-y-1/2 items-center rounded-full px-2 text-[9px] text-white shadow-sm ${statusStyle}`} style={{ left: `${position}%`, transform: "translate(-50%, -50%)" }}>{formatDate(item.dueDate)}</span> : <button type="button" onClick={() => onStatusChange(item.id, item.status === "completed" ? "todo" : "completed")} className={`absolute top-1/2 flex h-5 -translate-y-1/2 items-center rounded-full px-2 text-[9px] text-white shadow-sm ${statusStyle}`} style={{ left: `${position}%`, transform: "translate(-50%, -50%)" }}>{formatDate(item.dueDate)}</button>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SmallSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <label className="relative"><span className="sr-only">{label}</span><Filter className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /><select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 appearance-none rounded-lg border border-border bg-background pl-7 pr-7 text-[10px] text-foreground outline-none"><>{children}</></select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /></label>;
}

function ViewButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Columns3; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[10px] font-medium ${active ? "bg-muted text-foreground" : "text-muted-foreground"}`}><Icon className="size-3" />{children}</button>; }

function Summary({ label, value, detail, icon: Icon, tone = "text-foreground" }: { label: string; value: number; detail: string; icon: typeof ListTodo; tone?: string }) { return <div className="flex items-center gap-3 border-b border-r border-border p-4 last:border-r-0 sm:border-b-0"><span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span><div><p className="text-[10px] text-muted-foreground">{label}</p><p className={`mt-0.5 text-lg font-semibold ${tone}`}>{value}<span className="ml-2 text-[9px] font-normal text-muted-foreground">{detail}</span></p></div></div>; }

function isDueThisWeek(item: ActionItemView) { const due = new Date(item.dueDate).getTime(); return due >= ACTION_REFERENCE_TIME && due <= ACTION_REFERENCE_TIME + 7 * 86_400_000; }
