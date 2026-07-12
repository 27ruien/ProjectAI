"use client";

import { useMemo, useState } from "react";
import { mockRequirements, mockScopeChanges, mockScopeVersions } from "@/data/mock";
import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileDiff,
  FileText,
  Flag,
  GitCompareArrows,
  History,
  Milestone,
  Minus,
  Plus,
  ShieldAlert,
} from "lucide-react";
import { DiffPanel, type DiffItem } from "@/components/review/diff-panel";

type ScopeRecord = {
  id: string;
  projectId: string;
  version: string | number;
  name: string;
  status: string;
  summary: string;
  requirementIds: string[];
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  effectiveFrom?: string;
  supersedes?: string;
};

type ScopeChangeRecord = {
  id: string;
  fromScopeVersionId: string;
  toScopeVersionId: string;
  type: "added" | "removed" | "modified" | "pending" | string;
  title: string;
  description: string;
  impactDays: number;
  requirementIds: string[];
  status: string;
};

type RequirementRecord = { id: string; requirementId?: string; title?: string; description?: string; content?: string };

interface ScopePageProps {
  projectId?: string;
}

export function ScopePage({ projectId }: ScopePageProps) {
  const allScopes = mockScopeVersions as unknown as ScopeRecord[];
  const scopes = useMemo(() => projectId ? allScopes.filter((scope) => scope.projectId === projectId) : allScopes, [allScopes, projectId]);
  const changes = mockScopeChanges as unknown as ScopeChangeRecord[];
  const requirements = mockRequirements as unknown as RequirementRecord[];
  const sorted = useMemo(() => [...scopes].sort((a, b) => Number(b.version) - Number(a.version)), [scopes]);
  const [newVersionId, setNewVersionId] = useState(sorted.find((item) => item.status === "active")?.id ?? sorted[0]?.id ?? "");
  const [oldVersionId, setOldVersionId] = useState(
    sorted.find((item) => item.id !== (sorted.find((entry) => entry.status === "active")?.id ?? sorted[0]?.id))?.id ?? "",
  );
  const [tab, setTab] = useState<"compare" | "impact">("compare");

  const effectiveNewVersionId = scopes.some((item) => item.id === newVersionId) ? newVersionId : (scopes.find((item) => item.status === "active") ?? scopes[0])?.id ?? "";
  const effectiveOldVersionId = scopes.some((item) => item.id === oldVersionId && item.id !== effectiveNewVersionId) ? oldVersionId : scopes.find((item) => item.id !== effectiveNewVersionId)?.id ?? effectiveNewVersionId;
  const oldVersion = scopes.find((item) => item.id === effectiveOldVersionId) ?? scopes[0];
  const newVersion = scopes.find((item) => item.id === effectiveNewVersionId) ?? scopes[1] ?? scopes[0];
  const relevantChanges = useMemo(() => {
    const exact = changes.filter(
      (change) => change.fromScopeVersionId === oldVersion?.id && change.toScopeVersionId === newVersion?.id,
    );
    return exact.length ? exact : changes.filter((change) => change.toScopeVersionId === newVersion?.id);
  }, [changes, newVersion?.id, oldVersion?.id]);

  const requirementById = (id: string) => requirements.find((item) => item.id === id || item.requirementId === id);
  const diffItems = useMemo<DiffItem[]>(() => {
    if (!oldVersion || !newVersion) return [];
    const ids = Array.from(new Set([...oldVersion.requirementIds, ...newVersion.requirementIds]));
    return ids.slice(0, 8).map((id) => {
      const requirement = requirementById(id);
      const change = relevantChanges.find((item) => item.requirementIds?.includes(id));
      const inOld = oldVersion.requirementIds.includes(id);
      const inNew = newVersion.requirementIds.includes(id);
      const type: DiffItem["type"] = !inOld ? "added" : !inNew ? "removed" : change?.type === "modified" ? "modified" : "unchanged";
      const title = requirement?.title ?? requirement?.description ?? id;
      return {
        id,
        label: requirement?.requirementId ?? id,
        type,
        before: inOld ? title : undefined,
        after: inNew ? (type === "modified" && change?.description ? `${title} · ${change.description}` : title) : undefined,
      };
    });
  // requirementById is a local lookup over the immutable mock collection.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newVersion, oldVersion, relevantChanges, requirements]);

  const impact = useMemo(() => {
    const count = (type: string) => relevantChanges.filter((change) => change.type === type).length;
    const positiveDays = relevantChanges.filter((change) => change.impactDays > 0).reduce((sum, item) => sum + item.impactDays, 0);
    const negativeDays = Math.abs(relevantChanges.filter((change) => change.impactDays < 0).reduce((sum, item) => sum + item.impactDays, 0));
    return { added: count("added"), removed: count("removed"), modified: count("modified"), pending: count("pending"), positiveDays, negativeDays };
  }, [relevantChanges]);

  if (!oldVersion || !newVersion) {
    return <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center text-sm text-muted-foreground">暂无 Scope 版本数据</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><GitCompareArrows className="size-3.5" /> 版本化项目边界</div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Scope 管理</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">对比当前有效 Scope 与历史版本，评估变更对交付计划的影响。</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-xs text-emerald-800">
          <CheckCircle2 className="size-4" /> 当前有效：{sorted.find((item) => item.status === "active")?.name ?? newVersion.name}
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[230px_minmax(0,1fr)]">
        <aside className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="flex items-center gap-2 text-xs font-semibold text-foreground"><History className="size-3.5" /> 版本历史</h2>
          </div>
          <div className="divide-y divide-border">
            {sorted.map((scope) => (
              <button
                key={scope.id}
                type="button"
                onClick={() => {
                  if (scope.id !== newVersionId) setOldVersionId(scope.id);
                }}
                className={`w-full px-4 py-3.5 text-left transition ${effectiveOldVersionId === scope.id ? "bg-primary/[0.06] shadow-[inset_3px_0_var(--primary)]" : "hover:bg-muted/40"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground">v{scope.version}</span>
                  <ScopeStatus status={scope.status} />
                </div>
                <p className="mt-1.5 line-clamp-1 text-[11px] font-medium text-foreground">{scope.name}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{formatDate(scope.createdAt)} · {scope.createdBy}</p>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-w-0 space-y-4">
          <section className="rounded-xl border border-border bg-card p-4">
            <div className="grid items-end gap-3 md:grid-cols-[1fr_36px_1fr_auto]">
              <VersionSelect label="对比基线" value={effectiveOldVersionId} onChange={setOldVersionId} scopes={scopes.filter((item) => item.id !== effectiveNewVersionId)} />
              <div className="hidden h-9 items-center justify-center text-muted-foreground md:flex"><ArrowRight className="size-4" /></div>
              <VersionSelect label="目标版本" value={effectiveNewVersionId} onChange={setNewVersionId} scopes={scopes.filter((item) => item.id !== effectiveOldVersionId)} />
              <div className="flex h-9 items-center gap-1 rounded-lg bg-muted p-1">
                <button type="button" onClick={() => setTab("compare")} className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium ${tab === "compare" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><FileDiff className="size-3" /> 差异</button>
                <button type="button" onClick={() => setTab("impact")} className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium ${tab === "impact" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><ShieldAlert className="size-3" /> 影响</button>
              </div>
            </div>
            <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
              <VersionMeta version={oldVersion} />
              <VersionMeta version={newVersion} />
            </div>
          </section>

          {tab === "compare" ? (
            <section className="rounded-xl border border-border bg-card p-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">需求范围差异</h2>
                  <p className="mt-1 text-[11px] text-muted-foreground">仅显示版本边界中的结构化需求变化。</p>
                </div>
                <div className="flex flex-wrap gap-2 text-[9px]">
                  <Legend color="bg-emerald-500" label="新增" />
                  <Legend color="bg-rose-500" label="删除" />
                  <Legend color="bg-amber-500" label="修改" />
                  <Legend color="bg-violet-400" label="待确认" />
                </div>
              </div>
              <DiffPanel items={diffItems} />
            </section>
          ) : (
            <ImpactPanel impact={impact} changes={relevantChanges} />
          )}
        </main>
      </div>
    </div>
  );
}

function ImpactPanel({ impact, changes }: { impact: { added: number; removed: number; modified: number; pending: number; positiveDays: number; negativeDays: number }; changes: ScopeChangeRecord[] }) {
  const launchAffected = impact.positiveDays - impact.negativeDays >= 5;
  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card md:grid-cols-3 xl:grid-cols-6">
        <ImpactMetric label="新增需求" value={impact.added} icon={Plus} tone="text-emerald-700" />
        <ImpactMetric label="删除需求" value={impact.removed} icon={Minus} tone="text-rose-700" />
        <ImpactMetric label="修改需求" value={impact.modified} icon={FileDiff} tone="text-amber-700" />
        <ImpactMetric label="待确认" value={impact.pending} icon={CircleHelp} tone="text-violet-700" />
        <ImpactMetric label="预计增加" value={`${impact.positiveDays} 人日`} icon={CalendarClock} tone="text-foreground" />
        <ImpactMetric label="预计减少" value={`${impact.negativeDays} 人日`} icon={Clock3} tone="text-foreground" />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Flag className="size-4 text-primary" /> 交付影响</h3>
          <div className="mt-4 space-y-3">
            <ImpactRow icon={Milestone} label="影响任务" value={`${Math.max(changes.length * 2, 3)} 项任务需要调整`} />
            <ImpactRow icon={Flag} label="影响里程碑" value={launchAffected ? "UAT 验收与上线准备" : "不影响关键里程碑"} />
            <ImpactRow icon={CalendarClock} label="上线日期" value={launchAffected ? "存在延期风险，建议预留 1 周" : "当前计划可维持"} warning={launchAffected} />
          </div>
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldAlert className="size-4 text-amber-600" /> AI 风险建议</h3>
          <div className="mt-4 space-y-2">
            {(changes.length ? changes : [{ id: "fallback", title: "确认新增范围的验收责任人", description: "在进入开发前补齐验收口径与优先级。" } as ScopeChangeRecord]).slice(0, 3).map((change) => (
              <div key={change.id} className="rounded-lg border border-border bg-muted/25 p-3">
                <p className="text-xs font-medium text-foreground">{change.title}</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{change.description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function VersionSelect({ label, value, onChange, scopes }: { label: string; value: string; onChange: (value: string) => void; scopes: ScopeRecord[] }) {
  return (
    <label>
      <span className="mb-1.5 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="relative block">
        <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-xs font-medium text-foreground outline-none focus:border-primary">
          {scopes.map((scope) => <option key={scope.id} value={scope.id}>v{scope.version} · {scope.name}</option>)}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      </span>
    </label>
  );
}

function VersionMeta({ version }: { version: ScopeRecord }) {
  return (
    <div className="rounded-lg bg-muted/35 p-3">
      <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-foreground">v{version.version} · {version.name}</p><ScopeStatus status={version.status} /></div>
      <p className="mt-1.5 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{version.summary}</p>
      <p className="mt-2 flex items-center gap-1 text-[9px] text-muted-foreground"><FileText className="size-2.5" /> {version.requirementIds.length} 条需求 · {version.sourceIds.length} 个来源</p>
    </div>
  );
}

function ScopeStatus({ status }: { status: string }) {
  const styles: Record<string, [string, string]> = {
    active: ["当前有效", "bg-emerald-500/10 text-emerald-700"], approved: ["已批准", "bg-sky-500/10 text-sky-700"], pendingReview: ["待审核", "bg-amber-500/10 text-amber-700"], draft: ["草稿", "bg-muted text-muted-foreground"], superseded: ["已替代", "bg-slate-500/10 text-slate-600"], rejected: ["已驳回", "bg-destructive/10 text-destructive"],
  };
  const [label, className] = styles[status] ?? [status, "bg-muted text-muted-foreground"];
  return <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${className}`}>{label}</span>;
}

function ImpactMetric({ label, value, icon: Icon, tone }: { label: string; value: string | number; icon: typeof Plus; tone: string }) {
  return (
    <div className="border-b border-r border-border p-4 last:border-r-0 md:border-b-0">
      <p className="flex items-center gap-1 text-[10px] text-muted-foreground"><Icon className="size-3" /> {label}</p>
      <p className={`mt-2 text-lg font-semibold ${tone}`}>{value}</p>
    </div>
  );
}

function ImpactRow({ icon: Icon, label, value, warning = false }: { icon: typeof Milestone; label: string; value: string; warning?: boolean }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <span className={`flex size-8 items-center justify-center rounded-lg ${warning ? "bg-amber-500/10 text-amber-700" : "bg-muted text-muted-foreground"}`}><Icon className="size-4" /></span>
      <div><p className="text-[10px] text-muted-foreground">{label}</p><p className={`mt-0.5 text-xs font-medium ${warning ? "text-amber-800" : "text-foreground"}`}>{value}</p></div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) { return <span className="flex items-center gap-1"><span className={`size-1.5 rounded-full ${color}`} />{label}</span>; }

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
