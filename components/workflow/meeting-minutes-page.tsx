"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, Download, LoaderCircle, Mic2, Play, RefreshCw, Save, Trash2, Upload } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { withBasePath } from "@/lib/base-path";

type Artifact = { id: string; kind: string; title: string; status: string; currentVersion: number; content: Record<string, unknown>; markdown: string };
type Run = { id: string; projectId: string; displayName: string; status: string; currentStep: number; failureCode: string | null; artifactCount: number };
type Detail = { run: Run; artifacts: Artifact[] };
type Speaker = { id: string; displayName: string; speakerKey: string };
const active = new Set(["queued", "transcribing", "diarizing", "normalizing", "summarizing"]);

async function jsonApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(withBasePath(path), { cache: "no-store", ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json() as T & { error?: { message?: string; code?: string } };
  if (!response.ok) throw new Error(body.error?.message || body.error?.code || "请求失败");
  return body;
}

function stage(status: string) {
  const labels: Record<string, string> = { queued: "排队中", transcribing: "正在转写", diarizing: "正在区分说话人", normalizing: "正在整理转写", summarizing: "正在生成纪要", awaiting_review: "等待人工审核", published: "已发布", failed: "失败", cancelled: "已取消" };
  return labels[status] ?? status;
}

export function MeetingMinutesPage({ projects, initialRunId }: { projects: AuthorizedProjectSummary[]; initialRunId?: string }) {
  const router = useRouter();
  const search = useSearchParams();
  const editable = useMemo(() => projects.filter((project) => project.permissions.canEditProject), [projects]);
  const [projectId, setProjectId] = useState(search.get("projectId") || editable[0]?.id || "");
  const [runId, setRunId] = useState(initialRunId || "");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [activeArtifactId, setActiveArtifactId] = useState("");
  const [contentJson, setContentJson] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const idempotency = useRef(crypto.randomUUID());
  const artifact = detail?.artifacts.find((item) => item.id === activeArtifactId) ?? detail?.artifacts[0];
  const project = editable.find((item) => item.id === projectId);

  const load = useCallback(async () => {
    if (!projectId || !runId) return;
    try {
      const next = await jsonApi<Detail>(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}`);
      setDetail(next);
      if (!activeArtifactId && next.artifacts[0]) setActiveArtifactId(next.artifacts[0].id);
      setMessage(next.run.failureCode ? `处理失败：${next.run.failureCode}` : "");
    } catch (error) { setMessage(error instanceof Error ? error.message : "会议工作流加载失败"); }
  }, [activeArtifactId, projectId, runId]);

  useEffect(() => { const timer = window.setTimeout(() => { if (runId) void load(); }, 0); return () => window.clearTimeout(timer); }, [load, runId]);
  useEffect(() => { if (!detail || !active.has(detail.run.status)) return; const timer = window.setInterval(() => void load(), 2_000); return () => window.clearInterval(timer); }, [detail, load]);
  useEffect(() => { if (!artifact) return; const timer = window.setTimeout(() => setContentJson(JSON.stringify(artifact.content, null, 2)), 0); return () => window.clearTimeout(timer); }, [artifact]);

  const upload = async () => {
    if (!file || !projectId) return;
    setBusy(true); setMessage("正在安全上传到私有对象存储…");
    try {
      const form = new FormData(); form.set("file", file); form.set("idempotencyKey", idempotency.current);
      const response = await fetch(withBasePath(`/api/projects/${encodeURIComponent(projectId)}/workflows/meeting-minutes`), { method: "POST", body: form });
      const body = await response.json() as { runId?: string; error?: { message?: string; code?: string } };
      if (!response.ok || !body.runId) throw new Error(body.error?.message || body.error?.code || "上传失败");
      setRunId(body.runId); router.replace(`/workflows/meeting-minutes/${body.runId}?projectId=${encodeURIComponent(projectId)}`);
      setMessage("音视频已进入后台处理，可以离开页面，返回后会恢复任务状态。" );
    } catch (error) { setMessage(error instanceof Error ? error.message : "上传失败"); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!artifact) return;
    try {
      const content = JSON.parse(contentJson) as Record<string, unknown>;
      await jsonApi(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.id)}`, { method: "PATCH", body: JSON.stringify({ action: "save", expectedVersion: artifact.currentVersion, content }) });
      setMessage("会议产物已保存为新版本，状态回退为草稿并等待重新审核。" ); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "结构化内容无效"); }
  };

  const retry = async () => {
    if (!runId) return;
    setBusy(true);
    try {
      await jsonApi(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}`, { method: "PATCH", body: JSON.stringify({ action: "retry" }) });
      await load();
      setMessage("已从失败步骤重新进入后台处理；不会重新上传音视频或重复创建语音任务。" );
    } catch (error) { setMessage(error instanceof Error ? error.message : "会议工作流重试失败"); }
    finally { setBusy(false); }
  };

  const renameSpeaker = async (speaker: Speaker, displayName: string) => {
    await jsonApi(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/speakers/${encodeURIComponent(speaker.id)}`, { method: "PATCH", body: JSON.stringify({ displayName }) });
    setMessage("说话人名称已由用户确认，并同步写入转写、纪要和待办的新版本。" ); await load();
  };

  const review = async () => {
    setBusy(true);
    try {
      await jsonApi(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/review`, { method: "POST", body: JSON.stringify({ decision: "publish", note: "会议转写、说话人、决策和待办已人工审核" }) });
      setMessage("会议纪要已发布。AI 生成的待办仍是审核产物，不会自动成为正式项目任务。" ); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "会议纪要发布失败"); }
    finally { setBusy(false); }
  };

  const removeAudio = async () => {
    setBusy(true);
    try {
      await jsonApi(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/audio`, { method: "DELETE" });
      setMessage("原始音视频已从私有对象存储删除；审核产物和审计记录保留。" );
    } catch (error) { setMessage(error instanceof Error ? error.message : "原始音视频删除失败"); }
    finally { setBusy(false); }
  };

  const transcript = detail?.artifacts.find((item) => item.kind === "meeting_transcript");
  const speakers = (transcript?.content.speakers ?? []) as Speaker[];

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4"><div className="flex items-start gap-3"><button type="button" onClick={() => router.push("/workflows")} className="mt-1 grid size-9 place-items-center rounded-lg border border-border"><ArrowLeft className="size-4" /></button><div><p className="text-xs font-medium text-primary">AI 工作流</p><h1 className="mt-1 text-2xl font-semibold">提取会议纪要{project ? ` · ${project.name}` : ""}</h1><p className="mt-1 text-sm text-muted-foreground">私有上传、异步转写、官方说话人分离、人工命名和发布。</p></div></div>{!runId ? <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-9 rounded-lg border border-border bg-card px-3 text-sm">{editable.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select> : null}</header>
    {message ? <div className={`rounded-xl border px-4 py-3 text-sm ${detail?.run.status === "failed" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/20 bg-primary/5"}`}>{message}</div> : null}
    {!runId ? <section className="rounded-2xl border border-border bg-card p-6"><div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><Mic2 className="size-4 text-primary" />上传会议录音或视频</h2><label className="mt-4 flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/20 p-5 text-center"><Upload className="size-6 text-muted-foreground" /><span className="mt-3 text-sm font-medium">{file?.name || "选择 MP3 / M4A / WAV / AAC / MP4 / MOV"}</span><span className="mt-1 text-xs text-muted-foreground">ProjectAI 限制 100 MB；说话人分离建议单声道且不超过 2 小时。</span><input type="file" hidden accept=".mp3,.m4a,.wav,.aac,.mp4,.mov,audio/*,video/mp4,video/quicktime" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><button type="button" onClick={() => void upload()} disabled={!file || busy} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-45">{busy ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}上传并开始处理</button></div><aside className="rounded-xl border border-border p-4 text-xs leading-5 text-muted-foreground"><h3 className="font-semibold text-foreground">隐私与处理边界</h3><p className="mt-2">原始音视频保存在私有对象存储，只通过一小时短时签名地址提供给受控语音 Provider；浏览器不会获得对象 Key。</p><p className="mt-2">默认使用 Alibaba Model Studio Paraformer 的异步转写与 speaker_id。系统不会推断真实姓名，必须由用户手工重命名。</p><p className="mt-2">草稿纪要和 Action 不会自动进入正式知识或项目任务。</p></aside></div></section> : detail ? <>
      <section className="rounded-2xl border border-border bg-card p-5"><div className="flex items-center justify-between gap-3"><div><p className="text-xs text-muted-foreground">{detail.run.displayName}</p><h2 className="mt-1 text-sm font-semibold">{stage(detail.run.status)}</h2></div><div className="flex items-center gap-2">{["failed", "cancelled"].includes(detail.run.status) ? <button type="button" onClick={() => void retry()} disabled={busy} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs disabled:opacity-45">{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}从失败步骤重试</button> : null}{active.has(detail.run.status) ? <LoaderCircle className="size-5 animate-spin text-primary" /> : detail.run.status === "awaiting_review" || detail.run.status === "published" ? <CheckCircle2 className="size-5 text-emerald-600" /> : null}</div></div>{active.has(detail.run.status) ? <p className="mt-3 text-xs text-muted-foreground">任务在后台继续处理，可安全离开页面。系统不会因刷新或返回页面重复提交语音任务。</p> : null}</section>
      {speakers.length ? <section className="rounded-2xl border border-border bg-card p-5"><h2 className="text-sm font-semibold">确认说话人</h2><p className="mt-1 text-xs text-muted-foreground">Provider 只返回 speaker_id。这里的姓名必须由用户确认。</p><div className="mt-4 grid gap-3 md:grid-cols-3">{speakers.map((speaker) => <SpeakerEditor key={`${speaker.id}:${speaker.displayName}`} speaker={speaker} onSave={renameSpeaker} />)}</div></section> : null}
      {detail.artifacts.length ? <section className="rounded-2xl border border-border bg-card"><div className="flex flex-wrap gap-1 border-b border-border p-3">{detail.artifacts.map((item) => <button key={item.id} type="button" onClick={() => setActiveArtifactId(item.id)} className={`rounded-lg px-3 py-2 text-xs font-medium ${artifact?.id === item.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>{item.title} · v{item.currentVersion}</button>)}</div>{artifact ? <div className="p-5"><div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">{artifact.title}</h3><p className="mt-1 text-xs text-muted-foreground">结构化编辑会创建新版本，并由服务端重新校验和渲染。</p></div><div className="flex gap-2"><a href={withBasePath(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.id)}/export?format=md`)} className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs"><Download className="size-3" />MD</a>{artifact.kind === "meeting_transcript" ? <a href={withBasePath(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.id)}/export?format=txt`)} className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs"><Download className="size-3" />TXT</a> : null}{["meeting_minutes", "meeting_transcript"].includes(artifact.kind) ? <a href={withBasePath(`/api/projects/${encodeURIComponent(projectId)}/workflows/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifact.id)}/export?format=docx`)} className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs"><Download className="size-3" />DOCX</a> : null}<button type="button" onClick={() => void save()} className="inline-flex h-8 items-center gap-1 rounded-lg bg-primary px-2.5 text-xs text-primary-foreground"><Save className="size-3" />保存版本</button></div></div><textarea value={contentJson} onChange={(event) => setContentJson(event.target.value)} className="min-h-[24rem] w-full rounded-xl border border-border bg-background p-4 font-mono text-xs leading-6 outline-none focus:border-primary" aria-label={`${artifact.title} 结构化编辑器`} /><details className="mt-4 rounded-xl border border-border p-3"><summary className="cursor-pointer text-xs font-medium">服务端渲染预览</summary><pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{artifact.markdown}</pre></details></div> : null}</section> : null}
      {detail.run.status === "awaiting_review" && detail.artifacts.length === 3 ? <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-emerald-500/25 bg-emerald-500/5 p-5"><div><h2 className="text-sm font-semibold">转写、纪要和待办已就绪</h2><p className="mt-1 text-xs text-muted-foreground">发布前请确认说话人、区分决策/建议/待确认问题，并检查每项来源时间戳。</p></div><button type="button" onClick={() => void review()} disabled={busy} className="h-9 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-45">{busy ? "正在发布…" : "审核并发布"}</button></section> : null}
      {["awaiting_review", "published", "failed", "cancelled"].includes(detail.run.status) ? <div className="flex justify-end"><button type="button" onClick={() => void removeAudio()} disabled={busy} className="inline-flex h-9 items-center gap-2 rounded-lg border border-destructive/30 px-3 text-xs font-medium text-destructive disabled:opacity-45"><Trash2 className="size-3.5" />{busy ? "正在删除…" : "删除原始音视频"}</button></div> : null}
    </> : <div className="grid min-h-56 place-items-center"><LoaderCircle className="size-6 animate-spin text-primary" /></div>}
  </div>;
}

function SpeakerEditor({ speaker, onSave }: { speaker: Speaker; onSave: (speaker: Speaker, name: string) => Promise<void> }) {
  const [name, setName] = useState(speaker.displayName);
  return <div className="rounded-xl border border-border p-3"><p className="text-[10px] text-muted-foreground">{speaker.speakerKey}</p><div className="mt-2 flex gap-2"><input value={name} onChange={(event) => setName(event.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-border px-2 text-xs" /><button type="button" onClick={() => void onSave(speaker, name)} disabled={!name.trim() || name === speaker.displayName} className="rounded-lg bg-primary px-2.5 text-xs text-primary-foreground disabled:opacity-40">确认</button></div></div>;
}
