"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Library, LoaderCircle, MoreHorizontal, RefreshCw, Search, Upload } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { ProjectDocumentDto, ProjectDocumentVersionDto } from "@/types/documents";
import { useToast } from "@/components/common/toast";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { retryProjectDocumentEmbedding } from "@/lib/documents/client";

type Category = "charter" | "hr" | "project_management" | "security" | "finance" | "template" | "other";
type Lifecycle = "draft" | "published" | "expired" | "archived";
type Audience = "organization" | "department" | "admin";
type CompanyDocument = ProjectDocumentDto & { category: Category; lifecycleStatus: Lifecycle; audience: Audience; departmentId: string | null; publishedAt: string | null; expiresAt: string | null };
type Department = { id: string; name: string };

const categoryLabels: Record<Category, string> = { charter: "公司章程", hr: "人事制度", project_management: "项目管理规范", security: "信息安全", finance: "财务与采购", template: "标准模板", other: "其他" };
const lifecycleLabels: Record<Lifecycle, string> = { draft: "草稿", published: "已发布", expired: "已失效", archived: "已归档" };
const lifecycleClasses: Record<Lifecycle, string> = { draft: "bg-muted text-muted-foreground", published: "border-success/20 bg-success-soft text-success", expired: "border-warning/25 bg-warning-soft text-warning", archived: "bg-muted text-muted-foreground" };
const audienceLabels: Record<Audience, string> = { organization: "全公司", department: "指定部门", admin: "仅管理员" };

function vectorStatus(version: ProjectDocumentVersionDto | null) {
  if (!version || version.ingestion.status !== "succeeded") {
    return { label: version?.ingestion.status === "failed" ? "解析失败" : "等待解析", classes: "bg-muted text-muted-foreground" };
  }
  return {
    not_started: { label: "等待向量化", classes: "border-info/20 bg-info-soft text-info" },
    pending: { label: "等待向量化", classes: "border-info/20 bg-info-soft text-info" },
    running: { label: "正在向量化", classes: "border-info/20 bg-info-soft text-info" },
    succeeded: { label: "可用于 AI", classes: "border-success/20 bg-success-soft text-success" },
    failed: { label: "向量化失败", classes: "border-destructive/20 bg-destructive-soft text-destructive" },
    unknown: { label: "等待管理员复核", classes: "border-warning/25 bg-warning-soft text-warning" },
  }[version.embedding.status];
}

export function CompanyKnowledgePage() {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<CompanyDocument[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | Category>("all");
  const [status, setStatus] = useState<"all" | Lifecycle>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploadVersionNote, setUploadVersionNote] = useState("");
  const [uploadCategory, setUploadCategory] = useState<Category>("project_management");
  const [audience, setAudience] = useState<Audience>("organization");
  const [departmentId, setDepartmentId] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<{ document: CompanyDocument; versions: ProjectDocumentVersionDto[] } | null>(null);
  const [versionTarget, setVersionTarget] = useState<CompanyDocument | null>(null);
  const [versionFile, setVersionFile] = useState<File | null>(null);
  const [versionNote, setVersionNote] = useState("");

  const load = useCallback(async () => { const response = await fetch(withBasePath("/api/company-knowledge"), { credentials: "include", cache: "no-store" }); const body = await response.json() as { documents?: CompanyDocument[]; canManage?: boolean; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "公司资料加载失败"); setDocuments(body.documents ?? []); setCanManage(Boolean(body.canManage)); }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "公司资料加载失败")); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const processing = documents.some((document) => {
      const version = document.currentVersion;
      return version?.ingestion.status === "pending" || version?.ingestion.status === "running" || version?.embedding.status === "pending" || version?.embedding.status === "running";
    });
    if (!processing) return;
    const timer = window.setInterval(() => { void load().catch(() => undefined); }, 2_500);
    return () => window.clearInterval(timer);
  }, [documents, load]);
  useEffect(() => { if (!canManage) return; void fetch(withBasePath("/api/projects/creation-context"), { credentials: "include" }).then(async (response) => response.json() as Promise<{ departments?: Department[] }>).then((body) => setDepartments(body.departments ?? [])).catch(() => undefined); }, [canManage]);
  const filtered = useMemo(() => { const keyword = query.trim().toLocaleLowerCase("zh-CN"); return documents.filter((item) => (category === "all" || item.category === category) && (status === "all" || item.lifecycleStatus === status) && (!keyword || item.displayName.toLocaleLowerCase("zh-CN").includes(keyword))); }, [category, documents, query, status]);

  const upload = async (event: FormEvent) => { event.preventDefault(); if (!file) return; setBusy(true); setError(null); try { const form = new FormData(); form.set("file", file); form.set("displayName", file.name.replace(/\.[^.]+$/, "")); form.set("category", uploadCategory); form.set("audience", audience); if (uploadVersionNote.trim()) form.set("versionNote", uploadVersionNote.trim()); if (audience === "department") form.set("departmentId", departmentId); const response = await fetch(withBasePath("/api/company-knowledge"), { method: "POST", credentials: "include", headers: { "idempotency-key": crypto.randomUUID() }, body: form }); const body = await response.json() as { error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "上传失败"); setUploadOpen(false); setFile(null); setUploadVersionNote(""); await load(); toast("常规模板已上传为草稿"); } catch (caught) { setError(caught instanceof Error ? caught.message : "上传失败"); } finally { setBusy(false); } };
  const changeLifecycle = async (document: CompanyDocument, lifecycleStatus: Lifecycle) => { setError(null); const response = await fetch(withBasePath(`/api/company-knowledge/${document.id}`), { method: "PATCH", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ lifecycleStatus }) }); if (!response.ok) { const body = await response.json() as { error?: { message?: string } }; setError(body.error?.message ?? "状态更新失败"); return; } await response.json(); await load(); toast(`“${document.displayName}”已更新为${lifecycleLabels[lifecycleStatus]}`); };
  const newVersion = async (event: FormEvent) => { event.preventDefault(); if (!versionTarget || !versionFile) return; const form = new FormData(); form.set("file", versionFile); if (versionNote.trim()) form.set("versionNote", versionNote.trim()); setBusy(true); setError(null); try { const response = await fetch(withBasePath(`/api/company-knowledge/${versionTarget.id}/versions`), { method: "POST", credentials: "include", headers: { "idempotency-key": crypto.randomUUID() }, body: form }); if (!response.ok) { const body = await response.json() as { error?: { message?: string } }; throw new Error(body.error?.message ?? "新版本上传失败"); } setVersionTarget(null); setVersionFile(null); setVersionNote(""); await load(); toast("新版本已上传为草稿"); } catch (caught) { setError(caught instanceof Error ? caught.message : "新版本上传失败"); } finally { setBusy(false); } };
  const openHistory = async (document: CompanyDocument) => { const response = await fetch(withBasePath(`/api/company-knowledge/${document.id}/versions`), { credentials: "include", cache: "no-store" }); const body = await response.json() as { versions?: ProjectDocumentVersionDto[]; error?: { message?: string } }; if (!response.ok) { setError(body.error?.message ?? "版本历史加载失败"); return; } setHistory({ document, versions: body.versions ?? [] }); };
  const retryEmbedding = async (document: CompanyDocument) => {
    const version = document.currentVersion;
    if (!version || version.embedding.status !== "failed") return;
    setBusy(true);
    setError(null);
    try {
      await retryProjectDocumentEmbedding(document.projectId, document.id, version.id);
      await load();
      toast(`“${document.displayName}”已重新进入向量化队列`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "向量化重试失败");
    } finally {
      setBusy(false);
    }
  };

  return <main className="min-h-full px-5 py-7 sm:px-6 lg:px-8" data-testid="company-knowledge-page">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h2 className="text-xl font-semibold tracking-tight">公司资料</h2><p className="mt-1.5 text-sm text-muted-foreground">维护公司制度、项目管理 SOP 与标准模板；AI 助手按问题自动使用已发布且有权访问的当前版本。</p></div>{canManage ? <Button onClick={() => setUploadOpen(true)}><Upload />上传公司资料</Button> : null}</header>
    {error ? <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert> : null}
    <div className="mb-4 flex flex-wrap gap-2"><label className="relative min-w-56 flex-1 sm:max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索公司资料" className="pl-9" /></label><Select value={category} onValueChange={(value) => setCategory(value as typeof category)}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部类别</SelectItem>{Object.entries(categoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Select value={status} onValueChange={(value) => setStatus(value as typeof status)}><SelectTrigger className="w-32"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(lifecycleLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
    <section className="overflow-hidden rounded-lg border bg-card">{filtered.length ? <div className="overflow-x-auto"><Table className="min-w-[980px]"><TableHeader><TableRow><TableHead>模板名称</TableHead><TableHead>分类</TableHead><TableHead>当前版本</TableHead><TableHead>处理状态</TableHead><TableHead>可见范围</TableHead><TableHead>状态</TableHead><TableHead>更新时间</TableHead><TableHead className="w-12"><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{filtered.map((document) => { const processing = vectorStatus(document.currentVersion); return <TableRow key={document.id}><TableCell><div className="flex items-center gap-2.5"><span className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Library className="size-4" /></span><span className="max-w-60 truncate font-medium">{document.displayName}</span></div></TableCell><TableCell>{categoryLabels[document.category]}</TableCell><TableCell>v{document.currentVersion?.versionNumber ?? "—"}</TableCell><TableCell><Badge variant="outline" className={processing.classes}>{processing.label}</Badge></TableCell><TableCell>{audienceLabels[document.audience]}</TableCell><TableCell><Badge variant="outline" className={lifecycleClasses[document.lifecycleStatus]}>{lifecycleLabels[document.lifecycleStatus]}</Badge></TableCell><TableCell className="whitespace-nowrap text-muted-foreground">{new Date(document.updatedAt).toLocaleString("zh-CN")}</TableCell><TableCell><DocumentActions document={document} canManage={canManage} busy={busy} onHistory={() => void openHistory(document)} onVersion={() => setVersionTarget(document)} onRetry={() => void retryEmbedding(document)} onLifecycle={(next) => void changeLifecycle(document, next)} /></TableCell></TableRow>; })}</TableBody></Table></div> : <div className="grid min-h-72 place-items-center text-center"><div><Library className="mx-auto size-9 text-muted-foreground" /><h2 className="mt-3 text-sm font-medium">暂无可见常规模板</h2><p className="mt-1 text-xs text-muted-foreground">管理员上传并发布后，会话才会按权限检索这些资料。</p>{canManage ? <Button className="mt-4" onClick={() => setUploadOpen(true)}><Upload />上传模板</Button> : null}</div></div>}</section>

    <KnowledgeUploadDialog open={uploadOpen} onOpenChange={setUploadOpen} busy={busy} file={file} onFile={setFile} category={uploadCategory} onCategory={setUploadCategory} audience={audience} onAudience={setAudience} departmentId={departmentId} onDepartment={setDepartmentId} departments={departments} note={uploadVersionNote} onNote={setUploadVersionNote} onSubmit={(event) => void upload(event)} />
    <VersionUploadDialog target={versionTarget} busy={busy} file={versionFile} onFile={setVersionFile} note={versionNote} onNote={setVersionNote} onClose={() => { setVersionTarget(null); setVersionFile(null); setVersionNote(""); }} onSubmit={(event) => void newVersion(event)} />
    <Sheet open={Boolean(history)} onOpenChange={(open) => { if (!open) setHistory(null); }}><SheetContent className="w-full sm:max-w-lg"><SheetHeader><SheetTitle>版本历史</SheetTitle><SheetDescription>{history?.document.displayName}</SheetDescription></SheetHeader><div className="space-y-2 overflow-y-auto px-4 pb-6">{history?.versions.map((version) => <div key={version.id} className="flex items-center gap-3 rounded-lg border p-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">v{version.versionNumber}{version.isCurrent ? " · 当前" : ""}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(version.createdAt).toLocaleString("zh-CN")}</p>{version.versionNote ? <p className="mt-1 text-xs">{version.versionNote}</p> : null}</div><Button variant="link" size="sm" asChild><a href={history ? withBasePath(`/api/company-knowledge/${history.document.id}/versions/${version.id}/download`) : undefined}>下载</a></Button></div>)}</div></SheetContent></Sheet>
  </main>;
}

function DocumentActions({ document, canManage, busy, onHistory, onVersion, onRetry, onLifecycle }: { document: CompanyDocument; canManage: boolean; busy: boolean; onHistory: () => void; onVersion: () => void; onRetry: () => void; onLifecycle: (status: Lifecycle) => void }) {
  const version = document.currentVersion;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={`${document.displayName} 操作`} disabled={busy}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{version ? <><DropdownMenuItem asChild><a target="_blank" rel="noreferrer" href={withBasePath(`/api/company-knowledge/${document.id}/versions/${version.id}/download?preview=true`)}>预览</a></DropdownMenuItem><DropdownMenuItem asChild><a href={withBasePath(`/api/company-knowledge/${document.id}/versions/${version.id}/download`)}>下载</a></DropdownMenuItem></> : null}<DropdownMenuItem onSelect={onHistory}>查看版本历史</DropdownMenuItem>{canManage ? <><DropdownMenuItem onSelect={onVersion}>上传新版本</DropdownMenuItem>{version?.embedding.status === "failed" ? <DropdownMenuItem onSelect={onRetry}><RefreshCw />重试向量化</DropdownMenuItem> : null}<DropdownMenuSeparator />{document.lifecycleStatus !== "published" ? <DropdownMenuItem onSelect={() => onLifecycle("published")}>发布</DropdownMenuItem> : <DropdownMenuItem onSelect={() => onLifecycle("expired")}>标记失效</DropdownMenuItem>}<DropdownMenuItem onSelect={() => onLifecycle("archived")}>归档</DropdownMenuItem><DropdownMenuItem disabled>权限设置（由可见范围控制）</DropdownMenuItem></> : null}</DropdownMenuContent></DropdownMenu>;
}

function KnowledgeUploadDialog({ open, onOpenChange, busy, file, onFile, category, onCategory, audience, onAudience, departmentId, onDepartment, departments, note, onNote, onSubmit }: { open: boolean; onOpenChange: (open: boolean) => void; busy: boolean; file: File | null; onFile: (file: File | null) => void; category: Category; onCategory: (value: Category) => void; audience: Audience; onAudience: (value: Audience) => void; departmentId: string; onDepartment: (value: string) => void; departments: Department[]; note: string; onNote: (value: string) => void; onSubmit: (event: FormEvent) => void }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg" data-testid="company-upload-dialog"><DialogHeader><DialogTitle>上传模板</DialogTitle><DialogDescription>新模板先保存为草稿，人工检查后再发布。</DialogDescription></DialogHeader><form onSubmit={onSubmit} className="space-y-4"><label className="grid gap-1.5 text-sm font-medium">文件<Input required type="file" onChange={(event) => onFile(event.target.files?.[0] ?? null)} /></label><label className="grid gap-1.5 text-sm font-medium">分类<Select value={category} onValueChange={(value) => onCategory(value as Category)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(categoryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></label><label className="grid gap-1.5 text-sm font-medium">可见范围<Select value={audience} onValueChange={(value) => onAudience(value as Audience)}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="organization">全公司</SelectItem><SelectItem value="department">指定部门</SelectItem><SelectItem value="admin">仅管理员</SelectItem></SelectContent></Select></label>{audience === "department" ? <label className="grid gap-1.5 text-sm font-medium">部门<Select value={departmentId} onValueChange={onDepartment}><SelectTrigger className="w-full"><SelectValue placeholder="请选择部门" /></SelectTrigger><SelectContent>{departments.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></label> : null}<label className="grid gap-1.5 text-sm font-medium">版本说明（可选）<Textarea value={note} onChange={(event) => onNote(event.target.value)} rows={3} maxLength={500} /></label><label className="grid gap-1.5 text-sm font-medium">发布状态<Input value="草稿（上传后人工发布）" disabled /></label><DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={busy || !file}>{busy ? <LoaderCircle className="animate-spin" /> : null}上传草稿</Button></DialogFooter></form></DialogContent></Dialog>;
}

function VersionUploadDialog({ target, busy, file, onFile, note, onNote, onClose, onSubmit }: { target: CompanyDocument | null; busy: boolean; file: File | null; onFile: (file: File | null) => void; note: string; onNote: (value: string) => void; onClose: () => void; onSubmit: (event: FormEvent) => void }) {
  return <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>上传新版本</DialogTitle><DialogDescription>{target?.displayName} · 新版本默认回到草稿。</DialogDescription></DialogHeader><form onSubmit={onSubmit} className="space-y-4"><label className="grid gap-1.5 text-sm font-medium">文件<Input required type="file" onChange={(event) => onFile(event.target.files?.[0] ?? null)} /></label><label className="grid gap-1.5 text-sm font-medium">版本说明（可选）<Textarea value={note} onChange={(event) => onNote(event.target.value)} rows={3} maxLength={500} /></label><DialogFooter><Button type="button" variant="outline" onClick={onClose}>取消</Button><Button type="submit" disabled={busy || !file}>{busy ? <LoaderCircle className="animate-spin" /> : null}上传新版本</Button></DialogFooter></form></DialogContent></Dialog>;
}
