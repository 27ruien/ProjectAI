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
import { SourceCitation } from "@/components/common/source-citation";
import { ProjectContextHeader } from "@/components/project/ProjectContextHeader";
import type { AuthorizedProjectSummary, ProjectMockPayload } from "@/lib/auth/ui-types";
import {
  asRecords,
  dateLabel,
  numberValue,
  statusLabel,
  stringList,
  textValue,
} from "@/components/project/mock-view";

interface ProjectKnowledgePageProps {
  project: AuthorizedProjectSummary;
  data: ProjectMockPayload;
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

function selectCurrentScope(scopes: Record<string, unknown>[]) {
  return scopes.find((scope) => textValue(scope, "status", "") === "active")
    ?? scopes.at(-1);
}

function scopeVersionLabel(scope: Record<string, unknown> | undefined) {
  return textValue(scope, ["versionLabel", "version"], "未标注版本");
}

function scopeReference(scope: Record<string, unknown> | undefined) {
  if (!scope) return "未标注";
  return `${textValue(scope, ["name", "title"], "项目范围")} · ${scopeVersionLabel(scope)}`;
}

function mockAnswerForProject(input: {
  project: AuthorizedProjectSummary;
  projectRecord?: Record<string, unknown>;
  scopes: Record<string, unknown>[];
  risks: Record<string, unknown>[];
  requirements: Record<string, unknown>[];
  actions: Record<string, unknown>[];
  question: string;
}): string {
  const keyword = input.question.toLocaleLowerCase("zh-CN");
  if (keyword.includes("scope")) {
    const scope = selectCurrentScope(input.scopes);
    return scope
      ? `${input.project.name} 当前有效 Scope 是 ${scopeVersionLabel(scope)}：${textValue(scope, ["name", "title"], "项目范围")}。请结合下方来源进行人工确认。`
      : `${input.project.name} 暂无可用的 Scope 演示记录。`;
  }
  if (keyword.includes("风险")) {
    const risk = input.risks[0];
    return risk
      ? `${input.project.name} 当前优先关注：${textValue(risk, ["name", "title"], "项目风险")}。${textValue(risk, ["impact", "description"], "请由项目经理结合来源确认处置方式。")}`
      : `${input.project.name} 当前没有映射的风险演示记录。`;
  }
  if (keyword.includes("需求") || keyword.includes("新增")) {
    return `${input.project.name} 当前映射 ${input.requirements.length} 条需求演示记录。AI 结果仅供辅助判断，正式写入仍需人工审核。`;
  }
  if (keyword.includes("action") || keyword.includes("过期")) {
    return `${input.project.name} 当前映射 ${input.actions.length} 条 Action 演示记录，请在 Action Plan 中核对负责人和截止时间。`;
  }
  return `${input.project.name} 的当前项目背景为：${textValue(input.projectRecord, ["summary", "description", "goal"], input.project.description || "暂无项目说明")}。此回答来自当前项目的 Mock 数据，不会检索其他项目。`;
}

export function ProjectKnowledgePage({ project, data }: ProjectKnowledgePageProps) {
  const projectRecord = data.project ?? undefined;
  const id = project.id;
  const projectDocuments = asRecords(data.documents);
  const projectRisks = asRecords(data.risks);
  const projectDecisions = asRecords(data.decisions);
  const projectScopes = asRecords(data.scopes);
  const projectScopeChanges = asRecords(data.scopeChanges);
  const projectRequirements = asRecords(data.requirements);
  const projectActions = asRecords(data.actions);
  const sourceCitations = asRecords(data.citations).slice(0, 3);
  const confirmedGoals = stringList(projectRecord, ["goals", "objectives"]);
  const constraints = stringList(projectRecord, ["constraints", "rules"]);
  const pendingQuestions = stringList(projectRecord, ["openQuestions", "questions"]);
  const terms = stringList(projectRecord, ["terms", "entities", "tags"]);
  const currentScope = selectCurrentScope(projectScopes);
  const knowledgeRecordCount = projectDocuments.length
    + projectRisks.length
    + projectDecisions.length
    + projectScopes.length
    + projectScopeChanges.length
    + projectRequirements.length
    + projectActions.length
    + sourceCitations.length;
  const [activeLayer, setActiveLayer] = useState("facts");
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [question, setQuestion] = useState(presetQuestions[0]);
  const [customQuestion, setCustomQuestion] = useState("");
  const [answer, setAnswer] = useState(() => mockAnswerForProject({ project, projectRecord, scopes: projectScopes, risks: projectRisks, requirements: asRecords(data.requirements), actions: asRecords(data.actions), question: presetQuestions[0] }));
  const [answerCitations, setAnswerCitations] = useState<unknown[]>(sourceCitations);
  const [confidence, setConfidence] = useState(sourceCitations.length ? 0.9 : 0);
  const [effectiveVersion, setEffectiveVersion] = useState(scopeReference(currentScope));
  const [latency, setLatency] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [answerIndex, setAnswerIndex] = useState(0);

  const askQuestion = async (nextQuestion: string, index = -1) => {
    if (!nextQuestion.trim()) return;
    setQuestion(nextQuestion.trim());
    setGenerating(true);
    try {
      await new Promise((resolve) => window.setTimeout(resolve, 500));
      setAnswer(mockAnswerForProject({ project, projectRecord, scopes: projectScopes, risks: projectRisks, requirements: asRecords(data.requirements), actions: asRecords(data.actions), question: nextQuestion.trim() }));
      setAnswerCitations(sourceCitations);
      setConfidence(sourceCitations.length ? 0.9 : 0.62);
      setEffectiveVersion(scopeReference(selectCurrentScope(projectScopes)));
      setLatency(500);
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
    documentName: textValue(citation, ["documentName", "sourceName"], textValue(projectDocuments[index], ["name", "title", "fileName"], "项目资料")),
    section: textValue(citation, "section", "未标注章节"),
    pageNumber: numberValue(citation, "pageNumber", 0),
    sourceDate: textValue(citation, "sourceDate", textValue(projectDocuments[index], ["updatedAt", "createdAt"], "")),
    status: textValue(citation, "status", "confirmed"),
    isEffectiveVersion: Boolean(citation.isEffectiveVersion ?? citation.isEffective ?? false),
    citationText: textValue(citation, ["citationText", "text"], "当前引用片段暂无预览。"),
    trustLevel: textValue(citation, "trustLevel", "verified"),
  }));

  return (
    <div className="min-h-full bg-background">
      <ProjectContextHeader project={project} activeTab="knowledge" onOpenAI={() => setAssistantOpen(true)} />
      <main className="px-5 py-5 lg:px-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex items-center gap-2"><h2 className="text-lg font-semibold text-foreground">项目知识</h2><span className="rounded-full border border-success/20 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">授权项目数据</span></div><p className="mt-1 text-xs text-muted-foreground">当前载入 {knowledgeRecordCount} 条知识记录 · 仅包含当前项目</p></div>
          <div className="flex items-center gap-2"><span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"><Clock3 className="size-3.5" />按项目权限过滤</span><button type="button" onClick={() => setAssistantOpen((value) => !value)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted">{assistantOpen ? <PanelRightClose className="size-3.5" /> : <PanelRightOpen className="size-3.5" />}{assistantOpen ? "收起助手" : "打开助手"}</button></div>
        </div>

        <section className="mb-5 overflow-x-auto rounded-xl border border-border bg-card p-2">
          <div className="flex min-w-max gap-1">{knowledgeLayers.map((layer) => <button key={layer.id} type="button" onClick={() => setActiveLayer(layer.id)} className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${activeLayer === layer.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><layer.icon className="size-3.5" />{layer.label}</button>)}</div>
        </section>

        <div className={`grid gap-5 ${assistantOpen ? "xl:grid-cols-[minmax(0,1fr)_430px]" : "grid-cols-1"}`}>
          <div className="min-w-0 space-y-5">
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-3xl"><div className="mb-2 flex items-center gap-2"><Target className="size-4 text-primary" /><h3 className="text-sm font-semibold text-foreground">项目背景</h3></div><p className="text-sm leading-6 text-muted-foreground">{textValue(projectRecord, ["summary", "description", "goal"], project.description || "暂无项目说明")}</p></div><div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-right"><p className="text-[10px] text-muted-foreground">来源状态</p><p className="mt-1 text-sm font-semibold text-success">{sourceCitations.length ? "已有引用" : "待补充"}</p></div></div>
              <div className="mt-5 grid gap-3 md:grid-cols-3"><KnowledgeMetric icon={ShieldCheck} label="已确认目标" value={`${confirmedGoals.length} 项`} detail="当前项目记录" /><KnowledgeMetric icon={Flag} label="关键约束" value={`${constraints.length} 项`} detail="当前项目记录" /><KnowledgeMetric icon={CheckCircle2} label="已确认决策" value={String(projectDecisions.length)} detail="当前项目记录" /></div>
            </section>

            <div className="grid gap-5 lg:grid-cols-2">
              <KnowledgeSection icon={ShieldCheck} title="已确认目标" count={String(confirmedGoals.length)}>
                {confirmedGoals.map((item) => <KnowledgeItem key={item} title={item} meta="来自当前项目知识记录" status="confirmed" />)}
                {!confirmedGoals.length && <EmptyKnowledgeState label="当前项目尚无已确认目标" />}
              </KnowledgeSection>
              <KnowledgeSection icon={Flag} title="关键约束" count={String(constraints.length)}>
                {constraints.map((item) => <KnowledgeItem key={item} title={item} meta="来自当前项目知识记录" status="confirmed" />)}
                {!constraints.length && <EmptyKnowledgeState label="当前项目尚无关键约束记录" />}
              </KnowledgeSection>
              <KnowledgeSection icon={FileCheck2} title="当前 Scope" count={scopeVersionLabel(currentScope)} action={<Link href={`/projects/${id}/scope`} className="text-[11px] font-medium text-primary hover:underline">查看 Scope</Link>}>
                {currentScope ? <><div className="rounded-lg border border-success/20 bg-success/5 p-3"><div className="flex items-center justify-between"><div><p className="text-xs font-semibold text-foreground">{textValue(currentScope, ["name", "title"], "未命名 Scope")}</p><p className="mt-1 text-[11px] text-muted-foreground">更新于 {dateLabel(currentScope.updatedAt ?? currentScope.effectiveAt, "日期未记录")}</p></div><span className="rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">当前项目</span></div></div><div className="mt-3 grid grid-cols-3 gap-2 text-center"><MiniStat label="范围项" value={String(numberValue(currentScope, ["itemCount", "inScopeCount"], 0))} /><MiniStat label="排除项" value={String(numberValue(currentScope, "excludedCount", 0))} /><MiniStat label="待确认" value={String(numberValue(currentScope, "pendingCount", 0))} /></div></> : <EmptyKnowledgeState label="当前项目尚无 Scope 记录" />}
              </KnowledgeSection>
              <KnowledgeSection icon={CalendarClock} title="当前排期" count={statusLabel(project.stage)}>
                <div className="space-y-3"><div className="rounded-lg bg-muted/40 p-3"><p className="text-[10px] text-muted-foreground">当前阶段</p><p className="mt-1 text-xs font-medium text-foreground">{statusLabel(project.stage)}</p></div><div className="rounded-lg bg-muted/40 p-3"><p className="text-[10px] text-muted-foreground">目标上线</p><p className="mt-1 text-xs font-medium text-foreground">{dateLabel(project.targetLaunchDate, "尚未设置")}</p></div></div>
              </KnowledgeSection>
              <KnowledgeSection icon={AlertCircle} title="当前风险" count={String(projectRisks.length)} action={<Link href={`/projects/${id}/risks`} className="text-[11px] font-medium text-primary hover:underline">风险详情</Link>}>
                {projectRisks.slice(0, 3).map((risk, index) => { const level = textValue(risk, ["level", "severity"], "medium"); return <div key={textValue(risk, "id", `risk-${index}`)} className="flex items-start gap-2.5 border-b border-border py-2.5 first:pt-0 last:border-0 last:pb-0"><span className={`mt-1.5 size-2 rounded-full ${["high", "critical"].includes(level) ? "bg-destructive" : "bg-warning"}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium text-foreground">{textValue(risk, ["name", "title"], "未命名项目风险")}</p><p className="mt-1 text-[10px] text-muted-foreground">{statusLabel(level)}风险 · {textValue(risk, ["owner", "assignee"], "负责人未记录")}</p></div></div>; })}
                {!projectRisks.length && <EmptyKnowledgeState label="当前项目尚无风险记录" />}
              </KnowledgeSection>
              <KnowledgeSection icon={CircleHelp} title="待确认问题" count={String(pendingQuestions.length)}>
                {pendingQuestions.map((item) => <div key={item} className="flex items-start gap-2.5 border-b border-border py-2.5 first:pt-0 last:border-0 last:pb-0"><span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-warning/10 text-[9px] font-semibold text-warning">?</span><div><p className="text-xs leading-5 text-foreground">{item}</p><p className="mt-0.5 text-[10px] text-muted-foreground">来自当前项目知识记录</p></div></div>)}
                {!pendingQuestions.length && <EmptyKnowledgeState label="当前项目尚无待确认问题" />}
              </KnowledgeSection>
            </div>

            <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
              <KnowledgeSection icon={Tag} title="术语与实体" count={String(terms.length)}>
                <div className="flex flex-wrap gap-2">{terms.map((tag) => <button key={tag} type="button" onClick={() => askQuestion(`请总结 ${tag} 在当前项目中的已确认信息与风险。`)} className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11px] text-muted-foreground hover:border-primary/30 hover:text-primary">{tag}</button>)}</div>
                {!terms.length && <EmptyKnowledgeState label="当前项目尚无术语与实体记录" />}
              </KnowledgeSection>
              <KnowledgeSection icon={History} title="最近知识变化" count={String(projectScopeChanges.length)}>
                <div className="space-y-0">{projectScopeChanges.slice(0, 5).map((change, index) => <div key={textValue(change, "id", `change-${index}`)} className="relative flex gap-3 py-2 before:absolute before:left-[5px] before:top-5 before:h-[calc(100%-4px)] before:w-px before:bg-border last:before:hidden"><span className="relative z-10 mt-1 size-2.5 shrink-0 rounded-full bg-primary ring-2 ring-card" /><div><p className="text-xs font-medium text-foreground">{textValue(change, ["title", "name"], "未命名知识变化")}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{textValue(change, ["description", "summary"], "变更说明未记录")} · {dateLabel(change.createdAt ?? change.updatedAt, "时间未记录")}</p></div></div>)}</div>
                {!projectScopeChanges.length && <EmptyKnowledgeState label="当前项目尚无知识变化记录" />}
              </KnowledgeSection>
            </div>

            <section className="rounded-xl border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-4"><div className="flex items-center gap-2"><FileText className="size-4 text-muted-foreground" /><h3 className="text-sm font-semibold text-foreground">来源文档与当前有效版本</h3></div><Link href={`/projects/${id}/documents`} className="text-[11px] font-medium text-primary hover:underline">管理项目资料</Link></div>
              <div className="divide-y divide-border">{projectDocuments.slice(0, 5).map((document, index) => { const isEffective = Boolean(document.isEffectiveVersion ?? document.isEffective ?? false); return <Link key={textValue(document, "id", `doc-${index}`)} href={`/projects/${id}/documents?document=${textValue(document, "id", `doc-${index}`)}`} className="flex items-center gap-3 px-5 py-3 hover:bg-muted/40"><FileText className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-foreground">{textValue(document, ["name", "title", "fileName"], "未命名项目资料")}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{textValue(document, "version", "版本未标注")} · 更新于 {dateLabel(textValue(document, "updatedAt", ""), "时间未记录")}</span></span><span className={`rounded-full px-2 py-0.5 text-[9px] ${isEffective ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{isEffective ? "当前有效" : "参考资料"}</span><ArrowRight className="size-3.5 text-muted-foreground" /></Link>; })}{!projectDocuments.length && <EmptyKnowledgeState label="当前项目尚无来源文档" />}</div>
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

function EmptyKnowledgeState({ label }: { label: string }) {
  return <p className="py-4 text-center text-xs text-muted-foreground">{label}</p>;
}

export default ProjectKnowledgePage;
