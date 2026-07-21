"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, FileText, LoaderCircle, Sparkles } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { listProjectDocuments } from "@/lib/documents/client";
import { projectManagementMutation } from "@/lib/project-management/client";
import type { ProjectDocumentDto } from "@/types/documents";

interface RequirementExtractionPageProps {
  editableProject: Pick<AuthorizedProjectSummary, "id" | "name">;
  onBack?: () => void;
  onOpenReviews?: () => void;
}

export function RequirementExtractionPage({ editableProject, onBack, onOpenReviews }: RequirementExtractionPageProps) {
  const [documents, setDocuments] = useState<ProjectDocumentDto[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "running" | "completed" | "failed">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void listProjectDocuments(editableProject.id, "active", controller.signal)
      .then((response) => { setDocuments(response.documents); setPhase("ready"); })
      .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) { setMessage(error instanceof Error ? error.message : "资料加载失败"); setPhase("failed"); } });
    return () => controller.abort();
  }, [editableProject.id]);

  const run = async () => {
    if (!selected.length) return setMessage("请选择至少一份当前有权资料");
    setPhase("running");
    setMessage("正在由服务端重新校验 ACL、采集当前有效 Chunk 并生成草稿…");
    try {
      const result = await projectManagementMutation<{ drafts: unknown[]; replayed: boolean }>(
        `/api/projects/${encodeURIComponent(editableProject.id)}/requirement-extractions`,
        "POST",
        { documentIds: selected, idempotencyKey: crypto.randomUUID() },
      );
      setMessage(`已创建 ${result.drafts.length} 条待审核草稿；未写入正式需求。`);
      setPhase("completed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "提取失败，执行未写入正式需求");
      setPhase("failed");
    }
  };

  return <div className="space-y-5">
    <header className="flex items-start gap-3"><button type="button" onClick={onBack} className="mt-1 grid size-9 place-items-center rounded-lg border border-border"><ArrowLeft className="size-4" /></button><div><p className="text-xs font-medium text-primary">真实受控工作流</p><h1 className="mt-1 text-2xl font-semibold">需求提取 · {editableProject.name}</h1><p className="mt-1 text-sm text-muted-foreground">AI 只能生成 Draft；项目经理必须在需求中心人工接受、编辑接受或拒绝。</p></div></header>
    <section className="rounded-xl border border-border bg-card p-5"><h2 className="flex items-center gap-2 text-sm font-semibold"><FileText className="size-4 text-primary" />选择当前有效资料</h2><div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{documents.map((document) => { const checked = selected.includes(document.id); return <label key={document.id} className={`flex cursor-pointer gap-2 rounded-lg border p-3 ${checked ? "border-primary bg-primary/5" : "border-border"}`}><input type="checkbox" checked={checked} onChange={() => setSelected((current) => checked ? current.filter((id) => id !== document.id) : [...current, document.id])} className="mt-0.5 accent-primary" /><span className="min-w-0"><span className="block truncate text-xs font-medium">{document.displayName}</span><span className="mt-1 block text-[10px] text-muted-foreground">{document.visibility} · v{document.currentVersion?.versionNumber ?? "-"}</span></span></label>; })}</div><button type="button" disabled={phase === "loading" || phase === "running"} onClick={() => void run()} className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">{phase === "running" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}生成待审核草稿</button></section>
    {message ? <section role="status" className={`rounded-xl border p-5 ${phase === "failed" ? "border-destructive/20 bg-destructive-soft text-destructive" : "border-info/20 bg-info-soft text-info"}`}><div className="flex items-start gap-2">{phase === "completed" ? <CheckCircle2 className="mt-0.5 size-4" /> : null}<p className="text-sm">{message}</p></div>{phase === "completed" ? <button type="button" onClick={onOpenReviews} className="mt-3 rounded-lg border border-current px-3 py-1.5 text-xs font-medium">进入人工审核</button> : null}</section> : null}
  </div>;
}
