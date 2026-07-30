"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Clock3, FileText, Mic2, Play, RefreshCw, ShieldCheck, Workflow } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { withBasePath } from "@/lib/base-path";

type Run = {
  id: string;
  projectId: string;
  workflowType: "requirement_framework" | "meeting_minutes";
  displayName: string;
  creatorId: string;
  status: string;
  artifactCount: number;
  updatedAt: string;
};

interface WorkflowsPageProps {
  projects: AuthorizedProjectSummary[];
}

const cards = [
  {
    type: "requirement-framework",
    title: "搭建需求框架",
    description: "从项目资料中生成项目概览、需求文档、GA4 埋点文档和 Action Plan，并在当前页面审核后导出。",
    icon: FileText,
  },
  {
    type: "meeting-minutes",
    title: "提取会议纪要",
    description: "上传会议录音或视频，识别不同说话人，生成完整转写、讨论要点、决策和下一步待办。",
    icon: Mic2,
  },
] as const;

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    legacy_read_only: "旧版只读", queued: "排队中", validating_sources: "校验资料",
    parsing_sources: "解析资料", extracting_facts: "提取事实", identifying_gaps: "识别缺口",
    generating_overview: "生成概览", generating_requirements: "生成需求文档",
    generating_ga4: "生成埋点", generating_action_plan: "生成计划",
    checking_consistency: "一致性检查", transcribing: "语音转写", diarizing: "说话人分离",
    normalizing: "整理转写", summarizing: "生成纪要", awaiting_review: "待审核",
    publishing: "发布中", published: "已发布", failed: "失败", cancelled: "已取消",
  };
  return labels[status] ?? status;
}

export function WorkflowsPage({ projects }: WorkflowsPageProps) {
  const router = useRouter();
  const editable = useMemo(() => projects.filter((project) => project.permissions.canEditProject), [projects]);
  const [projectId, setProjectId] = useState(editable[0]?.id ?? "");
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(withBasePath("/api/workflows"), { cache: "no-store" });
      const body = await response.json() as { runs?: Run[]; error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message || "运行记录加载失败");
      setRuns(body.runs ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "运行记录加载失败");
    } finally { setLoading(false); }
  };

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  const open = (type: string, run?: Run) => {
    const targetProjectId = run?.projectId ?? projectId;
    if (!targetProjectId) return;
    router.push(`/workflows/${type}${run ? `/${run.id}` : ""}?projectId=${encodeURIComponent(targetProjectId)}`);
  };

  return (
    <div className="space-y-7">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-primary"><Workflow className="size-3.5" />受控项目交付</div>
          <h1 className="text-2xl font-semibold tracking-tight">AI 工作流</h1>
          <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">每次运行都绑定项目、授权资料、模型 Profile、版本和人工审核记录。</p>
        </div>
        <label className="grid gap-1 text-xs text-muted-foreground">
          运行项目
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)} className="h-9 min-w-56 rounded-lg border border-border bg-card px-3 text-sm text-foreground outline-none focus:border-primary">
            {editable.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
      </header>

      <section className="grid gap-4 xl:grid-cols-2">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article key={card.type} className="flex min-h-56 flex-col rounded-2xl border border-border bg-card p-6 shadow-sm">
              <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" /></span>
              <h2 className="mt-5 text-lg font-semibold">{card.title}</h2>
              <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{card.description}</p>
              <div className="mt-5 flex items-center justify-between gap-3 border-t border-border pt-4">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><ShieldCheck className="size-3.5" />发布前必须人工审核</span>
                <button type="button" disabled={!projectId} onClick={() => open(card.type)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-45"><Play className="size-3.5 fill-current" />开始运行<ArrowRight className="size-3.5" /></button>
              </div>
            </article>
          );
        })}
      </section>

      <section className="rounded-2xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div><h2 className="text-sm font-semibold">最近运行</h2><p className="mt-1 text-xs text-muted-foreground">仅显示当前账号有权访问的项目运行记录。</p></div>
          <button type="button" onClick={() => void refresh()} className="grid size-8 place-items-center rounded-lg border border-border text-muted-foreground hover:bg-muted" aria-label="刷新运行记录"><RefreshCw className={`size-3.5 ${loading ? "animate-spin" : ""}`} /></button>
        </div>
        {error ? <p className="m-4 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p> : null}
        <div className="divide-y divide-border">
          {runs.map((run) => {
            const project = projects.find((item) => item.id === run.projectId);
            const route = run.workflowType === "requirement_framework" ? "requirement-framework" : "meeting-minutes";
            return <button key={run.id} type="button" onClick={() => open(route, run)} className="grid w-full gap-3 px-5 py-4 text-left transition hover:bg-muted/40 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_8rem_7rem_9rem] md:items-center"><span className="truncate text-sm font-medium">{run.displayName}</span><span className="truncate text-xs text-muted-foreground">{project?.name ?? "授权项目"}</span><span className="text-xs text-muted-foreground">{run.workflowType === "requirement_framework" ? "需求框架" : "会议纪要"}</span><span className="text-xs font-medium text-primary">{statusLabel(run.status)}</span><span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" />{new Date(run.updatedAt).toLocaleString("zh-CN")}</span></button>;
          })}
          {!loading && !runs.length ? <div className="px-5 py-12 text-center text-sm text-muted-foreground">还没有工作流运行记录。</div> : null}
        </div>
      </section>
    </div>
  );
}
