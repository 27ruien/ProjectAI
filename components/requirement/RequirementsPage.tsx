"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, FileSearch, LoaderCircle, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import type { AuthorizedProjectSummary, ProjectMockPayload } from "@/lib/auth/ui-types";
import { listProjectDocuments } from "@/lib/documents/client";
import { projectManagementMutation, projectManagementRequest } from "@/lib/project-management/client";
import type { ProjectDocumentDto } from "@/types/documents";

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
  duplicateOfDraftId: string | null;
};

type Requirement = RequirementFields & {
  id: string;
  code: string;
  status: "approved" | "in_progress" | "done" | "cancelled";
  currentVersion: number;
  updatedAt: string;
};

type RequirementVersion = { id: string; requirementId: string; versionNumber: number; createdAt: string };
type RequirementPayload = { requirements: Requirement[]; drafts: Draft[]; versions: RequirementVersion[] };

const typeLabels: Record<RequirementFields["type"], string> = {
  functional: "功能",
  non_functional: "非功能",
  business_rule: "业务规则",
  constraint: "约束",
  compliance: "合规",
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试";
}

export function RequirementsPage({ project }: { project: AuthorizedProjectSummary; data: ProjectMockPayload }) {
  const [payload, setPayload] = useState<RequirementPayload>({ requirements: [], drafts: [], versions: [] });
  const [documents, setDocuments] = useState<ProjectDocumentDto[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<string[]>([]);
  const [selectedDrafts, setSelectedDrafts] = useState<string[]>([]);
  const [selectedRequirementId, setSelectedRequirementId] = useState<string | null>(null);
  const [draftEdits, setDraftEdits] = useState<Record<string, Pick<RequirementFields, "title" | "description">>>({});
  const [phase, setPhase] = useState<"loading" | "ready" | "working" | "error">("loading");
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    setFeedback(null);
    try {
      const [requirements, documentList] = await Promise.all([
        projectManagementRequest<RequirementPayload>(`/api/projects/${encodeURIComponent(project.id)}/requirements`),
        listProjectDocuments(project.id, "active"),
      ]);
      setPayload(requirements);
      setDocuments(documentList.documents);
      setPhase("ready");
    } catch (error) {
      setFeedback(errorMessage(error));
      setPhase("error");
    }
  }, [project.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const pendingDrafts = payload.drafts.filter((draft) => draft.status === "pending_review");
  const documentById = useMemo(() => new Map(documents.map((document) => [document.id, document])), [documents]);
  const selectedRequirement = payload.requirements.find((item) => item.id === selectedRequirementId) ?? null;

  const extract = async () => {
    if (!selectedDocuments.length) return setFeedback("请先选择至少一份已索引资料");
    setPhase("working");
    setFeedback(null);
    try {
      const result = await projectManagementMutation<{ drafts: Draft[]; replayed: boolean }>(
        `/api/projects/${encodeURIComponent(project.id)}/requirement-extractions`,
        "POST",
        { documentIds: selectedDocuments, idempotencyKey: crypto.randomUUID() },
      );
      setFeedback(`已生成 ${result.drafts.length} 条草稿，正式需求尚未写入。`);
      await load();
    } catch (error) {
      setFeedback(errorMessage(error));
      setPhase("ready");
    }
  };

  const review = async (draft: Draft, decision: "accept" | "edit_accept" | "reject") => {
    const edit = draftEdits[draft.id];
    const fields: RequirementFields = { ...draft, ...(edit ?? {}) };
    await projectManagementMutation(
      `/api/projects/${encodeURIComponent(project.id)}/requirement-drafts/${encodeURIComponent(draft.id)}/review`,
      "POST",
      { decision, fields: decision === "reject" ? undefined : fields, note: "Reviewed in ProjectAI" },
    );
  };

  const reviewOne = async (draft: Draft, decision: "accept" | "edit_accept" | "reject") => {
    setPhase("working");
    setFeedback(null);
    try {
      await review(draft, decision);
      setFeedback(decision === "reject" ? "草稿已拒绝，未生成正式需求。" : "草稿已人工确认并生成正式需求。");
      await load();
    } catch (error) {
      setFeedback(errorMessage(error));
      setPhase("ready");
    }
  };

  const bulkReview = async (decision: "accept" | "reject") => {
    const targets = pendingDrafts.filter((draft) => selectedDrafts.includes(draft.id));
    if (!targets.length) return;
    setPhase("working");
    setFeedback(null);
    try {
      for (const draft of targets) await review(draft, decision);
      setSelectedDrafts([]);
      setFeedback(`已完成 ${targets.length} 条草稿的人工${decision === "accept" ? "接受" : "拒绝"}。`);
      await load();
    } catch (error) {
      setFeedback(errorMessage(error));
      setPhase("ready");
    }
  };

  if (phase === "loading") return <div className="grid min-h-72 place-items-center rounded-xl border border-border bg-card"><LoaderCircle className="size-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium text-primary"><ShieldCheck className="size-3.5" /> AI 草稿与正式数据隔离</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">需求提取与审核</h1>
          <p className="mt-1 text-sm text-muted-foreground">仅从当前用户有权资料生成草稿；接受或编辑接受后才写入正式需求。</p>
        </div>
        <button type="button" onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs"><RefreshCw className="size-3.5" />刷新</button>
      </header>

      {feedback ? <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${phase === "error" ? "border-destructive/20 bg-destructive-soft text-destructive" : "border-info/20 bg-info-soft text-info"}`}>{feedback}</div> : null}

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="flex items-center gap-2 text-sm font-semibold"><FileSearch className="size-4 text-primary" />选择提取来源</h2><p className="mt-1 text-[11px] text-muted-foreground">来源选择会在服务端与当前 ACL 取交集，无法扩大权限。</p></div>
          <button disabled={phase === "working" || !project.permissions.canEditProject} type="button" onClick={() => void extract()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"><Sparkles className="size-3.5" />生成草稿</button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {documents.map((document) => {
            const checked = selectedDocuments.includes(document.id);
            return <label key={document.id} className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${checked ? "border-primary bg-primary/5" : "border-border"}`}><input type="checkbox" className="mt-0.5 accent-primary" checked={checked} onChange={() => setSelectedDocuments((current) => checked ? current.filter((id) => id !== document.id) : [...current, document.id])} /><span className="min-w-0"><span className="block truncate text-xs font-medium">{document.displayName}</span><span className="mt-1 block text-[10px] text-muted-foreground">{document.visibility} · v{document.currentVersion?.versionNumber ?? "-"}</span></span></label>;
          })}
          {!documents.length ? <p className="text-sm text-muted-foreground">暂无有权的活动资料。</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div><h2 className="text-sm font-semibold">待审核草稿</h2><p className="mt-1 text-[11px] text-muted-foreground">{pendingDrafts.length} 条待审核；重复项会明确标记。</p></div>
          <div className="flex gap-2"><button disabled={!selectedDrafts.length} onClick={() => void bulkReview("accept")} className="rounded-lg border border-success/30 px-3 py-1.5 text-xs text-success disabled:opacity-40">批量接受</button><button disabled={!selectedDrafts.length} onClick={() => void bulkReview("reject")} className="rounded-lg border border-destructive/30 px-3 py-1.5 text-xs text-destructive disabled:opacity-40">批量拒绝</button></div>
        </div>
        <div className="divide-y divide-border">
          {pendingDrafts.map((draft) => {
            const edit = draftEdits[draft.id] ?? { title: draft.title, description: draft.description };
            return <article key={draft.id} className="grid gap-4 p-5 lg:grid-cols-[24px_minmax(0,1fr)_180px]">
              <input aria-label={`选择 ${draft.title}`} type="checkbox" className="mt-2 accent-primary" checked={selectedDrafts.includes(draft.id)} onChange={() => setSelectedDrafts((current) => current.includes(draft.id) ? current.filter((id) => id !== draft.id) : [...current, draft.id])} />
              <div className="space-y-2"><input value={edit.title} onChange={(event) => setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, title: event.target.value } }))} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-medium" /><textarea rows={3} value={edit.description} onChange={(event) => setDraftEdits((current) => ({ ...current, [draft.id]: { ...edit, description: event.target.value } }))} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs leading-5" /><p className="text-[10px] text-muted-foreground">{typeLabels[draft.type]} · {draft.priority} · {documentById.get(draft.sourceDocumentId)?.displayName ?? "已授权来源"} [{draft.sourceLabel}] · 置信度 {Math.round(draft.confidenceBps / 100)}% {draft.duplicateOfDraftId ? "· 可能重复" : ""}</p></div>
              <div className="flex flex-col gap-2"><button onClick={() => void reviewOne(draft, edit.title === draft.title && edit.description === draft.description ? "accept" : "edit_accept")} className="inline-flex items-center justify-center gap-1 rounded-lg bg-success px-3 py-2 text-xs font-medium text-white"><Check className="size-3.5" />接受</button><button onClick={() => void reviewOne(draft, "reject")} className="inline-flex items-center justify-center gap-1 rounded-lg border border-destructive/30 px-3 py-2 text-xs text-destructive"><X className="size-3.5" />拒绝</button></div>
            </article>;
          })}
          {!pendingDrafts.length ? <p className="p-8 text-center text-sm text-muted-foreground">暂无待审核草稿。</p> : null}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-xl border border-border bg-card"><div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold">正式需求</h2></div><div className="divide-y divide-border">{payload.requirements.map((item) => <button type="button" key={item.id} onClick={() => setSelectedRequirementId(item.id)} className="grid w-full gap-2 px-5 py-4 text-left sm:grid-cols-[90px_minmax(0,1fr)_90px_80px]"><span className="font-mono text-xs font-semibold text-primary">{item.code}</span><span><span className="block text-sm font-medium">{item.title}</span><span className="mt-1 line-clamp-1 block text-[11px] text-muted-foreground">{item.description}</span></span><span className="text-xs text-muted-foreground">{item.status}</span><span className="text-xs text-muted-foreground">v{item.currentVersion}</span></button>)}</div></div>
        <aside className="rounded-xl border border-border bg-card p-5"><h2 className="text-sm font-semibold">需求详情与版本</h2>{selectedRequirement ? <div className="mt-4 space-y-3"><p className="font-mono text-xs text-primary">{selectedRequirement.code}</p><h3 className="font-semibold">{selectedRequirement.title}</h3><p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{selectedRequirement.description}</p><div className="border-t border-border pt-3"><p className="text-[11px] font-medium">版本历史</p>{payload.versions.filter((version) => version.requirementId === selectedRequirement.id).map((version) => <p key={version.id} className="mt-2 text-[10px] text-muted-foreground">v{version.versionNumber} · {new Date(version.createdAt).toLocaleString("zh-CN")}</p>)}</div></div> : <p className="mt-4 text-xs text-muted-foreground">选择一条正式需求查看详情和版本历史。</p>}</aside>
      </section>
    </div>
  );
}

export default RequirementsPage;
