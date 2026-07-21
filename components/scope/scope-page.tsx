"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, FileDiff, LoaderCircle, Plus, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import type { AuthorizedProjectSummary, ProjectMockPayload } from "@/lib/auth/ui-types";
import { projectManagementMutation, projectManagementRequest } from "@/lib/project-management/client";

type Requirement = { id: string; code: string; title: string; description: string };
type ScopeVersion = {
  id: string;
  name: string;
  versionNumber: number;
  status: string;
  requirementSnapshot: Array<{ id: string; code: string; title: string; sourceIds: string[] }>;
  removalDeclarations: string[];
  createdAt: string;
};
type DiffType = "added" | "removed" | "modified" | "unchanged" | "potentially_out_of_scope" | "not_mentioned" | "ambiguous";
type DiffItem = {
  id: string;
  comparisonRunId: string;
  diffType: DiffType;
  title: string;
  explanation: string;
  baselineCitation: { requirementId?: string; sourceIds?: string[] } | null;
  candidateCitation: { requirementId?: string; sourceIds?: string[] } | null;
  confidenceBps: number;
  reviewStatus: "pending" | "confirmed" | "dismissed";
  reviewerNote: string;
};
type ScopePayload = { versions: ScopeVersion[]; runs: Array<{ id: string; baselineVersionId: string; candidateVersionId: string }>; items: DiffItem[] };

const labels: Record<DiffType, string> = {
  added: "新增",
  removed: "明确删除",
  modified: "修改",
  unchanged: "未变化",
  potentially_out_of_scope: "可能超范围",
  not_mentioned: "未提及",
  ambiguous: "有歧义",
};

const tones: Record<DiffType, string> = {
  added: "bg-success/10 text-success",
  removed: "bg-destructive/10 text-destructive",
  modified: "bg-warning/10 text-warning",
  unchanged: "bg-muted text-muted-foreground",
  potentially_out_of_scope: "bg-violet-500/10 text-violet-700",
  not_mentioned: "bg-info/10 text-info",
  ambiguous: "bg-amber-500/10 text-amber-700",
};

export function ScopePage({ project }: { project: AuthorizedProjectSummary; data: ProjectMockPayload }) {
  const [scope, setScope] = useState<ScopePayload>({ versions: [], runs: [], items: [] });
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [includedIds, setIncludedIds] = useState<string[]>([]);
  const [explicitRemovalIds, setExplicitRemovalIds] = useState<string[]>([]);
  const [ambiguousIds, setAmbiguousIds] = useState<string[]>([]);
  const [outOfScopeIds, setOutOfScopeIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [candidateId, setCandidateId] = useState("");
  const [filter, setFilter] = useState<"all" | DiffType>("all");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<"loading" | "ready" | "working" | "error">("loading");
  const [feedback, setFeedback] = useState<string | null>(null);

  const load = useCallback(async () => {
    setPhase("loading");
    try {
      const [scopePayload, requirementPayload] = await Promise.all([
        projectManagementRequest<ScopePayload>(`/api/projects/${encodeURIComponent(project.id)}/scope`),
        projectManagementRequest<{ requirements: Requirement[] }>(`/api/projects/${encodeURIComponent(project.id)}/requirements`),
      ]);
      setScope(scopePayload);
      setRequirements(requirementPayload.requirements);
      setIncludedIds((current) => current.length ? current : requirementPayload.requirements.map((item) => item.id));
      setBaselineId((current) => current || scopePayload.versions[1]?.id || scopePayload.versions[0]?.id || "");
      setCandidateId((current) => current || scopePayload.versions[0]?.id || "");
      setPhase("ready");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Scope 数据加载失败");
      setPhase("error");
    }
  }, [project.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeRun = scope.runs.find((run) => run.baselineVersionId === baselineId && run.candidateVersionId === candidateId) ?? scope.runs[0];
  const items = useMemo(() => scope.items.filter((item) => (!activeRun || item.comparisonRunId === activeRun.id) && (filter === "all" || item.diffType === filter)), [activeRun, filter, scope.items]);

  const createVersion = async () => {
    if (name.trim().length < 2) return setFeedback("请输入 Scope 版本名称");
    setPhase("working");
    try {
      await projectManagementMutation(`/api/projects/${encodeURIComponent(project.id)}/scope`, "POST", {
        name,
        includedRequirementIds: includedIds,
        removalDeclarations: explicitRemovalIds,
        ambiguousRequirementIds: ambiguousIds,
        outOfScopeRequirementIds: outOfScopeIds,
      });
      setName("");
      setFeedback("Scope 版本已保存。未提及与明确删除保持独立。 ");
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Scope 版本创建失败");
      setPhase("ready");
    }
  };

  const compare = async () => {
    if (!baselineId || !candidateId || baselineId === candidateId) return setFeedback("请选择两个不同 Scope 版本");
    setPhase("working");
    try {
      await projectManagementMutation(`/api/projects/${encodeURIComponent(project.id)}/scope/comparisons`, "POST", { baselineVersionId: baselineId, candidateVersionId: candidateId });
      setFeedback("Scope 差异已生成，所有结论等待人工确认。 ");
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Scope 对比失败");
      setPhase("ready");
    }
  };

  const review = async (item: DiffItem, status: "confirmed" | "dismissed") => {
    setPhase("working");
    try {
      await projectManagementMutation(`/api/projects/${encodeURIComponent(project.id)}/scope/items/${encodeURIComponent(item.id)}/review`, "POST", { status, note: notes[item.id] ?? "" });
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "审核失败");
      setPhase("ready");
    }
  };

  if (phase === "loading") return <div className="grid min-h-72 place-items-center rounded-xl border border-border bg-card"><LoaderCircle className="size-6 animate-spin text-primary" /></div>;

  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><p className="flex items-center gap-1.5 text-xs font-medium text-primary"><ShieldAlert className="size-3.5" /> 版本化边界与人工确认</p><h1 className="mt-1 text-2xl font-semibold">Scope 对比</h1><p className="mt-1 text-sm text-muted-foreground">未提及不会自动判定为删除；只有候选版本明确声明后才显示“明确删除”。</p></div><button onClick={() => void load()} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs"><RefreshCw className="size-3.5" />刷新</button></header>
    {feedback ? <div role="status" className="rounded-lg border border-info/20 bg-info-soft px-4 py-3 text-sm text-info">{feedback}</div> : null}

    <section className="rounded-xl border border-border bg-card p-5"><div className="flex flex-wrap items-end gap-3"><label className="min-w-64 flex-1"><span className="mb-1 block text-[11px] text-muted-foreground">新版本名称</span><input value={name} onChange={(event) => setName(event.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm" placeholder="例如：客户确认版 2026-07" /></label><button disabled={!project.permissions.canEditProject || phase === "working"} onClick={() => void createVersion()} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-50"><Plus className="size-3.5" />保存候选版本</button></div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{requirements.map((item) => {
        const included = includedIds.includes(item.id);
        return <div key={item.id} className="rounded-lg border border-border p-3"><label className="flex items-start gap-2"><input type="checkbox" checked={included} className="mt-0.5 accent-primary" onChange={() => { setIncludedIds((current) => included ? current.filter((id) => id !== item.id) : [...current, item.id]); if (included) setExplicitRemovalIds((current) => current.filter((id) => id !== item.id)); }} /><span className="min-w-0"><span className="block text-xs font-medium">{item.code} · {item.title}</span><span className="mt-1 line-clamp-2 block text-[10px] text-muted-foreground">{item.description}</span></span></label><div className="mt-2 flex flex-wrap gap-2 text-[10px]">{!included ? <label><input type="checkbox" checked={explicitRemovalIds.includes(item.id)} onChange={() => setExplicitRemovalIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /> 明确删除</label> : <><label><input type="checkbox" checked={ambiguousIds.includes(item.id)} onChange={() => setAmbiguousIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /> 有歧义</label><label><input type="checkbox" checked={outOfScopeIds.includes(item.id)} onChange={() => setOutOfScopeIds((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /> 可能超范围</label></>}</div></div>;
      })}</div>
    </section>

    <section className="rounded-xl border border-border bg-card p-5"><div className="grid items-end gap-3 md:grid-cols-[1fr_1fr_auto]"><VersionSelect label="Baseline" value={baselineId} versions={scope.versions} onChange={setBaselineId} /><VersionSelect label="Candidate" value={candidateId} versions={scope.versions} onChange={setCandidateId} /><button disabled={phase === "working"} onClick={() => void compare()} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-foreground px-4 text-xs font-medium text-background"><FileDiff className="size-3.5" />开始对比</button></div></section>

    <section className="rounded-xl border border-border bg-card"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4"><div><h2 className="text-sm font-semibold">差异审核</h2><p className="mt-1 text-[11px] text-muted-foreground">引用只返回当前仍有权的来源；撤权后来源标识同步移除。</p></div><select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="h-8 rounded-lg border border-input bg-background px-3 text-xs"><option value="all">全部类型</option>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div><div className="divide-y divide-border">{items.map((item) => <article key={item.id} className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_240px]"><div><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tones[item.diffType]}`}>{labels[item.diffType]}</span><h3 className="text-sm font-semibold">{item.title}</h3><span className="text-[10px] text-muted-foreground">置信度 {Math.round(item.confidenceBps / 100)}%</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.explanation}</p><p className="mt-2 text-[10px] text-primary">Baseline 来源 {item.baselineCitation?.sourceIds?.length ?? 0} · Candidate 来源 {item.candidateCitation?.sourceIds?.length ?? 0}</p></div><div><textarea rows={2} value={notes[item.id] ?? item.reviewerNote} onChange={(event) => setNotes((current) => ({ ...current, [item.id]: event.target.value }))} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-xs" placeholder="人工备注" /><div className="mt-2 flex gap-2"><button onClick={() => void review(item, "confirmed")} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-success/30 py-2 text-xs text-success"><CheckCircle2 className="size-3.5" />确认</button><button onClick={() => void review(item, "dismissed")} className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-destructive/30 py-2 text-xs text-destructive"><XCircle className="size-3.5" />驳回</button></div></div></article>)}{!items.length ? <p className="p-8 text-center text-sm text-muted-foreground">暂无该类型差异。</p> : null}</div></section>
  </div>;
}

function VersionSelect({ label, value, versions, onChange }: { label: string; value: string; versions: ScopeVersion[]; onChange: (value: string) => void }) {
  return <label><span className="mb-1 block text-[11px] text-muted-foreground">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-lg border border-input bg-background px-3 text-xs"><option value="">请选择</option>{versions.map((version) => <option key={version.id} value={version.id}>v{version.versionNumber} · {version.name}</option>)}</select></label>;
}

export default ScopePage;
