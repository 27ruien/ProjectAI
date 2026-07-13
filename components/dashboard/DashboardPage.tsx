"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  FileText,
  FolderKanban,
  Gauge,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  TimerReset,
  WandSparkles,
} from "lucide-react";
import {
  actions,
  activities,
  documents,
  projects,
  reviews,
  risks,
} from "@/data/mock";
import {
  asRecords,
  dateLabel,
  numberValue,
  relativeLabel,
  statusClasses,
  statusLabel,
  textValue,
} from "@/components/project/mock-view";
import { storageKey } from "@/lib/storage-key";

type ShowcaseState = "ready" | "loading" | "empty" | "error";

const metricIcons = [FolderKanban, Sparkles, TimerReset, ShieldAlert, WandSparkles, Activity];

export function DashboardPage() {
  const projectRows = useMemo(() => asRecords(projects), []);
  const reviewRows = useMemo(() => asRecords(reviews), []);
  const actionRows = useMemo(() => asRecords(actions), []);
  const riskRows = useMemo(() => asRecords(risks), []);
  const activityRows = useMemo(() => asRecords(activities), []);
  const documentRows = useMemo(() => asRecords(documents), []);
  const [checked, setChecked] = useState<string[]>([]);
  const [showcase, setShowcase] = useState<ShowcaseState>("ready");

  const toggleTodo = (id: string) => {
    setChecked((current) => {
      const next = current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id];
      window.localStorage.setItem(storageKey("dashboard-todos"), JSON.stringify(next));
      return next;
    });
  };

  const activeProjects = projectRows.filter((project) =>
    ["active", "planning", "inProgress"].includes(textValue(project, "status", "active")),
  ).length;
  const pendingReviews = reviewRows.filter((review) =>
    ["pending", "pendingReview", "generated"].includes(textValue(review, "status", "pendingReview")),
  ).length;
  const urgentActions = actionRows.filter((action) =>
    ["overdue", "todo", "inProgress", "blocked"].includes(textValue(action, "status", "todo")),
  ).length;
  const highRisks = riskRows.filter((risk) =>
    ["high", "critical"].includes(textValue(risk, ["level", "severity"], "medium")),
  ).length;

  const metrics = [
    { label: "进行中项目", value: activeProjects || 6, detail: "2 个项目本周进入新阶段", tone: "text-primary" },
    { label: "待审核 AI 产出", value: pendingReviews || 8, detail: "3 项将在今天到期", tone: "text-warning" },
    { label: "即将到期 Action", value: urgentActions || 12, detail: "含 3 项已逾期", tone: "text-destructive" },
    { label: "高风险项目", value: highRisks || 2, detail: "较上周减少 1 个", tone: "text-destructive" },
    { label: "AI 节省工时", value: "46.5h", detail: "本月累计 186 小时", tone: "text-success" },
    { label: "AI 调用次数", value: "1,284", detail: "成功率 97.8%", tone: "text-primary" },
  ];

  const visibleProjects = projectRows.slice(0, 5);
  const visibleTodos = actionRows.slice(0, 6);
  const visibleRisks = riskRows.slice(0, 4);

  return (
    <main className="min-h-full bg-background px-5 py-6 lg:px-8 lg:py-7">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-sm text-muted-foreground">7 月 12 日，星期日</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">早上好，林可</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">今天有 3 项 AI 产出待审核，2 个项目需要你关注。</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/projects/new"
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <FolderKanban className="size-4" />
            创建项目
          </Link>
          <Link
            href="/workflows/requirement-extraction"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            <Sparkles className="size-4" />
            运行 AI 工作流
          </Link>
        </div>
      </header>

      <section className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2 xl:grid-cols-6" aria-label="关键指标">
        {metrics.map((metric, index) => {
          const Icon = metricIcons[index];
          return (
            <article key={metric.label} className="bg-card px-4 py-4">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{metric.label}</span>
                <Icon className={`size-4 ${metric.tone}`} />
              </div>
              <p className="text-2xl font-semibold tabular-nums text-foreground">{metric.value}</p>
              <p className="mt-1.5 truncate text-[11px] text-muted-foreground">{metric.detail}</p>
            </article>
          );
        })}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.8fr)]">
        <section className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">项目推进</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">最近访问与关键交付进度</p>
            </div>
            <Link href="/projects" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              全部项目 <ArrowRight className="size-3.5" />
            </Link>
          </div>
          <div className="divide-y divide-border">
            {(visibleProjects.length ? visibleProjects : Array.from({ length: 4 }, (_, index) => ({ id: `fallback-${index}` }))).map((project, index) => {
              const id = textValue(project, "id", `p${index + 1}`);
              const progress = Math.min(100, numberValue(project, ["progress", "completionRate"], [68, 42, 81, 35, 56][index] ?? 50));
              const health = textValue(project, ["health", "healthStatus"], index === 1 ? "attention" : "healthy");
              return (
                <Link
                  key={id}
                  href={`/projects/${id}/overview`}
                  className="group grid grid-cols-[minmax(0,1.4fr)_minmax(120px,0.8fr)_auto] items-center gap-4 px-5 py-3.5 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground group-hover:text-primary">
                      {textValue(project, ["name", "projectName"], ["北美旗舰店 AI 互动活动", "品牌官网重构", "会员系统升级", "CRM 数据看板建设"][index] ?? "项目")}
                    </p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {textValue(project, ["client", "clientName"], "品牌客户")} · {textValue(project, ["stage", "currentStage"], "交付实施")}
                    </p>
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>交付进度</span><span className="tabular-nums">{progress}%</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${statusClasses(health)}`}>{statusLabel(health)}</span>
                    <ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">我的待办</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{visibleTodos.length || 6} 项需要处理</p>
            </div>
            <CheckCircle2 className="size-4 text-muted-foreground" />
          </div>
          <div className="divide-y divide-border px-2">
            {(visibleTodos.length ? visibleTodos : Array.from({ length: 5 }, (_, index) => ({ id: `todo-${index}` }))).map((action, index) => {
              const id = textValue(action, "id", `todo-${index}`);
              const done = checked.includes(id);
              const status = textValue(action, "status", index === 0 ? "overdue" : "todo");
              return (
                <label key={id} className="flex cursor-pointer items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted/50">
                  <input className="sr-only" type="checkbox" checked={done} onChange={() => toggleTodo(id)} />
                  <span className={`mt-0.5 grid size-4 shrink-0 place-items-center rounded border transition-colors ${done ? "border-primary bg-primary text-primary-foreground" : "border-input bg-card"}`}>
                    {done && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${done ? "text-muted-foreground line-through" : "text-foreground"}`}>
                      {textValue(action, ["title", "content", "name"], ["审核会员中心需求提取结果", "确认支付接口排期", "更新客户周报", "跟进埋点方案", "评估新增优惠券需求"][index] ?? "处理项目事项")}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span>{textValue(action, ["projectName", "project"], "北美旗舰店 AI 互动活动")}</span>
                      <span>·</span>
                      <span className={status === "overdue" ? "text-destructive" : ""}>{status === "overdue" ? "已逾期" : dateLabel(textValue(action, "dueDate", ""))}</span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">待审核 AI 产出</h2>
            <Link href="/reviews" className="text-xs font-medium text-primary hover:underline">进入审核中心</Link>
          </div>
          <div className="divide-y divide-border">
            {(reviewRows.length ? reviewRows.slice(0, 4) : Array.from({ length: 4 }, (_, index) => ({ id: `review-${index}` }))).map((review, index) => (
              <Link key={textValue(review, "id", `review-${index}`)} href={`/reviews?task=${textValue(review, "id", `review-${index}`)}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50">
                <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><Bot className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{textValue(review, ["title", "name"], ["AI 提取 12 条新需求", "Scope v2.3 变更分析", "本周项目风险分析", "6 月项目周报"][index] ?? "AI 产出")}</span>
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{textValue(review, ["projectName", "project"], "北美旗舰店 AI 互动活动")} · {relativeLabel(textValue(review, "createdAt", ""))}</span>
                </span>
                <span className="rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">待审核</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">风险预警</h2>
            <AlertTriangle className="size-4 text-warning" />
          </div>
          <div className="divide-y divide-border">
            {(visibleRisks.length ? visibleRisks : Array.from({ length: 4 }, (_, index) => ({ id: `risk-${index}` }))).map((risk, index) => {
              const level = textValue(risk, ["level", "severity"], index === 0 ? "high" : "medium");
              const projectId = textValue(risk, "projectId", "p1");
              return (
                <Link key={textValue(risk, "id", `risk-${index}`)} href={`/projects/${projectId}/risks?risk=${textValue(risk, "id", `risk-${index}`)}`} className="flex items-start gap-3 px-5 py-3 transition-colors hover:bg-muted/50">
                  <span className={`mt-1 size-2 shrink-0 rounded-full ${["high", "critical"].includes(level) ? "bg-destructive" : "bg-warning"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{textValue(risk, ["name", "title"], ["第三方素材授权尚未确认", "会员数据迁移窗口压缩", "海外 CDN 性能波动", "关键接口联调晚于计划"][index] ?? "项目风险")}</span>
                    <span className="mt-1 block truncate text-[11px] text-muted-foreground">{textValue(risk, ["projectName", "project"], "会员系统升级")} · {textValue(risk, ["owner", "assignee"], "林可")}</span>
                  </span>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClasses(level)}`}>{statusLabel(level)}</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card lg:col-span-2 xl:col-span-1">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold text-foreground">最近 AI 活动</h2>
            <Gauge className="size-4 text-muted-foreground" />
          </div>
          <div className="space-y-0 px-5 py-2">
            {(activityRows.length ? activityRows.slice(0, 5) : Array.from({ length: 5 }, (_, index) => ({ id: `activity-${index}` }))).map((activity, index) => (
              <div key={textValue(activity, "id", `activity-${index}`)} className="relative flex gap-3 py-2.5 before:absolute before:left-[7px] before:top-7 before:h-[calc(100%-12px)] before:w-px before:bg-border last:before:hidden">
                <span className={`relative z-10 mt-1 size-3.5 shrink-0 rounded-full border-2 border-card ${index === 0 ? "bg-primary" : "bg-muted-foreground/40"}`} />
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-foreground">{textValue(activity, ["title", "action", "description"], ["完成需求去重分析", "生成 Scope 影响摘要", "项目知识索引已更新", "提取会议 Action Items", "生成项目周报草稿"][index] ?? "AI 任务已完成")}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">{relativeLabel(textValue(activity, ["createdAt", "timestamp"], ""))}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">最近生成文档</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">AI 草稿与正式版本严格分离</p>
            </div>
            <FileText className="size-4 text-muted-foreground" />
          </div>
          <div className="grid divide-y divide-border sm:grid-cols-2 sm:divide-x sm:divide-y-0">
            {(documentRows.length ? documentRows.slice(0, 2) : [{ id: "doc-1" }, { id: "doc-2" }]).map((document, index) => (
              <Link key={textValue(document, "id", `doc-${index}`)} href={`/projects/${textValue(document, "projectId", "p1")}/documents?document=${textValue(document, "id", `doc-${index}`)}`} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/50">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-border bg-muted/50 text-muted-foreground"><FileText className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{textValue(document, ["name", "title", "fileName"], index === 0 ? "北美互动活动项目周报 W27" : "会员系统 Scope 变更说明 v2.3")}</span>
                  <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground"><span>{relativeLabel(document.updatedAt ?? document.createdAt)}</span><span>·</span><span>{index === 0 ? "AI 草稿" : "已确认"}</span></span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-5 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">界面状态示例</h2>
              <div className="flex rounded-lg bg-muted p-0.5">
                {(["ready", "loading", "empty", "error"] as ShowcaseState[]).map((state) => (
                  <button key={state} type="button" onClick={() => setShowcase(state)} className={`rounded-md px-2 py-1 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${showcase === state ? "bg-card font-medium text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
                    {{ ready: "正常", loading: "加载", empty: "空", error: "错误" }[state]}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid min-h-32 place-items-center p-5 text-center">
            {showcase === "ready" && <div><CheckCircle2 className="mx-auto size-6 text-success" /><p className="mt-2 text-sm font-medium text-foreground">数据已同步</p><p className="mt-1 text-xs text-muted-foreground">刚刚更新 8 个项目</p></div>}
            {showcase === "loading" && <div><LoaderCircle className="mx-auto size-6 animate-spin text-primary" /><p className="mt-2 text-sm font-medium text-foreground">正在载入项目数据</p><p className="mt-1 text-xs text-muted-foreground">正在校验当前有效版本</p></div>}
            {showcase === "empty" && <div><FileText className="mx-auto size-6 text-muted-foreground" /><p className="mt-2 text-sm font-medium text-foreground">暂无匹配内容</p><p className="mt-1 text-xs text-muted-foreground">调整筛选条件后重试</p></div>}
            {showcase === "error" && <div><AlertTriangle className="mx-auto size-6 text-destructive" /><p className="mt-2 text-sm font-medium text-foreground">数据加载失败</p><button type="button" onClick={() => setShowcase("loading")} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"><RefreshCw className="size-3" />重试</button></div>}
          </div>
        </section>
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-[11px] text-muted-foreground"><Clock3 className="size-3.5" />数据为演示环境 Mock 内容，最后同步于 2 分钟前</p>
    </main>
  );
}

export default DashboardPage;
