"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FileCheck2,
  Gauge,
  Lightbulb,
  ListChecks,
  Milestone,
  Plus,
  Scale,
  Sparkles,
  Target,
} from "lucide-react";
import { actions, activities, decisions, reviews, risks, scopes } from "@/data/mock";
import { ProjectContextHeader, getProjectRecord } from "./ProjectContextHeader";
import {
  asRecords,
  dateLabel,
  numberValue,
  relativeLabel,
  statusClasses,
  statusLabel,
  textValue,
} from "./mock-view";

interface ProjectOverviewPageProps {
  projectId?: string;
}

function projectRecords(source: unknown, projectId: string) {
  const rows = asRecords(source);
  const matched = rows.filter((row) => textValue(row, "projectId", "") === projectId);
  return matched.length ? matched : rows;
}

export function ProjectOverviewPage({ projectId }: ProjectOverviewPageProps) {
  const project = getProjectRecord(projectId);
  const id = textValue(project, "id", projectId ?? "p1");
  const projectRisks = projectRecords(risks, id);
  const projectActions = projectRecords(actions, id);
  const projectDecisions = projectRecords(decisions, id);
  const projectActivities = projectRecords(activities, id);
  const projectReviews = projectRecords(reviews, id);
  const projectScopes = projectRecords(scopes, id);
  const [healthExpanded, setHealthExpanded] = useState(false);
  const [addedSuggestions, setAddedSuggestions] = useState<number[]>([]);
  const [resolvedQuestions, setResolvedQuestions] = useState<number[]>([]);

  const health = textValue(project, ["health", "healthStatus"], "attention");
  const progress = Math.min(100, numberValue(project, ["progress", "completionRate"], 68));
  const milestones = [
    { name: "需求与 Scope 确认", date: "06/18", status: "completed" },
    { name: "交互与视觉定稿", date: "07/08", status: "completed" },
    { name: "核心功能联调", date: "08/02", status: "active" },
    { name: "客户验收与上线", date: "09/15", status: "pending" },
  ];
  const suggestions = [
    "今天确认素材授权范围，避免创意制作继续等待",
    "在下一次客户周会前完成支付失败降级方案评审",
    "将新增加的多语言需求纳入 Scope 变更审核",
  ];

  return (
    <div className="min-h-full bg-background">
      <ProjectContextHeader projectId={id} activeTab="overview" />
      <main className="px-5 py-6 lg:px-8">
        <section className="mb-6 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
          <OverviewMetric icon={Gauge} label="整体进度" value={`${progress}%`} detail="按当前有效排期" />
          <OverviewMetric icon={FileCheck2} label="当前 Scope" value={textValue(projectScopes[0], ["version", "name"], "v2.2")} detail="已生效 · 06/28" />
          <OverviewMetric icon={ListChecks} label="未完成 Action" value={String(projectActions.filter((item) => textValue(item, "status", "todo") !== "completed").length || 8)} detail="其中 2 项即将到期" />
          <OverviewMetric icon={AlertTriangle} label="当前风险" value={String(projectRisks.filter((item) => !["resolved", "closed"].includes(textValue(item, "status", "open"))).length || 3)} detail="1 项高风险" tone="danger" />
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(330px,0.75fr)]">
          <div className="space-y-6">
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div><div className="mb-2 flex items-center gap-2"><Target className="size-4 text-primary" /><h2 className="text-sm font-semibold text-foreground">项目目标与摘要</h2></div><p className="max-w-3xl text-base font-medium leading-7 text-foreground">{textValue(project, ["objective", "goal"], "为北美旗舰店打造可规模化的 AI 互动体验，在 9 月品牌活动前完成上线，并将用户内容生成转化率提升 25%。")}</p></div>
                <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${statusClasses(health)}`}>{statusLabel(health)}</span>
              </div>
              <p className="border-t border-border pt-4 text-sm leading-6 text-muted-foreground">{textValue(project, ["summary", "description"], "项目已完成核心体验与数据链路方案确认，当前进入交付实施阶段。AI 图像生成主流程按计划推进，但第三方素材授权和北美支付接口的确认时间仍可能影响联调窗口。客户已确认首发范围以移动端体验为主，桌面端高级编辑功能延后至后续版本。")}</p>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <SmallFact label="当前阶段" value={textValue(project, ["stage", "currentStage"], "交付实施")} />
                <SmallFact label="当前有效排期" value="2026/06/03 — 2026/09/15" />
                <SmallFact label="最近正式确认" value="Scope v2.2 · 06/28" />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h2 className="text-sm font-semibold text-foreground">关键里程碑</h2><p className="mt-0.5 text-xs text-muted-foreground">基于当前有效排期</p></div><Link href={`/projects/${id}/actions`} className="text-xs font-medium text-primary hover:underline">查看 Action Plan</Link></div>
              <div className="overflow-x-auto px-5 py-5">
                <div className="flex min-w-[620px] items-start">
                  {milestones.map((milestone, index) => (
                    <div key={milestone.name} className="relative flex-1 pr-4 last:pr-0">
                      {index < milestones.length - 1 && <div className={`absolute left-4 right-0 top-3 h-px ${milestone.status === "completed" ? "bg-success" : "bg-border"}`} />}
                      <span className={`relative z-10 grid size-6 place-items-center rounded-full border-2 border-card ${milestone.status === "completed" ? "bg-success text-white" : milestone.status === "active" ? "bg-primary text-primary-foreground ring-4 ring-primary/10" : "bg-muted text-muted-foreground"}`}>{milestone.status === "completed" ? <Check className="size-3.5" /> : <CircleDot className="size-3" />}</span>
                      <p className="mt-3 text-xs font-medium text-foreground">{milestone.name}</p><p className="mt-1 text-[11px] text-muted-foreground">{milestone.date}{milestone.status === "active" && " · 进行中"}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div className="grid gap-6 lg:grid-cols-2">
              <section className="rounded-xl border border-border bg-card">
                <SectionHeader title="未解决问题" icon={Lightbulb} action="查看全部" href={`/projects/${id}/knowledge`} />
                <div className="divide-y divide-border">
                  {["第三方素材的全球使用权是否覆盖用户二创？", "加拿大法语版本是否需同步首发？", "支付失败后的优惠码是否保留 24 小时？"].map((question, index) => {
                    const resolved = resolvedQuestions.includes(index);
                    return <div key={question} className="flex items-start gap-3 px-5 py-3.5"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${resolved ? "bg-success" : "bg-warning"}`} /><div className="min-w-0 flex-1"><p className={`text-sm leading-5 ${resolved ? "text-muted-foreground line-through" : "text-foreground"}`}>{question}</p><p className="mt-1 text-[11px] text-muted-foreground">来源：{index === 0 ? "素材授权会 · 07/10" : "客户周会 · 07/08"}</p></div><button type="button" onClick={() => setResolvedQuestions((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index])} className="shrink-0 rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">{resolved ? "恢复" : "标记已解决"}</button></div>;
                  })}
                </div>
              </section>

              <section className="rounded-xl border border-border bg-card">
                <SectionHeader title="最近决策" icon={Scale} action="会议与决策" href={`/projects/${id}/meetings`} />
                <div className="divide-y divide-border">
                  {(projectDecisions.length ? projectDecisions.slice(0, 3) : [{ id: "decision-1" }, { id: "decision-2" }, { id: "decision-3" }]).map((decision, index) => <div key={textValue(decision, "id", `decision-${index}`)} className="px-5 py-3.5"><div className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /><p className="text-sm leading-5 text-foreground">{textValue(decision, ["title", "content"], ["首发版本以移动端体验为主", "生成结果保留 30 天供用户再次编辑", "多语言内容沿用客户术语库"][index] ?? "项目决策")}</p></div><p className="ml-6 mt-1 text-[11px] text-muted-foreground">{dateLabel(decision.decidedAt ?? decision.createdAt)} · {textValue(decision, ["decidedBy", "owner"], "客户与项目组共同确认")}</p></div>)}
                </div>
              </section>
            </div>

            <section className="rounded-xl border border-border bg-card">
              <SectionHeader title="最近 Action Items" icon={ListChecks} action="打开 Action Plan" href={`/projects/${id}/actions`} />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm"><thead className="border-b border-border bg-muted/30 text-[11px] font-medium text-muted-foreground"><tr><th className="px-5 py-2.5">Action</th><th className="px-3 py-2.5">负责人</th><th className="px-3 py-2.5">截止日期</th><th className="px-5 py-2.5">状态</th></tr></thead><tbody className="divide-y divide-border">{(projectActions.length ? projectActions.slice(0, 4) : Array.from({ length: 4 }, (_, index) => ({ id: `action-${index}` }))).map((action, index) => { const status = textValue(action, "status", index === 0 ? "overdue" : index === 1 ? "inProgress" : "todo"); return <tr key={textValue(action, "id", `action-${index}`)} className="hover:bg-muted/30"><td className="px-5 py-3 font-medium text-foreground">{textValue(action, ["title", "content"], ["确认素材授权补充条款", "完成支付失败降级方案", "补充法语术语翻译", "更新 UAT 测试账号清单"][index] ?? "项目 Action")}</td><td className="px-3 py-3 text-muted-foreground">{textValue(action, ["owner", "assignee"], ["林可", "陈舟", "Mia", "周霖"][index] ?? "林可")}</td><td className={`px-3 py-3 tabular-nums ${status === "overdue" ? "text-destructive" : "text-muted-foreground"}`}>{dateLabel(textValue(action, "dueDate", ""), ["07/11", "07/16", "07/18", "07/22"][index])}</td><td className="px-5 py-3"><span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses(status)}`}>{statusLabel(status)}</span></td></tr>; })}</tbody></table>
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <section className="rounded-xl border border-border bg-card">
              <button type="button" onClick={() => setHealthExpanded((value) => !value)} className="flex w-full items-center justify-between px-5 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"><div className="flex items-center gap-2"><Gauge className="size-4 text-warning" /><div><h2 className="text-sm font-semibold text-foreground">项目健康度解释</h2><p className="mt-0.5 text-xs text-muted-foreground">AI 风险分析 · 刚刚更新</p></div></div><ChevronDown className={`size-4 text-muted-foreground transition-transform ${healthExpanded ? "rotate-180" : ""}`} /></button>
              <div className="border-t border-border px-5 py-4">
                <div className="flex items-center justify-between"><span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${statusClasses(health)}`}>{statusLabel(health)}</span><span className="text-xs font-semibold tabular-nums text-warning">72 / 100</span></div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full w-[72%] rounded-full bg-warning" /></div>
                <div className="mt-4 space-y-3">{[{ label: "交付进度", value: 82, tone: "bg-success" }, { label: "Scope 稳定性", value: 68, tone: "bg-warning" }, { label: "资源可用性", value: 74, tone: "bg-primary" }, { label: "客户确认及时性", value: 61, tone: "bg-warning" }].map((item) => <div key={item.label}><div className="mb-1 flex justify-between text-[11px] text-muted-foreground"><span>{item.label}</span><span>{item.value}</span></div><div className="h-1 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${item.tone}`} style={{ width: `${item.value}%` }} /></div></div>)}</div>
                {healthExpanded && <div className="mt-4 rounded-lg bg-muted/50 p-3 text-xs leading-5 text-muted-foreground">主要扣分来自素材授权确认延迟和 Scope 新增的多语言要求。若本周内完成两项确认，健康度预计回升至 80 分以上。</div>}
              </div>
            </section>

            <section className="overflow-hidden rounded-xl border border-primary/20 bg-card">
              <div className="flex items-center gap-2 border-b border-primary/15 bg-primary/5 px-5 py-4"><span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground"><Bot className="size-4" /></span><div><h2 className="text-sm font-semibold text-foreground">下一步建议</h2><p className="mt-0.5 text-xs text-muted-foreground">基于有效 Scope、风险和待办生成</p></div></div>
              <div className="divide-y divide-border">{suggestions.map((suggestion, index) => { const added = addedSuggestions.includes(index); return <div key={suggestion} className="px-5 py-4"><div className="flex gap-2"><Sparkles className="mt-0.5 size-4 shrink-0 text-primary" /><p className="text-sm leading-5 text-foreground">{suggestion}</p></div><button type="button" onClick={() => setAddedSuggestions((current) => current.includes(index) ? current : [...current, index])} disabled={added} className={`ml-6 mt-2 inline-flex items-center gap-1 text-xs font-medium ${added ? "text-success" : "text-primary hover:underline"}`}>{added ? <><Check className="size-3" />已加入 Action Plan</> : <><Plus className="size-3" />加入 Action Plan</>}</button></div>; })}</div>
              <Link href={`/projects/${id}/knowledge`} className="flex items-center justify-center gap-1.5 border-t border-border px-4 py-3 text-xs font-medium text-primary hover:bg-primary/5">向项目 AI 助手追问 <ArrowRight className="size-3.5" /></Link>
            </section>

            <section className="rounded-xl border border-border bg-card">
              <SectionHeader title="最近 AI 产出" icon={Sparkles} action="审核中心" href="/reviews" />
              <div className="divide-y divide-border">{(projectReviews.length ? projectReviews.slice(0, 3) : [{ id: "output-1" }, { id: "output-2" }, { id: "output-3" }]).map((output, index) => <Link key={textValue(output, "id", `output-${index}`)} href={`/reviews?task=${textValue(output, "id", `output-${index}`)}`} className="flex items-start gap-3 px-5 py-3.5 hover:bg-muted/40"><span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><Bot className="size-3.5" /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{textValue(output, ["title", "name"], ["新增需求提取结果", "Scope 变更影响分析", "项目风险周度分析"][index] ?? "AI 产出")}</span><span className="mt-1 block text-[11px] text-muted-foreground">{relativeLabel(textValue(output, "createdAt", ""))} · 待审核</span></span></Link>)}</div>
            </section>

            <section className="rounded-xl border border-border bg-card">
              <SectionHeader title="项目活动时间线" icon={Activity} />
              <div className="px-5 py-2">{(projectActivities.length ? projectActivities.slice(0, 5) : Array.from({ length: 5 }, (_, index) => ({ id: `timeline-${index}` }))).map((activity, index) => <div key={textValue(activity, "id", `timeline-${index}`)} className="relative flex gap-3 py-2.5 before:absolute before:left-[7px] before:top-7 before:h-[calc(100%-12px)] before:w-px before:bg-border last:before:hidden"><span className={`relative z-10 mt-1 size-3.5 shrink-0 rounded-full border-2 border-card ${index === 0 ? "bg-primary" : "bg-muted-foreground/35"}`} /><div><p className="text-xs font-medium leading-5 text-foreground">{textValue(activity, ["title", "description", "action"], ["客户确认首发端范围", "Scope v2.2 正式生效", "完成核心体验视觉定稿", "AI 更新项目知识索引", "项目排期调整已确认"][index] ?? "项目更新")}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{relativeLabel(textValue(activity, ["createdAt", "timestamp"], ""))}</p></div></div>)}</div>
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

function SectionHeader({ title, icon: Icon, action, href }: { title: string; icon: typeof Milestone; action?: string; href?: string }) {
  return <div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" /><h2 className="text-sm font-semibold text-foreground">{title}</h2></div>{action && href && <Link href={href} className="text-xs font-medium text-primary hover:underline">{action}</Link>}</div>;
}

export default ProjectOverviewPage;
