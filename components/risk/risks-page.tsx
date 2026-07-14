"use client";

import { useEffect, useMemo, useState } from "react";
import type { AuthorizedProjectSummary, ProjectMockPayload } from "@/lib/auth/ui-types";
import {
  Activity,
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  ClipboardCheck,
  ExternalLink,
  Filter,
  Lightbulb,
  Link2,
  Search,
  ShieldAlert,
  Sparkles,
  TrendingDown,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { RiskBadge, riskLevelConfig } from "./risk-badge";

type RiskRecord = {
  id: string;
  projectId: string;
  riskId: string;
  name: string;
  level: string;
  type: string;
  impact: string;
  evidence: string;
  recommendedAction: string;
  owner: string;
  dueDate: string;
  status: string;
  source: string;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
};

type ActionRecord = { id: string; riskIds: string[]; status: string };

const riskStatusConfig: Record<string, { label: string; style: string }> = {
  open: { label: "待处理", style: "bg-rose-500/10 text-rose-700" },
  monitoring: { label: "监控中", style: "bg-amber-500/10 text-amber-700" },
  resolved: { label: "已解决", style: "bg-emerald-500/10 text-emerald-700" },
  accepted: { label: "已接受", style: "bg-sky-500/10 text-sky-700" },
  closed: { label: "已关闭", style: "bg-muted text-muted-foreground" },
};

interface RisksPageProps {
  project: AuthorizedProjectSummary;
  data: ProjectMockPayload;
}

export function RisksPage({ project, data }: RisksPageProps) {
  const sourceRisks = data.risks as unknown as RiskRecord[];
  const actions = data.actions as unknown as ActionRecord[];
  const canEdit = project.permissions.canEditProject;
  const [risks, setRisks] = useState(sourceRisks);
  const [selectedId, setSelectedId] = useState(sourceRisks[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [feedback, setFeedback] = useState<string | null>(null);

  const scopedRisks = risks;
  const filtered = useMemo(
    () => scopedRisks.filter((risk) => {
      const active = !["resolved", "closed"].includes(risk.status);
      return `${risk.riskId} ${risk.name} ${risk.owner}`.toLowerCase().includes(search.toLowerCase()) && (levelFilter === "all" || risk.level === levelFilter) && (statusFilter === "all" || statusFilter === "active" && active || risk.status === statusFilter);
    }),
    [levelFilter, scopedRisks, search, statusFilter],
  );
  const selected = scopedRisks.find((risk) => risk.id === selectedId) ?? filtered[0] ?? scopedRisks[0];
  const activeRisks = scopedRisks.filter((risk) => !["resolved", "closed"].includes(risk.status));
  const healthScore = Math.max(35, 100 - activeRisks.reduce((score, risk) => score + ({ low: 3, medium: 7, high: 14, critical: 25 }[risk.level] ?? 5), 0));
  const criticalCount = activeRisks.filter((risk) => ["high", "critical"].includes(risk.level)).length;
  const blockedActions = actions.filter((action) => action.status === "blocked" || action.riskIds?.some((id) => activeRisks.some((risk) => risk.id === id || risk.riskId === id))).length;
  const projectName = () => project.name;

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const updateStatus = (id: string, status: string) => {
    setRisks((current) => current.map((risk) => risk.id === id ? { ...risk, status, updatedAt: new Date().toISOString() } : risk));
    setFeedback(`风险状态已更新为「${riskStatusConfig[status]?.label ?? status}」`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><ShieldAlert className="size-3.5" /> 项目健康雷达</div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">风险与状态</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">从项目证据中识别风险，由项目经理确认处置建议与责任人。</p>
        </div>
        {canEdit ? <button type="button" onClick={() => setFeedback("AI 风险分析已刷新，未直接修改正式风险记录")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3.5 text-sm font-medium text-primary hover:bg-primary/10"><Sparkles className="size-4" /> 刷新 AI 风险分析</button> : null}
      </div>

      <section className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_1fr]">
        <div className="flex items-center gap-4 bg-card p-5">
          <HealthRing score={healthScore} />
          <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">项目组合健康度</p><p className="mt-1 text-sm font-semibold text-foreground">{healthScore >= 80 ? "健康" : healthScore >= 60 ? "需要关注" : "存在风险"}</p><p className="mt-1 text-[10px] text-muted-foreground">较上周 {healthScore >= 70 ? "+3" : "-4"} 分</p></div>
        </div>
        <HealthMetric icon={AlertOctagon} label="高风险项目" value={criticalCount} detail="需要决策" tone="text-rose-700" />
        <HealthMetric icon={CircleDot} label="阻塞事项" value={blockedActions} detail="关联 Action" tone="text-amber-700" />
        <HealthMetric icon={ClipboardCheck} label="待决策事项" value={activeRisks.filter((risk) => risk.status === "open").length} detail="本周处理" tone="text-primary" />
      </section>

      <section className="rounded-xl border border-primary/15 bg-primary/[0.025] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Sparkles className="size-4" /></span><div><p className="text-xs font-semibold text-foreground">AI 下一步建议</p><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">{activeRisks[0]?.recommendedAction ?? "当前未发现需要立即处理的高优先级风险，建议继续监控里程碑与待确认事项。"}</p></div></div>
          {activeRisks[0] ? <button type="button" onClick={() => setSelectedId(activeRisks[0].id)} className="inline-flex items-center gap-1 text-[10px] font-medium text-primary">查看风险 <ArrowRight className="size-3" /></button> : null}
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(330px,0.6fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <div className="relative min-w-52 flex-1"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索风险、ID 或负责人" className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary" /></div>
            <RiskSelect label="等级" value={levelFilter} onChange={setLevelFilter}><option value="all">全部等级</option>{Object.entries(riskLevelConfig).map(([level, config]) => <option key={level} value={level}>{config.label}风险</option>)}</RiskSelect>
            <RiskSelect label="状态" value={statusFilter} onChange={setStatusFilter}><option value="active">处理中</option><option value="all">全部状态</option>{Object.entries(riskStatusConfig).map(([status, config]) => <option key={status} value={status}>{config.label}</option>)}</RiskSelect>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-muted/35 text-[9px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-2.5">风险</th><th className="px-3 py-2.5">等级</th><th className="px-3 py-2.5">项目</th><th className="px-3 py-2.5">负责人</th><th className="px-3 py-2.5">截止时间</th><th className="px-3 py-2.5">状态</th></tr></thead>
              <tbody>
                {filtered.map((risk) => <tr key={risk.id} onClick={() => setSelectedId(risk.id)} className={`cursor-pointer border-b border-border transition hover:bg-muted/30 ${selected?.id === risk.id ? "bg-primary/[0.045]" : ""}`}><td className="min-w-64 px-4 py-3"><p className="line-clamp-1 text-xs font-medium text-foreground">{risk.name}</p><p className="mt-1 font-mono text-[9px] text-muted-foreground">{risk.riskId} · {riskType(risk.type)}</p></td><td className="px-3 py-3"><RiskBadge level={risk.level} /></td><td className="whitespace-nowrap px-3 py-3 text-[10px] text-muted-foreground">{projectName()}</td><td className="whitespace-nowrap px-3 py-3 text-[10px] text-foreground">{risk.owner}</td><td className="whitespace-nowrap px-3 py-3 text-[10px] text-muted-foreground">{formatDate(risk.dueDate)}</td><td className="px-3 py-3">{canEdit ? <select aria-label={`${risk.riskId} 状态`} onClick={(event) => event.stopPropagation()} value={risk.status} onChange={(event) => updateStatus(risk.id, event.target.value)} className={`h-7 rounded-full border-0 px-2 text-[9px] font-medium outline-none ${riskStatusConfig[risk.status]?.style ?? "bg-muted text-muted-foreground"}`}>{Object.entries(riskStatusConfig).map(([value, config]) => <option key={value} value={value}>{config.label}</option>)}</select> : <span className={`inline-flex h-7 items-center rounded-full px-2 text-[9px] font-medium ${riskStatusConfig[risk.status]?.style ?? "bg-muted text-muted-foreground"}`}>{riskStatusConfig[risk.status]?.label ?? risk.status}</span>}</td></tr>)}
              </tbody>
            </table>
            {!filtered.length ? <div className="p-12 text-center text-xs text-muted-foreground">当前筛选下没有风险。</div> : null}
          </div>
        </section>

        {selected ? <RiskDetail risk={selected} projectName={projectName()} relatedActions={actions.filter((action) => action.riskIds?.includes(selected.id) || action.riskIds?.includes(selected.riskId)).length} readOnly={!canEdit} onStatusChange={(status) => updateStatus(selected.id, status)} /> : null}
      </div>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Activity className="size-4 text-primary" /> 最近风险变化</h2><span className="text-[10px] text-muted-foreground">按更新时间排序</span></div>
        <div className="grid gap-3 md:grid-cols-3">{[...scopedRisks].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()).slice(0, 3).map((risk, index) => <button key={risk.id} type="button" onClick={() => setSelectedId(risk.id)} className="rounded-lg border border-border p-3 text-left hover:border-primary/30"><div className="flex items-center justify-between"><RiskBadge level={risk.level} /><span className="flex items-center gap-1 text-[9px] text-muted-foreground">{index === 0 ? <TrendingUp className="size-3 text-rose-600" /> : <TrendingDown className="size-3 text-emerald-600" />}{formatDate(risk.updatedAt)}</span></div><p className="mt-2 line-clamp-1 text-xs font-medium text-foreground">{risk.name}</p><p className="mt-1 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{risk.recommendedAction}</p></button>)}</div>
      </section>

      {feedback ? <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-xs text-foreground shadow-xl"><CheckCircle2 className="size-4 text-emerald-600" />{feedback}</div> : null}
    </div>
  );
}

function RiskDetail({ risk, projectName, relatedActions, readOnly, onStatusChange }: { risk: RiskRecord; projectName: string; relatedActions: number; readOnly: boolean; onStatusChange: (status: string) => void }) {
  return <aside className="self-start rounded-xl border border-border bg-card"><div className="border-b border-border p-4"><div className="flex items-start justify-between gap-3"><RiskBadge level={risk.level} /><span className="font-mono text-[9px] text-muted-foreground">{risk.riskId}</span></div><h2 className="mt-3 text-sm font-semibold leading-6 text-foreground">{risk.name}</h2><p className="mt-1 text-[10px] text-muted-foreground">{projectName} · {riskType(risk.type)}</p></div><div className="space-y-4 p-4"><DetailBlock icon={AlertTriangle} label="影响范围" content={risk.impact} /><DetailBlock icon={Link2} label="证据" content={risk.evidence} /><div className="rounded-lg border border-primary/15 bg-primary/[0.035] p-3"><p className="flex items-center gap-1.5 text-[10px] font-semibold text-primary"><Lightbulb className="size-3" /> 建议动作</p><p className="mt-2 text-[11px] leading-5 text-foreground/80">{risk.recommendedAction}</p></div><div className="grid grid-cols-2 gap-2"><DetailMeta icon={UserRound} label="负责人" value={risk.owner} /><DetailMeta icon={CalendarClock} label="截止时间" value={formatDate(risk.dueDate)} /><DetailMeta icon={ExternalLink} label="关联来源" value={`${risk.sourceIds.length} 项`} /><DetailMeta icon={ClipboardCheck} label="关联 Action" value={`${relatedActions} 项`} /></div><label><span className="mb-1.5 block text-[10px] font-medium text-muted-foreground">处置状态</span>{readOnly ? <span className={`inline-flex h-9 w-full items-center rounded-lg px-3 text-xs font-medium ${riskStatusConfig[risk.status]?.style ?? "bg-muted text-muted-foreground"}`}>{riskStatusConfig[risk.status]?.label ?? risk.status}</span> : <select value={risk.status} onChange={(event) => onStatusChange(event.target.value)} className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none">{Object.entries(riskStatusConfig).map(([status, config]) => <option key={status} value={status}>{config.label}</option>)}</select>}</label></div></aside>;
}

function HealthRing({ score }: { score: number }) { return <div className="relative flex size-16 shrink-0 items-center justify-center rounded-full" style={{ background: `conic-gradient(var(--primary) ${score * 3.6}deg, var(--muted) 0deg)` }}><div className="absolute inset-1.5 rounded-full bg-card" /><div className="relative text-center"><span className="text-lg font-semibold text-foreground">{score}</span><span className="block text-[7px] text-muted-foreground">/ 100</span></div></div>; }

function HealthMetric({ icon: Icon, label, value, detail, tone }: { icon: typeof AlertTriangle; label: string; value: number; detail: string; tone: string }) { return <div className="flex items-center gap-3 bg-card p-5"><span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span><div><p className="text-[10px] text-muted-foreground">{label}</p><p className={`mt-0.5 text-lg font-semibold ${tone}`}>{value}<span className="ml-2 text-[9px] font-normal text-muted-foreground">{detail}</span></p></div></div>; }

function RiskSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) { return <label className="relative"><span className="sr-only">{label}</span><Filter className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /><select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 appearance-none rounded-lg border border-border bg-background pl-7 pr-7 text-[10px] text-foreground outline-none">{children}</select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /></label>; }

function DetailBlock({ icon: Icon, label, content }: { icon: typeof AlertTriangle; label: string; content: string }) { return <div><p className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground"><Icon className="size-3" />{label}</p><p className="mt-1.5 text-[11px] leading-5 text-foreground/80">{content}</p></div>; }
function DetailMeta({ icon: Icon, label, value }: { icon: typeof UserRound; label: string; value: string }) { return <div className="rounded-lg bg-muted/35 p-2.5"><p className="flex items-center gap-1 text-[9px] text-muted-foreground"><Icon className="size-2.5" />{label}</p><p className="mt-1 text-[10px] font-medium text-foreground">{value}</p></div>; }
function riskType(type: string) { const labels: Record<string, string> = { schedule: "进度", scope: "范围", technical: "技术", resource: "资源", dependency: "依赖", quality: "质量", communication: "沟通", commercial: "商务" }; return labels[type] ?? type; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date); }
