"use client";

import { useState } from "react";
import { mockAIExecutions, mockAIModelProfiles, mockAIModels, mockAIProviders, mockSkills } from "@/data/mock";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  Cloud,
  Coins,
  Cpu,
  Database,
  Eye,
  FileInput,
  Filter,
  Gauge,
  KeyRound,
  Network,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Wrench,
} from "lucide-react";
import { ProfileDetailDrawer } from "./profile-detail-drawer";
import type { AIExecutionView, AIModelProfileView, AIModelView, AIProviderView, SkillRelationView } from "./model-types";

type ModelsTab = "providers" | "models" | "profiles" | "relations" | "logs" | "cost";

interface AIModelsPageProps {
  initialProfileId?: string;
}

const tabs: { id: ModelsTab; label: string; icon: typeof Cloud }[] = [
  { id: "providers", label: "模型供应商", icon: Cloud },
  { id: "models", label: "模型注册中心", icon: Cpu },
  { id: "profiles", label: "Model Profiles", icon: Route },
  { id: "relations", label: "Skill 关联关系", icon: Network },
  { id: "logs", label: "调用日志", icon: TerminalSquare },
  { id: "cost", label: "用量与成本", icon: BarChart3 },
];

export function AIModelsPage({ initialProfileId }: AIModelsPageProps) {
  const providers = mockAIProviders as unknown as AIProviderView[];
  const models = mockAIModels as unknown as AIModelView[];
  const profiles = mockAIModelProfiles as unknown as AIModelProfileView[];
  const skills = mockSkills as unknown as SkillRelationView[];
  const executions = mockAIExecutions as unknown as AIExecutionView[];
  const initialProfile = profiles.find((profile) => profile.id === initialProfileId || profile.profileId === initialProfileId);
  const [tab, setTab] = useState<ModelsTab>(initialProfile ? "profiles" : "providers");
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(initialProfile?.id ?? null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId || profile.profileId === selectedProfileId);
  const totalCost = executions.reduce((sum, execution) => sum + execution.cost, 0);
  const totalTokens = executions.reduce((sum, execution) => sum + execution.totalTokens, 0);
  const successRate = executions.length ? executions.filter((execution) => execution.status === "completed").length / executions.length * 100 : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><Route className="size-3.5" /> 统一 AI Gateway 配置</div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI 模型管理</h1>
          <p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">只读查看供应商、模型注册、Model Profiles、Skill 路由关系及调用成本。</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 text-xs text-emerald-800"><ShieldCheck className="size-4" /> Secret 隔离已启用</div>
      </div>

      <section className="grid overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-2 xl:grid-cols-4">
        <TopMetric icon={Cloud} label="可用供应商" value={`${providers.filter((provider) => provider.status === "active").length}/${providers.length}`} detail="统一适配器" />
        <TopMetric icon={Route} label="Model Profiles" value={profiles.length} detail={`${skills.length} 项 Skill 关联`} />
        <TopMetric icon={CheckCircle2} label="调用成功率" value={`${successRate.toFixed(1)}%`} detail={`${executions.length} 次调用`} />
        <TopMetric icon={Coins} label="本期 Mock 成本" value={`$${totalCost.toFixed(2)}`} detail={`${formatCompact(totalTokens)} tokens`} />
      </section>

      <div className="overflow-x-auto border-b border-border">
        <nav className="flex min-w-max gap-1" aria-label="AI 模型管理分区">
          {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => { setTab(id); setSearch(""); setStatusFilter("all"); }} className={`inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-[11px] font-medium transition ${tab === id ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon className="size-3.5" />{label}<span className="rounded-full bg-muted px-1.5 py-0.5 text-[8px] text-muted-foreground">{tabCount(id, { providers, models, profiles, skills, executions })}</span></button>)}
        </nav>
      </div>

      <div>
        {tab === "providers" ? <ProvidersTab providers={providers} /> : null}
        {tab === "models" ? <ModelsRegistryTab models={models} providers={providers} search={search} onSearch={setSearch} statusFilter={statusFilter} onStatusFilter={setStatusFilter} /> : null}
        {tab === "profiles" ? <ProfilesTab profiles={profiles} models={models} skills={skills} search={search} onSearch={setSearch} onOpenProfile={(profile) => setSelectedProfileId(profile.id)} /> : null}
        {tab === "relations" ? <RelationsTab skills={skills} profiles={profiles} onOpenProfile={(profileId) => setSelectedProfileId(profiles.find((profile) => profile.id === profileId || profile.profileId === profileId)?.id ?? profileId)} /> : null}
        {tab === "logs" ? <LogsTab executions={executions} profiles={profiles} search={search} onSearch={setSearch} statusFilter={statusFilter} onStatusFilter={setStatusFilter} /> : null}
        {tab === "cost" ? <CostTab executions={executions} profiles={profiles} providers={providers} /> : null}
      </div>

      {selectedProfile ? <ProfileDetailDrawer profile={selectedProfile} models={models} skills={skills} executions={executions} onClose={() => setSelectedProfileId(null)} /> : null}
    </div>
  );
}

function ProvidersTab({ providers }: { providers: AIProviderView[] }) {
  return <div className="grid gap-4 lg:grid-cols-2">{providers.map((provider) => { const percent = provider.monthlyBudget ? provider.currentSpend / provider.monthlyBudget * 100 : 0; return <article key={provider.id} className="rounded-xl border border-border bg-card p-5"><div className="flex items-start justify-between gap-4"><div className="flex gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Cloud className="size-5" /></span><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-foreground">{provider.providerName}</h2><GenericStatus status={provider.status} /></div><p className="mt-1 text-[10px] text-muted-foreground">{provider.providerType} · {provider.region}</p></div></div><span className="rounded-md bg-muted px-2 py-1 text-[9px] text-muted-foreground">优先级 P{provider.priority}</span></div><dl className="mt-5 grid grid-cols-2 gap-3"><ProviderMeta label="Gateway URL" value={maskUrl(provider.baseUrl)} icon={Network} /><ProviderMeta label="Secret" value={provider.secretConfigured ? "已配置" : "未配置"} icon={KeyRound} tone={provider.secretConfigured ? "text-emerald-700" : "text-rose-700"} /><ProviderMeta label="超时" value={`${provider.timeout} ms`} icon={Clock3} /><ProviderMeta label="并发上限" value={`${provider.concurrencyLimit}`} icon={Gauge} /></dl><div className="mt-5"><div className="flex items-center justify-between text-[10px] text-muted-foreground"><span>月度预算</span><span>${provider.currentSpend.toFixed(0)} / ${provider.monthlyBudget.toFixed(0)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${percent > 85 ? "bg-rose-500" : percent > 65 ? "bg-amber-500" : "bg-primary"}`} style={{ width: `${Math.min(100, percent)}%` }} /></div></div></article>; })}</div>;
}

function ModelsRegistryTab({ models, providers, search, onSearch, statusFilter, onStatusFilter }: { models: AIModelView[]; providers: AIProviderView[]; search: string; onSearch: (value: string) => void; statusFilter: string; onStatusFilter: (value: string) => void }) {
  const filtered = models.filter((model) => `${model.displayName} ${model.modelId} ${model.providerModelName}`.toLowerCase().includes(search.toLowerCase()) && (statusFilter === "all" || model.status === statusFilter));
  const providerName = (id: string) => providers.find((provider) => provider.id === id || provider.providerId === id)?.providerName ?? id;
  return <DataSectionToolbar search={search} onSearch={onSearch} placeholder="搜索模型、注册 ID" statusFilter={statusFilter} onStatusFilter={onStatusFilter}><div className="overflow-x-auto"><table className="w-full text-left"><thead className="bg-muted/35 text-[9px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-2.5">注册模型</th><th className="px-3 py-2.5">供应商</th><th className="px-3 py-2.5">类型</th><th className="px-3 py-2.5">能力标签</th><th className="px-3 py-2.5">上下文</th><th className="px-3 py-2.5">质量 / 速度 / 成本</th><th className="px-3 py-2.5">状态</th></tr></thead><tbody>{filtered.map((model) => <tr key={model.id} className="border-b border-border hover:bg-muted/25"><td className="min-w-56 px-4 py-3"><p className="text-xs font-semibold text-foreground">{model.displayName}</p><p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{model.modelId}</p></td><td className="whitespace-nowrap px-3 py-3 text-[10px] text-muted-foreground">{providerName(model.providerId ?? model.provider)}</td><td className="px-3 py-3"><span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-foreground">{modelType(model.modelType)}</span></td><td className="min-w-52 px-3 py-3"><div className="flex flex-wrap gap-1">{model.capabilityTags.slice(0, 4).map((tag) => <CapabilityTag key={tag} tag={tag} />)}{model.capabilityTags.length > 4 ? <span className="text-[9px] text-muted-foreground">+{model.capabilityTags.length - 4}</span> : null}</div></td><td className="whitespace-nowrap px-3 py-3 text-[10px] text-foreground">{formatCompact(model.contextWindow)}</td><td className="whitespace-nowrap px-3 py-3"><LevelDots label="Q" value={model.qualityLevel} /><LevelDots label="S" value={model.speedLevel} /><LevelDots label="$" value={model.costLevel} /></td><td className="px-3 py-3"><GenericStatus status={model.status} /></td></tr>)}</tbody></table>{!filtered.length ? <p className="p-12 text-center text-xs text-muted-foreground">没有匹配的模型。</p> : null}</div></DataSectionToolbar>;
}

function ProfilesTab({ profiles, models, skills, search, onSearch, onOpenProfile }: { profiles: AIModelProfileView[]; models: AIModelView[]; skills: SkillRelationView[]; search: string; onSearch: (value: string) => void; onOpenProfile: (profile: AIModelProfileView) => void }) {
  const filtered = profiles.filter((profile) => `${profile.displayName} ${profile.profileId} ${profile.description}`.toLowerCase().includes(search.toLowerCase()));
  const modelName = (id: string) => models.find((model) => model.id === id || model.modelId === id)?.displayName ?? id;
  return <div className="space-y-4"><div className="relative max-w-sm"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索 Model Profile" className="h-9 w-full rounded-lg border border-border bg-card pl-8 pr-3 text-xs outline-none focus:border-primary" /></div><div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">{filtered.map((profile) => { const relatedCount = skills.filter((skill) => skill.modelProfileId === profile.profileId || skill.modelProfileId === profile.id || profile.relatedSkillIds.includes(skill.id) || profile.relatedSkillIds.includes(skill.name)).length; return <button key={profile.id} type="button" onClick={() => onOpenProfile(profile)} className="group rounded-xl border border-border bg-card p-4 text-left transition hover:border-primary/35 hover:shadow-sm"><div className="flex items-start justify-between gap-3"><span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Route className="size-4" /></span><GenericStatus status={profile.status} /></div><h2 className="mt-3 text-sm font-semibold text-foreground">{profile.displayName}</h2><p className="mt-1 font-mono text-[9px] text-primary">{profile.profileId}</p><p className="mt-2 line-clamp-2 min-h-10 text-[10px] leading-5 text-muted-foreground">{profile.description}</p><div className="mt-4 space-y-2 border-t border-border pt-3"><RouteLine label="Primary" value={modelName(profile.primaryModelId)} /><RouteLine label="Fallback" value={modelName(profile.fallbackModelId)} /></div><div className="mt-3 flex items-center justify-between"><span className="text-[9px] text-muted-foreground">{relatedCount} 项 Skill · 上限 ${profile.costLimit.toFixed(3)}</span><ArrowRight className="size-3.5 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-primary" /></div></button>; })}</div></div>;
}

function RelationsTab({ skills, profiles, onOpenProfile }: { skills: SkillRelationView[]; profiles: AIModelProfileView[]; onOpenProfile: (profileId: string) => void }) {
  const profileName = (id: string) => profiles.find((profile) => profile.id === id || profile.profileId === id)?.displayName ?? id;
  return <div className="overflow-hidden rounded-xl border border-border bg-card"><div className="border-b border-border p-4"><h2 className="text-sm font-semibold text-foreground">Skill → Model Profile 路由</h2><p className="mt-1 text-[10px] text-muted-foreground">业务能力只关联 Profile，供应商选择由 AI Gateway 完成。</p></div><div className="overflow-x-auto"><table className="w-full text-left"><thead className="bg-muted/35 text-[9px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-2.5">Skill</th><th className="px-3 py-2.5">模块</th><th className="px-3 py-2.5">Primary Profile</th><th className="px-3 py-2.5">Fallback Profile</th><th className="px-3 py-2.5">人工审核</th><th className="px-3 py-2.5">状态</th></tr></thead><tbody>{skills.map((skill) => <tr key={skill.id} className="border-b border-border hover:bg-muted/25"><td className="min-w-56 px-4 py-3"><p className="text-xs font-medium text-foreground">{skill.displayName}</p><p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{skill.name}</p></td><td className="px-3 py-3 text-[10px] text-muted-foreground">{skill.module}</td><td className="px-3 py-3"><button type="button" onClick={() => onOpenProfile(skill.modelProfileId)} className="rounded-md bg-primary/[0.06] px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/10">{profileName(skill.modelProfileId)}</button></td><td className="px-3 py-3"><button type="button" onClick={() => onOpenProfile(skill.fallbackModelProfileId)} className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground">{profileName(skill.fallbackModelProfileId)}</button></td><td className="px-3 py-3">{skill.approvalRequired ? <span className="inline-flex items-center gap-1 text-[10px] text-amber-700"><ShieldCheck className="size-3" />是</span> : <span className="text-[10px] text-muted-foreground">否</span>}</td><td className="px-3 py-3"><GenericStatus status={skill.status} /></td></tr>)}</tbody></table></div></div>;
}

function LogsTab({ executions, profiles, search, onSearch, statusFilter, onStatusFilter }: { executions: AIExecutionView[]; profiles: AIModelProfileView[]; search: string; onSearch: (value: string) => void; statusFilter: string; onStatusFilter: (value: string) => void }) {
  const filtered = executions.filter((execution) => `${execution.executionId} ${execution.skillId ?? ""} ${execution.modelProfileId}`.toLowerCase().includes(search.toLowerCase()) && (statusFilter === "all" || execution.status === statusFilter));
  const profileName = (id: string) => profiles.find((profile) => profile.id === id || profile.profileId === id)?.displayName ?? id;
  return <DataSectionToolbar search={search} onSearch={onSearch} placeholder="搜索执行 ID、Skill 或 Profile" statusFilter={statusFilter} onStatusFilter={onStatusFilter}><div className="overflow-x-auto"><table className="w-full text-left"><thead className="bg-muted/35 text-[9px] uppercase tracking-wide text-muted-foreground"><tr><th className="px-4 py-2.5">执行 ID</th><th className="px-3 py-2.5">Skill</th><th className="px-3 py-2.5">Model Profile</th><th className="px-3 py-2.5">状态</th><th className="px-3 py-2.5">耗时</th><th className="px-3 py-2.5">Token</th><th className="px-3 py-2.5">重试</th><th className="px-3 py-2.5">成本</th><th className="px-3 py-2.5">开始时间</th></tr></thead><tbody>{filtered.map((execution) => <tr key={execution.id} className="border-b border-border hover:bg-muted/25"><td className="px-4 py-3 font-mono text-[10px] text-foreground">{execution.executionId}</td><td className="px-3 py-3 text-[10px] text-muted-foreground">{execution.skillId ?? "—"}</td><td className="whitespace-nowrap px-3 py-3 text-[10px] text-foreground">{profileName(execution.modelProfileId)}</td><td className="px-3 py-3"><ExecutionStatus status={execution.status} /></td><td className="px-3 py-3 text-[10px] text-muted-foreground">{(execution.durationMs / 1000).toFixed(1)}s</td><td className="px-3 py-3 text-[10px] tabular-nums text-muted-foreground">{formatCompact(execution.totalTokens)}</td><td className="px-3 py-3 text-[10px] text-muted-foreground">{execution.retryCount}</td><td className="px-3 py-3 text-[10px] font-medium text-foreground">${execution.cost.toFixed(4)}</td><td className="whitespace-nowrap px-3 py-3 text-[9px] text-muted-foreground">{formatDateTime(execution.startedAt)}</td></tr>)}</tbody></table>{!filtered.length ? <p className="p-12 text-center text-xs text-muted-foreground">没有匹配的调用日志。</p> : null}</div></DataSectionToolbar>;
}

function CostTab({ executions, profiles, providers }: { executions: AIExecutionView[]; profiles: AIModelProfileView[]; providers: AIProviderView[] }) {
  const byProfile = profiles.map((profile) => ({ id: profile.id, label: profile.displayName, value: executions.filter((item) => item.modelProfileId === profile.id || item.modelProfileId === profile.profileId).reduce((sum, item) => sum + item.cost, 0) })).sort((a, b) => b.value - a.value);
  const byProvider = providers.map((provider) => ({ id: provider.id, label: provider.providerName, value: executions.filter((item) => item.providerId === provider.id || item.providerId === provider.providerId).reduce((sum, item) => sum + item.cost, 0) })).sort((a, b) => b.value - a.value);
  const maxProfile = Math.max(...byProfile.map((item) => item.value), 0.01);
  const total = executions.reduce((sum, item) => sum + item.cost, 0);
  return <div className="space-y-4"><section className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-3"><CostMetric label="本期总成本" value={`$${total.toFixed(3)}`} detail="Mock 计费口径" icon={CircleDollarSign} /><CostMetric label="平均单次成本" value={`$${(total / Math.max(1, executions.length)).toFixed(4)}`} detail={`${executions.length} 次调用`} icon={Coins} /><CostMetric label="累计用量" value={formatCompact(executions.reduce((sum, item) => sum + item.totalTokens, 0))} detail="tokens" icon={Activity} /></section><div className="grid gap-4 lg:grid-cols-[1.4fr_0.6fr]"><section className="rounded-xl border border-border bg-card p-5"><div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-foreground">Profile 成本分布</h2><span className="text-[9px] text-muted-foreground">当前 Mock 周期</span></div><div className="mt-5 space-y-3">{byProfile.map((item) => <div key={item.id} className="grid grid-cols-[140px_1fr_54px] items-center gap-3"><span className="truncate text-[10px] text-muted-foreground">{item.label}</span><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${item.value / maxProfile * 100}%` }} /></div><span className="text-right text-[10px] font-medium text-foreground">${item.value.toFixed(3)}</span></div>)}</div></section><section className="rounded-xl border border-border bg-card p-5"><h2 className="text-sm font-semibold text-foreground">供应商成本</h2><div className="mt-4 space-y-3">{byProvider.map((item, index) => <div key={item.id} className="flex items-center gap-3"><span className={`flex size-7 items-center justify-center rounded-md text-[10px] font-semibold ${index === 0 ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-[10px] font-medium text-foreground">{item.label}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{total ? (item.value / total * 100).toFixed(1) : "0"}%</p></div><span className="text-[10px] font-semibold text-foreground">${item.value.toFixed(3)}</span></div>)}</div></section></div><div className="rounded-lg border border-amber-500/20 bg-amber-500/[0.045] p-3 text-[10px] leading-5 text-amber-800"><p className="flex items-center gap-1.5 font-semibold"><AlertTriangle className="size-3" /> 成本说明</p><p className="mt-1">当前数据为 Mock AI Gateway 模拟结果，仅用于产品演示；未来接入真实模型后按 Provider Adapter 返回用量统一核算。</p></div></div>;
}

function DataSectionToolbar({ search, onSearch, placeholder, statusFilter, onStatusFilter, children }: { search: string; onSearch: (value: string) => void; placeholder: string; statusFilter: string; onStatusFilter: (value: string) => void; children: React.ReactNode }) { return <section className="overflow-hidden rounded-xl border border-border bg-card"><div className="flex flex-wrap items-center gap-2 border-b border-border p-3"><div className="relative min-w-64 flex-1 sm:max-w-sm"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={placeholder} className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary" /></div><label className="relative"><Filter className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /><select aria-label="状态筛选" value={statusFilter} onChange={(event) => onStatusFilter(event.target.value)} className="h-8 appearance-none rounded-lg border border-border bg-background pl-7 pr-7 text-[10px] text-foreground outline-none"><option value="all">全部状态</option><option value="active">已启用</option><option value="completed">成功</option><option value="failed">失败</option><option value="inactive">已停用</option></select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /></label></div>{children}</section>; }
function ProviderMeta({ label, value, icon: Icon, tone = "text-foreground" }: { label: string; value: string; icon: typeof Network; tone?: string }) { return <div><dt className="flex items-center gap-1 text-[9px] text-muted-foreground"><Icon className="size-2.5" />{label}</dt><dd className={`mt-1 truncate text-[10px] font-medium ${tone}`}>{value}</dd></div>; }
function TopMetric({ icon: Icon, label, value, detail }: { icon: typeof Cloud; label: string; value: string | number; detail: string }) { return <div className="flex items-center gap-3 border-b border-r border-border p-4 last:border-r-0 sm:border-b-0"><span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span><div><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold text-foreground">{value}<span className="ml-2 text-[9px] font-normal text-muted-foreground">{detail}</span></p></div></div>; }
function CostMetric({ icon: Icon, label, value, detail }: { icon: typeof Coins; label: string; value: string; detail: string }) { return <div className="flex items-center gap-3 bg-card p-5"><span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-4" /></span><div><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold text-foreground">{value}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{detail}</p></div></div>; }
function RouteLine({ label, value }: { label: string; value: string }) { return <div className="flex items-center gap-2 text-[9px]"><span className="w-12 text-muted-foreground">{label}</span><span className="size-1 rounded-full bg-primary" /><span className="truncate font-medium text-foreground">{value}</span></div>; }
function CapabilityTag({ tag }: { tag: string }) { const icons: Record<string, typeof Eye> = { vision: Eye, fileInput: FileInput, structuredOutput: Database, toolCalling: Wrench, text: Sparkles }; const Icon = icons[tag] ?? Boxes; return <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[8px] text-muted-foreground"><Icon className="size-2" />{tag}</span>; }
function LevelDots({ label, value }: { label: string; value: string | number }) { const level = typeof value === "number" ? value : ({ low: 1, medium: 2, high: 3, premium: 3, fast: 3, standard: 2 }[value] ?? 2); return <div className="mb-0.5 flex items-center gap-1"><span className="w-3 text-[8px] text-muted-foreground">{label}</span>{[1, 2, 3].map((item) => <span key={item} className={`size-1 rounded-full ${item <= level ? "bg-primary" : "bg-border"}`} />)}</div>; }
function GenericStatus({ status }: { status: string }) { const active = ["active", "available"].includes(status); return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium ${active ? "bg-emerald-500/10 text-emerald-700" : status === "degraded" ? "bg-amber-500/10 text-amber-700" : "bg-muted text-muted-foreground"}`}><span className={`size-1 rounded-full ${active ? "bg-emerald-500" : "bg-muted-foreground"}`} />{active ? "已启用" : status}</span>; }
function ExecutionStatus({ status }: { status: string }) { const success = status === "completed"; return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium ${success ? "bg-emerald-500/10 text-emerald-700" : status === "failed" ? "bg-rose-500/10 text-rose-700" : "bg-amber-500/10 text-amber-700"}`}>{success ? <CheckCircle2 className="size-2.5" /> : status === "failed" ? <AlertTriangle className="size-2.5" /> : <RefreshCw className="size-2.5" />}{success ? "成功" : status === "failed" ? "失败" : status}</span>; }
function tabCount(tab: ModelsTab, data: { providers: AIProviderView[]; models: AIModelView[]; profiles: AIModelProfileView[]; skills: SkillRelationView[]; executions: AIExecutionView[] }) { return tab === "providers" ? data.providers.length : tab === "models" ? data.models.length : tab === "profiles" ? data.profiles.length : tab === "relations" ? data.skills.length : tab === "logs" ? data.executions.length : "$"; }
function modelType(type: string) { const labels: Record<string, string> = { chat: "对话", reasoning: "推理", embedding: "向量", reranker: "重排", vision: "视觉", image: "图像" }; return labels[type] ?? type; }
function maskUrl(url: string) { try { const parsed = new URL(url); return `${parsed.protocol}//${parsed.host}/•••`; } catch { return url ? "已配置端点" : "—"; } }
function formatCompact(value: number) { return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
