"use client";

import Link from "next/link";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Eye,
  FolderKanban,
  Gauge,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import {
  projectRoleLabel,
  systemRoleLabel,
  type ViewerContext,
} from "@/lib/auth/ui-types";
import { dateLabel, statusClasses, statusLabel } from "@/components/project/mock-view";

export function DashboardPage({ viewer }: { viewer: ViewerContext }) {
  const projects = viewer.projects;
  const activeProjects = projects.filter((project) => ["active", "planning", "at_risk"].includes(project.status)).length;
  const attentionProjects = projects.filter((project) => ["attention", "at_risk", "critical"].includes(project.health)).length;
  const readOnlyProjects = projects.filter((project) => !project.permissions.canEditProject).length;
  const editableProject = projects.find((project) => project.permissions.canEditProject);

  const metrics = [
    { label: "可访问项目", value: projects.length, detail: "来自服务端授权结果", icon: FolderKanban, tone: "text-primary" },
    { label: "进行中项目", value: activeProjects, detail: "仅统计当前授权范围", icon: Gauge, tone: "text-success" },
    { label: "需要关注", value: attentionProjects, detail: "依据项目健康度", icon: Clock3, tone: attentionProjects ? "text-warning" : "text-success" },
    { label: "只读项目", value: readOnlyProjects, detail: "写操作已由服务端关闭", icon: Eye, tone: "text-info" },
  ];

  return (
    <main className="min-h-full bg-background px-5 py-6 lg:px-8 lg:py-7">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-sm text-muted-foreground">安全工作区</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">你好，{viewer.user.displayName}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">你当前可访问 {projects.length} 个项目，列表已按成员关系完成服务端过滤。</p>
        </div>
        <div className="flex items-center gap-2">
          {viewer.canCreateProject ? (
            <Link href="/projects/new" className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted">
              <FolderKanban className="size-4" />创建项目
            </Link>
          ) : null}
          {editableProject ? (
            <Link href={`/workflows/requirement-extraction?project=${editableProject.id}`} className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
              <Sparkles className="size-4" />运行 AI 工作流
            </Link>
          ) : null}
        </div>
      </header>

      <section className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-4" aria-label="授权范围摘要">
        {metrics.map((metric) => (
          <article key={metric.label} className="bg-card px-5 py-4">
            <div className="mb-4 flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{metric.label}</span><metric.icon className={`size-4 ${metric.tone}`} /></div>
            <p className="text-2xl font-semibold tabular-nums text-foreground">{metric.value}</p>
            <p className="mt-1.5 text-[11px] text-muted-foreground">{metric.detail}</p>
          </article>
        ))}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div><h2 className="text-sm font-semibold text-foreground">我的项目</h2><p className="mt-0.5 text-xs text-muted-foreground">项目基础信息来自 PostgreSQL</p></div>
            <Link href="/projects" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">全部项目 <ArrowRight className="size-3.5" /></Link>
          </div>
          {projects.length ? (
            <div className="divide-y divide-border">
              {projects.slice(0, 6).map((project) => (
                <Link key={project.id} href={`/projects/${project.id}/overview`} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
                  <div className="min-w-0"><p className="truncate text-sm font-medium text-foreground group-hover:text-primary">{project.name}</p><p className="mt-1 truncate text-xs text-muted-foreground">{project.clientName} · {statusLabel(project.stage)}</p></div>
                  <div className="flex flex-wrap items-center gap-2"><span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClasses(project.health)}`}>{statusLabel(project.health)}</span><span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground">{projectRoleLabel(project.projectRole)}</span></div>
                  <ChevronRight className="hidden size-4 text-muted-foreground sm:block" />
                </Link>
              ))}
            </div>
          ) : (
            <div className="grid min-h-64 place-items-center px-6 text-center"><div><FolderKanban className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium text-foreground">暂无可访问项目</p><p className="mt-1 text-xs text-muted-foreground">请联系系统管理员或项目经理分配项目成员关系。</p></div></div>
          )}
        </section>

        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4"><h2 className="text-sm font-semibold text-foreground">当前身份</h2><p className="mt-0.5 text-xs text-muted-foreground">身份信息由 Session 恢复</p></div>
            <div className="space-y-4 p-5">
              <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><UserRoundCheck className="size-5" /></span><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{viewer.user.displayName}</p><p className="truncate text-xs text-muted-foreground">{viewer.user.email}</p></div></div>
              <div className="grid grid-cols-2 gap-2"><IdentityFact label="系统角色" value={systemRoleLabel(viewer.user.systemRole)} /><IdentityFact label="Session" value="已验证" /></div>
            </div>
          </section>

          <section className="rounded-xl border border-success/20 bg-success-soft p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><ShieldCheck className="size-4 text-success" />项目隔离已启用</div>
            <ul className="mt-3 space-y-2 text-xs leading-5 text-muted-foreground">
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />项目列表由数据库成员关系过滤</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />项目深层路由在服务端重新授权</li>
              <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" />拒绝访问会写入安全审计事件</li>
            </ul>
          </section>
        </div>
      </div>

      <section className="mt-6 rounded-xl border border-info/20 bg-info-soft px-4 py-3">
        <div className="flex items-start gap-2.5"><LockKeyhole className="mt-0.5 size-4 shrink-0 text-info" /><div><p className="text-xs font-medium text-foreground">能力边界</p><p className="mt-1 text-xs leading-5 text-muted-foreground">身份、组织/部门、知识空间、文档、检索、需求、Scope、Action、Risk 与周报已绑定真实数据库和服务端授权；会议与决策展示仍为项目隔离 Mock，不会被 AI 自动写入正式数据。</p></div></div>
      </section>
      <p className="mt-4 text-[11px] text-muted-foreground">项目最近更新时间：{dateLabel(projects[0]?.updatedAt)}</p>
    </main>
  );
}

function IdentityFact({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-muted/45 px-3 py-2.5"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 text-xs font-medium text-foreground">{value}</p></div>;
}

export default DashboardPage;
