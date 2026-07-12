"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  type ColumnDef,
  type VisibilityState,
  type PaginationState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  AlertCircle,
  ArrowDownUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  FolderKanban,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { projects } from "@/data/mock";
import {
  asRecords,
  dateLabel,
  numberValue,
  statusClasses,
  statusLabel,
  textValue,
} from "./mock-view";

interface ProjectRow {
  id: string;
  name: string;
  client: string;
  manager: string;
  status: string;
  stage: string;
  health: string;
  targetDate: string;
  updatedAt: string;
  actionCount: number;
  reviewCount: number;
  riskCount: number;
}

type DataState = "ready" | "loading" | "error";

function compactCount(value: number, tone: "neutral" | "warning" | "danger") {
  const classes = {
    neutral: "bg-muted text-muted-foreground",
    warning: "bg-warning/10 text-warning",
    danger: "bg-destructive/10 text-destructive",
  };
  return <span className={`inline-flex min-w-6 justify-center rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums ${classes[tone]}`}>{value}</span>;
}

export function ProjectsPage() {
  const router = useRouter();
  const allProjects = useMemo<ProjectRow[]>(
    () =>
      asRecords(projects).map((project, index) => ({
        id: textValue(project, "id", `p${index + 1}`),
        name: textValue(project, ["name", "projectName"], `项目 ${index + 1}`),
        client: textValue(project, ["client", "clientName"], "品牌客户"),
        manager: textValue(project, ["manager", "projectManager", "owner"], ["林可", "周霖", "陈舟", "吴桐"][index % 4]),
        status: textValue(project, "status", index === 7 ? "completed" : "active"),
        stage: textValue(project, ["stage", "currentStage"], ["需求确认", "方案设计", "交付实施", "联调测试"][index % 4]),
        health: textValue(project, ["health", "healthStatus"], index % 4 === 1 ? "attention" : index % 4 === 3 ? "atRisk" : "healthy"),
        targetDate: textValue(project, ["targetLaunchDate", "launchDate"], "2026-09-30"),
        updatedAt: textValue(project, "updatedAt", "2026-07-12"),
        actionCount: numberValue(project, ["openActionCount", "actionCount", "incompleteActions"], [8, 12, 6, 3, 9, 4, 11, 0][index] ?? 0),
        reviewCount: numberValue(project, ["pendingReviewCount", "reviewCount"], [3, 1, 2, 0, 4, 1, 2, 0][index] ?? 0),
        riskCount: numberValue(project, ["riskCount", "openRiskCount"], [2, 1, 3, 0, 2, 1, 2, 0][index] ?? 0),
      })),
    [],
  );
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [health, setHealth] = useState("all");
  const [manager, setManager] = useState("all");
  const [client, setClient] = useState("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "updatedAt", desc: true }]);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 5 });
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [dataState, setDataState] = useState<DataState>("ready");

  const managers = useMemo(() => [...new Set(allProjects.map((item) => item.manager))], [allProjects]);
  const clients = useMemo(() => [...new Set(allProjects.map((item) => item.client))], [allProjects]);
  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    return allProjects.filter((project) => {
      const matchesKeyword = !keyword || `${project.name} ${project.client} ${project.manager}`.toLocaleLowerCase("zh-CN").includes(keyword);
      return (
        matchesKeyword &&
        (status === "all" || project.status === status) &&
        (health === "all" || project.health === health) &&
        (manager === "all" || project.manager === manager) &&
        (client === "all" || project.client === client)
      );
    });
  }, [allProjects, client, health, manager, search, status]);

  const columns = useMemo<ColumnDef<ProjectRow>[]>(
    () => [
      {
        accessorKey: "name",
        header: "项目名称",
        size: 250,
        cell: ({ row }) => (
          <div className="min-w-0 py-0.5">
            <p className="truncate font-medium text-foreground group-hover:text-primary">{row.original.name}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{row.original.client}</p>
          </div>
        ),
      },
      { accessorKey: "manager", header: "项目经理" },
      {
        accessorKey: "status",
        header: "状态",
        cell: ({ getValue }) => {
          const value = getValue<string>();
          return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses(value)}`}>{statusLabel(value)}</span>;
        },
      },
      { accessorKey: "stage", header: "当前阶段" },
      {
        accessorKey: "health",
        header: "健康度",
        cell: ({ getValue }) => {
          const value = getValue<string>();
          return <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses(value)}`}>{statusLabel(value)}</span>;
        },
      },
      { accessorKey: "targetDate", header: "目标上线", cell: ({ getValue }) => <span className="tabular-nums">{dateLabel(getValue())}</span> },
      { accessorKey: "updatedAt", header: "最近更新", cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{dateLabel(getValue())}</span> },
      { accessorKey: "actionCount", header: "未完成 Action", cell: ({ getValue }) => compactCount(getValue<number>(), "neutral") },
      { accessorKey: "reviewCount", header: "待审核", cell: ({ getValue }) => compactCount(getValue<number>(), "warning") },
      { accessorKey: "riskCount", header: "风险", cell: ({ getValue }) => compactCount(getValue<number>(), getValue<number>() > 1 ? "danger" : "warning") },
    ],
    [],
  );

  // TanStack Table returns a stable stateful instance by design.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, pagination, columnVisibility },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const activeFilterCount = [status, health, manager, client].filter((item) => item !== "all").length + (search ? 1 : 0);
  const resetFilters = () => {
    setSearch("");
    setStatus("all");
    setHealth("all");
    setManager("all");
    setClient("all");
    setPagination((current) => ({ ...current, pageIndex: 0 }));
  };

  return (
    <main className="min-h-full bg-background px-5 py-6 lg:px-8 lg:py-7">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-sm text-muted-foreground">项目交付空间</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">项目</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">集中查看项目进度、健康度与待处理事项。</p>
        </div>
        <Link href="/projects/new" className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
          <Plus className="size-4" />创建项目
        </Link>
      </header>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="border-b border-border p-4">
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative min-w-[230px] flex-1 lg:max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <span className="sr-only">搜索项目</span>
              <input value={search} onChange={(event) => { setSearch(event.target.value); setPagination((current) => ({ ...current, pageIndex: 0 })); }} placeholder="搜索项目、客户或项目经理" className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-9 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15" />
              {search && <button type="button" onClick={() => setSearch("")} aria-label="清空搜索" className="absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" /></button>}
            </label>
            <FilterSelect label="项目状态" value={status} onChange={setStatus} options={[{ value: "all", label: "全部状态" }, { value: "active", label: "进行中" }, { value: "planning", label: "规划中" }, { value: "paused", label: "已暂停" }, { value: "completed", label: "已完成" }]} />
            <FilterSelect label="项目健康度" value={health} onChange={setHealth} options={[{ value: "all", label: "全部健康度" }, { value: "healthy", label: "正常" }, { value: "attention", label: "需关注" }, { value: "atRisk", label: "有风险" }, { value: "critical", label: "严重风险" }]} />
            <FilterSelect label="项目经理" value={manager} onChange={setManager} options={[{ value: "all", label: "全部项目经理" }, ...managers.map((item) => ({ value: item, label: item }))]} />
            <FilterSelect label="客户" value={client} onChange={setClient} options={[{ value: "all", label: "全部客户" }, ...clients.map((item) => ({ value: item, label: item }))]} />
            <details className="relative">
              <summary className="flex h-9 cursor-pointer list-none items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                <Columns3 className="size-4 text-muted-foreground" />列显示<ChevronDown className="size-3.5" />
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-52 rounded-xl border border-border bg-card p-2 shadow-lg">
                <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">选择可见列</p>
                {table.getAllLeafColumns().map((column) => (
                  <label key={column.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-foreground hover:bg-muted">
                    <input type="checkbox" checked={column.getIsVisible()} onChange={column.getToggleVisibilityHandler()} className="accent-primary" />
                    {typeof column.columnDef.header === "string" ? column.columnDef.header : column.id}
                  </label>
                ))}
              </div>
            </details>
            <div className="ml-auto flex items-center rounded-lg bg-muted p-0.5" aria-label="数据状态演示">
              {(["ready", "loading", "error"] as DataState[]).map((state) => (
                <button key={state} type="button" onClick={() => setDataState(state)} className={`rounded-md px-2 py-1 text-[10px] transition-colors ${dataState === state ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{{ ready: "正常", loading: "加载", error: "错误" }[state]}</button>
              ))}
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <SlidersHorizontal className="size-3.5" />已启用 {activeFilterCount} 个条件
              <button type="button" onClick={resetFilters} className="font-medium text-primary hover:underline">清除全部</button>
            </div>
          )}
        </div>

        {dataState === "loading" ? (
          <div className="grid min-h-[390px] place-items-center text-center"><div><LoaderCircle className="mx-auto size-7 animate-spin text-primary" /><p className="mt-3 text-sm font-medium text-foreground">正在加载项目</p><p className="mt-1 text-xs text-muted-foreground">同步最新状态与风险数据</p></div></div>
        ) : dataState === "error" ? (
          <div className="grid min-h-[390px] place-items-center text-center"><div><AlertCircle className="mx-auto size-7 text-destructive" /><p className="mt-3 text-sm font-medium text-foreground">项目数据加载失败</p><p className="mt-1 text-xs text-muted-foreground">演示环境暂时无法响应，请重试。</p><button type="button" onClick={() => setDataState("ready")} className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted"><RefreshCw className="size-3.5" />重新加载</button></div></div>
        ) : filtered.length === 0 ? (
          <div className="grid min-h-[390px] place-items-center px-6 text-center"><div><span className="mx-auto grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground"><FolderKanban className="size-5" /></span><p className="mt-3 text-sm font-medium text-foreground">没有找到匹配的项目</p><p className="mt-1 text-xs text-muted-foreground">尝试更换关键词或清除筛选条件。</p><button type="button" onClick={resetFilters} className="mt-3 text-xs font-medium text-primary hover:underline">清除筛选</button></div></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1160px] border-collapse text-left text-sm">
              <thead className="bg-muted/40">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th key={header.id} style={{ width: header.getSize() }} className="whitespace-nowrap border-b border-border px-4 py-2.5 text-[11px] font-medium text-muted-foreground">
                        {header.isPlaceholder ? null : header.column.getCanSort() ? (
                          <button type="button" onClick={header.column.getToggleSortingHandler()} className="inline-flex items-center gap-1.5 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                            {flexRender(header.column.columnDef.header, header.getContext())}<ArrowDownUp className={`size-3 ${header.column.getIsSorted() ? "text-primary" : "text-muted-foreground/60"}`} />
                          </button>
                        ) : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="divide-y divide-border">
                {table.getRowModel().rows.map((row) => (
                  <tr key={row.id} tabIndex={0} onClick={() => router.push(`/projects/${row.original.id}/overview`)} onKeyDown={(event) => { if (event.key === "Enter") router.push(`/projects/${row.original.id}/overview`); }} className="group cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                    {row.getVisibleCells().map((cell) => <td key={cell.id} className="whitespace-nowrap px-4 py-3 text-sm text-foreground">{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {dataState === "ready" && filtered.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
            <p className="text-xs text-muted-foreground">共 {filtered.length} 个项目 · 第 {table.getState().pagination.pageIndex + 1} / {Math.max(1, table.getPageCount())} 页</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground">每页 <select value={table.getState().pagination.pageSize} onChange={(event) => table.setPageSize(Number(event.target.value))} className="ml-1 h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground outline-none focus:border-primary"><option value="5">5</option><option value="10">10</option><option value="20">20</option></select></label>
              <button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="上一页" className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="size-4" /></button>
              <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="下一页" className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"><ChevronRight className="size-4" /></button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <label className="relative">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 appearance-none rounded-lg border border-input bg-background pl-3 pr-8 text-sm text-foreground outline-none transition-colors hover:bg-muted focus:border-primary focus:ring-2 focus:ring-primary/15">
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
    </label>
  );
}

export default ProjectsPage;
