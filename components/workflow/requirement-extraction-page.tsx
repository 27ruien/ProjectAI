"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  FileText,
  LoaderCircle,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import {
  finalizeTemporaryWorkflowDocument,
  listProjectDocuments,
  readProjectDocumentVersionFile,
  uploadProjectDocument,
} from "@/lib/documents/client";
import {
  ProjectManagementApiError,
  projectManagementMutation,
} from "@/lib/project-management/client";
import { withBasePath } from "@/lib/base-path";
import type {
  KnowledgeSpaceUploadDestinationDto,
  ProjectDocumentDto,
} from "@/types/documents";

type RequirementFields = {
  title: string;
  description: string;
  type: "functional" | "non_functional" | "business_rule" | "constraint" | "compliance";
  priority: "low" | "medium" | "high" | "critical";
  ownerUserId: string | null;
  acceptanceCriteria: string[];
  assumptions: string[];
  openQuestions: string[];
};

type Draft = RequirementFields & {
  id: string;
  status: "pending_review" | "accepted" | "rejected";
  sourceDocumentId: string;
  sourceLabel: string;
  confidenceBps: number;
};

interface RequirementExtractionPageProps {
  editableProject: Pick<AuthorizedProjectSummary, "id" | "name">;
  onBack?: () => void;
  onOpenReviews?: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  SOURCE_REQUIRED: "请先选择知识库资料或上传附件。",
  SOURCE_NOT_FOUND: "所选资料已删除、归档或不存在，请刷新后重新选择。",
  SOURCE_FORBIDDEN: "你没有权限使用所选资料。",
  SOURCE_NOT_READY: "所选资料仍在上传或解析，请稍后重试。",
  SOURCE_PARSE_FAILED: "所选资料解析失败或没有可提取的文本。",
  INVALID_WORKFLOW_INPUT: "工作流输入无效，请重新选择资料。",
  AI_OUTPUT_INVALID: "AI 返回格式未通过校验和一次受控修复，请重试。",
  AI_CITATION_INVALID: "AI 引用未绑定本次资料，结果已拒绝。",
  WORKFLOW_ALREADY_RUNNING: "相同工作流请求仍在处理中，请等待当前请求完成。",
  WORKFLOW_RESULT_NOT_READY: "工作流结果仍在保存，请稍后刷新。",
};

function messageFor(error: unknown): string {
  if (error instanceof ProjectManagementApiError) {
    return ERROR_MESSAGES[error.code] ?? error.message;
  }
  return error instanceof Error ? error.message : "工作流执行失败";
}

export function RequirementExtractionPage({
  editableProject,
  onBack,
}: RequirementExtractionPageProps) {
  const workflowId = useRef(crypto.randomUUID());
  const fileInput = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<ProjectDocumentDto[]>([]);
  const [destinations, setDestinations] = useState<KnowledgeSpaceUploadDestinationDto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [temporaryDocumentIds, setTemporaryDocumentIds] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [edits, setEdits] = useState<Record<string, Pick<Draft, "title" | "description">>>({});
  const [phase, setPhase] = useState<"loading" | "ready" | "uploading" | "running" | "reviewing" | "completed" | "failed">("loading");
  const [message, setMessage] = useState("");
  const [savePrompt, setSavePrompt] = useState(false);

  const refreshDocuments = async () => {
    const response = await listProjectDocuments(editableProject.id, "active");
    setDocuments(response.documents);
    setDestinations(response.permissions.uploadDestinations);
    return response.documents;
  };

  useEffect(() => {
    const controller = new AbortController();
    void listProjectDocuments(editableProject.id, "active", controller.signal)
      .then((response) => {
        setDocuments(response.documents);
        setDestinations(response.permissions.uploadDestinations);
        setPhase("ready");
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          setMessage(error instanceof Error ? error.message : "资料加载失败");
          setPhase("failed");
        }
      });
    return () => controller.abort();
  }, [editableProject.id]);

  const uploadTemporary = async (file: File) => {
    const destination = destinations.find((item) => item.projectId === editableProject.id) ?? destinations[0];
    if (!destination) {
      setMessage("当前没有可编辑的知识空间，无法上传附件。");
      setPhase("failed");
      return;
    }
    setPhase("uploading");
    setMessage("正在安全上传临时附件…");
    try {
      const uploaded = await uploadProjectDocument({
        projectId: editableProject.id,
        file,
        knowledgeSpaceId: destination.id,
        temporaryWorkflowId: workflowId.current,
        idempotencyKey: crypto.randomUUID(),
      });
      setTemporaryDocumentIds((current) => [...new Set([...current, uploaded.document.id])]);
      let latest: ProjectDocumentDto | undefined;
      for (let attempt = 0; attempt < 45; attempt += 1) {
        const currentDocuments = await refreshDocuments();
        latest = currentDocuments.find((item) => item.id === uploaded.document.id);
        const status = latest?.currentVersion?.ingestion.status;
        if (status === "succeeded" || status === "failed" || status === "needs_ocr") break;
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
      }
      if (latest?.currentVersion?.ingestion.status !== "succeeded") {
        setMessage("附件已上传，但解析尚未成功。可稍后刷新后重试，不会发送无效工作流请求。");
        setPhase("failed");
        return;
      }
      setSelected((current) => [...new Set([...current, latest!.id])]);
      setMessage("临时附件已解析完成，默认 24 小时后过期；批准结果后可选择是否保存。" );
      setPhase("ready");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "附件上传失败");
      setPhase("failed");
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const run = async () => {
    if (!selected.length) {
      setMessage("请从知识库选择资料，或上传一份附件后再运行工作流。");
      return;
    }
    setPhase("running");
    setMessage("正在由服务端重新校验权限、采集当前有效 Chunk 并生成草稿…");
    try {
      const result = await projectManagementMutation<{ drafts: Draft[]; replayed: boolean }>(
        `/api/projects/${encodeURIComponent(editableProject.id)}/requirement-extractions`,
        "POST",
        { documentIds: selected, idempotencyKey: crypto.randomUUID() },
      );
      setDrafts(result.drafts);
      setEdits(Object.fromEntries(result.drafts.map((draft) => [draft.id, { title: draft.title, description: draft.description }])));
      setMessage(`已生成 ${result.drafts.length} 条待审核草稿；请在当前页面核对和编辑。`);
      setPhase("completed");
    } catch (error) {
      setMessage(messageFor(error));
      setPhase("failed");
    }
  };

  const approveAll = async () => {
    setPhase("reviewing");
    setMessage("正在保存人工审核决定…");
    try {
      for (const draft of drafts) {
        const edit = edits[draft.id] ?? { title: draft.title, description: draft.description };
        const fields: RequirementFields = { ...draft, ...edit };
        await projectManagementMutation(
          `/api/projects/${encodeURIComponent(editableProject.id)}/requirement-drafts/${encodeURIComponent(draft.id)}/review`,
          "POST",
          {
            decision:
              edit.title === draft.title && edit.description === draft.description
                ? "accept"
                : "edit_accept",
            fields,
            note: "Reviewed in contextual AI workflow",
          },
        );
      }
      setMessage(`${drafts.length} 条结果已人工批准并写入正式需求。`);
      setPhase("completed");
      setSavePrompt(true);
    } catch (error) {
      setMessage(messageFor(error));
      setPhase("failed");
    }
  };

  const rejectAll = async () => {
    setPhase("reviewing");
    try {
      for (const draft of drafts) {
        await projectManagementMutation(
          `/api/projects/${encodeURIComponent(editableProject.id)}/requirement-drafts/${encodeURIComponent(draft.id)}/review`,
          "POST",
          { decision: "reject", note: "Rejected in contextual AI workflow" },
        );
      }
      await finalizeTemporaryDocuments("discard");
      setDrafts([]);
      setMessage("本次结果已拒绝；临时附件已退出活动知识索引。" );
      setPhase("ready");
    } catch (error) {
      setMessage(messageFor(error));
      setPhase("failed");
    }
  };

  const finalizeTemporaryDocuments = async (
    action: "promote" | "discard",
    targetKnowledgeSpaceId?: string,
  ) => {
    for (const documentId of temporaryDocumentIds) {
      await finalizeTemporaryWorkflowDocument({
        projectId: editableProject.id,
        documentId,
        workflowId: workflowId.current,
        action,
        targetKnowledgeSpaceId,
      });
    }
  };

  return (
    <div className="space-y-5">
      <header className="flex items-start gap-3">
        <button type="button" onClick={onBack} className="mt-1 grid size-9 place-items-center rounded-lg border border-border"><ArrowLeft className="size-4" /></button>
        <div><p className="text-xs font-medium text-primary">真实受控工作流</p><h1 className="mt-1 text-2xl font-semibold">需求提取 · {editableProject.name}</h1><p className="mt-1 text-sm text-muted-foreground">AI 只生成草稿；引用和字段在当前页面审核后才写入正式需求。</p></div>
      </header>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4 text-primary" />选择工作流资料</h2><p className="mt-1 text-xs text-muted-foreground">从知识库选择现有文档，或上传一份 24 小时有效的临时附件。</p></div><button type="button" disabled={phase === "uploading" || phase === "running"} onClick={() => fileInput.current?.click()} className="inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-medium disabled:opacity-50">{phase === "uploading" ? <LoaderCircle className="size-4 animate-spin" /> : <Upload className="size-4" />}上传附件</button><input ref={fileInput} type="file" hidden accept=".pdf,.docx,.xlsx,.pptx,.txt,.md" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadTemporary(file); }} /></div>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {documents.map((document) => {
            const checked = selected.includes(document.id);
            const ingestion = document.currentVersion?.ingestion.status;
            const selectable = ingestion === "succeeded";
            return <label key={document.id} className={`flex gap-2 rounded-lg border p-3 ${selectable ? "cursor-pointer" : "cursor-not-allowed opacity-55"} ${checked ? "border-primary bg-primary/5" : "border-border"}`}><input type="checkbox" disabled={!selectable} checked={checked} onChange={() => setSelected((current) => checked ? current.filter((id) => id !== document.id) : [...current, document.id])} className="mt-0.5 accent-primary" /><span className="min-w-0"><span className="block truncate text-xs font-medium">{document.displayName}</span><span className="mt-1 block text-[10px] text-muted-foreground">{document.workflowTemporary ? "临时附件" : document.visibility} · {ingestion === "succeeded" ? "已就绪" : "处理中"}</span></span></label>;
          })}
        </div>
        {!documents.length ? <div className="mt-4 rounded-xl border border-dashed bg-surface px-5 py-8 text-center"><p className="text-sm font-medium">还没有可用资料</p><p className="mt-1 text-xs text-muted-foreground">请选择“上传附件”，或先在知识库上传文件。</p></div> : null}
        <button type="button" disabled={["loading", "uploading", "running", "reviewing"].includes(phase) || !selected.length} onClick={() => void run()} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">{phase === "running" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}生成待审核草稿</button>
      </section>

      {message ? <section role="status" className={`rounded-xl border p-4 text-sm ${phase === "failed" ? "border-destructive/20 bg-destructive-soft text-destructive" : "border-info/20 bg-info-soft text-info"}`}>{message}</section> : null}

      {drafts.length ? (
        <section className="overflow-hidden rounded-xl border bg-card">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"><div><h2 className="text-sm font-semibold">当前页面审核</h2><p className="mt-1 text-xs text-muted-foreground">编辑后可整批批准；右侧信息绑定本次来源引用。</p></div><div className="flex gap-2"><button type="button" disabled={phase === "reviewing"} onClick={() => void rejectAll()} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-destructive/30 px-3 text-xs text-destructive"><X className="size-4" />整批拒绝</button><button type="button" disabled={phase === "reviewing"} onClick={() => void approveAll()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-success px-3 text-xs font-semibold text-white">{phase === "reviewing" ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}整批批准</button></div></header>
          <div className="divide-y">{drafts.map((draft) => { const edit = edits[draft.id] ?? { title: draft.title, description: draft.description }; return <article key={draft.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_220px]"><div className="space-y-2"><input aria-label="需求标题" value={edit.title} onChange={(event) => setEdits((current) => ({ ...current, [draft.id]: { ...edit, title: event.target.value } }))} className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-medium outline-none focus:border-primary" /><textarea aria-label="需求描述" rows={4} value={edit.description} onChange={(event) => setEdits((current) => ({ ...current, [draft.id]: { ...edit, description: event.target.value } }))} className="w-full rounded-lg border bg-background px-3 py-2 text-xs leading-5 outline-none focus:border-primary" /></div><aside className="rounded-xl border bg-surface p-3 text-xs"><p className="font-semibold">审核依据</p><p className="mt-2 text-muted-foreground">引用 {draft.sourceLabel}</p><p className="mt-1 text-muted-foreground">置信度 {Math.round(draft.confidenceBps / 100)}%</p><p className="mt-1 text-muted-foreground">优先级 {draft.priority}</p></aside></article>; })}</div>
        </section>
      ) : null}

      {savePrompt ? (
        <KnowledgeSaveDialog
          project={editableProject}
          destinations={destinations}
          drafts={drafts}
          hasTemporaryAttachments={temporaryDocumentIds.length > 0}
          onClose={() => setSavePrompt(false)}
          onFinalize={async (choice) => {
            const crossProject = Boolean(
              choice.saveOriginalAttachments &&
              choice.targetProjectId &&
              choice.targetProjectId !== editableProject.id,
            );
            if (crossProject && choice.targetProjectId && choice.targetKnowledgeSpaceId) {
              for (const documentId of temporaryDocumentIds) {
                const source = documents.find((document) => document.id === documentId);
                const version = source?.currentVersion;
                if (!source || !version) throw new Error("临时附件版本不可用，请刷新后重试");
                const file = await readProjectDocumentVersionFile(
                  editableProject.id,
                  source.id,
                  version.id,
                  version.originalFilename,
                );
                await uploadProjectDocument({
                  projectId: choice.targetProjectId,
                  file,
                  displayName: source.displayName,
                  knowledgeSpaceId: choice.targetKnowledgeSpaceId,
                  idempotencyKey: crypto.randomUUID(),
                });
              }
            }
            if (choice.saveResult && choice.targetKnowledgeSpaceId) {
              const markdown = drafts.map((draft, index) => `## ${index + 1}. ${edits[draft.id]?.title ?? draft.title}\n\n${edits[draft.id]?.description ?? draft.description}\n\n来源：${draft.sourceLabel}`).join("\n\n");
              await uploadProjectDocument({
                projectId: choice.targetProjectId ?? editableProject.id,
                file: new File([`# 需求提取审核结果\n\n${markdown}\n`], `requirement-review-${new Date().toISOString().slice(0, 10)}.md`, { type: "text/markdown" }),
                displayName: `需求提取审核结果 ${new Date().toLocaleDateString("zh-CN")}`,
                knowledgeSpaceId: choice.targetKnowledgeSpaceId,
                idempotencyKey: crypto.randomUUID(),
              });
            }
            if (!choice.saveOriginalAttachments || crossProject) {
              await finalizeTemporaryDocuments("discard");
            } else {
              await finalizeTemporaryDocuments("promote", choice.targetKnowledgeSpaceId);
            }
            setSavePrompt(false);
            setMessage(choice.saveResult || choice.saveOriginalAttachments ? "已按选择保存到知识库。" : "本次未保存到知识库；临时附件已退出活动索引。" );
          }}
        />
      ) : null}
    </div>
  );
}

function KnowledgeSaveDialog({
  project,
  destinations,
  hasTemporaryAttachments,
  onClose,
  onFinalize,
}: {
  project: Pick<AuthorizedProjectSummary, "id" | "name">;
  destinations: KnowledgeSpaceUploadDestinationDto[];
  drafts: Draft[];
  hasTemporaryAttachments: boolean;
  onClose: () => void;
  onFinalize: (choice: { saveResult: boolean; saveOriginalAttachments: boolean; targetKnowledgeSpaceId?: string; targetProjectId?: string }) => Promise<void>;
}) {
  const [choice, setChoice] = useState<"none" | "department" | "project" | "new-project">("none");
  const [targetId, setTargetId] = useState("");
  const [newName, setNewName] = useState("");
  const [saveOriginal, setSaveOriginal] = useState(hasTemporaryAttachments);
  const [saveResult, setSaveResult] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const options = destinations.filter((item) => choice === "department" ? item.type === "department" : item.type === "project");
  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      let destinationId = targetId || options[0]?.id;
      let targetProjectId: string | undefined;
      if (choice === "new-project") {
        const response = await fetch(withBasePath("/api/projects"), {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: newName, clientName: "Kivisense Internal", description: "由 AI 工作流保存流程创建。" }),
        });
        const body = (await response.json().catch(() => null)) as { project?: { id?: string }; knowledgeSpaceId?: string; error?: { message?: string } } | null;
        if (!response.ok || !body?.project?.id || !body.knowledgeSpaceId) throw new Error(body?.error?.message ?? "新项目空间创建失败");
        targetProjectId = body.project.id;
        destinationId = body.knowledgeSpaceId;
      }
      if (choice !== "none" && !destinationId) throw new Error("请选择保存空间");
      await onFinalize({
        saveResult: choice !== "none" && saveResult,
        saveOriginalAttachments: choice !== "none" && saveOriginal,
        targetKnowledgeSpaceId: choice === "none" ? undefined : destinationId,
        targetProjectId,
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
      setSubmitting(false);
    }
  };
  return <div className="fixed inset-0 z-[85] grid place-items-center bg-[var(--overlay)] p-4" role="dialog" aria-modal="true" aria-label="保存到知识库"><button type="button" className="absolute inset-0" onClick={onClose} aria-label="关闭" /><section className="relative w-full max-w-xl space-y-4 rounded-2xl border bg-card p-6 shadow-[var(--shadow-float)]"><div><h2 className="flex items-center gap-2 text-base font-semibold"><CheckCircle2 className="size-5 text-success" />是否将本次资料和结果保存到知识库？</h2><p className="mt-1 text-xs text-muted-foreground">正式需求已经过人工批准；这里决定是否额外保存原始附件和审核结果文档。</p></div><div className="grid gap-2 sm:grid-cols-2">{([ ["none", "不保存"], ["department", "保存到部门共享空间"], ["project", "保存到现有项目空间"], ["new-project", "新建项目空间并保存"] ] as const).map(([value, label]) => <button key={value} type="button" onClick={() => { setChoice(value); setTargetId(""); }} className={`rounded-xl border p-3 text-left text-xs font-medium ${choice === value ? "border-primary bg-primary/5 text-primary" : "border-border"}`}>{label}</button>)}</div>{choice === "department" || choice === "project" ? <label className="block text-xs font-medium">目标空间<select value={targetId} onChange={(event) => setTargetId(event.target.value)} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm"><option value="">请选择</option>{options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}{choice === "new-project" ? <label className="block text-xs font-medium">新项目空间名称<input value={newName} onChange={(event) => setNewName(event.target.value)} minLength={2} required className="mt-1.5 h-10 w-full rounded-lg border bg-background px-3 text-sm" placeholder={`${project.name} · 新空间`} /></label> : null}{choice !== "none" ? <div className="space-y-2 rounded-xl border bg-surface p-3"><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={saveResult} onChange={(event) => setSaveResult(event.target.checked)} />保存审核后的结果</label>{hasTemporaryAttachments ? <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={saveOriginal} onChange={(event) => setSaveOriginal(event.target.checked)} />保存原始附件{choice === "new-project" ? "（复制到新项目后清理临时源）" : ""}</label> : null}</div> : null}{error ? <p role="alert" className="rounded-lg bg-destructive-soft p-3 text-xs text-destructive">{error}</p> : null}<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="h-9 rounded-lg border px-4 text-xs">稍后处理</button><button type="button" disabled={submitting || (choice === "new-project" && newName.trim().length < 2)} onClick={() => void submit()} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground disabled:opacity-50">{submitting ? <LoaderCircle className="size-4 animate-spin" /> : null}确认</button></div></section></div>;
}
