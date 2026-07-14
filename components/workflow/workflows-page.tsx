"use client";

import { useMemo, useState } from "react";
import type {
  AuthorizedProjectSummary,
  WorkspaceMockPayload,
} from "@/lib/auth/ui-types";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clock3,
  Filter,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  Workflow,
} from "lucide-react";
import { RequirementExtractionPage } from "./requirement-extraction-page";
import { useToast } from "@/components/common/toast";

type WorkflowRecord = {
  id: string;
  name: string;
  displayName: string;
  description: string;
  status: string;
  skillIds: string[];
  steps: unknown[];
  approvalRequired: boolean;
  updatedAt: string;
};

type SkillRecord = { id: string; name: string; displayName: string };

interface WorkflowsPageProps {
  data: WorkspaceMockPayload;
  editableProject?: Pick<AuthorizedProjectSummary, "id" | "name">;
  onOpenReviews?: () => void;
}

export function WorkflowsPage({ data, editableProject, onOpenReviews }: WorkflowsPageProps) {
  const { toast } = useToast();
  const workflows = data.workflows as unknown as WorkflowRecord[];
  const skills = data.skills as unknown as SkillRecord[];
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showExecution, setShowExecution] = useState(false);

  const filtered = useMemo(
    () =>
      workflows.filter((workflow) => {
        const matchesSearch = `${workflow.displayName} ${workflow.description}`.toLowerCase().includes(search.toLowerCase());
        const matchesStatus = statusFilter === "all" || workflow.status === statusFilter;
        return matchesSearch && matchesStatus;
      }),
    [search, statusFilter, workflows],
  );

  if (showExecution && editableProject) {
    return <RequirementExtractionPage editableProject={editableProject} onBack={() => setShowExecution(false)} onOpenReviews={onOpenReviews} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary">
            <Sparkles className="size-3.5" /> AI 交付编排
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">AI 工作流</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">将标准 Skills 编排为可追踪、可失败恢复、需人工审核的项目交付流程。</p>
        </div>
        <button type="button" onClick={() => toast("首期仅开放固定工作流执行；拖拽编排将在后续阶段开放", "info")} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground hover:bg-muted">
          <Plus className="size-4" /> 创建工作流
        </button>
      </div>

      <section className="grid overflow-hidden rounded-xl border border-border bg-card md:grid-cols-3">
        <Metric icon={Workflow} label="已启用工作流" value={String(workflows.filter((item) => item.status === "active").length)} detail="固定编排，稳定交付" />
        <Metric icon={Bot} label="本月 AI 执行" value="128" detail="较上月 +18%" />
        <Metric icon={ShieldCheck} label="人工审核覆盖" value="100%" detail="关键输出均需确认" />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
        <div className="relative min-w-64 flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索工作流或业务场景"
            className="h-9 w-full rounded-lg border border-border bg-card pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary"
          />
        </div>
        <label className="flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-xs text-muted-foreground">
          <Filter className="size-3.5" />
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="bg-transparent text-foreground outline-none">
            <option value="all">全部状态</option>
            <option value="active">已启用</option>
            <option value="draft">草稿</option>
            <option value="archived">已归档</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {filtered.map((workflow, index) => {
          const relatedSkills = workflow.skillIds
            .map((id) => skills.find((skill) => skill.id === id || skill.name === id)?.displayName ?? id)
            .slice(0, 3);
          return (
            <article key={workflow.id} className="group rounded-xl border border-border bg-card p-5 transition hover:border-primary/35 hover:shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    {index === 0 ? <Sparkles className="size-5" /> : <Workflow className="size-5" />}
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-sm font-semibold text-foreground">{workflow.displayName}</h2>
                      <StatusBadge status={workflow.status} />
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{workflow.description}</p>
                  </div>
                </div>
                <button type="button" onClick={() => toast(`「${workflow.displayName}」当前为只读固定编排`, "info")} aria-label="更多操作" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <MoreHorizontal className="size-4" />
                </button>
              </div>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {relatedSkills.map((skill) => (
                  <span key={skill} className="rounded-md border border-border bg-muted/35 px-2 py-1 text-[10px] text-muted-foreground">{skill}</span>
                ))}
                {workflow.skillIds.length > 3 ? <span className="px-1 py-1 text-[10px] text-muted-foreground">+{workflow.skillIds.length - 3}</span> : null}
              </div>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5"><CheckCircle2 className="size-3.5" /> {workflow.steps.length} 个步骤</span>
                  <span className="flex items-center gap-1.5"><Clock3 className="size-3.5" /> 约 2 分钟</span>
                </div>
                <button
                  type="button"
                  onClick={() => editableProject && setShowExecution(true)}
                  disabled={!editableProject}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Play className="size-3.5 fill-current" /> 运行 <ArrowRight className="size-3.5" />
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {!filtered.length ? (
        <div className="flex min-h-60 flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card text-center">
          <Search className="size-6 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium text-foreground">没有匹配的工作流</p>
          <p className="mt-1 text-xs text-muted-foreground">尝试调整搜索条件或状态筛选。</p>
        </div>
      ) : null}
    </div>
  );
}

function Metric({ icon: Icon, label, value, detail }: { icon: typeof Workflow; label: string; value: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-border px-5 py-4 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0">
      <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span>
      <div>
        <p className="text-[11px] text-muted-foreground">{label}</p>
        <div className="mt-0.5 flex items-baseline gap-2"><span className="text-lg font-semibold text-foreground">{value}</span><span className="text-[10px] text-muted-foreground">{detail}</span></div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const active = status === "active";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${active ? "bg-emerald-500/10 text-emerald-700" : "bg-muted text-muted-foreground"}`}>
      {active ? "已启用" : status === "draft" ? "草稿" : "已归档"}
    </span>
  );
}
