"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Bot,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  Clock3,
  FileCheck2,
  FileText,
  Flag,
  History,
  Layers3,
  LoaderCircle,
  MessageSquareText,
  Network,
  PanelRightClose,
  PanelRightOpen,
  Send,
  ShieldCheck,
  Sparkles,
  Tag,
  Target,
  Users,
} from "lucide-react";
import { citations, decisions, documents, risks, scopes } from "@/data/mock";
import { mockProjectKnowledgeService } from "@/lib/knowledge";
import { SourceCitation } from "@/components/common/source-citation";
import { ProjectContextHeader, getProjectRecord } from "@/components/project/ProjectContextHeader";
import {
  asRecords,
  dateLabel,
  numberValue,
  statusLabel,
  textValue,
} from "@/components/project/mock-view";

interface ProjectKnowledgePageProps {
  projectId?: string;
}

const knowledgeLayers = [
  { id: "documents", label: "项目资料知识", icon: FileText },
  { id: "facts", label: "已确认项目事实", icon: ShieldCheck },
  { id: "requirements", label: "需求知识", icon: MessageSquareText },
  { id: "scope", label: "Scope 知识", icon: FileCheck2 },
  { id: "decisions", label: "会议决策", icon: Users },
  { id: "actions", label: "Action Plan", icon: CheckCircle2 },
  { id: "risks", label: "风险知识", icon: AlertCircle },
  { id: "rules", label: "公司公共规则", icon: BookOpen },
  { id: "cases", label: "历史项目案例", icon: History },
];

const presetQuestions = [
  "当前有效 Scope 是哪一个版本？",
  "客户提出了哪些关键目标？",
  "最近新增了哪些需求？",
  "当前最大的项目风险是什么？",
  "哪些 Action Items 已经过期？",
  "这个需求是什么时候提出的？",
  "为什么上线日期发生了变化？",
  "最近一次客户确认了哪些内容？",
];

const answers = [
  "当前有效 Scope 为 v2.2，于 2026 年 6 月 28 日经客户与项目组确认后生效。该版本覆盖移动端 AI 图片生成、结果编辑与分享链路；桌面端高级编辑和法语本地化仍不在当前正式范围内。",
  "客户提出的关键目标有三项：在 9 月品牌活动前完成北美旗舰店互动体验上线；将用户生成内容的分享转化率提升 25%；建立素材授权、生成记录和发布状态的可追溯机制。",
  "最近 7 天新增 5 条需求，其中 3 条来自 7 月 8 日客户周会，2 条来自支付接口联调。影响最大的是“加拿大法语内容支持”，它被标记为原 Scope 之外，正在等待变更审核。",
  "当前最大的项目风险是第三方素材授权范围尚未明确。若授权条款不覆盖用户二次创作，核心生成链路需要更换素材或增加授权确认步骤，预计影响联调 3—5 个工作日。",
  "当前有 2 个 Action Items 已逾期：A-032“确认素材授权补充条款”，负责人林可，原截止 7 月 11 日；A-041“提供北美支付测试账号”，负责人陈舟，原截止 7 月 10 日。",
  "REQ-018“加拿大法语内容支持”最早于 2026 年 7 月 8 日客户周会提出，会后纪要第 3.2 节记录了原始表述。7 月 9 日由 AI 提取为需求草稿，目前处于待审核状态。",
  "上线日期从 9 月 8 日调整至 9 月 15 日，主要因为客户确认将北美支付接口纳入首发，接口安全评审和联调新增 5 个工作日；该变更已在 6 月 28 日的 Scope v2.2 中正式确认。",
  "最近一次客户确认发生在 7 月 8 日：确认首发以移动端为主、生成内容保留 30 天、分享页沿用品牌主视觉；同时将桌面端高级编辑移出首发范围。",
];

function forProject(source: unknown, projectId: string) {
  const rows = asRecords(source);
  const matched = rows.filter((row) => textValue(row, "projectId", "") === projectId);
  return matched.length ? matched : rows;
}

export function ProjectKnowledgePage({ projectId }: ProjectKnowledgePageProps) {
  const project = getProjectRecord(projectId);
  const id = textValue(project, "id", projectId ?? "p1");
  const projectDocuments = forProject(documents, id);
  const projectRisks = forProject(risks, id);
  const projectDecisions = forProject(decisions, id);
  const projectScopes = forProject(scopes, id);
  const sourceCitations = asRecords(citations).slice(0, 3);
  const [activeLayer, setActiveLayer] = useState("facts");
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [question, setQuestion] = useState(presetQuestions[0]);
  const [customQuestion, setCustomQuestion] = useState("");
  const [answer, setAnswer] = useState(answers[0]);
  const [answerCitations, setAnswerCitations] = useState<unknown[]>(sourceCitations);
  const [confidence, setConfidence] = useState(0.94);
  const [effectiveVersion, setEffectiveVersion] = useState(textValue(projectScopes[0], "version", "v2.2"));
  const [latency, setLatency] = useState(1800);
  const [generating, setGenerating] = useState(false);
  const [answerIndex, setAnswerIndex] = useState(0);

  const askQuestion = async (nextQuestion: string, index = -1) => {
    if (!nextQuestion.trim()) return;
    setQuestion(nextQuestion.trim());
    setGenerating(true);
    try {
      const result = await mockProjectKnowledgeService.answerProjectQuestion({ projectId: id, question: nextQuestion.trim(), filters: { effectiveOnly: true } });
      setAnswer(result.answer);
      setAnswerCitations(result.citations);
      setConfidence(result.confidence);
      setEffectiveVersion(result.effectiveVersionUsed);
      setLatency(result.latency);
      setAnswerIndex(index >= 0 ? index : 0);
    } catch {
      setAnswer("项目知识服务暂时不可用，已保留当前问题。请稍后重试，或先从来源文档中人工核对。 ");
      setConfidence(0);
    } finally {
      setGenerating(false);
    }
  };

  const normalizedCitations = asRecords(answerCitations).map((citation, index) => ({
    id: textValue(citation, "id", `citation-${index}`),
    documentId: textValue(citation, "documentId", textValue(projectDocuments[index], "id", `doc-${index}`)),
    documentName: textValue(citation, ["documentName", "sourceName"], ["北美互动活动 Scope v2.2.pdf", "客户需求确认纪要 0708.docx", "项目总排期 v5.xlsx"][index] ?? "项目资料"),
    section: textValue(citation, "section", ["2.1 首发功能范围", "3.2 新增需求与确认", "里程碑与上线计划"][index] ?? "项目范围"),
    pageNumber: numberValue(citation, "pageNumber", [6, 4, 2][index] ?? 1),
    sourceDate: textValue(citation, "sourceDate", ["2026-06-28", "2026-07-08", "2026-06-28"][index] ?? "2026-07-08"),
    status: textValue(citation, "status", "confirmed"),
    isEffectiveVersion: Boolean(citation.isEffectiveVersion ?? citation.isEffective ?? true),
    citationText: textValue(citation, ["citationText", "text"], ["首发范围包括移动端 AI 图片生成、结果编辑及分享页面。", "客户确认首发阶段以移动端体验为主，桌面端高级编辑后续评估。", "支付接口联调完成后，于 9 月 15 日进入正式发布窗口。"][index] ?? "项目已确认内容。"),
    trustLevel: textValue(citation, "trustLevel", "high"),
  }));

  return (
    <div className="min-h-full bg-background">
      <ProjectContextHeader projectId={id} activeTab="knowledge" onOpenAI={() => setAssistantOpen(true)} />
      <main className="px-5 py-5 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-foreground">项目知识</h2><span className="rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">索引已更新</span></div><p className="mt-1 text-xs text-muted-foreground">已聚合 9 类知识 · 124 个可检索片段 · 32 项已确认事实</p></div>
          <div className="flex items-center gap-2"><span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><Clock3 className="size-3.5" />2 分钟前同步</span><button type="button" onClick={() => setAssistantOpen((value) => !value)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted">{assistantOpen ? <PanelRightClose className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}{assistantOpen ? "收起助手" : "打开助手"}</button></div>
        </div>

        <section className="mb-5 overflow-x-auto rounded-xl border border-border bg-card p-2">
          <div className="flex min-w-max gap-1">{knowledgeLayers.map((layer) => <button key={layer.id} type="button" onClick={() => setActiveLayer(layer.id)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${activeLayer === layer.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><layer.icon className="size-3.5" />{layer.label}</button>)}</div>
        </section>

        <div className={`grid gap-5 ${assistantOpen ? "xl:grid-cols-[minmax(0,1fr)_430px]" : "grid-cols-1"}`}>
          <div className="min-w-0 space-y-5">
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><div className="mb-2 flex items-center gap-2"><Target className="size-4 text-primary" /><h3 className="text-sm font-semibold text-foreground">项目背景</h3></div><p className="text-sm leading-6 text-muted-foreground">{textValue(project, ["summary", "description"], "品牌计划在北美旗舰店上线 AI 图片互动体验，用户可基于官方素材生成个性化内容并分享。项目涉及营销活动、AI 生成服务、支付与会员数据，并受到素材授权和区域合规约束。")}</p></div><div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-right"><p className="text-[10px] text-muted-foreground">知识可信度</p><p className="mt-1 text-sm font-semibold text-success">92%</p></div></div>
              <div className="mt-5 grid gap-3 md:grid-cols-3"><KnowledgeMetric icon={ShieldCheck} label="已确认目标" value="3 项" detail="全部有正式来源" /><KnowledgeMetric icon={Flag} label="关键约束" value="5 项" detail="1 项待确认" /><KnowledgeMetric icon={CheckCircle2} label="已确认决策" value={String(projectDecisions.length || 10)} detail="最近更新 07/08" /></div>
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <KnowledgeSection icon={ShieldCheck} title="已确认目标" count="3">
                {["9 月 15 日前完成北美旗舰店首发", "用户内容分享转化率提升 25%", "建立素材、生成与发布全链路追溯"].map((item, index) => <KnowledgeItem key={item} title={item} meta={`来源 ${index + 1} 处 · ${index === 0 ? "Scope v2.2" : "项目启动会"}`} status="confirmed" />)}
              </KnowledgeSection>
              <KnowledgeSection icon={Flag} title="关键约束" count="5">
                {["仅允许使用完成全球授权的品牌素材", "用户生成内容默认保留 30 天", "首发峰值需支持 50,000 次/日", "加拿大法语版本尚待 Scope 审核"].map((item, index) => <KnowledgeItem key={item} title={item} meta={index === 3 ? "来源 2 处 · 存在版本差异" : `来源 ${index + 1} 处 · 已确认`} status={index === 3 ? "pendingReview" : "confirmed"} />)}
              </KnowledgeSection>
              <KnowledgeSection icon={FileCheck2} title="当前 Scope" count={textValue(projectScopes[0], "version", "v2.2")} action={<Link href={`/projects/${id}/scope`} className="text-[11px] font-medium text-primary hover:underline">查看 Scope</Link>}>
                <div className="rounded-lg border border-success/20 bg-success/5 p-3"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-foreground">{textValue(projectScopes[0], ["name", "title"], "北美互动活动 Scope v2.2")}</p><p className="mt-1 text-[11px] text-muted-foreground">2026/06/28 生效 · 替代 v2.1</p></div><span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">当前有效</span></div></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center"><MiniStat label="范围项" value="24" /><MiniStat label="排除项" value="6" /><MiniStat label="待确认" value="2" /></div>
              </KnowledgeSection>
              <KnowledgeSection icon={CalendarClock} title="当前排期" count="v5">
                <div className="space-y-3">{[{ label: "核心功能开发", date: "06/30—07/26", progress: 72 }, { label: "集成联调", date: "07/29—08/16", progress: 18 }, { label: "客户 UAT", date: "08/19—09/06", progress: 0 }].map((item) => <div key={item.label}><div className="flex items-center justify-between text-xs"><span className="font-medium text-foreground">{item.label}</span><span className="text-[10px] text-muted-foreground">{item.date}</span></div><div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${item.progress}%` }} /></div></div>)}</div>
              </KnowledgeSection>
              <KnowledgeSection icon={AlertCircle} title="当前风险" count={String(projectRisks.length || 3)} action={<Link href={`/projects/${id}/risks`} className="text-[11px] font-medium text-primary hover:underline">风险详情</Link>}>
                {(projectRisks.length ? projectRisks.slice(0, 3) : Array.from({ length: 3 }, (_, index) => ({ id: `risk-${index}` }))).map((risk, index) => { const level = textValue(risk, ["level", "severity"], index === 0 ? "high" : "medium"); return <div key={textValue(risk, "id", `risk-${index}`)} className="flex items-start gap-2.5 border-b border-border py-2.5 first:pt-0 last:border-0 last:pb-0"><span className={`mt-1.5 size-2 rounded-full ${["high", "critical"].includes(level) ? "bg-destructive" : "bg-warning"}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-foreground">{textValue(risk, ["name", "title"], ["素材授权范围尚未明确", "支付接口联调窗口压缩", "法语内容评审资源不足"][index] ?? "项目风险")}</p><p className="mt-1 text-[10px] text-muted-foreground">{statusLabel(level)}风险 · {textValue(risk, ["owner", "assignee"], "林可")}</p></div></div>; })}
              </KnowledgeSection>
              <KnowledgeSection icon={CircleHelp} title="待确认问题" count="3">
                {["加拿大法语内容是否纳入首发？", "素材授权是否覆盖用户二次创作？", "支付失败优惠码保留多久？"].map((item, index) => <div key={item} className="flex items-start gap-2.5 border-b border-border py-2.5 first:pt-0 last:border-0 last:pb-0"><span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-warning/10 text-[9px] font-semibold text-warning">?</span><div><p className="text-xs leading-5 text-foreground">{item}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{index === 0 ? "影响 Scope · 待客户确认" : "最近更新 07/10"}</p></div></div>)}
              </KnowledgeSection>
            </div>

            <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
              <KnowledgeSection icon={Tag} title="术语与实体" count="12">
                <div className="flex flex-wrap gap-2">{["UGC 生成器", "北美旗舰店", "LUMINA Club", "Brand Vault", "加拿大法语", "支付降级", "Global CDN", "活动素材包"].map((tag) => <button key={tag} type="button" onClick={() => askQuestion(`请总结 ${tag} 在当前项目中的已确认信息与风险。`)} className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground hover:border-primary/30 hover:text-primary">{tag}</button>)}</div>
              </KnowledgeSection>
              <KnowledgeSection icon={History} title="最近知识变化" count="过去 7 天">
                <div className="space-y-0">{[{ title: "新增 5 条需求知识", meta: "来源：客户需求确认纪要 0708", tone: "bg-primary" }, { title: "Scope v2.2 标记为当前有效", meta: "替代 v2.1 · 由林可确认", tone: "bg-success" }, { title: "更新上线日期为 09/15", meta: "来源：项目总排期 v5", tone: "bg-warning" }, { title: "1 条事实因版本冲突转为待确认", meta: "素材授权范围", tone: "bg-destructive" }].map((change, index) => <div key={change.title} className="relative flex gap-3 py-2 before:absolute before:left-[5px] before:top-5 before:h-[calc(100%-4px)] before:w-px before:bg-border last:before:hidden"><span className={`relative z-10 mt-1 size-2.5 shrink-0 rounded-full ring-2 ring-card ${change.tone}`} /><div><p className="text-xs font-medium text-foreground">{change.title}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{change.meta} · {index + 1} 天前</p></div></div>)}</div>
              </KnowledgeSection>
            </div>

            <section className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-2"><FileText className="size-4 text-muted-foreground" /><h3 className="text-sm font-semibold text-foreground">来源文档与当前有效版本</h3></div><Link href={`/projects/${id}/documents`} className="text-[11px] font-medium text-primary hover:underline">管理项目资料</Link></div>
              <div className="divide-y divide-border">{(projectDocuments.length ? projectDocuments.slice(0, 5) : Array.from({ length: 5 }, (_, index) => ({ id: `doc-${index}` }))).map((document, index) => <Link key={textValue(document, "id", `doc-${index}`)} href={`/projects/${id}/documents?document=${textValue(document, "id", `doc-${index}`)}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40"><FileText className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{textValue(document, ["name", "title", "fileName"], ["北美互动活动 Scope v2.2.pdf", "客户需求确认纪要 0708.docx", "项目总排期 v5.xlsx", "AI 图像服务技术方案.pdf", "素材授权确认邮件.eml"][index] ?? "项目资料")}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{textValue(document, "version", `v${index + 1}.0`)} · 更新于 {dateLabel(textValue(document, "updatedAt", ""))}</span></span><span className={`rounded-full px-2 py-0.5 text-[9px] ${index < 3 ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{index < 3 ? "当前有效" : "参考资料"}</span><ArrowRight className="size-3.5 text-muted-foreground" /></Link>)}</div>
            </section>
          </div>

          {assistantOpen && <aside className="self-start overflow-hidden rounded-xl border border-primary/20 bg-card xl:sticky xl:top-4">
            <div className="border-b border-primary/15 bg-primary/5 px-4 py-4"><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><Bot className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="text-sm font-semibold text-foreground">项目 AI 助手</h3><span className="size-1.5 rounded-full bg-success" /></div><p className="mt-0.5 text-[10px] text-muted-foreground">仅检索当前项目 · 已启用版本与权限过滤</p></div></div></div>
            <div className="max-h-[calc(100vh-280px)] min-h-[620px] overflow-y-auto">
              <div className="border-b border-border p-4"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">预设问题</p><div className="flex flex-wrap gap-1.5">{presetQuestions.map((item, index) => <button key={item} type="button" onClick={() => askQuestion(item, index)} className={`rounded-lg border px-2.5 py-1.5 text-left text-[10px] leading-4 transition-colors ${question === item ? "border-primary/30 bg-primary/5 text-primary" : "border-border text-muted-foreground hover:border-primary/20 hover:text-foreground"}`}>{item}</button>)}</div></div>
              <div className="space-y-4 p-4">
                <div className="ml-10 rounded-xl rounded-tr-sm bg-muted px-3.5 py-3 text-xs leading-5 text-foreground">{question}</div>
                <div className="flex items-start gap-2.5"><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground"><Sparkles className="size-3.5" /></span><div className="min-w-0 flex-1">{generating ? <div className="rounded-xl rounded-tl-sm border border-border bg-card p-4"><div className="flex items-center gap-2"><LoaderCircle className="size-4 animate-spin text-primary" /><p className="text-xs font-medium text-foreground">正在检索项目知识</p></div><div className="mt-3 space-y-2"><div className="h-2 w-full animate-pulse rounded bg-muted" /><div className="h-2 w-4/5 animate-pulse rounded bg-muted" /><div className="h-2 w-3/5 animate-pulse rounded bg-muted" /></div><div className="mt-3 flex gap-2 text-[9px] text-muted-foreground"><span>版本过滤</span><span>·</span><span>证据重排</span><span>·</span><span>生成回答</span></div></div> : <div className="rounded-xl rounded-tl-sm border border-border bg-card p-3.5 shadow-sm"><p className="text-xs leading-5 text-foreground">{answer}</p><div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-2.5 text-[9px] text-muted-foreground"><span className="inline-flex items-center gap-1"><ShieldCheck className="size-3 text-success" />置信度 {Math.round(confidence * 100)}%</span><span>·</span><span>有效版本 {effectiveVersion}</span><span>·</span><span>{(latency / 1000).toFixed(1)}s</span></div></div>}</div></div>
                {!generating && <div className="ml-9"><div className="mb-2 flex items-center justify-between"><p className="text-[10px] font-semibold text-muted-foreground">来源证据 · {normalizedCitations.length}</p><span className="text-[9px] text-muted-foreground">按相关度排序</span></div><div className="space-y-2">{normalizedCitations.slice(0, answerIndex === 0 ? 2 : 3).map((citation) => <SourceCitation key={citation.id} citation={citation} compact />)}</div></div>}
              </div>
            </div>
            <div className="border-t border-border bg-card p-3"><form onSubmit={(event) => { event.preventDefault(); askQuestion(customQuestion); setCustomQuestion(""); }} className="flex items-end gap-2 rounded-xl border border-input bg-background p-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15"><textarea rows={2} value={customQuestion} onChange={(event) => setCustomQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); askQuestion(customQuestion); setCustomQuestion(""); } }} placeholder="询问项目 Scope、需求、风险或决策…" className="max-h-24 min-h-10 flex-1 resize-none bg-transparent px-1 text-xs leading-5 text-foreground outline-none placeholder:text-muted-foreground" /><button type="submit" disabled={!customQuestion.trim() || generating} aria-label="发送问题" className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"><Send className="size-3.5" /></button></form><div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground"><span>AI 回答需结合来源人工判断</span><span>Model Profile · project-qa</span></div></div>
          </aside>}
        </div>
      </main>
    </div>
  );
}

function KnowledgeMetric({ icon: Icon, label, value, detail }: { icon: typeof Network; label: string; value: string; detail: string }) {
  return <div className="rounded-lg border border-border bg-muted/25 p-3"><div className="flex items-center gap-1.5 text-[10px] text-muted-foreground"><Icon className="size-3.5" />{label}</div><p className="mt-2 text-base font-semibold text-foreground">{value}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{detail}</p></div>;
}

function KnowledgeSection({ icon: Icon, title, count, action, children }: { icon: typeof Layers3; title: string; count: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-xl border border-border bg-card"><div className="flex items-center gap-2 border-b border-border px-4 py-3.5"><Icon className="size-4 text-muted-foreground" /><h3 className="text-sm font-semibold text-foreground">{title}</h3><span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{count}</span><div className="ml-auto">{action}</div></div><div className="p-4">{children}</div></section>;
}

function KnowledgeItem({ title, meta, status }: { title: string; meta: string; status: string }) {
  return <div className="flex w-full items-start gap-2.5 border-b border-border py-2.5 text-left first:pt-0 last:border-0 last:pb-0"><span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded-full ${status === "confirmed" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{status === "confirmed" ? <CheckCircle2 className="size-3" /> : <CircleHelp className="size-3" />}</span><span className="min-w-0 flex-1"><span className="block text-xs font-medium leading-5 text-foreground">{title}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{meta}</span></span></div>;
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted/50 px-2 py-2"><p className="text-sm font-semibold text-foreground">{value}</p><p className="mt-0.5 text-[9px] text-muted-foreground">{label}</p></div>;
}

export default ProjectKnowledgePage;
