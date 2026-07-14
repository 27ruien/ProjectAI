"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  FileText,
  GitCompareArrows,
  History,
  Link2,
  LoaderCircle,
  Save,
  Send,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { SourceCitation } from "@/components/common/source-citation";
import { asRecords, numberValue, statusClasses, statusLabel, textValue } from "@/components/project/mock-view";
import type { SerializableRecord } from "@/lib/auth/ui-types";

export interface RequirementHistoryView {
  id: string;
  title: string;
  user: string;
  time: string;
  detail: string;
}

export interface RequirementView {
  id: string;
  code: string;
  title: string;
  description: string;
  type: string;
  source: string;
  aiUnderstanding: string;
  originalQuote: string;
  acceptanceCriteria: string;
  exceptionStates: string;
  nonFunctional: string;
  relatedPages: string[];
  relatedTasks: string[];
  relatedScope: string;
  inOriginalScope: boolean;
  priority: string;
  assignee: string;
  status: string;
  acceptanceStatus: string;
  updatedAt: string;
  citationCount: number;
  citationIds: string[];
  confidence: number;
  flags: string[];
  history: RequirementHistoryView[];
}

export interface RequirementDrawerProps {
  open: boolean;
  requirement: RequirementView | null;
  citations: SerializableRecord[];
  readOnly?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (requirement: RequirementView) => void;
  onSubmitReview?: (requirement: RequirementView) => void;
}

type DrawerTab = "detail" | "evidence" | "history";

const typeLabels: Record<string, string> = {
  functional: "功能需求",
  nonFunctional: "非功能需求",
  businessRule: "业务规则",
  technicalConstraint: "技术约束",
  compliance: "合规需求",
  content: "内容需求",
  design: "设计需求",
  integration: "集成需求",
};

export function RequirementDrawer({ open, requirement, citations, readOnly = false, onOpenChange, onSave, onSubmitReview }: RequirementDrawerProps) {
  const [draft, setDraft] = useState<RequirementView | null>(requirement);
  const [editing, setEditing] = useState(!readOnly && (requirement?.id.startsWith("new-") ?? false));
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<DrawerTab>("detail");
  const [notice, setNotice] = useState("");
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onOpenChange, open]);

  const evidence = useMemo(() => {
    const citationIds = new Set(draft?.citationIds ?? []);
    const rows = asRecords(citations).filter((citation) => {
      const citationId = textValue(citation, "id", "");
      const requirementId = textValue(citation, ["requirementId", "relatedRequirementId"], "");
      return citationIds.has(citationId) || (Boolean(draft?.id) && requirementId === draft?.id);
    });
    return rows.map((citation, index) => ({
      id: textValue(citation, "id", `req-citation-${index}`),
      documentId: textValue(citation, "documentId", "未提供"),
      documentName: textValue(citation, ["documentName", "sourceName"], "未命名来源"),
      section: textValue(citation, "section", "未提供章节"),
      pageNumber: numberValue(citation, "pageNumber", 0) || undefined,
      sourceDate: textValue(citation, "sourceDate", ""),
      status: textValue(citation, ["status", "sourceStatus"], "未提供"),
      isEffectiveVersion: Boolean(citation.isEffectiveVersion ?? citation.isEffective ?? false),
      citationText: textValue(citation, ["citationText", "text"], "引用内容未提供。"),
      trustLevel: textValue(citation, "trustLevel", "未提供"),
    }));
  }, [citations, draft?.citationIds, draft?.id]);

  if (!open || !draft) return null;

  const update = <K extends keyof RequirementView>(key: K, value: RequirementView[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);
  const save = async () => {
    setSaving(true);
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    onSave({ ...draft, updatedAt: new Date().toISOString() });
    setSaving(false);
    setEditing(false);
    setNotice("浏览器演示：修改仅保存在当前页面状态");
  };
  const setWorkflowStatus = (status: string, message: string) => {
    const next = { ...draft, status, updatedAt: new Date().toISOString() };
    setDraft(next);
    onSave(next);
    setNotice(message);
  };
  const submitReview = () => {
    const next = { ...draft, status: "pendingReview", updatedAt: new Date().toISOString() };
    setDraft(next);
    onSave(next);
    onSubmitReview?.(next);
    setNotice("浏览器演示：已标记为待审核，未写入正式需求");
  };

  const relatedItems = [
    ...draft.relatedPages.map((item) => `页面 · ${item}`),
    ...draft.relatedTasks.map((item) => `任务 · ${item}`),
    ...(draft.relatedScope && draft.relatedScope !== "未关联" ? [`Scope · ${draft.relatedScope}`] : []),
  ];

  return (
    <div className="fixed inset-0 z-50" role="presentation">
      <button type="button" aria-label="关闭需求详情" onClick={() => onOpenChange(false)} className="absolute inset-0 bg-overlay/45 backdrop-blur-[1px]" />
      <section role="dialog" aria-modal="true" aria-labelledby="requirement-drawer-title" className="absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl animate-in slide-in-from-right duration-200">
        <header className="shrink-0 border-b border-border px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-mono text-xs font-semibold text-primary">{draft.code}</span><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClasses(draft.status)}`}>{statusLabel(draft.status)}</span>{draft.flags.map((flag) => <span key={flag} className="rounded-full border border-destructive/20 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">{flag === "duplicate" ? "疑似重复" : flag === "conflict" ? "存在冲突" : flag}</span>)}</div>
              {editing ? <input id="requirement-drawer-title" value={draft.title} onChange={(event) => update("title", event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2 text-base font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" /> : <h2 id="requirement-drawer-title" className="text-lg font-semibold leading-6 text-foreground">{draft.title}</h2>}
            </div>
            <button ref={closeButtonRef} type="button" onClick={() => onOpenChange(false)} aria-label="关闭" className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X className="size-4" /></button>
          </div>
          {notice && <div className="mt-3 flex items-center gap-2 rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-xs text-success"><CheckCircle2 className="size-3.5" />{notice}</div>}
          <nav className="mt-4 flex gap-1" aria-label="需求详情标签">{([{ id: "detail", label: "需求详情", icon: FileText }, { id: "evidence", label: `证据引用 ${evidence.length}`, icon: Link2 }, { id: "history", label: "修改历史", icon: History }] as const).map((tab) => <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`relative inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium ${activeTab === tab.id ? "text-primary after:absolute after:inset-x-2 after:-bottom-4 after:h-0.5 after:bg-primary" : "text-muted-foreground hover:text-foreground"}`}><tab.icon className="size-3.5" />{tab.label}</button>)}</nav>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {activeTab === "detail" && <div className="space-y-5">
            <section><SectionLabel icon={FileText} label="需求描述" />{editing ? <textarea rows={4} value={draft.description} onChange={(event) => update("description", event.target.value)} className={editorClasses} /> : <p className="rounded-lg bg-muted/35 p-3 text-sm leading-6 text-foreground">{draft.description}</p>}</section>
            <div className="grid gap-4 sm:grid-cols-2">
              <DrawerField label="需求类型">{editing ? <select value={draft.type} onChange={(event) => update("type", event.target.value)} className={editorClasses}>{Object.entries(typeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select> : <ValueText>{typeLabels[draft.type] ?? draft.type}</ValueText>}</DrawerField>
              <DrawerField label="来源"><ValueText>{draft.source}</ValueText></DrawerField>
              <DrawerField label="优先级">{editing ? <select value={draft.priority} onChange={(event) => update("priority", event.target.value)} className={editorClasses}>{["P0", "P1", "P2", "P3"].map((item) => <option key={item}>{item}</option>)}</select> : <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${statusClasses(draft.priority)}`}>{draft.priority}</span>}</DrawerField>
              <DrawerField label="负责人">{editing ? <input value={draft.assignee} onChange={(event) => update("assignee", event.target.value)} placeholder="输入负责人" className={editorClasses} /> : <ValueText>{draft.assignee}</ValueText>}</DrawerField>
              <DrawerField label="是否属于原 Scope">{editing ? <label className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 text-xs text-foreground"><input type="checkbox" checked={draft.inOriginalScope} onChange={(event) => update("inOriginalScope", event.target.checked)} className="accent-primary" />属于原 Scope</label> : <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${draft.inOriginalScope ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{draft.inOriginalScope ? "原 Scope 内" : "Scope 外新增"}</span>}</DrawerField>
              <DrawerField label="关联 Scope"><ValueText>{draft.relatedScope}</ValueText></DrawerField>
            </div>
            <section className="rounded-xl border border-primary/15 bg-primary/5 p-4"><div className="mb-2 flex items-center justify-between"><SectionLabel icon={Bot} label="AI 理解" /><span className="inline-flex items-center gap-1 text-[10px] font-medium text-success"><ShieldCheck className="size-3" />置信度 {draft.confidence}%</span></div>{editing ? <textarea rows={4} value={draft.aiUnderstanding} onChange={(event) => update("aiUnderstanding", event.target.value)} className={editorClasses} /> : <p className="text-sm leading-6 text-foreground">{draft.aiUnderstanding}</p>}<p className="mt-3 border-t border-primary/10 pt-2 text-[10px] text-muted-foreground">AI 理解为可编辑草稿，提交审核前不会写入正式项目数据。</p></section>
            <section><SectionLabel icon={FileText} label="原文引用" />{editing ? <textarea rows={3} value={draft.originalQuote} onChange={(event) => update("originalQuote", event.target.value)} className={editorClasses} /> : <blockquote className="border-l-2 border-primary/40 bg-muted/30 py-2 pl-3 text-sm italic leading-6 text-muted-foreground">“{draft.originalQuote}”</blockquote>}</section>
            <section><SectionLabel icon={CheckCircle2} label="验收标准" />{editing ? <textarea rows={5} value={draft.acceptanceCriteria} onChange={(event) => update("acceptanceCriteria", event.target.value)} className={editorClasses} /> : <div className="space-y-2">{draft.acceptanceCriteria.split("\n").filter(Boolean).map((criterion, index) => <div key={`${criterion}-${index}`} className="flex gap-2 text-sm leading-5 text-foreground"><Check className="mt-0.5 size-4 shrink-0 text-success" /><span>{criterion.replace(/^[-\d.、\s]+/, "")}</span></div>)}</div>}</section>
            <div className="grid gap-4 sm:grid-cols-2"><DrawerField label="异常状态">{editing ? <textarea rows={3} value={draft.exceptionStates} onChange={(event) => update("exceptionStates", event.target.value)} className={editorClasses} /> : <ValueText>{draft.exceptionStates}</ValueText>}</DrawerField><DrawerField label="非功能要求">{editing ? <textarea rows={3} value={draft.nonFunctional} onChange={(event) => update("nonFunctional", event.target.value)} className={editorClasses} /> : <ValueText>{draft.nonFunctional}</ValueText>}</DrawerField></div>
            <section><SectionLabel icon={Link2} label="关联对象" /><div className="flex flex-wrap gap-2">{relatedItems.map((item) => <button key={item} type="button" className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:border-primary/30 hover:text-primary"><Link2 className="size-3" />{item}</button>)}{relatedItems.length === 0 ? <span className="text-xs text-muted-foreground">暂无关联对象。</span> : null}{readOnly ? null : <button type="button" onClick={() => setNotice("浏览器演示：关联来源选择器未接入服务端")} className="inline-flex items-center gap-1 rounded-lg border border-dashed border-primary/40 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5">+ 关联来源</button>}</div></section>
          </div>}

          {activeTab === "evidence" && <div className="space-y-4"><div className={`rounded-xl border p-4 ${evidence.length ? "border-success/20 bg-success/5" : "border-border bg-muted/20"}`}><div className="flex items-center gap-2"><ShieldCheck className={`size-4 ${evidence.length ? "text-success" : "text-muted-foreground"}`} /><div><p className="text-sm font-medium text-foreground">{evidence.length ? "来源证据" : "暂无来源证据"}</p><p className="mt-1 text-xs text-muted-foreground">{evidence.length ? `${evidence.length} 条引用来自父级传入的当前项目授权数据。` : "父级 payload 未提供与该需求精确关联的引用。"}</p></div></div></div>{evidence.length ? <div className="space-y-3">{evidence.map((citation) => <SourceCitation key={citation.id} citation={citation} />)}</div> : null}{readOnly ? null : <button type="button" onClick={() => setNotice("浏览器演示：关联来源选择器未接入服务端")} className="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-primary/40 text-xs font-medium text-primary hover:bg-primary/5"><Link2 className="size-3.5" />关联新的来源证据</button>}</div>}

          {activeTab === "history" && (draft.history.length ? <div className="space-y-0">{draft.history.map((history, index) => <div key={history.id} className="relative flex gap-3 pb-6 before:absolute before:left-[7px] before:top-5 before:h-full before:w-px before:bg-border last:before:hidden"><span className={`relative z-10 mt-1 size-4 shrink-0 rounded-full border-2 border-card ${index === 0 ? "bg-primary" : "bg-muted-foreground/35"}`} /><div className="min-w-0 flex-1 rounded-lg border border-border p-3"><div className="flex items-start justify-between gap-3"><p className="text-xs font-semibold text-foreground">{history.title}</p><span className="shrink-0 text-[10px] text-muted-foreground">{history.time || "未提供时间"}</span></div><p className="mt-1 text-[10px] text-muted-foreground">{history.user}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{history.detail}</p>{index === 1 && <button type="button" onClick={() => setNotice("浏览器演示：已打开差异视图占位")} className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium text-primary hover:underline"><GitCompareArrows className="size-3" />查看版本差异</button>}</div></div>)}</div> : <div className="rounded-xl border border-dashed border-border p-5 text-sm text-muted-foreground">父级 payload 未提供该需求的修改历史。</div>)}
        </div>

        {readOnly ? <div className="shrink-0 border-t border-border bg-info-soft px-5 py-3 text-xs text-info">只读访问：修改、确认和审核操作已关闭。</div> : <div className="shrink-0 border-t border-border bg-card px-5 py-3">
          <div className="mb-3 flex flex-wrap items-center gap-1.5"><button type="button" onClick={() => setWorkflowStatus("confirmed", "浏览器演示：已标记为确认，未写入正式需求")} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-success hover:bg-success/10"><CheckCircle2 className="size-3.5" />确认需求</button><button type="button" onClick={() => setWorkflowStatus("rejected", "浏览器演示：已标记为驳回，未写入服务端")} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] font-medium text-destructive hover:bg-destructive/10"><XCircle className="size-3.5" />驳回</button><button type="button" onClick={() => { update("flags", draft.flags.includes("duplicate") ? draft.flags : [...draft.flags, "duplicate"]); setNotice("浏览器演示：已标记为疑似重复"); }} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"><Copy className="size-3.5" />标记重复</button><button type="button" onClick={() => { update("flags", draft.flags.includes("conflict") ? draft.flags : [...draft.flags, "conflict"]); setNotice("浏览器演示：已标记为存在冲突"); }} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"><AlertTriangle className="size-3.5" />标记冲突</button><button type="button" onClick={() => setActiveTab("history")} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"><History className="size-3.5" />历史版本</button></div>
          <div className="flex items-center justify-between gap-3"><p className="hidden text-[10px] text-muted-foreground sm:block">最后更新：{draft.updatedAt || "刚刚"}</p><div className="ml-auto flex items-center gap-2">{editing ? <><button type="button" onClick={() => { setDraft(requirement); setEditing(false); }} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted">取消编辑</button><button type="button" onClick={save} disabled={saving || !draft.title.trim()} className="inline-flex h-9 min-w-24 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50">{saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}保存</button></> : <><button type="button" onClick={() => setEditing(true)} className="inline-flex h-9 items-center rounded-lg border border-border px-3 text-xs font-medium text-foreground hover:bg-muted">编辑需求</button><button type="button" onClick={submitReview} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90"><Send className="size-3.5" />提交审核</button></>}</div></div>
        </div>}
      </section>
    </div>
  );
}

const editorClasses = "w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";

function SectionLabel({ icon: Icon, label }: { icon: typeof FileText; label: string }) { return <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-foreground"><Icon className="size-3.5 text-muted-foreground" />{label}</div>; }
function DrawerField({ label, children }: { label: string; children: React.ReactNode }) { return <div><p className="mb-1.5 text-[11px] font-medium text-muted-foreground">{label}</p>{children}</div>; }
function ValueText({ children }: { children: React.ReactNode }) { return <p className="text-sm leading-6 text-foreground">{children}</p>; }

export default RequirementDrawer;
