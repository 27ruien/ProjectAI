"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, MoreHorizontal, Pencil } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { ProjectContextHeader } from "./ProjectContextHeader";
import { dateLabel, statusLabel } from "./mock-view";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Summary = { departmentName: string | null; fileCount: number; requirementCount: number; currentRequirementVersion: number | null; latestActivityAt: string };

async function deleteErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? "删除项目失败，请稍后重试";
  } catch {
    return "删除项目失败，请稍后重试";
  }
}

export function ProjectOverviewPage({ project }: { project: AuthorizedProjectSummary }) {
  const router = useRouter();
  const [summary, setSummary] = useState<Summary | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"delete" | null>(null);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState(project.status);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const controller = new AbortController(); void fetch(withBasePath("/api/projects/focused-summaries"), { credentials: "include", cache: "no-store", signal: controller.signal }).then(async (response) => response.json() as Promise<{ summaries: Array<Summary & { projectId: string }> }>).then((payload) => setSummary(payload.summaries.find((item) => item.projectId === project.id) ?? null)).catch(() => undefined); return () => controller.abort(); }, [project.id]);
  const save = async (event: FormEvent) => { event.preventDefault(); setSaving(true); setError(null); try { const response = await fetch(withBasePath(`/api/projects/${project.id}`), { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, description, status }) }); const body = await response.json() as { error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "保存失败"); setEditing(false); router.refresh(); } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); } finally { setSaving(false); } };
  const runLifecycleAction = async () => { if (!confirmAction) return; setError(null); const response = await fetch(withBasePath(`/api/projects/${project.id}`), { method: "DELETE", credentials: "include" }); if (!response.ok) { setError(await deleteErrorMessage(response)); setConfirmAction(null); return; } setConfirmAction(null); router.replace("/data-spaces/projects"); };
  const actions = <>{project.permissions.canEditProject ? <Button variant="outline" onClick={() => setEditing(true)}><Pencil />编辑项目</Button> : null}{project.permissions.canDeleteProject ? <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="更多项目操作"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={() => setConfirmAction("delete")}>删除项目</DropdownMenuItem></DropdownMenuContent></DropdownMenu> : null}</>;
  return <div className="min-h-full"><ProjectContextHeader project={project} activeTab="overview" actions={actions} /><div className="px-5 py-7 sm:px-6 lg:px-8">
    {error ? <Alert variant="destructive" className="mb-5"><AlertDescription>{error}</AlertDescription></Alert> : null}
    <section aria-labelledby="overview-heading"><div className="mb-4"><h2 id="overview-heading" className="text-base font-semibold">基本信息</h2><p className="mt-1 text-sm text-muted-foreground">关键项目信息和当前资料状态。</p></div><dl className="grid overflow-hidden rounded-lg border bg-card sm:grid-cols-2">
      <Info label="状态" value={statusLabel(project.status)} /><Info label="负责人" value={project.managerDisplayName ?? "待分配"} /><Info label="部门" value={summary?.departmentName ?? "未分配部门"} /><Info label="创建时间" value={dateLabel(project.createdAt)} /><Info label="更新时间" value={dateLabel(project.updatedAt)} /><Info label="最近活动" value={dateLabel(summary?.latestActivityAt ?? project.updatedAt)} /><Info label="成员数量" value={`${project.memberCount}`} /><Info label="项目资料数量" value={`${summary?.fileCount ?? "—"}`} /><Info label="当前 AI 文档版本" value={summary?.currentRequirementVersion ? `v${summary.currentRequirementVersion}` : "尚未生成"} /><Info label="AI 生成文档数量" value={`${summary?.requirementCount ?? "—"}`} /><div className="border-t px-5 py-4 sm:col-span-2"><dt className="text-xs text-muted-foreground">项目描述</dt><dd className="mt-1.5 text-sm leading-6">{project.description || "暂无描述"}</dd></div>
    </dl></section>
  </div>
  <Dialog open={editing} onOpenChange={setEditing}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>编辑项目</DialogTitle><DialogDescription>更新项目名称、描述和状态。</DialogDescription></DialogHeader><form onSubmit={save} className="space-y-4"><label className="grid gap-1.5 text-sm font-medium">项目名称<Input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={200} /></label><label className="grid gap-1.5 text-sm font-medium">项目描述<Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} maxLength={4000} /></label><label className="grid gap-1.5 text-sm font-medium">状态<Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="planning">规划中</SelectItem><SelectItem value="active">进行中</SelectItem><SelectItem value="completed">已完成</SelectItem></SelectContent></Select></label>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => setEditing(false)}>取消</Button><Button type="submit" disabled={saving}>{saving ? <LoaderCircle className="animate-spin" /> : null}保存</Button></DialogFooter></form></DialogContent></Dialog>
  <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除项目？</AlertDialogTitle><AlertDialogDescription>项目、项目资料、历史版本、解析结果、会话和 AI 生成文档都会被永久删除，无法恢复。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => void runLifecycleAction()}>确认删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

function Info({ label, value }: { label: string; value: string }) { return <div className="border-t px-5 py-4 first:border-t-0 sm:[&:nth-child(2)]:border-t-0 sm:odd:border-r"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1.5 text-sm">{value}</dd></div>; }
