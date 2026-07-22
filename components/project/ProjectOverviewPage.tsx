"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  FileCheck2,
  FileText,
  FolderKanban,
  Gauge,
  Lightbulb,
  ListChecks,
  Milestone,
  Plus,
  Scale,
  ShieldAlert,
  Sparkles,
  Target,
} from "lucide-react";
import { ProjectContextHeader } from "./ProjectContextHeader";
import type { AuthorizedProjectSummary, ProjectMockPayload } from "@/lib/auth/ui-types";
import { projectManagementRequest } from "@/lib/project-management/client";
import {
  asRecords,
  dateLabel,
  numberValue,
  relativeLabel,
  statusClasses,
  statusLabel,
  stringList,
  textValue,
} from "./mock-view";

interface ProjectOverviewPageProps {
  project: AuthorizedProjectSummary;
  data: ProjectMockPayload;
}

export function ProjectOverviewPage({ project: authorizedProject, data }: ProjectOverviewPageProps) {
  const project = data.project ?? undefined;
  const id = authorizedProject.id;
  const projectRisks = asRecords(data.risks);
  const projectActions = asRecords(data.actions);
  const projectDecisions = asRecords(data.decisions);
  const projectActivities = asRecords(data.activities);
  const projectReviews = asRecords(data.reviews);
  const projectScopes = asRecords(data.scopes);
  const projectMilestones = asRecords(project?.milestones);
  const healthDimensions = asRecords(project?.healthDimensions);
  const [healthExpanded, setHealthExpanded] = useState(false);
  const [addedSuggestions, setAddedSuggestions] = useState<number[]>([]);
  const [resolvedQuestions, setResolvedQuestions] = useState<number[]>([]);
  const [management, setManagement] = useState<{ requirement_count: number; requirement_done: number; scope_changes: number; action_count: number; action_done: number; overdue_actions: number; open_risks: number; latest_report_id: string | null; latest_report_version: number | null } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void projectManagementRequest<typeof management>(`/api/projects/${encodeURIComponent(id)}/management-dashboard`, { signal: controller.signal })
      .then(setManagement)
      .catch(() => undefined);
    return () => controller.abort();
  }, [id]);

  const health = textValue(project, ["health", "healthStatus"], authorizedProject.health || "attention");
  const progress = Math.min(100, numberValue(project, ["progress", "completionRate"], 0));
  const healthScore = Math.min(100, numberValue(project, ["healthScore", "health_score"], 0));
  const questions = stringList(project, ["openQuestions", "questions"]).slice(0, 3);
  const suggestions = stringList(project, ["suggestions", "nextSteps"]).slice(0, 3);
  const currentScope = projectScopes[0];
  const activeRiskCount = projectRisks.filter(
    (item) => !["resolved", "closed"].includes(textValue(item, "status", "open")),
  ).length;

  if (!project) {
    return (
      <div className="min-h-full bg-background">
        <ProjectContextHeader project={authorizedProject} activeTab="overview" />
        <main className="px-5 py-12 lg:px-8">
          <section className="mx-auto max-w-xl rounded-xl border border-border bg-card p-8 text-center">
            <FolderKanban className="mx-auto size-7 text-muted-foreground" />
            <h2 className="mt-4 text-base font-semibold text-foreground">项目基础信息已建立</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">此项目尚未映射演示业务内容。项目身份和权限边界已生效，不会回退展示其他项目的数据。</p>
          </section>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-background">
      <ProjectContextHeader project={authorizedProject} activeTab="overview" />
      <main className="px-5 py-6 lg:px-8">
        <section className="mb-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4 xl:grid-cols-6">
          <OverviewMetric icon={Gauge} label="需求完成" value={management ? `${management.requirement_done}/${management.requirement_count}` : `${progress}%`} detail="正式 Requirement" />
          <OverviewMetric icon={FileCheck2} label="Scope Changes" value={String(management?.scope_changes ?? 0)} detail="已排除驳回项" />
          <OverviewMetric icon={ListChecks} label="Action Progress" value={management?.action_count ? `${management.action_done}/${management.action_count}` : "0/0"} detail="正式 Action" />
          <OverviewMetric icon={AlertTriangle} label="Overdue Actions" value={String(management?.overdue_actions ?? 0)} detail="按当前日期" tone="danger" />
          <OverviewMetric icon={ShieldAlert} label="Open Risks" value={String(management?.open_risks ?? activeRiskCount)} detail="Open + Monitoring" tone="danger" />
          <OverviewMetric icon={FileText} label="Current Weekly" value={management?.latest_report_version ? `v${management.latest_report_version}` : "未发布"} detail="不可覆盖版本" />
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.75fr)]">
          <div className="space-y-6">
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div><div className="mb-2 flex items-center gap-2"><Target className="size-4 text-primary" /><h2 className="text-sm font-semibold text-foreground">项目目标与摘要</h2></div><p className="max-w-3xl text-base font-medium leading-7 text-foreground">{textValue(project, ["objective", "goal"], authorizedProject.description || "项目目标尚未录入")}</p></div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${statusClasses(health)}`}>{statusLabel(health)}</span>
              </div>
              <p className="border-t border-border pt-4 text-sm leading-6 text-muted-foreground">{textValue(project, ["summary", "description"], authorizedProject.description || "项目摘要尚未录入")}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <SmallFact label="当前阶段" value={textValue(project, ["stage", "currentStage"], statusLabel(authorizedProject.stage))} />
                <SmallFact label="目标上线" value={dateLabel(authorizedProject.targetLaunchDate, "尚未设置")} />
                <SmallFact label="最近正式确认" value={currentScope ? `${textValue(currentScope, ["version", "name"], "当前 Scope")} · ${dateLabel(currentScope.updatedAt ?? currentScope.effectiveAt, "日期未记录")}` : "尚无 Scope 记录"} />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-sm font-semibold text-foreground">关键里程碑</h2><p className="mt-0.5 text-xs text-muted-foreground">基于当前有效排期</p></div><Link href={`/projects/${id}/actions`} className="text-xs font-medium text-primary hover:underline">查看 Action Plan</Link></div>
              {projectMilestones.length ? <div className="overflow-x-auto px-5 py-5"><div className="flex min-w-[620px] items-start">{projectMilestones.slice(0, 6).map((milestone, index) => { const status = textValue(milestone, "status", "pending"); return <div key={textValue(milestone, "id", `milestone-${index}`)} className="relative flex-1 pr-4 last:pr-0">{index < projectMilestones.length - 1 && <div className={`absolute left-4 right-0 top-3 h-px ${status === "completed" ? "bg-success" : "bg-border"}`} />}<span className={`relative z-10 grid size-6 place-items-center rounded-full border-2 border-card ${status === "completed" ? "bg-success text-white" : status === "active" ? "bg-primary text-primary-foreground ring-4 ring-primary/10" : "bg-muted text-muted-foreground"}`}>{status === "completed" ? <Check className="size-3.5" /> : <Milestone className="size-3" />}</span><p className="mt-3 text-xs font-medium text-foreground">{textValue(milestone, ["name", "title"], "未命名里程碑")}</p><p className="mt-1 text-[11px] text-muted-foreground">{dateLabel(milestone.date ?? milestone.dueDate, "日期未设置")}</p></div>; })}</div></div> : <EmptyState label="当前项目尚无里程碑记录" />}
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-xl border border-border bg-card">
                <SectionHeader title="未解决问题" icon={Lightbulb} action="查看全部" href={`/projects/${id}/knowledge`} />
                <div className="divide-y divide-border">
                  {questions.map((question, index) => {
                    const resolved = resolvedQuestions.includes(index);
                    return <div key={question} className="flex items-start gap-3 px-5 py-3.5"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${resolved ? "bg-success" : "bg-warning"}`} /><div className="min-w-0 flex-1"><p className={`text-sm leading-5 ${resolved ? "text-muted-foreground line-through" : "text-foreground"}`}>{question}</p><p className="mt-1 text-[11px] text-muted-foreground">来自当前项目知识记录</p></div>{authorizedProject.permissions.canEditProject ? <button type="button" onClick={() => setResolvedQuestions((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])} className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">{resolved ? "恢复" : "标记已解决"}</button> : null}</div>;
                  })}
                  {!questions.length && <EmptyState label="当前项目尚无待确认问题" />}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-card">
                <SectionHeader title="最近决策" icon={Scale} action="会议与决策" href={`/projects/${id}/meetings`} />
                <div className="divide-y divide-border">
                  {projectDecisions.slice(0, 3).map((decision, index) => <div key={textValue(decision, "id", `decision-${index}`)} className="px-5 py-3.5"><div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /><p className="text-sm leading-5 text-foreground">{textValue(decision, ["title", "content"], "未命名项目决策")}</p></div><p className="ml-6 mt-1 text-[11px] text-muted-foreground">{dateLabel(decision.decidedAt ?? decision.createdAt, "日期未记录")} · {textValue(decision, ["decidedBy", "owner"], "确认人未记录")}</p></div>)}
                  {!projectDecisions.length && <EmptyState label="当前项目尚无决策记录" />}
                </div>
              </section>
            </div>

            <section className="rounded-xl border border-border bg-card">
              <SectionHeader title="最近 Action Items" icon={ListChecks} action="打开 Action Plan" href={`/projects/${id}/actions`} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b border-border bg-muted/30 text-[11px] font-medium text-muted-foreground"><tr><th className="px-5 py-2.5">Action</th><th className="px-3 py-2.5">负责人</th><th className="px-3 py-2.5">截止日期</th><th className="px-5 py-2.5">状态</th></tr></thead><tbody className="divide-y divide-border">{projectActions.slice(0, 4).map((action, index) => { const status = textValue(action, "status", "todo"); return <tr key={textValue(action, "id", `action-${index}`)} className="hover:bg-muted/30"><td className="px-5 py-3 font-medium text-foreground">{textValue(action, ["title", "content"], "未命名 Action")}</td><td className="px-3 py-3 text-muted-foreground">{textValue(action, ["owner", "assignee"], "待分配")}</td><td className={`px-3 py-3 tabular-nums ${status === "overdue" ? "text-destructive" : "text-muted-foreground"}`}>{dateLabel(textValue(action, "dueDate", ""), "尚未设置")}</td><td className="px-5 py-3"><span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses(status)}`}>{statusLabel(status)}</span></td></tr>; })}{!projectActions.length && <tr><td colSpan={4}><EmptyState label="当前项目尚无 Action 记录" /></td></tr>}</tbody></table>
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl border border-border bg-card">
              <button type="button" onClick={() => setHealthExpanded((value) => !value)} className="flex w-full items-center justify-between px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><div className="flex items-center gap-2"><Gauge className="size-4 text-warning" /><div><h2 className="text-sm font-semibold text-foreground">项目健康度解释</h2><p className="mt-0.5 text-xs text-muted-foreground">AI 风险分析 · 刚刚更新</p></div></div><ChevronDown className={`size-4 text-muted-foreground transition-transform ${healthExpanded ? "rotate-180" : ""}`} /></button>
              <div className="border-t border-border px-5 py-4">
                <div className="flex items-center justify-between"><span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusClasses(health)}`}>{statusLabel(health)}</span><span className="text-xs font-semibold tabular-nums text-warning">{healthScore ? `${healthScore} / 100` : "暂无评分"}</span></div>
                {healthScore ? <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-warning" style={{ width: `${healthScore}%` }} /></div> : null}
                <div className="mt-4 space-y-3">{healthDimensions.map((item, index) => { const value = Math.min(100, numberValue(item, "value", 0)); return <div key={textValue(item, "id", `dimension-${index}`)}><div className="mb-1 flex justify-between text-[11px] text-muted-foreground"><span>{textValue(item, ["label", "name"], "未命名维度")}</span><span>{value}</span></div><div className="h-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${value}%` }} /></div></div>; })}</div>
                {healthExpanded && <div className="mt-4 rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">{textValue(project, ["healthExplanation", "healthSummary"], "当前项目尚无健康度解释。")}</div>}
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-primary/20 bg-card">
              <div className="flex items-center gap-2 border-b border-primary/15 bg-primary/5 px-5 py-4"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Bot className="size-4" /></span><div><h2 className="text-sm font-semibold text-foreground">下一步建议</h2><p className="mt-0.5 text-xs text-muted-foreground">基于有效 Scope、风险和待办生成</p></div></div>
              <div className="divide-y divide-border">{suggestions.map((suggestion, index) => { const added = addedSuggestions.includes(index); return <div key={suggestion} className="px-5 py-4"><div className="flex gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-primary" /><p className="text-sm leading-5 text-foreground">{suggestion}</p></div>{authorizedProject.permissions.canEditProject ? <button type="button" onClick={() => setAddedSuggestions((current) => current.includes(index) ? current : [...current, index])} disabled={added} className={`ml-6 mt-2 inline-flex items-center gap-1 text-xs font-medium ${added ? "text-success" : "text-primary hover:underline"}`}>{added ? <><Check className="size-3" />已加入 Action Plan</> : <><Plus className="size-3" />加入 Action Plan</>}</button> : null}</div>; })}{!suggestions.length && <EmptyState label="当前项目尚无下一步建议" />}</div>
              <Link href={`/projects/${id}/knowledge`} className="flex items-center justify-center gap-1.5 border-t border-border px-4 py-3 text-xs font-medium text-primary hover:bg-primary/5">向项目 AI 助手追问 <ArrowRight className="size-3.5" /></Link>
            </section>

            <section className="rounded-xl border border-border bg-card">
              <SectionHeader title="最近 AI 产出" icon={Sparkles} action={authorizedProject.permissions.canEditProject ? "审核中心" : undefined} href={authorizedProject.permissions.canEditProject ? "/reviews" : undefined} />
              <div className="divide-y divide-border">{projectReviews.slice(0, 3).map((output, index) => { const content = <><span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Bot className="size-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{textValue(output, ["title", "name"], "未命名 AI 产出")}</span><span className="mt-1 block text-[11px] text-muted-foreground">{textValue(output, "createdAt", "") ? relativeLabel(textValue(output, "createdAt", "")) : "时间未记录"} · 待审核</span></span></>; return authorizedProject.permissions.canEditProject ? <Link key={textValue(output, "id", `output-${index}`)} href={`/reviews?task=${textValue(output, "id", `output-${index}`)}`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-muted/40">{content}</Link> : <div key={textValue(output, "id", `output-${index}`)} className="flex items-start gap-3 px-5 py-3.5">{content}</div>; })}{!projectReviews.length && <EmptyState label="当前项目尚无 AI 产出" />}</div>
            </section>

            <section className="rounded-xl border border-border bg-card">
              <SectionHeader title="项目活动时间线" icon={Activity} />
              <div className="px-5 py-2">{projectActivities.slice(0, 5).map((activity, index) => <div key={textValue(activity, "id", `timeline-${index}`)} className="relative flex gap-3 py-2.5 before:absolute before:left-[7px] before:top-7 before:h-[calc(100%-12px)] before:w-px before:bg-border last:before:hidden"><span className={`relative z-10 mt-1 size-3.5 shrink-0 rounded-full border-2 border-card ${index === 0 ? "bg-primary" : "bg-muted-foreground/35"}`} /><div><p className="text-xs font-medium leading-5 text-foreground">{textValue(activity, ["title", "description", "action"], "项目更新")}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{textValue(activity, ["createdAt", "timestamp"], "") ? relativeLabel(textValue(activity, ["createdAt", "timestamp"], "")) : "时间未记录"}</p></div></div>)}{!projectActivities.length && <EmptyState label="当前项目尚无活动记录" />}</div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function OverviewMetric({ icon: Icon, label, value, detail, tone }: { icon: typeof Gauge; label: string; value: string; detail: string; tone?: "danger" }) {
  return <div className="bg-card px-5 py-4"><div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className={`size-4 ${tone === "danger" ? "text-destructive" : "text-primary"}`} />{label}</div><div className="mt-3 flex items-end justify-between gap-3"><p className="text-xl font-semibold tabular-nums text-foreground">{value}</p><p className={`text-[11px] ${tone === "danger" ? "text-destructive" : "text-muted-foreground"}`}>{detail}</p></div></div>;
}

function SmallFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted/50 px-3 py-2.5"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 text-xs font-medium text-foreground">{value}</p></div>;
}

function EmptyState({ label }: { label: string }) {
  return <p className="px-5 py-5 text-center text-xs text-muted-foreground">{label}</p>;
}

function SectionHeader({ title, icon: Icon, action, href }: { title: string; icon: typeof Milestone; action?: string; href?: string }) {
  return <div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" /><h2 className="text-sm font-semibold text-foreground">{title}</h2></div>{action && href && <Link href={href} className="text-xs font-medium text-primary hover:underline">{action}</Link>}</div>;
}

export default ProjectOverviewPage;
