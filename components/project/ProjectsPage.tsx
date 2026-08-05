"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FolderKanban, MoreHorizontal, Plus, Search } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { ViewerContext } from "@/lib/auth/ui-types";
import { dateLabel, statusLabel } from "./mock-view";
import { CreateProjectDialog } from "./CreateProjectPage";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Summary = { projectId: string; departmentName: string | null; fileCount: number; requirementCount: number; currentRequirementVersion: number | null; latestActivityAt: string };
type ProjectSummary = ViewerContext["projects"][number];

async function deleteErrorMessage(response: Response): Promise<string> {
  try { const body = await response.json() as { error?: { message?: string } }; return body.error?.message ?? "删除项目失败，请稍后重试"; }
  catch { return "删除项目失败，请稍后重试"; }
}

const statusTone: Record<string, string> = { planning: "border-border bg-muted text-muted-foreground", active: "border-primary/20 bg-primary/10 text-primary", completed: "border-success/20 bg-success-soft text-success" };

export function ProjectsPage({ viewer }: { viewer: ViewerContext }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [summaries, setSummaries] = useState<Map<string, Summary>>(new Map());
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(withBasePath("/api/projects/focused-summaries"), { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ summaries: Summary[] }> : { summaries: [] })
      .then((payload) => setSummaries(new Map(payload.summaries.map((item) => [item.projectId, item])))).catch(() => undefined);
    return () => controller.abort();
  }, []);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return viewer.projects.filter((project) => {
      const summary = summaries.get(project.id);
      return (!keyword || `${project.name} ${project.description} ${summary?.departmentName ?? ""} ${project.managerDisplayName ?? ""}`.toLocaleLowerCase("zh-CN").includes(keyword)) && (status === "all" || project.status === status);
    });
  }, [query, status, summaries, viewer.projects]);

  const deleteProject = async () => {
    if (!deleteTarget) return;
    setDeleting(true); setDeleteError(null);
    try {
      const response = await fetch(withBasePath(`/api/projects/${deleteTarget.id}`), { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error(await deleteErrorMessage(response));
      setDeleteTarget(null); router.refresh();
    } catch (caught) { setDeleteError(caught instanceof Error ? caught.message : "删除项目失败"); }
    finally { setDeleting(false); }
  };

  return <main className="mx-auto min-h-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8" data-testid="projects-page">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-medium text-primary">资料空间</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">项目资料</h1><p className="mt-2 max-w-2xl text-sm text-muted-foreground">每个项目拥有独立的资料、成员权限与 AI 产物。</p></div>
      {viewer.canCreateProject ? <CreateProjectDialog managerName={viewer.user.displayName} trigger={<Button><Plus />创建项目</Button>} /> : null}
    </header>
    {deleteError ? <Alert variant="destructive"><AlertTitle>操作未完成</AlertTitle><AlertDescription>{deleteError}</AlertDescription></Alert> : null}
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
      <label className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索项目、部门或负责人" className="pl-9" value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索项目、部门或负责人" /></label>
      <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full sm:w-40" aria-label="按状态筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="planning">规划中</SelectItem><SelectItem value="active">进行中</SelectItem><SelectItem value="completed">已完成</SelectItem></SelectContent></Select>
    </div>
    {filtered.length ? <Card className="overflow-hidden p-0"><div className="overflow-x-auto"><Table className="min-w-[900px]"><TableHeader className="sticky top-0 bg-muted/70"><TableRow><TableHead>项目名称</TableHead><TableHead>描述</TableHead><TableHead>状态</TableHead><TableHead>所属部门</TableHead><TableHead>负责人</TableHead><TableHead>更新时间</TableHead><TableHead className="w-12"><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{filtered.map((project) => {
      const summary = summaries.get(project.id); const projectHref = `/data-spaces/projects/${project.id}`;
      return <TableRow key={project.id}><TableCell><Button variant="link" asChild className="h-auto px-0 font-medium"><Link href={projectHref}>{project.name}</Link></Button></TableCell><TableCell className="max-w-72 truncate text-muted-foreground">{project.description || "暂无描述"}</TableCell><TableCell><Badge variant="outline" className={statusTone[project.status]}>{statusLabel(project.status)}</Badge></TableCell><TableCell className="text-muted-foreground">{summary?.departmentName ?? "未分配"}</TableCell><TableCell className="text-muted-foreground">{project.managerDisplayName ?? "待分配"}</TableCell><TableCell className="text-muted-foreground">{dateLabel(summary?.latestActivityAt ?? project.updatedAt)}</TableCell><TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`${project.name} 操作`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><Link href={projectHref}>打开项目</Link></DropdownMenuItem><DropdownMenuItem asChild><Link href={`${projectHref}/files`}>查看资料</Link></DropdownMenuItem><DropdownMenuItem asChild><Link href={`/assistant?project=${encodeURIComponent(project.id)}`}>前往 AI 助手</Link></DropdownMenuItem>{project.permissions.canDeleteProject ? <><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(project)}>删除项目</DropdownMenuItem></> : null}</DropdownMenuContent></DropdownMenu></TableCell></TableRow>;
    })}</TableBody></Table></div></Card> : <Card className="flex min-h-56 flex-col items-center justify-center p-8 text-center"><span className="grid size-11 place-items-center rounded-full bg-muted"><FolderKanban className="size-5 text-muted-foreground" /></span><h2 className="mt-4 text-base font-medium">没有匹配的项目</h2><p className="mt-1 text-sm text-muted-foreground">调整搜索或筛选条件后重试。</p></Card>}
    <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除项目？</AlertDialogTitle><AlertDialogDescription>项目、资料、历史版本、解析结果、会话和 AI 生成文档都会被永久删除，无法恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel><AlertDialogAction disabled={deleting} onClick={(event) => { event.preventDefault(); void deleteProject(); }} className="bg-destructive text-white hover:bg-destructive/90">{deleting ? "正在删除…" : "确认删除"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
