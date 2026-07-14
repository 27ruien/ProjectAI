"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  type ColumnDef,
  type PaginationState,
  type RowSelectionState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDownUp,
  Check,
  CheckSquare2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileQuestion,
  Link2,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { ProjectContextHeader } from "@/components/project/ProjectContextHeader";
import type { AuthorizedProjectSummary, ProjectMockPayload } from "@/lib/auth/ui-types";
import {
  asRecords,
  numberValue,
  statusClasses,
  statusLabel,
  stringList,
  textValue,
} from "@/components/project/mock-view";
import {
  RequirementDrawer,
  type RequirementHistoryView,
  type RequirementView,
} from "./RequirementDrawer";

interface RequirementsPageProps {
  project: AuthorizedProjectSummary;
  data: ProjectMockPayload;
}

const requirementTypeLabels: Record<string, string> = {
  functional: "功能需求",
  nonFunctional: "非功能需求",
  businessRule: "业务规则",
  technicalConstraint: "技术约束",
  compliance: "合规需求",
  content: "内容需求",
  design: "设计需求",
  integration: "集成需求",
};

function multilineValue(
  record: Record<string, unknown>,
  keys: string | string[],
  fallback: string,
): string {
  for (const key of Array.isArray(keys) ? keys : [keys]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value;
    if (Array.isArray(value)) {
      const lines = value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
      if (lines.length) return lines.join("\n");
    }
  }
  return fallback;
}

function normalizeHistory(source: unknown): RequirementHistoryView[] {
  return asRecords(source).map((history, index) => ({
    id: textValue(history, "id", `history-${index + 1}`),
    title: textValue(history, ["title", "changeType"], "需求变更记录"),
    user: textValue(history, ["changedBy", "createdBy", "user"], "未提供"),
    time: textValue(history, ["createdAt", "updatedAt", "time"], ""),
    detail: textValue(history, ["changeSummary", "detail", "description"], "未提供变更说明。"),
  }));
}

function normalizeRequirements(source: unknown): RequirementView[] {
  const rows = asRecords(source);
  return rows.map((requirement, index) => {
    const citationIds = stringList(requirement, ["citationIds", "citations"]);
    const rawConfidence = numberValue(requirement, ["confidence", "aiConfidence"], 0);
    return {
      id: textValue(requirement, "id", `requirement-${index + 1}`),
      code: textValue(requirement, ["code", "requirementId", "requirementCode", "number"], "未编号"),
      title: textValue(requirement, ["title", "name"], "未命名需求"),
      description: textValue(requirement, "description", "暂无需求描述。"),
      type: textValue(requirement, ["type", "requirementType"], "functional"),
      source: textValue(requirement, ["source", "sourceName"], "未提供来源"),
      aiUnderstanding: textValue(requirement, "aiUnderstanding", "暂无 AI 理解。"),
      originalQuote: textValue(requirement, ["originalQuote", "sourceQuote"], "暂无原文引用。"),
      acceptanceCriteria: multilineValue(requirement, "acceptanceCriteria", "暂无验收标准。"),
      exceptionStates: multilineValue(requirement, ["exceptionStates", "exceptionStatus"], "暂无异常状态说明。"),
      nonFunctional: multilineValue(requirement, ["nonFunctional", "nonFunctionalRequirements"], "暂无非功能要求。"),
      relatedPages: stringList(requirement, ["relatedPages", "pageIds", "pages"]),
      relatedTasks: stringList(requirement, ["relatedTasks", "relatedTaskIds", "taskIds", "tasks"]),
      relatedScope: textValue(requirement, ["relatedScope", "scopeVersion", "relatedScopeId"], "未关联"),
      inOriginalScope: Boolean(requirement.inOriginalScope ?? requirement.isInOriginalScope ?? false),
      priority: textValue(requirement, "priority", "P2"),
      assignee: textValue(requirement, ["assignee", "owner"], "未分配"),
      status: textValue(requirement, "status", "draft"),
      acceptanceStatus: textValue(requirement, "acceptanceStatus", "notStarted"),
      updatedAt: textValue(requirement, "updatedAt", ""),
      citationCount: numberValue(requirement, ["citationCount", "citationsCount"], citationIds.length),
      citationIds,
      confidence: rawConfidence > 0 && rawConfidence <= 1 ? Math.round(rawConfidence * 100) : rawConfidence,
      flags: stringList(requirement, ["flags", "issues"]),
      history: normalizeHistory(requirement.history),
    };
  });
}

export function RequirementsPage({ project, data }: RequirementsPageProps) {
  const id = project.id;
  const canEdit = project.permissions.canEditProject;
  const initialRows = useMemo(() => normalizeRequirements(data.requirements), [data.requirements]);
  const [overrides, setOverrides] = useState<Record<string, RequirementView>>({});
  const rows = useMemo(() => initialRows.map((row) => overrides[row.id] ?? row), [initialRows, overrides]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 8 });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedRequirement, setSelectedRequirement] = useState<RequirementView | null>(null);
  const [feedback, setFeedback] = useState("");

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return rows.filter((row) => {
      const searchable = `${row.code} ${row.title} ${row.source} ${row.assignee}`.toLocaleLowerCase("zh-CN");
      return (!keyword || searchable.includes(keyword)) && (typeFilter === "all" || row.type === typeFilter) && (statusFilter === "all" || row.status === statusFilter) && (priorityFilter === "all" || row.priority === priorityFilter) && (scopeFilter === "all" || (scopeFilter === "inside" ? row.inOriginalScope : !row.inOriginalScope));
    });
  }, [priorityFilter, rows, scopeFilter, search, statusFilter, typeFilter]);

  const openDrawer = (requirement: RequirementView) => {
    setSelectedRequirement(requirement);
    setDrawerOpen(true);
  };

  const columns = useMemo<ColumnDef<RequirementView>[]>(() => [
    {
      id: "select",
      enableSorting: false,
      header: ({ table }) => canEdit ? <input type="checkbox" aria-label="选择当前页全部需求" checked={table.getIsAllPageRowsSelected()} ref={(node) => { if (node) node.indeterminate = table.getIsSomePageRowsSelected(); }} onChange={table.getToggleAllPageRowsSelectedHandler()} className="size-3.5 accent-primary" /> : null,
      cell: ({ row }) => canEdit ? <input type="checkbox" aria-label={`选择 ${row.original.code}`} checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} onClick={(event) => event.stopPropagation()} className="size-3.5 accent-primary" /> : null,
      size: 42,
    },
    { accessorKey: "code", header: "需求编号", cell: ({ getValue }) => <span className="font-mono text-xs font-semibold text-primary">{getValue<string>()}</span> },
    { accessorKey: "title", header: "需求标题", size: 290, cell: ({ row }) => <div className="max-w-[280px]"><p className="truncate font-medium text-foreground group-hover:text-primary">{row.original.title}</p><p className="mt-1 truncate text-[11px] text-muted-foreground">{row.original.source}</p></div> },
    { accessorKey: "type", header: "需求类型", cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{requirementTypeLabels[getValue<string>()] ?? getValue<string>()}</span> },
    { accessorKey: "priority", header: "优先级", cell: ({ getValue }) => <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusClasses(getValue<string>())}`}>{getValue<string>()}</span> },
    { accessorKey: "status", header: "状态", cell: ({ getValue }) => { const status = getValue<string>(); return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses(status)}`}>{statusLabel(status)}</span>; } },
    { accessorKey: "inOriginalScope", header: "Scope 范围", cell: ({ getValue }) => <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${getValue<boolean>() ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{getValue<boolean>() ? "原 Scope 内" : "Scope 外新增"}</span> },
    { accessorKey: "assignee", header: "负责人" },
    { accessorKey: "acceptanceStatus", header: "验收状态", cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{{ passed: "已通过", pending: "待验收", notStarted: "未开始" }[getValue<string>()] ?? getValue<string>()}</span> },
    { accessorKey: "updatedAt", header: "最近更新", cell: ({ getValue }) => <span className="text-xs tabular-nums text-muted-foreground">{getValue<string>().slice(0, 10) || "—"}</span> },
    { accessorKey: "citationCount", header: "引用", cell: ({ getValue }) => <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Link2 className="size-3" />{getValue<number>()}</span> },
  ], [canEdit]);

  // TanStack Table returns a stable stateful instance by design.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns,
    getRowId: (row) => row.id,
    state: { sorting, pagination, rowSelection },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const selectedCount = Object.values(rowSelection).filter(Boolean).length;
  const saveRequirement = (requirement: RequirementView) => {
    setOverrides((current) => ({ ...current, [requirement.id]: requirement }));
    setSelectedRequirement(requirement);
    setFeedback(`${requirement.code} 的修改仅保存为浏览器演示状态`);
  };
  const batchStatus = (status: string) => {
    const ids = new Set(Object.keys(rowSelection).filter((key) => rowSelection[key]));
    setOverrides((current) => {
      const next = { ...current };
      rows.filter((row) => ids.has(row.id)).forEach((row) => { next[row.id] = { ...row, status, updatedAt: new Date().toISOString() }; });
      return next;
    });
    setFeedback(`浏览器演示：已将 ${ids.size} 条需求标记为${statusLabel(status)}`);
    setRowSelection({});
  };
  const createRequirement = () => {
    const next: RequirementView = { id: `new-${Date.now()}`, code: `REQ-DEMO-${String(rows.length + 1).padStart(3, "0")}`, title: "", description: "", type: "functional", source: "手动创建（浏览器演示）", aiUnderstanding: "", originalQuote: "", acceptanceCriteria: "", exceptionStates: "", nonFunctional: "", relatedPages: [], relatedTasks: [], relatedScope: "未关联", inOriginalScope: false, priority: "P2", assignee: "未分配", status: "draft", acceptanceStatus: "notStarted", updatedAt: new Date().toISOString(), citationCount: 0, citationIds: [], confidence: 0, flags: [], history: [] };
    setSelectedRequirement(next);
    setDrawerOpen(true);
  };
  const exportCsv = () => {
    const header = ["需求编号", "需求标题", "类型", "优先级", "状态", "负责人", "Scope 范围"];
    const body = filtered.map((row) => [row.code, row.title, requirementTypeLabels[row.type] ?? row.type, row.priority, statusLabel(row.status), row.assignee, row.inOriginalScope ? "原 Scope 内" : "Scope 外新增"]);
    const content = [header, ...body].map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeff${content}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `requirements-${id}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setFeedback(`已导出 ${filtered.length} 条需求`);
  };
  const activeFilters = [typeFilter, statusFilter, priorityFilter, scopeFilter].filter((item) => item !== "all").length + (search ? 1 : 0);

  return (
    <div className="min-h-full bg-background">
      <ProjectContextHeader project={project} activeTab="requirements" />
      <main className="px-5 py-5 lg:px-8">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-foreground">需求中心</h2><span className="rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">{rows.filter((row) => row.status === "pendingReview").length} 条待审核</span></div><p className="mt-1 text-xs text-muted-foreground">结构化管理需求、Scope 边界、验收标准与来源证据。</p></div><div className="flex flex-wrap gap-2">{canEdit ? <Link href={`/workflows/requirement-extraction?project=${id}`} className="inline-flex h-9 items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 text-sm font-medium text-primary hover:bg-primary/10"><Sparkles className="size-4" />AI 提取需求</Link> : null}<button type="button" onClick={exportCsv} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium text-foreground hover:bg-muted"><Download className="size-4" />导出</button>{canEdit ? <button type="button" onClick={createRequirement} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="size-4" />演示新建</button> : null}</div></div>

        {feedback && <div className="mb-3 flex items-center justify-between rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-xs text-success"><span className="flex items-center gap-1.5"><Check className="size-3.5" />{feedback}</span><button type="button" onClick={() => setFeedback("")} aria-label="关闭提示"><X className="size-3.5" /></button></div>}
        {canEdit ? <div className="mb-3 rounded-lg border border-info/20 bg-info-soft px-3 py-2 text-xs text-info">编辑、新建与批量状态变更仅用于浏览器交互演示，不会写入服务端正式数据。</div> : null}

        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border p-4"><div className="flex flex-wrap items-center gap-2"><label className="relative min-w-[240px] flex-1 lg:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><span className="sr-only">搜索需求</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPagination((current) => ({ ...current, pageIndex: 0 })); }} placeholder="搜索编号、标题、来源或负责人" className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-8 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" />{search && <button type="button" onClick={() => setSearch("")} className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"><X className="size-3" /></button>}</label><RequirementFilter label="类型" value={typeFilter} onChange={setTypeFilter} options={[{ value: "all", label: "全部类型" }, ...Object.entries(requirementTypeLabels).map(([value, label]) => ({ value, label }))]} /><RequirementFilter label="状态" value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "全部状态" }, { value: "draft", label: "草稿" }, { value: "pendingReview", label: "待审核" }, { value: "confirmed", label: "已确认" }, { value: "rejected", label: "已驳回" }, { value: "deprecated", label: "已失效" }]} /><RequirementFilter label="优先级" value={priorityFilter} onChange={setPriorityFilter} options={[{ value: "all", label: "全部优先级" }, ...["P0", "P1", "P2", "P3"].map((value) => ({ value, label: value }))]} /><RequirementFilter label="Scope" value={scopeFilter} onChange={setScopeFilter} options={[{ value: "all", label: "全部 Scope 范围" }, { value: "inside", label: "原 Scope 内" }, { value: "outside", label: "Scope 外新增" }]} />{activeFilters > 0 && <button type="button" onClick={() => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); setPriorityFilter("all"); setScopeFilter("all"); }} className="inline-flex h-9 items-center gap-1 text-xs font-medium text-primary hover:underline"><X className="size-3" />清除 {activeFilters} 项</button>}</div></div>

          {canEdit && selectedCount > 0 && <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2.5"><span className="inline-flex items-center gap-1.5 text-xs font-medium text-primary"><CheckSquare2 className="size-3.5" />已选择 {selectedCount} 条</span><span className="mx-1 h-4 w-px bg-border" /><button type="button" onClick={() => batchStatus("confirmed")} className="rounded-md px-2 py-1 text-xs text-foreground hover:bg-card">标记已确认</button><button type="button" onClick={() => batchStatus("pendingReview")} className="rounded-md px-2 py-1 text-xs text-foreground hover:bg-card">提交审核</button><button type="button" onClick={() => batchStatus("deprecated")} className="rounded-md px-2 py-1 text-xs text-foreground hover:bg-card">标记已失效</button><button type="button" onClick={() => setRowSelection({})} className="ml-auto text-xs text-muted-foreground hover:text-foreground">取消选择</button></div>}

          {filtered.length ? <div className="overflow-x-auto"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="bg-muted/35"><tr>{table.getHeaderGroups()[0]?.headers.map((header) => <th key={header.id} style={{ width: header.getSize() }} className="whitespace-nowrap border-b border-border px-3 py-2.5 text-[11px] font-medium text-muted-foreground">{header.isPlaceholder ? null : header.column.getCanSort() ? <button type="button" onClick={header.column.getToggleSortingHandler()} className="inline-flex items-center gap-1 rounded hover:text-foreground">{flexRender(header.column.columnDef.header, header.getContext())}<ArrowDownUp className={`size-3 ${header.column.getIsSorted() ? "text-primary" : "opacity-50"}`} /></button> : flexRender(header.column.columnDef.header, header.getContext())}</th>)}</tr></thead><tbody className="divide-y divide-border">{table.getRowModel().rows.map((row) => <tr key={row.id} tabIndex={0} onClick={() => openDrawer(row.original)} onKeyDown={(event) => { if (event.key === "Enter") openDrawer(row.original); }} className={`group cursor-pointer transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${row.getIsSelected() ? "bg-primary/5" : ""}`}>{row.getVisibleCells().map((cell) => <td key={cell.id} className="whitespace-nowrap px-3 py-3 text-sm text-foreground">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}</tr>)}</tbody></table></div> : <div className="grid min-h-[420px] place-items-center px-6 text-center"><div><span className="mx-auto grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground"><FileQuestion className="size-5" /></span><p className="mt-3 text-sm font-medium text-foreground">{rows.length ? "暂无匹配需求" : "暂无需求数据"}</p><p className="mt-1 text-xs text-muted-foreground">{rows.length ? "请调整搜索或筛选条件。" : "父级尚未提供当前项目可访问的需求。"}</p>{rows.length ? <button type="button" onClick={() => { setSearch(""); setTypeFilter("all"); setStatusFilter("all"); setPriorityFilter("all"); setScopeFilter("all"); }} className="mt-3 text-xs font-medium text-primary hover:underline">清除筛选</button> : null}</div></div>}

          {filtered.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3"><p className="text-xs text-muted-foreground">共 {filtered.length} 条需求 · 当前显示 {table.getRowModel().rows.length} 条</p><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">第 {pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())} 页</span><button type="button" aria-label="上一页" disabled={!table.getCanPreviousPage()} onClick={() => table.previousPage()} className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-35"><ChevronLeft className="size-4" /></button><button type="button" aria-label="下一页" disabled={!table.getCanNextPage()} onClick={() => table.nextPage()} className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted disabled:opacity-35"><ChevronRight className="size-4" /></button></div></div>}
        </section>
      </main>

      <RequirementDrawer key={`${selectedRequirement?.id ?? "none"}-${drawerOpen ? "open" : "closed"}`} open={drawerOpen} requirement={selectedRequirement} citations={data.citations} readOnly={!canEdit} onOpenChange={setDrawerOpen} onSave={saveRequirement} onSubmitReview={(requirement) => setFeedback(`浏览器演示：${requirement.code} 已标记为待审核`)} />
    </div>
  );
}

function RequirementFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return <label className="relative"><span className="sr-only">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 appearance-none rounded-lg border border-input bg-background pl-3 pr-8 text-sm text-foreground outline-none hover:bg-muted focus:border-primary focus:ring-2 focus:ring-primary/15">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /></label>;
}

export default RequirementsPage;
