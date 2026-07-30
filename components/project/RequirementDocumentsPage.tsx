"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, FileText, History, LoaderCircle, Pencil, Save, Sparkles } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { ProjectContextHeader } from "./ProjectContextHeader";
import { useToast } from "@/components/common/toast";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

type Section = { key: string; title: string; content: string; citationLabels: string[] };
type Citation = { label: string; valid: boolean; sourceScope?: string; displayName?: string; sourceLocator?: Record<string, unknown>; excerpt?: string; reason?: string };
type RequirementDocument = { id: string; versionNumber: number; status: "generating" | "draft" | "published" | "failed"; sections: Section[]; citations: Citation[]; failureCode: string | null; projectSourceCount: number; companySourceCount: number; sourceSnapshotAt: string; updatedAt: string; publishedAt: string | null };

const failureMessages: Record<string, string> = {
  NO_ELIGIBLE_PROJECT_SOURCES: "当前项目没有可用于 AI 的资料，请先上传并等待解析完成。",
  NO_PUBLISHED_PROJECT_STANDARD: "当前没有已发布的公司项目管理规范。",
  REQUIREMENT_SKILL_NOT_CONFIGURED: "需求文档生成能力尚未配置，请联系管理员。",
  REQUIREMENT_MODEL_PROFILE_NOT_CONFIGURED: "需求文档生成能力尚未完成配置，请联系管理员。",
  REQUIREMENT_EXECUTION_CREATE_FAILED: "需求文档生成任务登记失败，请稍后重试。",
  REQUIREMENT_PROVIDER_FAILED: "当前项目资料已完整保留，但 AI 服务账号暂时没有模型访问权限，因此本次未生成需求文档。请联系管理员检查 Staging 的模型凭据和访问权限。",
  REQUIREMENT_OUTPUT_INVALID: "AI 返回的需求文档未通过格式检查，请手动重新生成。",
  REQUIREMENT_CITATION_VALIDATION_FAILED: "AI 返回的来源引用未通过校验，请手动重新生成。",
  REQUIREMENT_SOURCE_CHANGED: "资料在生成期间发生变化，请手动重新生成。",
};

const steps = ["正在读取项目资料", "正在整理项目事实", "正在生成需求文档", "正在校验引用"];
const tagStyle: Record<string, string> = {
  Fact: "border-border bg-muted text-foreground",
  "Company Standard": "border-info/20 bg-info-soft text-info",
  "AI Inference": "border-primary/20 bg-accent text-primary",
  TBD: "border-warning/25 bg-warning-soft text-warning",
};

export function RequirementDocumentsPage({ project }: { project: AuthorizedProjectSummary }) {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<RequirementDocument[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [canPublish, setCanPublish] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<"generate" | "save" | "publish" | "restore" | null>(null);
  const [generationStep, setGenerationStep] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (preferredId?: string) => {
    const response = await fetch(withBasePath(`/api/projects/${project.id}/requirement-documents`), { credentials: "include", cache: "no-store" });
    const body = await response.json() as { documents?: RequirementDocument[]; canEdit?: boolean; canPublish?: boolean; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? "需求文档加载失败");
    const rows = body.documents ?? [];
    setDocuments(rows); setCanEdit(Boolean(body.canEdit)); setCanPublish(Boolean(body.canPublish));
    const next = rows.find((item) => item.id === preferredId) ?? rows[0] ?? null;
    setSelectedId(next?.id ?? null); setSections(next?.sections ?? []); return rows;
  }, [project.id]);
  useEffect(() => { const timer = window.setTimeout(() => { void load().catch((caught) => setError(caught instanceof Error ? caught.message : "需求文档加载失败")); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { if (busy !== "generate" && !documents.some((item) => item.status === "generating")) return; const timer = window.setInterval(() => setGenerationStep((value) => Math.min(value + 1, steps.length - 1)), 1800); return () => window.clearInterval(timer); }, [busy, documents]);
  const selected = useMemo(() => documents.find((item) => item.id === selectedId) ?? null, [documents, selectedId]);
  useEffect(() => { if (!documents.some((item) => item.status === "generating")) return; const timer = window.setInterval(() => { void load(selectedId ?? undefined).catch(() => undefined); }, 2500); return () => window.clearInterval(timer); }, [documents, load, selectedId]);
  const request = async (path: string, init: RequestInit) => { const response = await fetch(withBasePath(path), { credentials: "include", ...init }); const body = await response.json() as { document?: { id?: string }; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "操作失败"); return body.document?.id; };
  const save = async () => { if (!selected) return; setBusy("save"); setError(null); try { await request(`/api/projects/${project.id}/requirement-documents/${selected.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ sections }) }); await load(selected.id); setEditing(false); toast("需求文档草稿已保存"); } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); } finally { setBusy(null); } };
  const publish = async () => { if (!selected) return; setBusy("publish"); setError(null); try { await request(`/api/projects/${project.id}/requirement-documents/${selected.id}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); await load(selected.id); toast("需求文档已发布"); } catch (caught) { setError(caught instanceof Error ? caught.message : "发布失败"); } finally { setBusy(null); } };
  const restore = async (document: RequirementDocument) => { setBusy("restore"); setError(null); try { const id = await request(`/api/projects/${project.id}/requirement-documents/${document.id}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); await load(id); toast(`已从 v${document.versionNumber} 恢复为新草稿`); } catch (caught) { setError(caught instanceof Error ? caught.message : "恢复失败"); } finally { setBusy(null); } };
  const selectVersion = (document: RequirementDocument) => { setSelectedId(document.id); setSections(document.sections); setEditing(false); };
  const generating = busy === "generate" || selected?.status === "generating";

  return <div className="min-h-full" data-testid="requirement-documents-page">
    <ProjectContextHeader project={project} activeTab="artifacts" />
    <div className="px-5 py-7 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-lg font-semibold">AI 生成文档</h2><p className="mt-1 text-sm text-muted-foreground">这里保存会话中生成的项目文档、资料快照和历史版本。</p></div>{canEdit ? <Button asChild><Link href={`/knowledge/sessions?project=${encodeURIComponent(project.id)}`}><Sparkles />前往会话生成</Link></Button> : null}</header>

      {generating ? <section className="mb-6 rounded-lg border bg-card p-5" role="status" data-testid="requirement-generating"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-medium">{steps[generationStep]}</p><p className="mt-1 text-xs text-muted-foreground">任务已登记，可以离开本页后再返回查看。</p></div><span className="text-xs tabular-nums text-primary">{generationStep + 1}/{steps.length}</span></div><Progress value={((generationStep + 1) / steps.length) * 100} className="mt-4 h-1.5" /><div className="mt-5 space-y-3"><Skeleton className="h-5 w-2/5" /><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-5/6" /></div></section> : null}
      {error ? <Alert variant="destructive" className="mb-5"><AlertTitle>操作未完成</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}

      {!selected ? <section className="grid min-h-96 place-items-center rounded-lg border bg-card text-center" data-testid="requirement-empty"><div><FileText className="mx-auto size-9 text-muted-foreground" /><h3 className="mt-3 text-sm font-medium">尚无 AI 生成文档</h3><p className="mt-1 text-xs text-muted-foreground">上传并解析项目资料后，在会话中生成第一份需求文档。</p>{canEdit ? <Button className="mt-4" asChild><Link href={`/knowledge/sessions?project=${encodeURIComponent(project.id)}`}><Sparkles />打开会话</Link></Button> : null}</div></section> : selected.status === "failed" ? <RequirementFailure projectId={project.id} document={selected} /> : <>
        <section className="border-b pb-5" data-testid="requirement-document"><div className="flex flex-wrap items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold">需求文档 v{selected.versionNumber}</h3><Badge variant="outline" className={selected.status === "published" ? "border-success/20 bg-success-soft text-success" : "bg-muted text-muted-foreground"}>{selected.status === "published" ? "已发布" : selected.status === "generating" ? "生成中" : "草稿"}</Badge></div><dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><div><dt className="inline">资料快照：</dt><dd className="inline">{new Date(selected.sourceSnapshotAt).toLocaleString("zh-CN")}</dd></div><div><dt className="inline">项目资料：</dt><dd className="inline">{selected.projectSourceCount} 份</dd></div><div><dt className="inline">公司规范：</dt><dd className="inline">{selected.companySourceCount} 份</dd></div></dl></div><div className="flex flex-wrap gap-2">{canEdit && selected.status !== "generating" ? editing ? <Button variant="outline" onClick={() => void save()} disabled={Boolean(busy)}>{busy === "save" ? <LoaderCircle className="animate-spin" /> : <Save />}保存草稿</Button> : <Button variant="outline" onClick={() => setEditing(true)}><Pencil />编辑</Button> : null}{canPublish && selected.status === "draft" ? <Button onClick={() => void publish()} disabled={Boolean(busy)}>发布</Button> : null}{selected.status !== "generating" ? <DownloadMenu projectId={project.id} documentId={selected.id} /> : null}<VersionHistory documents={documents} selectedId={selectedId} canEdit={canEdit} busy={Boolean(busy)} onSelect={selectVersion} onRestore={(document) => void restore(document)} /></div></div></section>

        <div className="mx-auto max-w-[860px] py-8">
          <div className="space-y-8">{sections.map((section, index) => <article key={section.key}><h3 className="mb-3 text-base font-semibold">{index + 1}. {section.title}</h3>{editing ? <Textarea rows={Math.max(4, Math.min(12, section.content.split("\n").length + 1))} value={section.content} onChange={(event) => setSections((current) => current.map((item) => item.key === section.key ? { ...item, content: event.target.value } : item))} className="leading-7" /> : <TaggedContent content={section.content} />} {section.citationLabels.length ? <div className="mt-3 flex flex-wrap gap-1.5">{section.citationLabels.map((label) => <Badge key={label} variant="outline" className="font-normal text-primary">引用 {label}</Badge>)}</div> : null}</article>)}</div>
          {selected.citations.length ? <section className="mt-10 border-t pt-6"><h3 className="text-sm font-semibold">来源引用</h3><div className="mt-3 space-y-2">{selected.citations.map((citation) => <div key={citation.label} className={`rounded-lg border px-3 py-2.5 ${citation.valid ? "" : "border-warning/30 bg-warning-soft"}`}><div className="flex flex-wrap items-center gap-2 text-xs"><Badge variant="outline">{citation.label}</Badge><span className="font-medium">[{citation.sourceScope === "organization" ? "公司资料" : "项目资料"}] {citation.valid ? citation.displayName : "来源已失效或更新"}</span></div>{citation.valid ? <p className="mt-2 line-clamp-3 text-xs leading-5 text-muted-foreground">{citation.excerpt}</p> : <p className="mt-2 text-xs text-warning">该引用不再作为当前有效证据，请重新生成或复核。</p>}</div>)}</div></section> : null}
        </div>
      </>}
    </div>
  </div>;
}

function TaggedContent({ content }: { content: string }) {
  return <div className="space-y-2 text-sm leading-7">{content.split("\n").map((line, index) => { const match = line.match(/\[(Fact|Company Standard|AI Inference|TBD)\]/u); const tag = match?.[1]; const text = tag ? line.replace(match[0], "").trim() : line; return <div key={`${index}-${line.slice(0, 16)}`} className="flex items-start gap-2">{tag ? <Badge variant="outline" className={`mt-1 shrink-0 text-[10px] ${tagStyle[tag]}`}>{tag}</Badge> : null}<p className="whitespace-pre-wrap">{text || "\u00a0"}</p></div>; })}</div>;
}

function DownloadMenu({ projectId, documentId }: { projectId: string; documentId: string }) {
  const base = `/api/projects/${projectId}/requirement-documents/${documentId}/export`;
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="outline"><Download />下载</Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><a href={withBasePath(`${base}?format=md`)}>下载 Markdown</a></DropdownMenuItem><DropdownMenuItem asChild><a href={withBasePath(`${base}?format=docx`)}>下载 DOCX</a></DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
}

function VersionHistory({ documents, selectedId, canEdit, busy, onSelect, onRestore }: { documents: RequirementDocument[]; selectedId: string | null; canEdit: boolean; busy: boolean; onSelect: (document: RequirementDocument) => void; onRestore: (document: RequirementDocument) => void }) {
  return <Sheet><SheetTrigger asChild><Button variant="ghost"><History />版本历史</Button></SheetTrigger><SheetContent className="w-full sm:max-w-md"><SheetHeader><SheetTitle>版本历史</SheetTitle><SheetDescription>查看历史版本，或恢复为新的可编辑草稿。</SheetDescription></SheetHeader><div className="space-y-2 overflow-y-auto px-4 pb-6">{documents.map((document) => <div key={document.id} className={`rounded-lg border p-3 ${document.id === selectedId ? "border-primary/30 bg-accent/50" : ""}`}><button type="button" onClick={() => onSelect(document)} className="w-full text-left"><p className="text-sm font-medium">v{document.versionNumber} · {{ generating: "生成中", draft: "草稿", published: "已发布", failed: "失败" }[document.status]}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(document.updatedAt).toLocaleString("zh-CN")}</p></button>{canEdit && document.id !== selectedId && ["draft", "published"].includes(document.status) ? <Button variant="link" size="sm" className="mt-2 h-auto px-0" disabled={busy} onClick={() => onRestore(document)}>恢复为新草稿</Button> : null}</div>)}</div></SheetContent></Sheet>;
}

function RequirementFailure({ projectId, document }: { projectId: string; document: RequirementDocument }) {
  const providerFailure = document.failureCode === "REQUIREMENT_PROVIDER_FAILED";
  return <section className="mx-auto max-w-3xl py-12" data-testid="requirement-provider-failure"><Alert variant="destructive" className="border-destructive/20 bg-destructive-soft"><AlertTitle>{providerFailure ? "AI 服务暂时不可用" : "需求文档未生成"}</AlertTitle><AlertDescription className="leading-6">{failureMessages[document.failureCode ?? ""] ?? "需求文档生成未完成，请检查资料状态后在会话中重试。"}</AlertDescription></Alert><div className="mt-4 flex flex-wrap gap-2"><Button asChild><Link href={`/knowledge/sessions?project=${encodeURIComponent(projectId)}`}><Sparkles />返回会话</Link></Button><Button variant="outline" asChild><Link href={`/knowledge/projects/${projectId}/files`}>查看项目资料</Link></Button></div></section>;
}
