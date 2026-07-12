"use client";

import { useEffect, useMemo, useState } from "react";
import { mockAIExecutions, mockAIModelProfiles, mockSkills } from "@/data/mock";
import {
  Activity,
  ArrowRight,
  Braces,
  Check,
  CheckCircle2,
  ChevronDown,
  Coins,
  FileCheck2,
  Filter,
  GitBranch,
  History,
  Info,
  Layers3,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Wrench,
  X,
  XCircle,
} from "lucide-react";
import { ModelProfileBadge } from "./model-profile-badge";

type SkillRecord = {
  id: string;
  name: string;
  displayName: string;
  version: string;
  owner: string;
  module: string;
  status: string;
  description: string;
  useCases: string[];
  excludedUseCases: string[];
  inputSchema: unknown;
  outputSchema: unknown;
  steps: Array<string | { id: string; name: string; description: string; order: number }>;
  validators: Array<string | { id: string; name: string; description: string; type?: string }>;
  modelProfileId: string;
  fallbackModelProfileId: string;
  approvalRequired: boolean;
  averageDurationMs: number;
  averageCost: number;
  usageCount: number;
  approvalRate: number;
  manualEditRate: number;
  createdAt: string;
  updatedAt: string;
};

type ProfileRecord = { id: string; profileId: string; displayName: string; description: string };
type ExecutionRecord = { id: string; executionId?: string; skillId?: string; status: string; durationMs: number; cost: number; createdAt: string; modelProfileId?: string };

interface SkillsPageProps {
  initialSkillId?: string;
}

export function SkillsPage({ initialSkillId }: SkillsPageProps) {
  const skills = mockSkills as unknown as SkillRecord[];
  const profiles = mockAIModelProfiles as unknown as ProfileRecord[];
  const executions = mockAIExecutions as unknown as ExecutionRecord[];
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(() => skills.find((skill) => skill.id === initialSkillId || skill.name === initialSkillId)?.id ?? null);
  const [drawerTab, setDrawerTab] = useState<"overview" | "schema" | "history">("overview");

  const filtered = useMemo(() => skills.filter((skill) => `${skill.displayName} ${skill.name} ${skill.description}`.toLowerCase().includes(search.toLowerCase()) && (moduleFilter === "all" || skill.module === moduleFilter) && (statusFilter === "all" || skill.status === statusFilter)), [moduleFilter, search, skills, statusFilter]);
  const selected = skills.find((skill) => skill.id === selectedId);

  useEffect(() => {
    if (!selected) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") setSelectedId(null); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [selected]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><Sparkles className="size-3.5" /> 标准 AI 能力</div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Skills</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">只读查看每项 AI 能力的契约、模型档案、验收规则与实际运行表现。</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-emerald-600" /><strong className="text-foreground">{skills.filter((skill) => skill.approvalRequired).length}</strong> 项需要人工审核</div>
      </div>

      <section className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 xl:grid-cols-4">
        <SkillMetric icon={Layers3} label="已注册 Skills" value={skills.length} detail={`${skills.filter((skill) => skill.status === "active").length} 项启用`} />
        <SkillMetric icon={Activity} label="累计调用" value={skills.reduce((sum, skill) => sum + skill.usageCount, 0)} detail="统一 Gateway" />
        <SkillMetric icon={CheckCircle2} label="平均通过率" value={`${average(skills.map((skill) => normalizePercent(skill.approvalRate))).toFixed(0)}%`} detail="人工审核后" />
        <SkillMetric icon={Coins} label="平均成本" value={`$${average(skills.map((skill) => skill.averageCost)).toFixed(3)}`} detail="Mock 口径" />
      </section>

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-64 flex-1 sm:max-w-sm"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 Skill 名称、ID 或用途" className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary" /></div>
          <SkillSelect label="模块" value={moduleFilter} onChange={setModuleFilter}><option value="all">全部模块</option>{Array.from(new Set(skills.map((skill) => skill.module))).map((module) => <option key={module} value={module}>{skillModule(module)}</option>)}</SkillSelect>
          <SkillSelect label="状态" value={statusFilter} onChange={setStatusFilter}><option value="all">全部状态</option><option value="active">已启用</option><option value="draft">草稿</option><option value="deprecated">已弃用</option></SkillSelect>
          <span className="ml-auto text-[10px] text-muted-foreground">{filtered.length} / {skills.length}</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="bg-muted/35 text-[9px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-2.5">Skill</th><th className="px-3 py-2.5">模块 / 版本</th><th className="px-3 py-2.5">Model Profile</th><th className="px-3 py-2.5">使用次数</th><th className="px-3 py-2.5">产出通过率</th><th className="px-3 py-2.5">人工修改率</th><th className="px-3 py-2.5">平均耗时</th><th className="px-3 py-2.5">状态</th><th /></tr></thead>
            <tbody>
              {filtered.map((skill) => (
                <tr key={skill.id} onClick={() => { setSelectedId(skill.id); setDrawerTab("overview"); }} className="group cursor-pointer border-b border-border transition hover:bg-muted/30">
                  <td className="min-w-64 px-4 py-3"><div className="flex items-start gap-2.5"><span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Wrench className="size-4" /></span><div><p className="text-xs font-semibold text-foreground">{skill.displayName}</p><p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{skill.name || skill.id}</p></div></div></td>
                  <td className="whitespace-nowrap px-3 py-3"><p className="text-[10px] text-foreground">{skillModule(skill.module)}</p><p className="mt-0.5 text-[9px] text-muted-foreground">v{skill.version}</p></td>
                  <td className="px-3 py-3"><ModelProfileBadge profileId={skill.modelProfileId} /></td>
                  <td className="px-3 py-3 text-xs font-medium tabular-nums text-foreground">{skill.usageCount.toLocaleString()}</td>
                  <td className="px-3 py-3"><RateBar value={normalizePercent(skill.approvalRate)} tone="bg-emerald-500" /></td>
                  <td className="px-3 py-3"><RateBar value={normalizePercent(skill.manualEditRate)} tone="bg-amber-500" /></td>
                  <td className="whitespace-nowrap px-3 py-3 text-[10px] text-muted-foreground">{formatDuration(skill.averageDurationMs)}</td>
                  <td className="px-3 py-3"><SkillStatus status={skill.status} /></td>
                  <td className="px-3 py-3"><ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!filtered.length ? <div className="p-12 text-center text-xs text-muted-foreground">没有匹配的 Skill。</div> : null}
        </div>
      </section>

      {selected ? <SkillDrawer skill={selected} profile={profiles.find((profile) => profile.id === selected.modelProfileId || profile.profileId === selected.modelProfileId)} fallbackProfile={profiles.find((profile) => profile.id === selected.fallbackModelProfileId || profile.profileId === selected.fallbackModelProfileId)} executions={executions.filter((execution) => execution.skillId === selected.id || execution.skillId === selected.name)} tab={drawerTab} onTabChange={setDrawerTab} onClose={() => setSelectedId(null)} /> : null}
    </div>
  );
}

function SkillDrawer({ skill, profile, fallbackProfile, executions, tab, onTabChange, onClose }: { skill: SkillRecord; profile?: ProfileRecord; fallbackProfile?: ProfileRecord; executions: ExecutionRecord[]; tab: "overview" | "schema" | "history"; onTabChange: (tab: "overview" | "schema" | "history") => void; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-foreground/25 backdrop-blur-[1px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><aside className="flex h-full w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl"><header className="border-b border-border p-5"><div className="flex items-start justify-between gap-4"><div className="flex items-start gap-3"><span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Wrench className="size-5" /></span><div><div className="flex items-center gap-2"><h2 className="text-base font-semibold text-foreground">{skill.displayName}</h2><SkillStatus status={skill.status} /></div><p className="mt-1 font-mono text-[10px] text-muted-foreground">{skill.name} · v{skill.version}</p></div></div><button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button></div><div className="mt-4 flex gap-1 rounded-lg bg-muted/55 p-1"><DrawerTab active={tab === "overview"} onClick={() => onTabChange("overview")} icon={Info}>能力说明</DrawerTab><DrawerTab active={tab === "schema"} onClick={() => onTabChange("schema")} icon={Braces}>输入 / 输出</DrawerTab><DrawerTab active={tab === "history"} onClick={() => onTabChange("history")} icon={History}>版本与执行</DrawerTab></div></header><div className="min-h-0 flex-1 overflow-auto p-5">{tab === "overview" ? <SkillOverview skill={skill} profile={profile} fallbackProfile={fallbackProfile} /> : tab === "schema" ? <SkillSchema skill={skill} /> : <SkillHistory skill={skill} executions={executions} />}</div></aside></div>;
}

function SkillOverview({ skill, profile, fallbackProfile }: { skill: SkillRecord; profile?: ProfileRecord; fallbackProfile?: ProfileRecord }) {
  return <div className="space-y-5"><section><h3 className="text-xs font-semibold text-foreground">用途</h3><p className="mt-2 text-xs leading-6 text-muted-foreground">{skill.description}</p></section><div className="grid gap-4 sm:grid-cols-2"><ListBlock title="适用场景" icon={Check} items={skill.useCases} tone="text-emerald-700" /><ListBlock title="不适用场景" icon={XCircle} items={skill.excludedUseCases} tone="text-rose-700" /></div><section className="rounded-xl border border-border p-4"><h3 className="flex items-center gap-2 text-xs font-semibold text-foreground"><TerminalSquare className="size-3.5 text-primary" /> 执行步骤</h3><ol className="mt-3 space-y-2">{skill.steps.map((step, index) => <li key={typeof step === "string" ? `${step}-${index}` : step.id} className="flex gap-3"><span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">{index + 1}</span><span className="pt-0.5 text-[11px] leading-4 text-foreground/80">{typeof step === "string" ? step : step.description || step.name}</span></li>)}</ol></section><section className="rounded-xl border border-border p-4"><div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-xs font-semibold text-foreground"><FileCheck2 className="size-3.5 text-emerald-600" /> 验收规则</h3>{skill.approvalRequired ? <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-700"><ShieldCheck className="size-2.5" />需要人工审核</span> : null}</div><ul className="mt-3 space-y-2">{skill.validators.map((validator, index) => <li key={typeof validator === "string" ? `${validator}-${index}` : validator.id} className="flex gap-2 text-[11px] leading-4 text-muted-foreground"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-emerald-600" />{typeof validator === "string" ? validator : validator.description || validator.name}</li>)}</ul></section><div className="grid gap-3 sm:grid-cols-2"><ProfileCard label="Model Profile" id={skill.modelProfileId} profile={profile} /><ProfileCard label="备用 Profile" id={skill.fallbackModelProfileId} profile={fallbackProfile} /></div></div>;
}

function SkillSchema({ skill }: { skill: SkillRecord }) { return <div className="space-y-5"><SchemaBlock title="Input Schema" schema={skill.inputSchema} /><SchemaBlock title="Output Schema" schema={skill.outputSchema} /><div className="rounded-lg border border-primary/15 bg-primary/[0.035] p-3 text-[11px] leading-5 text-muted-foreground"><p className="flex items-center gap-1.5 font-medium text-primary"><GitBranch className="size-3" /> 扩展约定</p><p className="mt-1">Skill 仅保存 Model Profile 标识，不直接引用供应商或模型名称；结构化输出由 AI Gateway 统一校验。</p></div></div>; }

function SkillHistory({ skill, executions }: { skill: SkillRecord; executions: ExecutionRecord[] }) { return <div className="space-y-5"><section className="rounded-xl border border-border p-4"><h3 className="flex items-center gap-2 text-xs font-semibold text-foreground"><History className="size-3.5" /> 版本历史</h3><div className="mt-3 space-y-3">{[{ version: skill.version, date: skill.updatedAt, current: true }, { version: previousVersion(skill.version), date: skill.createdAt, current: false }].map((entry) => <div key={entry.version} className="flex items-center gap-3"><span className={`size-2 rounded-full ${entry.current ? "bg-primary" : "bg-border"}`} /><div className="flex-1"><p className="text-[11px] font-medium text-foreground">v{entry.version}{entry.current ? " · 当前版本" : ""}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{formatDate(entry.date)} · {skill.owner}</p></div>{entry.current ? <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-700">生效中</span> : null}</div>)}</div></section><section><div className="mb-3 flex items-center justify-between"><h3 className="flex items-center gap-2 text-xs font-semibold text-foreground"><Activity className="size-3.5" /> Mock 执行记录</h3><span className="text-[9px] text-muted-foreground">最近 {executions.length} 次</span></div><div className="overflow-hidden rounded-xl border border-border"><table className="w-full text-left"><thead className="bg-muted/35 text-[9px] text-muted-foreground"><tr><th className="px-3 py-2">执行 ID</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">耗时</th><th className="px-3 py-2">成本</th><th className="px-3 py-2">时间</th></tr></thead><tbody>{executions.slice(0, 8).map((execution) => <tr key={execution.id} className="border-t border-border text-[10px]"><td className="px-3 py-2.5 font-mono text-foreground">{execution.executionId ?? execution.id}</td><td className="px-3 py-2.5"><span className={execution.status === "completed" ? "text-emerald-700" : "text-amber-700"}>{execution.status === "completed" ? "成功" : execution.status}</span></td><td className="px-3 py-2.5 text-muted-foreground">{formatDuration(execution.durationMs)}</td><td className="px-3 py-2.5 text-muted-foreground">${execution.cost.toFixed(4)}</td><td className="px-3 py-2.5 text-muted-foreground">{formatDate(execution.createdAt)}</td></tr>)}</tbody></table>{!executions.length ? <p className="p-8 text-center text-xs text-muted-foreground">暂无执行记录。</p> : null}</div></section></div>; }

function ListBlock({ title, icon: Icon, items, tone }: { title: string; icon: typeof Check; items: string[]; tone: string }) { return <section className="rounded-xl border border-border p-4"><h3 className={`flex items-center gap-1.5 text-xs font-semibold ${tone}`}><Icon className="size-3.5" />{title}</h3><ul className="mt-3 space-y-2">{items.map((item, index) => <li key={`${item}-${index}`} className="text-[11px] leading-5 text-muted-foreground">• {item}</li>)}</ul></section>; }
function ProfileCard({ label, id, profile }: { label: string; id: string; profile?: ProfileRecord }) { return <div className="rounded-xl border border-border p-3"><p className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</p><div className="mt-2"><ModelProfileBadge profileId={id} /></div><p className="mt-2 line-clamp-2 text-[10px] leading-4 text-muted-foreground">{profile?.description ?? "由统一 Model Router 根据策略选择模型。"}</p></div>; }
function SchemaBlock({ title, schema }: { title: string; schema: unknown }) { return <section><h3 className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground"><Braces className="size-3.5 text-primary" />{title}</h3><pre className="max-h-72 overflow-auto rounded-xl border border-border bg-foreground p-4 font-mono text-[10px] leading-5 text-background/80">{typeof schema === "string" ? schema : JSON.stringify(schema, null, 2)}</pre></section>; }
function DrawerTab({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Info; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-[10px] font-medium ${active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}><Icon className="size-3" />{children}</button>; }
function SkillMetric({ icon: Icon, label, value, detail }: { icon: typeof Layers3; label: string; value: string | number; detail: string }) { return <div className="flex items-center gap-3 border-b border-r border-border p-4 last:border-r-0 sm:border-b-0"><span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span><div><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold text-foreground">{typeof value === "number" ? value.toLocaleString() : value}<span className="ml-2 text-[9px] font-normal text-muted-foreground">{detail}</span></p></div></div>; }
function SkillSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) { return <label className="relative"><span className="sr-only">{label}</span><Filter className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /><select value={value} onChange={(event) => onChange(event.target.value)} className="h-8 appearance-none rounded-lg border border-border bg-background pl-7 pr-7 text-[10px] text-foreground outline-none">{children}</select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /></label>; }
function RateBar({ value, tone }: { value: number; tone: string }) { return <div className="flex min-w-20 items-center gap-2"><div className="h-1.5 w-12 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.min(100, value)}%` }} /></div><span className="text-[10px] tabular-nums text-foreground">{value.toFixed(0)}%</span></div>; }
function SkillStatus({ status }: { status: string }) { const style = status === "active" ? "bg-emerald-500/10 text-emerald-700" : status === "deprecated" ? "bg-rose-500/10 text-rose-700" : "bg-muted text-muted-foreground"; return <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${style}`}>{status === "active" ? "已启用" : status === "deprecated" ? "已弃用" : "草稿"}</span>; }
function skillModule(module: string) { const labels: Record<string, string> = { document: "文档处理", requirement: "需求管理", scope: "Scope 管理", action: "Action Plan", meeting: "会议与决策", risk: "风险管理", reporting: "项目报告", knowledge: "知识问答" }; return labels[module] ?? module; }
function normalizePercent(value: number) { return value <= 1 ? value * 100 : value; }
function average(values: number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }
function formatDuration(value: number) { return value >= 60_000 ? `${(value / 60_000).toFixed(1)} 分` : `${(value / 1000).toFixed(1)} 秒`; }
function formatDate(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date); }
function previousVersion(version: string) { const parts = version.split(".").map(Number); if (!parts.every(Number.isFinite)) return "1.0.0"; parts[parts.length - 1] = Math.max(0, parts[parts.length - 1] - 1); return parts.join("."); }
