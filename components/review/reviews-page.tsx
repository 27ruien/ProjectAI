"use client";

import { useEffect, useMemo, useState } from "react";
import { mockAIGateway } from "@/lib/ai";
import type {
  AuthorizedProjectSummary,
  WorkspaceMockPayload,
} from "@/lib/auth/ui-types";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  FileText,
  Filter,
  Link2,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  X,
  XCircle,
} from "lucide-react";
import { AIExecutionInfo, type ExecutionInfoRecord } from "./ai-execution-info";
import { ReviewPanel, reviewTypeLabel, stringifyContent, type ReviewPanelTask } from "./review-panel";

type ReviewRecord = ReviewPanelTask & {
  projectId: string;
  canReview: boolean;
  status: string;
  citationIds: string[];
  sourceIds: string[];
  skillId: string;
  modelProfileId: string;
  aiExecutionId: string;
  assignee?: string;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
};

type CitationRecord = {
  id: string;
  documentName?: string;
  citationText?: string;
  content?: string;
  pageNumber?: number;
  sectionTitle?: string;
  similarity?: number;
  sourceStatus?: string;
};

type ProjectRecord = { id: string; name: string };

type ReviewAction = "approved" | "approvedWithChanges" | "rejected" | "draft";

interface ReviewsPageProps {
  data: WorkspaceMockPayload;
  projects: AuthorizedProjectSummary[];
}

export function ReviewsPage({ data, projects: authorizedProjects }: ReviewsPageProps) {
  const sourceReviews = data.reviews as unknown as ReviewRecord[];
  const projects = authorizedProjects as ProjectRecord[];
  const citations = data.citations as unknown as CitationRecord[];
  const executions = data.aiExecutions as unknown as ExecutionInfoRecord[];
  const [records, setRecords] = useState(sourceReviews);
  const [selectedId, setSelectedId] = useState(sourceReviews[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("pending");
  const [contentDrafts, setContentDrafts] = useState<Record<string, string>>({});
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  const filtered = useMemo(
    () =>
      records.filter((review) => {
        const query = search.toLowerCase();
        return (
          `${review.title} ${reviewTypeLabel(review.type)}`.toLowerCase().includes(query) &&
          (typeFilter === "all" || review.type === typeFilter) &&
          (projectFilter === "all" || review.projectId === projectFilter) &&
          (statusFilter === "all" || (statusFilter === "pending" ? ["generated", "pendingReview"].includes(review.status) : statusFilter === "approved" ? ["approved", "approvedWithChanges"].includes(review.status) : review.status === statusFilter))
        );
      }),
    [projectFilter, records, search, statusFilter, typeFilter],
  );

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2600);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const selected = filtered.find((record) => record.id === selectedId) ?? filtered[0];
  const projectName = (projectId: string) => projects.find((project) => project.id === projectId)?.name ?? "未命名项目";

  const act = (action: ReviewAction) => {
    if (!selected?.canReview) {
      setFeedback("当前项目为只读权限，不能执行审核操作");
      return;
    }
    const status = action === "draft" ? selected.status : action;
    setRecords((current) => current.map((item) => (item.id === selected.id ? { ...item, status } : item)));
    const labels: Record<ReviewAction, string> = {
      approved: "审核已通过，内容可进入项目数据写入队列",
      approvedWithChanges: "修改后通过，已保留原始版本与差异记录",
      rejected: "已驳回并通知工作流发起人",
      draft: "审核草稿已保存",
    };
    setFeedback(labels[action]);
  };

  const regenerate = async () => {
    if (!selected?.canReview) {
      setFeedback("当前项目为只读权限，不能重新生成草稿");
      return;
    }
    setRegenerating(true);
    try {
      const result = await mockAIGateway.generateText({
        profileId: selected.modelProfileId,
        projectId: selected.projectId,
        skillId: selected.skillId,
        prompt: `基于审核备注重新生成「${selected.title}」的可审核草稿，保留来源引用。`,
        sourceIds: selected.sourceIds,
      });
      setContentDrafts((current) => ({ ...current, [selected.id]: `${stringifyContent(selected.editableContent)}\n\n重新生成说明：${result.text}` }));
      setRegenerating(false);
      setFeedback(`已通过 AI Gateway 生成新草稿（${result.executionId}），原始版本仍可追溯`);
    } catch {
      setRegenerating(false);
      setFeedback("重新生成失败，原始草稿与审核备注均已保留");
    }
  };

  return (
    <div className="-m-4 flex min-h-[calc(100vh-72px)] flex-col bg-background lg:-m-6">
      <header className="border-b border-border bg-card px-4 py-4 lg:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-primary"><ShieldCheck className="size-3.5" /> Human in the loop</div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">审核中心</h1>
            <p className="mt-1 text-xs text-muted-foreground">核对 AI 生成结果、来源证据与执行信息后，再写入正式项目数据。</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground"><strong className="mr-1.5 text-base text-foreground">{records.filter((item) => ["generated", "pendingReview"].includes(item.status)).length}</strong>待审核</span>
            <span className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted-foreground"><strong className="mr-1.5 text-base text-emerald-700">{records.filter((item) => ["approved", "approvedWithChanges"].includes(item.status)).length}</strong>已完成</span>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[280px_minmax(430px,1fr)_310px]">
        <aside className="flex min-h-0 flex-col border-b border-border bg-card xl:border-b-0 xl:border-r">
          <div className="space-y-2 border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索审核任务" className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <FilterSelect value={typeFilter} onChange={setTypeFilter} ariaLabel="审核类型">
                <option value="all">全部类型</option>
                {Array.from(new Set(records.map((item) => item.type))).map((type) => <option key={type} value={type}>{reviewTypeLabel(type)}</option>)}
              </FilterSelect>
              <FilterSelect value={projectFilter} onChange={setProjectFilter} ariaLabel="项目">
                <option value="all">全部项目</option>
                {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </FilterSelect>
            </div>
            <div className="flex gap-1 rounded-lg bg-muted/60 p-1">
              {["pending", "approved", "all"].map((status) => (
                <button key={status} type="button" onClick={() => setStatusFilter(status)} className={`h-7 flex-1 rounded-md text-[10px] font-medium ${statusFilter === status ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}>
                  {status === "pending" ? "待审核" : status === "approved" ? "已通过" : "全部"}
                </button>
              ))}
            </div>
          </div>
          <div className="max-h-72 overflow-auto xl:max-h-[calc(100vh-300px)] xl:flex-1">
            {filtered.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`w-full border-b border-border px-4 py-3.5 text-left transition ${selectedId === item.id ? "bg-primary/[0.06] shadow-[inset_3px_0_var(--primary)]" : "hover:bg-muted/40"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">{reviewTypeLabel(item.type)}</span>
                    {!item.canReview ? <span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">只读</span> : null}
                  </span>
                  <ReviewStatus status={item.status} />
                </div>
                <p className="mt-2 line-clamp-2 text-xs font-medium leading-5 text-foreground">{item.title}</p>
                <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                  <span className="truncate">{projectName(item.projectId)}</span>
                  <span className="shrink-0">{formatDate(item.createdAt)}</span>
                </div>
              </button>
            ))}
            {!filtered.length ? <div className="p-8 text-center text-xs text-muted-foreground">当前筛选下没有审核任务。</div> : null}
          </div>
        </aside>

        {selected ? (
          <ReviewPanel
            task={selected}
            value={contentDrafts[selected.id] ?? stringifyContent(selected.editableContent)}
            onChange={(value) => selected.canReview && setContentDrafts((current) => ({ ...current, [selected.id]: value }))}
            reviewNote={noteDrafts[selected.id] ?? selected.reviewNote ?? ""}
            onReviewNoteChange={(value) => selected.canReview && setNoteDrafts((current) => ({ ...current, [selected.id]: value }))}
            regenerating={regenerating}
            readOnly={!selected.canReview}
          />
        ) : (
          <div className="flex min-h-96 items-center justify-center bg-card text-sm text-muted-foreground">请选择一个审核任务</div>
        )}

        <aside className="min-h-0 border-t border-border bg-card xl:border-l xl:border-t-0">
          {selected ? (
            <div className="max-h-[calc(100vh-160px)] overflow-auto">
              <div className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground"><Link2 className="size-3.5 text-primary" /> 来源证据</h3>
                  <span className="text-[10px] text-muted-foreground">{selected.citationIds?.length ?? 0} 项引用</span>
                </div>
                <div className="mt-3 space-y-2.5">
                  {citations
                    .filter((citation) => selected.citationIds?.includes(citation.id))
                    .slice(0, 4)
                    .map((citation) => <CitationCard key={citation.id} citation={citation} />)}
                  {!citations.some((citation) => selected.citationIds?.includes(citation.id)) ? (
                    <CitationCard citation={citations[0] ?? { id: "citation-demo", documentName: "客户需求说明_v3.docx", sectionTitle: "2.4 互动体验", citationText: "系统应支持用户通过现场屏幕完成多轮互动，并在结束后生成个性化结果。", similarity: 0.94 }} />
                  ) : null}
                </div>
              </div>
              <AIExecutionInfo
                execution={executions.find((execution) => execution.id === selected.aiExecutionId || execution.executionId === selected.aiExecutionId)}
                skillName={selected.skillId}
                modelProfile={selected.modelProfileId}
                confidence={selected.confidence}
              />
            </div>
          ) : null}
        </aside>
      </div>

      {selected ? (
        <footer className="sticky bottom-0 z-20 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-card/95 px-4 py-3 shadow-[0_-8px_24px_rgba(15,23,42,0.05)] backdrop-blur lg:px-6">
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Clock3 className="size-3.5" />
            {selected.canReview
              ? "草稿修改将自动记录为新审核版本"
              : "当前项目为只读权限，不能修改、重新生成或审核"}
          </div>
          {selected.canReview ? (
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={regenerate} disabled={regenerating} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"><RefreshCw className={`size-3.5 ${regenerating ? "animate-spin" : ""}`} /> 重新生成</button>
              <button type="button" onClick={() => act("draft")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-xs font-medium text-foreground hover:bg-muted"><Save className="size-3.5" /> 保存草稿</button>
              <button type="button" onClick={() => act("rejected")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-destructive/30 px-3 text-xs font-medium text-destructive hover:bg-destructive/5"><X className="size-3.5" /> 驳回</button>
              <button type="button" onClick={() => act("approvedWithChanges")} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/5 px-3 text-xs font-medium text-primary hover:bg-primary/10"><CheckCircle2 className="size-3.5" /> 修改后通过</button>
              <button type="button" onClick={() => act("approved")} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3.5 text-xs font-medium text-primary-foreground hover:opacity-90"><Check className="size-3.5" /> 通过</button>
            </div>
          ) : null}
        </footer>
      ) : null}

      {feedback ? (
        <div className="fixed bottom-6 right-6 z-50 flex max-w-sm items-center gap-3 rounded-xl border border-emerald-500/25 bg-card px-4 py-3 text-xs text-foreground shadow-xl">
          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> {feedback}
          <button type="button" onClick={() => setFeedback(null)} className="ml-2 text-muted-foreground"><XCircle className="size-3.5" /></button>
        </div>
      ) : null}
    </div>
  );
}

function CitationCard({ citation }: { citation: CitationRecord }) {
  const text = citation.citationText ?? citation.content ?? "暂无引用片段";
  const similarity = citation.similarity ?? 0.9;
  return (
    <article className="rounded-lg border border-border bg-background p-3 transition hover:border-primary/30">
      <div className="flex items-start gap-2">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"><FileText className="size-3.5" /></span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-foreground">{citation.documentName ?? "项目需求文档"}</p>
          <p className="mt-0.5 text-[9px] text-muted-foreground">{citation.sectionTitle ?? "原始文档片段"}{citation.pageNumber ? ` · P${citation.pageNumber}` : ""}</p>
        </div>
        <span className="text-[9px] font-medium text-emerald-700">{Math.round(similarity * (similarity <= 1 ? 100 : 1))}%</span>
      </div>
      <blockquote className="mt-2 border-l-2 border-primary/30 pl-2 text-[10px] leading-4 text-muted-foreground">“{text}”</blockquote>
    </article>
  );
}

function FilterSelect({ value, onChange, ariaLabel, children }: { value: string; onChange: (value: string) => void; ariaLabel: string; children: React.ReactNode }) {
  return (
    <label className="relative">
      <Filter className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
      <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)} className="h-8 w-full appearance-none rounded-lg border border-border bg-background pl-7 pr-6 text-[10px] text-foreground outline-none">
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
    </label>
  );
}

function ReviewStatus({ status }: { status: string }) {
  const config: [string, string, typeof Clock3] = ["approved", "approvedWithChanges"].includes(status)
    ? [status === "approvedWithChanges" ? "修改后通过" : "已通过", "bg-emerald-500/10 text-emerald-700", CheckCircle2]
    : status === "rejected"
      ? ["已驳回", "bg-destructive/10 text-destructive", AlertTriangle]
      : ["待审核", "bg-amber-500/10 text-amber-700", Clock3];
  const Icon = config[2];
  return <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${config[1]}`}><Icon className="size-2.5" />{config[0]}</span>;
}

function formatDate(value: string) {
  if (!value) return "刚刚";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}
