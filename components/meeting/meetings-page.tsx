"use client";

import { useEffect, useMemo, useState } from "react";
import type { AuthorizedProjectSummary, ProjectMockPayload } from "@/lib/auth/ui-types";
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  FileAudio,
  FileText,
  Flag,
  ListTodo,
  Search,
  Sparkles,
  Upload,
  Users,
  Video,
} from "lucide-react";
import { WorkflowStepper, type WorkflowStepItem } from "@/components/workflow/workflow-stepper";

type MeetingRecord = {
  id: string;
  projectId: string;
  title: string;
  startAt: string;
  participants: string[];
  type: string;
  rawNotes: string;
  aiSummary: string;
  decisionIds: string[];
  requirementIds: string[];
  scopeChangeIds: string[];
  actionItemIds: string[];
  riskIds: string[];
  openQuestions: string[];
  sourceIds: string[];
  reviewStatus: string;
  createdAt: string;
};

type NamedRecord = { id: string; title?: string; name?: string; content?: string; actionId?: string; riskId?: string; status?: string; owner?: string };
type MeetingTab = "summary" | "record" | "outputs";

const meetingProcess = [
  "上传会议记录",
  "AI 生成摘要",
  "AI 提取决策",
  "AI 提取新需求",
  "AI 提取 Action Items",
  "AI 识别风险",
  "人工审核",
  "写入项目数据",
];

interface MeetingsPageProps {
  project: AuthorizedProjectSummary;
  data: ProjectMockPayload;
}

export function MeetingsPage({ project, data }: MeetingsPageProps) {
  const meetings = data.meetings as unknown as MeetingRecord[];
  const decisions = data.decisions as unknown as NamedRecord[];
  const actions = data.actions as unknown as NamedRecord[];
  const risks = data.risks as unknown as NamedRecord[];
  const [selectedId, setSelectedId] = useState(meetings[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [tab, setTab] = useState<MeetingTab>("summary");
  const [feedback, setFeedback] = useState<string | null>(null);

  const filtered = useMemo(
    () => meetings.filter((meeting) => `${meeting.title} ${meeting.participants.join(" ")}`.toLowerCase().includes(search.toLowerCase()) && (typeFilter === "all" || meeting.type === typeFilter)),
    [meetings, search, typeFilter],
  );
  const selected = meetings.find((meeting) => meeting.id === selectedId) ?? filtered[0];
  const projectName = () => project.name;

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 2200);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  const processSteps: WorkflowStepItem[] = meetingProcess.map((title, index) => {
    const reviewed = selected?.reviewStatus === "approved";
    const reviewIndex = meetingProcess.indexOf("人工审核");
    const status = index < reviewIndex || (reviewed && index <= reviewIndex + 1) ? "completed" : index === reviewIndex && !reviewed ? "running" : "pending";
    return { id: `meeting-step-${index}`, title, status };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><Video className="size-3.5" /> 决策与行动可追溯</div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">会议与决策</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">将会议原始记录转为经过审核的决策、需求、Action 与风险。</p>
        </div>
        {project.permissions.canEditProject ? <button type="button" onClick={() => setFeedback("上传入口仍为 Mock，本轮未接入真实文件上传")} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3.5 text-sm font-medium text-primary-foreground"><Upload className="size-4" /> 上传会议记录</button> : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-[310px_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="space-y-2 border-b border-border p-3">
            <div className="relative"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索会议或参会人" className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-xs outline-none focus:border-primary" /></div>
            <label className="relative block"><select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} className="h-8 w-full appearance-none rounded-lg border border-border bg-background px-3 pr-8 text-[10px] text-foreground outline-none"><option value="all">全部会议类型</option>{Array.from(new Set(meetings.map((meeting) => meeting.type))).map((type) => <option key={type} value={type}>{meetingType(type)}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /></label>
          </div>
          <div className="max-h-[calc(100vh-270px)] divide-y divide-border overflow-auto">
            {filtered.map((meeting) => (
              <button key={meeting.id} type="button" onClick={() => { setSelectedId(meeting.id); setTab("summary"); }} className={`w-full px-4 py-4 text-left transition ${selected?.id === meeting.id ? "bg-primary/[0.06] shadow-[inset_3px_0_var(--primary)]" : "hover:bg-muted/35"}`}>
                <div className="flex items-start justify-between gap-2"><span className="rounded bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">{meetingType(meeting.type)}</span><MeetingReviewStatus status={meeting.reviewStatus} /></div>
                <p className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-foreground">{meeting.title}</p>
                <p className="mt-1 text-[10px] text-muted-foreground">{projectName()}</p>
                <div className="mt-2 flex items-center justify-between text-[9px] text-muted-foreground"><span className="flex items-center gap-1"><CalendarDays className="size-2.5" />{formatDateTime(meeting.startAt)}</span><span className="flex items-center gap-1"><Users className="size-2.5" />{meeting.participants.length}</span></div>
              </button>
            ))}
            {!filtered.length ? <div className="p-10 text-center text-xs text-muted-foreground">没有匹配的会议。</div> : null}
          </div>
        </aside>

        {selected ? (
          <main className="min-w-0 space-y-4">
            <section className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary">{meetingType(selected.type)}</span><MeetingReviewStatus status={selected.reviewStatus} /></div>
                  <h2 className="mt-2 text-lg font-semibold text-foreground">{selected.title}</h2>
                  <p className="mt-1 text-xs text-muted-foreground">{projectName()} · {formatDateTime(selected.startAt)}</p>
                </div>
                <div className="flex -space-x-1.5">{selected.participants.slice(0, 5).map((person) => <span key={person} title={person} className="flex size-8 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-semibold text-foreground">{person.slice(0, 1)}</span>)}{selected.participants.length > 5 ? <span className="flex size-8 items-center justify-center rounded-full border-2 border-card bg-foreground text-[9px] text-background">+{selected.participants.length - 5}</span> : null}</div>
              </div>
              <div className="mt-4 flex gap-1 border-b border-border">
                <MeetingTabButton active={tab === "summary"} onClick={() => setTab("summary")} icon={Sparkles}>AI 摘要</MeetingTabButton>
                <MeetingTabButton active={tab === "record"} onClick={() => setTab("record")} icon={FileAudio}>原始记录</MeetingTabButton>
                <MeetingTabButton active={tab === "outputs"} onClick={() => setTab("outputs")} icon={ClipboardCheck}>结构化产出</MeetingTabButton>
              </div>
              <div className="pt-4">
                {tab === "summary" ? <SummaryView meeting={selected} /> : tab === "record" ? <RecordView meeting={selected} /> : <OutputsView meeting={selected} decisions={decisions} actions={actions} risks={risks} />}
              </div>
            </section>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
              <OutputMetrics meeting={selected} />
              <section className="rounded-xl border border-border bg-card p-4">
                <div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-semibold text-foreground">会议处理进度</h3><span className="text-[9px] text-muted-foreground">{processSteps.filter((step) => step.status === "completed").length}/{processSteps.length}</span></div>
                <WorkflowStepper steps={processSteps} compact />
              </section>
            </div>
          </main>
        ) : null}
      </div>

      {feedback ? <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-xs text-foreground shadow-xl"><CheckCircle2 className="size-4 text-emerald-600" />{feedback}</div> : null}
    </div>
  );
}

function SummaryView({ meeting }: { meeting: MeetingRecord }) { return <div className="rounded-lg border border-primary/15 bg-primary/[0.035] p-4"><div className="flex items-center gap-2 text-xs font-semibold text-foreground"><Sparkles className="size-3.5 text-primary" /> AI 会议摘要</div><p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-foreground/80">{meeting.aiSummary || "AI 摘要生成中…"}</p><div className="mt-4 flex items-center gap-2 border-t border-primary/10 pt-3 text-[9px] text-muted-foreground"><CheckCircle2 className="size-3 text-emerald-600" /> 已关联 {meeting.sourceIds.length} 个来源文件，等待人工确认</div></div>; }

function RecordView({ meeting }: { meeting: MeetingRecord }) { return <div className="rounded-lg border border-border bg-background p-4"><div className="mb-3 flex items-center justify-between"><span className="flex items-center gap-2 text-xs font-semibold text-foreground"><FileText className="size-3.5" /> 原始会议记录</span><span className="text-[9px] text-muted-foreground">不可编辑 · 保留原文</span></div><pre className="max-h-80 overflow-auto whitespace-pre-wrap font-sans text-xs leading-6 text-muted-foreground">{meeting.rawNotes}</pre></div>; }

function OutputsView({ meeting, decisions, actions, risks }: { meeting: MeetingRecord; decisions: NamedRecord[]; actions: NamedRecord[]; risks: NamedRecord[] }) {
  const sections = [
    { title: "已确认决策", icon: Check, ids: meeting.decisionIds, data: decisions, tone: "text-emerald-700" },
    { title: "Action Items", icon: ListTodo, ids: meeting.actionItemIds, data: actions, tone: "text-primary" },
    { title: "识别风险", icon: AlertTriangle, ids: meeting.riskIds, data: risks, tone: "text-amber-700" },
  ];
  return <div className="space-y-3">{sections.map(({ title, icon: Icon, ids, data, tone }) => <div key={title} className="rounded-lg border border-border p-3"><p className={`flex items-center gap-1.5 text-xs font-semibold ${tone}`}><Icon className="size-3.5" />{title}<span className="ml-auto rounded-full bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{ids.length}</span></p><div className="mt-2 space-y-1.5">{ids.slice(0, 4).map((id) => { const item = data.find((entry) => entry.id === id); return <div key={id} className="rounded-md bg-muted/35 px-3 py-2 text-[11px] text-foreground">{item?.title ?? item?.name ?? item?.content ?? id}</div>; })}{!ids.length ? <p className="py-2 text-[10px] text-muted-foreground">本次会议未识别到相关内容。</p> : null}</div></div>)}</div>;
}

function OutputMetrics({ meeting }: { meeting: MeetingRecord }) {
  const items = [
    ["已确认决策", meeting.decisionIds.length, Check, "text-emerald-700"], ["新需求", meeting.requirementIds.length, Sparkles, "text-primary"], ["Scope 变更", meeting.scopeChangeIds.length, Flag, "text-amber-700"], ["Action Items", meeting.actionItemIds.length, ListTodo, "text-sky-700"], ["风险", meeting.riskIds.length, AlertTriangle, "text-rose-700"], ["待确认", meeting.openQuestions.length, CircleHelp, "text-violet-700"],
  ] as const;
  return <section className="grid grid-cols-2 overflow-hidden rounded-xl border border-border bg-card sm:grid-cols-3">{items.map(([label, value, Icon, tone]) => <div key={label} className="border-b border-r border-border p-4"><p className="flex items-center gap-1 text-[10px] text-muted-foreground"><Icon className="size-3" />{label}</p><p className={`mt-1 text-lg font-semibold ${tone}`}>{value}</p></div>)}</section>;
}

function MeetingTabButton({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: typeof Sparkles; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`inline-flex h-9 items-center gap-1.5 border-b-2 px-3 text-xs font-medium ${active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon className="size-3.5" />{children}</button>; }

function MeetingReviewStatus({ status }: { status: string }) { const approved = status === "approved"; return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-medium ${approved ? "bg-emerald-500/10 text-emerald-700" : "bg-amber-500/10 text-amber-700"}`}>{approved ? <CheckCircle2 className="size-2.5" /> : <CircleHelp className="size-2.5" />}{approved ? "已审核" : "待审核"}</span>; }

function meetingType(type: string) { const labels: Record<string, string> = { kickoff: "项目启动会", weekly: "周会", requirement: "需求澄清会", review: "评审会", client: "客户会议", retrospective: "复盘会" }; return labels[type] ?? type; }

function formatDateTime(value: string) { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(date); }
