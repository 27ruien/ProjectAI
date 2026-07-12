"use client";

import { useEffect } from "react";
import {
  ArrowRight,
  Braces,
  CheckCircle2,
  Clock3,
  Coins,
  Cpu,
  GitBranch,
  RefreshCw,
  Route,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
  Zap,
} from "lucide-react";
import type { AIExecutionView, AIModelProfileView, AIModelView, SkillRelationView } from "./model-types";

interface ProfileDetailDrawerProps {
  profile: AIModelProfileView;
  models: AIModelView[];
  skills: SkillRelationView[];
  executions: AIExecutionView[];
  onClose: () => void;
}

export function ProfileDetailDrawer({ profile, models, skills, executions, onClose }: ProfileDetailDrawerProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const primary = models.find((model) => model.id === profile.primaryModelId || model.modelId === profile.primaryModelId);
  const fallback = models.find((model) => model.id === profile.fallbackModelId || model.modelId === profile.fallbackModelId);
  const related = skills.filter((skill) => profile.relatedSkillIds.includes(skill.id) || profile.relatedSkillIds.includes(skill.name) || skill.modelProfileId === profile.profileId || skill.modelProfileId === profile.id);
  const relatedExecutions = executions.filter((execution) => execution.modelProfileId === profile.id || execution.modelProfileId === profile.profileId);
  const totalCost = relatedExecutions.reduce((sum, execution) => sum + execution.cost, 0);

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-foreground/25 backdrop-blur-[1px]" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <aside className="flex h-full w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl">
        <header className="border-b border-border p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Route className="size-5" /></span>
              <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-foreground">{profile.displayName}</h2><ProfileStatus status={profile.status} /></div><p className="mt-1 font-mono text-[10px] text-muted-foreground">{profile.profileId}</p></div>
            </div>
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
          </div>
          <p className="mt-4 text-xs leading-5 text-muted-foreground">{profile.description}</p>
        </header>

        <div className="min-h-0 flex-1 space-y-5 overflow-auto p-5">
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniMetric icon={Wrench} label="关联 Skills" value={String(related.length)} />
            <MiniMetric icon={Zap} label="调用次数" value={String(relatedExecutions.length)} />
            <MiniMetric icon={Clock3} label="平均耗时" value={relatedExecutions.length ? `${(relatedExecutions.reduce((sum, item) => sum + item.durationMs, 0) / relatedExecutions.length / 1000).toFixed(1)}s` : "—"} />
            <MiniMetric icon={Coins} label="累计成本" value={`$${totalCost.toFixed(3)}`} />
          </section>

          <section className="rounded-xl border border-border p-4">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground"><GitBranch className="size-3.5 text-primary" /> 模型路由</h3>
            <div className="mt-4 grid items-center gap-2 sm:grid-cols-[1fr_28px_1fr]">
              <ModelRouteCard label="Primary" model={primary} modelId={profile.primaryModelId} />
              <ArrowRight className="mx-auto size-4 rotate-90 text-muted-foreground sm:rotate-0" />
              <ModelRouteCard label="Fallback" model={fallback} modelId={profile.fallbackModelId} />
            </div>
            <p className="mt-3 flex items-center gap-1.5 text-[9px] text-muted-foreground"><RefreshCw className="size-2.5" /> Primary 超时或失败时，Model Router 最多重试 {profile.retryCount} 次后切换备用模型。</p>
          </section>

          <section className="rounded-xl border border-border p-4">
            <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground"><Cpu className="size-3.5 text-primary" /> 调用参数</h3>
            <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg bg-border sm:grid-cols-3">
              <ConfigCell label="Temperature" value={String(profile.temperature)} />
              <ConfigCell label="Max output" value={profile.maxOutputTokens.toLocaleString()} />
              <ConfigCell label="Timeout" value={`${profile.timeoutSeconds}s`} />
              <ConfigCell label="成本上限" value={`$${profile.costLimit.toFixed(3)}`} />
              <ConfigCell label="重试次数" value={String(profile.retryCount)} />
              <ConfigCell label="输出模式" value={profile.structuredOutput ? "结构化" : "文本"} />
            </dl>
            <div className="mt-3 flex flex-wrap gap-2">
              <Capability enabled={profile.structuredOutput} icon={Braces} label="Structured output" />
              <Capability enabled={profile.toolCalling} icon={Wrench} label="Tool calling" />
              <Capability enabled={profile.visionRequired} icon={Sparkles} label="Vision required" />
            </div>
          </section>

          <section className="rounded-xl border border-border p-4">
            <div className="flex items-center justify-between"><h3 className="flex items-center gap-2 text-xs font-semibold text-foreground"><Wrench className="size-3.5 text-primary" /> 关联 Skills</h3><span className="text-[9px] text-muted-foreground">业务层仅引用 Profile ID</span></div>
            <div className="mt-3 divide-y divide-border">
              {related.map((skill) => <div key={skill.id} className="flex items-center justify-between gap-3 py-2.5"><div><p className="text-[11px] font-medium text-foreground">{skill.displayName}</p><p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{skill.name}</p></div><div className="flex items-center gap-2">{skill.approvalRequired ? <span className="flex items-center gap-1 text-[9px] text-amber-700"><ShieldCheck className="size-2.5" />人工审核</span> : null}<span className="rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{skill.module}</span></div></div>)}
              {!related.length ? <p className="py-6 text-center text-xs text-muted-foreground">暂无关联 Skill。</p> : null}
            </div>
          </section>

          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/[0.045] p-3 text-[10px] leading-5 text-emerald-800"><p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="size-3" /> 统一路由约束</p><p className="mt-1">业务页面 → Skill → Model Profile → Model Router → Provider Adapter。API Key 不进入前端，所有调用均记录日志与成本。</p></div>
        </div>
      </aside>
    </div>
  );
}

function ModelRouteCard({ label, model, modelId }: { label: string; model?: AIModelView; modelId: string }) { return <div className="rounded-lg border border-border bg-muted/25 p-3"><p className="text-[9px] font-semibold uppercase tracking-wide text-primary">{label}</p><p className="mt-1.5 text-xs font-medium text-foreground">{model?.displayName ?? modelId}</p><p className="mt-1 font-mono text-[9px] text-muted-foreground">{model?.modelId ?? modelId}</p></div>; }
function MiniMetric({ icon: Icon, label, value }: { icon: typeof Wrench; label: string; value: string }) { return <div className="rounded-lg border border-border p-3"><p className="flex items-center gap-1 text-[9px] text-muted-foreground"><Icon className="size-2.5" />{label}</p><p className="mt-1.5 text-sm font-semibold text-foreground">{value}</p></div>; }
function ConfigCell({ label, value }: { label: string; value: string }) { return <div className="bg-card p-3"><dt className="text-[9px] text-muted-foreground">{label}</dt><dd className="mt-1 text-[11px] font-medium text-foreground">{value}</dd></div>; }
function Capability({ enabled, icon: Icon, label }: { enabled: boolean; icon: typeof Braces; label: string }) { return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-medium ${enabled ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground line-through"}`}><Icon className="size-2.5" />{label}</span>; }
function ProfileStatus({ status }: { status: string }) { const active = status === "active"; return <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${active ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"}`}>{active ? "已启用" : status}</span>; }
