"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, FileText, LoaderCircle, Play, RefreshCw, Save, ShieldCheck, Upload, XCircle } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { finalizeTemporaryWorkflowDocument, listProjectDocuments, uploadProjectDocument } from "@/lib/documents/client";
import { withBasePath } from "@/lib/base-path";
import type { KnowledgeSpaceUploadDestinationDto, ProjectDocumentDto } from "@/types/documents";

type Artifact = { id: string; kind: string; title: string; status: string; currentVersion: number; content: Record<string, unknown>; markdown: string; sourceReferences: Array<Record<string, unknown>> };
type Run = { id: string; projectId: string; displayName: string; status: string; currentStep: number; sourceCount: number; artifactCount: number; failureCode: string | null; legacyReadOnly: boolean };
type Detail = { run: Run; artifacts: Artifact[] };

const stepLabels = ["校验来源权限", "解析素材", "提取事实和引用", "识别信息缺口", "生成项目需求概览", "生成需求文档", "生成 GA4 埋点文档", "生成 Action Plan", "交叉一致性检查", "人工审核", "发布和导出"];
const activeStatuses = new Set(["queued", "validating_sources", "parsing_sources", "extracting_facts", "identifying_gaps", "generating_overview", "generating_requirements", "generating_ga4", "generating_action_plan", "checking_consistency"]);

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withBasePath(path), { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json() as T & { error?: { code?: string; message?: string } };
  if (!response.ok) throw new Error(body.error?.message || body.error?.code || "请求失败");
  return body;
}

export function RequirementFrameworkPage({ projects, initialRunId }: { projects: AuthorizedProjectSummary[]; initialRunId?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const editable = useMemo(() => projects.filter((project) => project.permissions.canEditProject), [projects]);
  const initialProjectId = search.get("projectId") || editable[0]?.id || "";
  const [projectId, setProjectId] = useState(initialProjectId);
  const [runId, setRunId] = useState(initialRunId || "");
  const [documents, setDocuments] = useState<ProjectDocumentDto[]>([]);
  const [destinations, setDestinations] = useState<KnowledgeSpaceUploadDestinationDto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [activeArtifactId, setActiveArtifactId] = useState("");
  const [contentJson, setContentJson] = useState("");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const temporaryWorkflowId = useRef(crypto.randomUUID());
  const idempotencyKey = useRef(crypto.randomUUID());

  const project = editable.find((item) => item.id === projectId);
  const artifact = detail?.artifacts.find((item) => item.id === activeArtifactId) ?? detail?.artifacts[0];

  const loadDocuments = useCallback(async (signal?: AbortSignal) => {
    if (!projectId || runId) return;
    setLoading(true);
    try {
      const result = await listProjectDocuments(projectId, "active", signal);
      setDocuments(result.documents);
      setDestinations(result.permissions.uploadDestinations);
      setMessage("");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setMessage(error instanceof Error ? error.message : "资料加载失败");
    } finally { setLoading(false); }
  }, [projectId, runId]);

  const loadRun = useCallback(async () => {
    if (!projectId || !runId) return;
    try {
      const next = await api<Detail>(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}`);
      setDetail(next);
      if (!activeArtifactId && next.artifacts[0]) setActiveArtifactId(next.artifacts[0].id);
      if (next.run.failureCode) setMessage(`工作流失败：${next.run.failureCode}`);
      else setMessage("");
      return next;
    } catch (error) { setMessage(error instanceof Error ? error.message : "工作流加载失败"); }
  }, [activeArtifactId, projectId, runId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (runId) void loadRun(); else void loadDocuments(controller.signal);
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [loadDocuments, loadRun, projectId, runId]);

  useEffect(() => {
    if (!runId || !detail || !activeStatuses.has(detail.run.status)) return;
    const timer = window.setInterval(() => void loadRun(), 2_000);
    return () => window.clearInterval(timer);
  }, [detail, loadRun, runId]);

  useEffect(() => {
    if (!artifact) return;
    const timer = window.setTimeout(() => setContentJson(JSON.stringify(artifact.content, null, 2)), 0);
    return () => window.clearTimeout(timer);
  }, [artifact]);

  const start = async () => {
    if (!projectId || selected.length === 0) { setMessage("请至少选择一份已解析资料。"); return; }
    setLoading(true);
    try {
      const result = await api<{ run: Run }>(`/api/projects/${encodeURIComponent(projectId)}/workflows`, { method: "POST", body: JSON.stringify({ workflowType: "requirement_framework", documentIds: selected, idempotencyKey: idempotencyKey.current, temporaryWorkflowId: temporaryWorkflowId.current }) });
      setRunId(result.run.id);
      router.replace(`/workflows/requirement-framework/${result.run.id}?projectId=${encodeURIComponent(projectId)}`);
      setMessage("工作流已进入后台队列，可以离开页面，返回后会恢复进度。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "工作流启动失败"); }
    finally { setLoading(false); }
  };

  const upload = async (file: File) => {
    const destination = destinations.find((item) => item.projectId === projectId) ?? destinations[0];
    if (!destination) { setMessage("当前项目没有可写知识空间。"); return; }
    setLoading(true);
    try {
      const uploaded = await uploadProjectDocument({ projectId, file, knowledgeSpaceId: destination.id, temporaryWorkflowId: temporaryWorkflowId.current, idempotencyKey: crypto.randomUUID() });
      setMessage("临时附件已安全上传，正在解析；解析完成后才能选择。默认 24 小时过期。" );
      for (let attempt = 0; attempt < 45; attempt += 1) {
        const current = await listProjectDocuments(projectId, "active");
        setDocuments(current.documents);
        const latest = current.documents.find((item) => item.id === uploaded.document.id);
        if (latest?.currentVersion?.ingestion.status === "succeeded") { setSelected((items) => [...new Set([...items, latest.id])]); setMessage("临时附件已解析并选中。未经确认不会进入正式知识库。" ); break; }
        if (["failed", "needs_ocr"].includes(latest?.currentVersion?.ingestion.status ?? "")) { setMessage("附件解析失败或需要 OCR，不能用于本次工作流。" ); break; }
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "附件上传失败"); }
    finally { setLoading(false); if (fileInput.current) fileInput.current.value = ""; }
  };

  const runAction = async (action: "cancel" | "retry") => {
    if (!runId) return;
    await api(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}`, { method: "PATCH", body: JSON.stringify({ action }) });
    await loadRun();
  };

  const save = async () => {
    if (!artifact || !runId) return;
    try {
      const content = JSON.parse(contentJson) as Record<string, unknown>;
      const result = await api<{ version: number }>(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.id)}`, { method: "PATCH", body: JSON.stringify({ action: "save", expectedVersion: artifact.currentVersion, content }) });
      setMessage(`已保存为版本 v${result.version}，发布前仍需审核。`);
      await loadRun();
    } catch (error) { setMessage(error instanceof Error ? error.message : "结构化内容无效"); }
  };

  const regenerate = async () => {
    if (!artifact || !runId) return;
    try {
      await api(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.id)}`, { method: "PATCH", body: JSON.stringify({ action: "regenerate", expectedVersion: artifact.currentVersion }) });
      setMessage(`已仅将“${artifact.title}”加入重新生成队列，其他产物版本保持不变。`);
      await loadRun();
    } catch (error) { setMessage(error instanceof Error ? error.message : "重新生成请求失败"); }
  };

  const finalizeTemporary = async (document: ProjectDocumentDto, action: "promote" | "discard") => {
    const destination = destinations.find((item) => item.projectId === projectId) ?? destinations[0];
    try {
      await finalizeTemporaryWorkflowDocument({ projectId, documentId: document.id, workflowId: temporaryWorkflowId.current, action, targetKnowledgeSpaceId: action === "promote" ? destination?.id : undefined });
      setSelected((items) => items.filter((id) => id !== document.id));
      await loadDocuments();
      setMessage(action === "promote" ? "临时附件已保存到授权知识空间。" : "临时附件已安全移出活动索引。" );
    } catch (error) { setMessage(error instanceof Error ? error.message : "临时附件操作失败"); }
  };

  const review = async (decision: "approve" | "publish") => {
    if (!runId) return;
    await api(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/review`, { method: "POST", body: JSON.stringify({ decision, note: "在工作流上下文完成整批人工审核" }) });
    setMessage(decision === "publish" ? "四类产物已发布；审核和版本记录已保存。" : "四类产物已整批审核，可继续发布。" );
    await loadRun();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3"><button type="button" onClick={() => router.push("/workflows")} className="mt-1 grid size-9 place-items-center rounded-lg border border-border"><ArrowLeft className="size-4" /></button><div><p className="text-xs font-medium text-primary">AI 工作流</p><h1 className="mt-1 text-2xl font-semibold">搭建需求框架{project ? ` · ${project.name}` : ""}</h1><p className="mt-1 text-sm text-muted-foreground">生成项目概览、26 节需求文档、GA4 埋点和 Action Plan；事实必须引用，缺失信息保持待确认。</p></div></div>
        {!runId ? <select value={projectId} onChange={(event) => { setProjectId(event.target.value); setSelected([]); }} className="h-9 rounded-lg border border-border bg-card px-3 text-sm">{editable.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}
      </header>

      {message ? <div className={`rounded-xl border px-4 py-3 text-sm ${detail?.run.status === "failed" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/20 bg-primary/5 text-foreground"}`}>{message}</div> : null}

      {!runId ? (
        <section className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4 text-primary" />选择授权资料</h2><p className="mt-1 text-xs text-muted-foreground">当前项目、已授权部门/公司来源及 24 小时临时附件。手工选择只能缩小授权范围。</p></div><button type="button" onClick={() => fileInput.current?.click()} disabled={loading || destinations.length === 0} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-45"><Upload className="size-4" />上传临时附件</button><input ref={fileInput} hidden type="file" accept=".md,.txt,.pdf,.docx,.pptx,.xlsx" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></div>
          <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{documents.map((document) => { const ready = document.currentVersion?.ingestion.status === "succeeded"; const checked = selected.includes(document.id); return <div key={document.id} className={`rounded-lg border p-3 ${checked ? "border-primary bg-primary/5" : "border-border"}`}><label className={`flex gap-2 ${ready ? "cursor-pointer" : "cursor-not-allowed opacity-55"}`}><input type="checkbox" disabled={!ready} checked={checked} onChange={() => setSelected((items) => checked ? items.filter((id) => id !== document.id) : [...items, document.id])} className="mt-0.5 accent-primary" /><span className="min-w-0"><span className="block truncate text-xs font-medium">{document.displayName}</span><span className="mt-1 block text-[10px] text-muted-foreground">{document.workflowTemporary ? "临时附件" : document.visibility} · {ready ? "已建立索引" : document.currentVersion?.ingestion.status || "处理中"} · v{document.currentVersion?.versionNumber ?? "—"}</span></span></label>{document.workflowTemporary ? <div className="mt-3 flex gap-2 border-t border-border pt-2"><button type="button" onClick={() => void finalizeTemporary(document, "promote")} className="text-[10px] font-medium text-primary">保存到知识库</button><button type="button" onClick={() => void finalizeTemporary(document, "discard")} className="text-[10px] font-medium text-destructive">删除临时附件</button></div> : null}</div>; })}</div>
          {!loading && !documents.length ? <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">当前授权范围还没有已上传资料。可先上传临时附件。</div> : null}
          <div className="mt-5 flex justify-end"><button type="button" onClick={() => void start()} disabled={loading || !selected.length} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-45">{loading ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}开始生成四类产物</button></div>
        </section>
      ) : detail ? (
        <>
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-muted-foreground">{detail.run.displayName}</p><h2 className="mt-1 text-sm font-semibold">{detail.run.status === "awaiting_review" ? "产物已生成，等待人工审核" : detail.run.status === "published" ? "已发布" : detail.run.status === "failed" ? "执行失败" : `正在执行：${stepLabels[Math.max(0, detail.run.currentStep - 1)]}`}</h2></div><div className="flex gap-2">{activeStatuses.has(detail.run.status) ? <button type="button" onClick={() => void runAction("cancel")} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs"><XCircle className="size-3.5" />取消</button> : null}{["failed", "cancelled"].includes(detail.run.status) ? <button type="button" onClick={() => void runAction("retry")} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs"><RefreshCw className="size-3.5" />重试</button> : null}</div></div>
            <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-6 xl:grid-cols-11">{stepLabels.map((label, index) => <div key={label} className={`rounded-lg border p-2 text-[10px] leading-4 ${index + 1 < detail.run.currentStep || detail.run.status === "published" ? "border-emerald-500/25 bg-emerald-500/5 text-emerald-700" : index + 1 === detail.run.currentStep ? "border-primary/30 bg-primary/5 text-primary" : "border-border text-muted-foreground"}`}><span className="block font-semibold">{index + 1}</span>{label}</div>)}</div>
            {activeStatuses.has(detail.run.status) ? <p className="mt-4 text-xs text-muted-foreground">任务在后台继续运行，可以安全离开本页面；返回后会恢复当前状态，不会重复调用 Provider。</p> : null}
          </section>

          {artifact && detail.run.status === "awaiting_review" ? <div className="flex justify-end"><button type="button" onClick={() => void regenerate()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-xs font-medium"><RefreshCw className="size-3.5" />仅重新生成当前产物</button></div> : null}

          {detail.artifacts.length ? <section className="rounded-2xl border border-border bg-card"><div className="flex flex-wrap gap-1 border-b border-border p-3">{detail.artifacts.map((item) => <button key={item.id} type="button" onClick={() => setActiveArtifactId(item.id)} className={`rounded-lg px-3 py-2 text-xs font-medium ${artifact?.id === item.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{item.title} · v{item.currentVersion}</button>)}</div>{artifact ? <div className="grid lg:grid-cols-[minmax(0,1fr)_18rem]"><div className="p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">{artifact.title}</h3><p className="mt-1 text-xs text-muted-foreground">来源引用 {artifact.sourceReferences.length} 条 · 状态 {artifact.status}</p></div><div className="flex flex-wrap gap-2"><a href={withBasePath(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.id)}/export?format=md`)} className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs"><Download className="size-3" />MD</a>{["project_overview", "requirements_document", "meeting_minutes"].includes(artifact.kind) ? <a href={withBasePath(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.id)}/export?format=docx`)} className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs"><Download className="size-3" />DOCX</a> : null}{["ga4_measurement_plan", "action_plan"].includes(artifact.kind) ? <a href={withBasePath(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.id)}/export?format=xlsx`)} className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs"><Download className="size-3" />XLSX</a> : null}<button type="button" onClick={() => void save()} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-2.5 text-xs text-primary-foreground"><Save className="size-3" />保存新版本</button></div></div><label className="text-xs font-medium">结构化内容（JSON Schema 校验）</label><textarea value={contentJson} onChange={(event) => setContentJson(event.target.value)} className="mt-2 min-h-[28rem] w-full resize-y rounded-xl border border-border bg-background p-4 font-mono text-xs leading-6 outline-none focus:border-primary" aria-label={`${artifact.title} 结构化编辑器`} /><details className="mt-4 rounded-xl border border-border p-3"><summary className="cursor-pointer text-xs font-medium">服务端渲染预览</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{artifact.markdown}</pre></details></div><aside className="border-t border-border p-5 lg:border-l lg:border-t-0"><h3 className="flex items-center gap-2 text-xs font-semibold"><ShieldCheck className="size-3.5 text-primary" />审核上下文</h3><p className="mt-2 text-xs leading-5 text-muted-foreground">编辑会在服务端重新执行结构、引用和摘要校验，并由服务端生成 Markdown。所有产物整批审核后才能发布；AI 不直接覆盖正式项目数据。</p><div className="mt-4 space-y-2 text-[11px] text-muted-foreground"><p>• 无来源内容必须保持待确认</p><p>• AI 建议不能伪装成事实</p><p>• 日期和 Measurement ID 不得编造</p><p>• 撤权后需要重新审核引用</p></div></aside></div> : null}</section> : null}

          {detail.run.status === "awaiting_review" && detail.artifacts.length === 4 ? <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-5"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 className="size-4 text-emerald-600" />四类产物已通过结构与引用校验</h2><p className="mt-1 text-xs text-muted-foreground">请人工检查事实、建议、待确认项、日期依赖和埋点覆盖，再整批审核或发布。</p></div><div className="flex gap-2"><button type="button" onClick={() => void review("approve")} className="h-9 rounded-lg border border-border bg-card px-4 text-xs font-medium">整批标记已审核</button><button type="button" onClick={() => void review("publish")} className="h-9 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground">审核并发布</button></div></section> : null}
        </>
      ) : <div className="grid min-h-56 place-items-center rounded-2xl border border-border bg-card"><LoaderCircle className="size-6 animate-spin text-primary" /></div>}
    </div>
  );
}
