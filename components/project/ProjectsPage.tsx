"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderKanban, MoreHorizontal, Plus, Search } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { ViewerContext } from "@/lib/auth/ui-types";
import { dateLabel, statusClasses, statusLabel } from "./mock-view";
import { CreateProjectDialog } from "./CreateProjectPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

type Summary = { projectId: string; departmentName: string | null; fileCount: number; requirementCount: number; currentRequirementVersion: number | null; latestActivityAt: string };
type ProjectSummary = ViewerContext["projects"][number];

async function deleteErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? "删除项目失败，请稍后重试";
  } catch {
    return "删除项目失败，请稍后重试";
  }
}

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
    return viewer.projects.filter((project) => { const summary = summaries.get(project.id); return (!keyword || `${project.name} ${project.description} ${summary?.departmentName ?? ""} ${project.managerDisplayName ?? ""}`.toLocaleLowerCase("zh-CN").includes(keyword)) && (status === "all" || project.status === status); });
  }, [query, status, summaries, viewer.projects]);

  const deleteProject = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch(withBasePath(`/api/projects/${deleteTarget.id}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(await deleteErrorMessage(response));
      }
      setDeleteTarget(null);
      router.refresh();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "删除项目失败");
    } finally {
      setDeleting(false);
    }
  };

  const createTrigger = <Button><Plus />创建项目</Button>;
  return <main className="min-h-full px-5 py-7 sm:px-6 lg:px-8" data-testid="projects-page">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-semibold tracking-tight">项目</h2><p className="mt-1.5 text-sm text-muted-foreground">每个项目是一组独立资料、成员权限与 AI 产物。</p></div>{viewer.canCreateProject ? <CreateProjectDialog managerName={viewer.user.displayName} trigger={createTrigger} /> : null}</header>
    {deleteError ? <Alert variant="destructive" className="mb-4"><AlertDescription>{deleteError}</AlertDescription></Alert> : null}
    <div className="mb-4 flex flex-wrap gap-2"><label className="relative min-w-56 flex-1 sm:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目、部门或负责人" className="pl-9" /></label><Select value={status} onValueChange={setStatus}><SelectTrigger className="w-36"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="planning">规划中</SelectItem><SelectItem value="active">进行中</SelectItem><SelectItem value="completed">已完成</SelectItem></SelectContent></Select></div>
    <section className="overflow-hidden rounded-lg border bg-card">
      {filtered.length ? <div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead className="min-w-44">项目名称</TableHead><TableHead className="min-w-56">描述</TableHead><TableHead>状态</TableHead><TableHead>所属部门</TableHead><TableHead>项目负责人</TableHead><TableHead>更新时间</TableHead><TableHead className="w-12"><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{filtered.map((project) => { const summary = summaries.get(project.id); const projectHref = `/data-spaces/projects/${project.id}`; return <TableRow key={project.id} className="cursor-pointer" tabIndex={0} onClick={() => router.push(projectHref)} onKeyDown={(event) => { if (event.key === "Enter") router.push(projectHref); }}><TableCell className="font-medium">{project.name}</TableCell><TableCell><span className="block max-w-64 truncate text-muted-foreground">{project.description || "暂无描述"}</span></TableCell><TableCell><Badge variant="outline" className={statusClasses(project.status)}>{statusLabel(project.status)}</Badge></TableCell><TableCell className="text-muted-foreground">{summary?.departmentName ?? "未分配"}</TableCell><TableCell className="text-muted-foreground">{project.managerDisplayName ?? "待分配"}</TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{dateLabel(summary?.latestActivityAt ?? project.updatedAt)}</TableCell><TableCell onClick={(event) => event.stopPropagation()}><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`${project.name} 操作`}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => router.push(projectHref)}>打开项目</DropdownMenuItem><DropdownMenuItem onSelect={() => router.push(`${projectHref}/files`)}>查看资料</DropdownMenuItem><DropdownMenuItem onSelect={() => router.push(`/assistant?project=${encodeURIComponent(project.id)}`)}>前往 AI 助手</DropdownMenuItem>{project.permissions.canDeleteProject ? <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(project)}>删除项目</DropdownMenuItem> : null}</DropdownMenuContent></DropdownMenu></TableCell></TableRow>; })}</TableBody></Table></div> : <div className="grid min-h-72 place-items-center px-6 text-center"><div><FolderKanban className="mx-auto size-8 text-muted-foreground" /><h2 className="mt-3 text-sm font-medium">没有匹配的项目</h2><p className="mt-1 text-xs text-muted-foreground">调整筛选条件，或创建第一个项目。</p>{viewer.canCreateProject ? <CreateProjectDialog managerName={viewer.user.displayName} trigger={<Button className="mt-4"><Plus />创建项目</Button>} /> : null}</div></div>}
    </section>
    <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除项目？</AlertDialogTitle><AlertDialogDescription>项目、项目资料、历史版本、解析结果、会话和 AI 生成文档都会被永久删除，无法恢复。确认继续吗？</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={deleting} onClick={(event) => { event.preventDefault(); void deleteProject(); }}>{deleting ? "删除中…" : "确认删除"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </main>;
}
