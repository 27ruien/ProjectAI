"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Clock3,
  FileCheck2,
  FileText,
  FlaskConical,
  Play,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AIGeneratingState, type WorkflowLog, type WorkflowRunStatus } from "./ai-generating-state";
import type { WorkflowStepItem } from "./workflow-stepper";
import { mockAIGateway } from "@/lib/ai";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { useToast } from "@/components/common/toast";

interface RequirementExtractionPageProps {
  editableProject: Pick<AuthorizedProjectSummary, "id" | "name">;
  onBack?: () => void;
  onOpenReviews?: () => void;
}

const stepDefinitions = [
  ["select", "选择项目资料", "确认输入文件与当前有效版本"],
  ["parse", "文档解析", "提取正文、表格及元数据"],
  ["classify", "内容分类", "识别背景、需求与约束信息"],
  ["extract", "AI 提取需求", "生成结构化需求草稿"],
  ["duplicate", "识别重复需求", "与当前需求库进行语义比对"],
  ["conflict", "识别冲突需求", "标记表述与约束冲突"],
  ["questions", "生成待确认问题", "补齐缺失的业务信息"],
  ["acceptance", "生成验收标准", "形成可验证的验收口径"],
  ["citation", "生成来源引用", "绑定原文证据与文件版本"],
  ["review", "进入人工审核", "创建可追溯的审核任务"],
  ["write", "写入需求中心", "仅将人工审核通过的内容写入正式需求数据"],
] as const;

const stepLogs = [
  "已锁定 3 个输入文件，版本校验通过",
  "解析完成：126 个段落、8 个表格、4 张图片",
  "内容已分为 6 个业务主题，过滤 14 段非需求信息",
  "结构化提取 24 条需求，正在校验字段完整性",
  "发现 3 组潜在重复项，已生成合并建议",
  "识别 2 条约束冲突，需要项目经理确认",
  "生成 5 个待确认问题并关联责任人",
  "已为 19 条需求生成可测试验收标准",
  "建立 31 个来源引用，当前有效性校验通过",
  "审核任务 REV-240712 已创建",
  "等待人工审核通过后写入正式需求中心",
];

function initialSteps(): WorkflowStepItem[] {
  return stepDefinitions.map(([id, title, description]) => ({ id, title, description, status: "pending" }));
}

function currentTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

export function RequirementExtractionPage({ editableProject, onBack, onOpenReviews }: RequirementExtractionPageProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<WorkflowRunStatus>("idle");
  const [steps, setSteps] = useState<WorkflowStepItem[]>(initialSteps);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [logs, setLogs] = useState<WorkflowLog[]>([]);
  const [simulateFailure, setSimulateFailure] = useState(true);
  const hasFailedRef = useRef(false);
  const inputFiles = useMemo(
    () => [
      { name: `${editableProject.name}_当前需求说明.docx`, meta: "2.8 MB · 当前版本", selected: true },
      { name: `${editableProject.name}_需求澄清纪要.pdf`, meta: "4.1 MB · 已解析", selected: true },
      { name: `${editableProject.name}_范围确认.xlsx`, meta: "680 KB · 3 个工作表", selected: true },
      { name: `${editableProject.name}_历史范围_v1.pdf`, meta: "1.2 MB · 仅供参考", selected: false },
    ],
    [editableProject.name],
  );

  const progress = useMemo(() => {
    const completed = steps.filter((step) => step.status === "completed").length;
    if (status === "completed") return 100;
    return Math.round((completed / steps.length) * 100);
  }, [status, steps]);

  useEffect(() => {
    if (status !== "running" || activeIndex < 0) return;

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const shouldFail = simulateFailure && activeIndex === 3 && !hasFailedRef.current;
      let gatewayLog: WorkflowLog | undefined;
      if (activeIndex === 3) {
        if (shouldFail) hasFailedRef.current = true;
        try {
          const result = await mockAIGateway.generateStructuredOutput({
            profileId: "requirement-analysis",
            projectId: editableProject.id,
            skillId: "requirement-extraction",
            sourceIds: [
              `${editableProject.id}-document-current`,
              `${editableProject.id}-meeting-current`,
              `${editableProject.id}-scope-current`,
            ],
            prompt: "从当前有效项目资料中提取结构化需求，识别重复、冲突和待确认问题，并保留来源引用。",
            schemaName: "RequirementExtractionResult",
            mockData: { requirementCount: 24, duplicateCount: 3, conflictCount: 2, questionCount: 5 },
            simulation: shouldFail ? { forceFailure: true, latencyMs: 180 } : hasFailedRef.current ? { failAttempts: 1, latencyMs: 220 } : { latencyMs: 220 },
          });
          gatewayLog = {
            id: `log-gateway-${result.executionId}`,
            time: currentTime(),
            message: `AI Gateway 执行完成 · Profile ${result.modelProfileId} · Mock 成本 ¥${result.cost.toFixed(3)}`,
            tone: "success",
          };
        } catch {
          if (cancelled) return;
          setSteps((current) => current.map((step, index) => (index === activeIndex ? { ...step, status: "failed" } : step)));
          setLogs((current) => [...current, { id: `log-error-${Date.now()}`, time: currentTime(), message: "AI Gateway 结构化输出失败，执行上下文与输入资料已保留", tone: "warning" }]);
          setStatus("failed");
          return;
        }
      }
      if (cancelled) return;
      const stopsForReview = stepDefinitions[activeIndex]?.[0] === "review";

      setSteps((current) =>
        current.map((step, index) =>
          index === activeIndex
            ? { ...step, status: "completed" }
            : !stopsForReview && index === activeIndex + 1
              ? { ...step, status: "running" }
              : step,
        ),
      );
      setLogs((current) => [
        ...current,
        ...(gatewayLog ? [gatewayLog] : []),
        {
          id: `log-${activeIndex}-${Date.now()}`,
          time: currentTime(),
          message: stepLogs[activeIndex],
          tone: activeIndex === stepDefinitions.length - 1 ? "success" : "default",
        },
      ]);

      if (stopsForReview || activeIndex === stepDefinitions.length - 1) {
        setStatus("completed");
      } else {
        setActiveIndex((index) => index + 1);
      }
    }, 720);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [activeIndex, editableProject.id, simulateFailure, status]);

  const startRun = () => {
    hasFailedRef.current = false;
    const next = initialSteps();
    next[0] = { ...next[0], status: "running" };
    setSteps(next);
    setActiveIndex(0);
    setLogs([
      {
        id: `log-start-${Date.now()}`,
        time: currentTime(),
        message: "工作流实例 WF-RUN-240712 已启动，正在创建可追溯执行上下文",
      },
    ]);
    setStatus("running");
  };

  const retry = () => {
    setSimulateFailure(false);
    setSteps((current) => current.map((step, index) => (index === activeIndex ? { ...step, status: "running" } : step)));
    setLogs((current) => [
      ...current,
      { id: `log-retry-${Date.now()}`, time: currentTime(), message: "已切换备用路由，从失败步骤继续执行" },
    ]);
    setStatus("running");
  };

  if (status !== "idle") {
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="size-3.5" /> 返回工作流
            </button>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">AI 提取需求</h1>
            <p className="mt-1 text-sm text-muted-foreground">{editableProject.name} · Workflow Run #WF-240712</p>
          </div>
          <div className="flex items-center gap-2">
            {status === "completed" ? (
              <button
                type="button"
                onClick={onOpenReviews}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                进入审核中心 <ArrowRight className="size-4" />
              </button>
            ) : null}
            <button type="button" onClick={startRun} className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3.5 text-sm font-medium text-foreground hover:bg-muted">
              重新执行
            </button>
          </div>
        </div>

        {status === "completed" ? <ResultMetrics /> : null}
        <AIGeneratingState status={status} steps={steps} progress={progress} logs={logs} onRetry={retry} />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> 返回工作流
        </button>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">配置需求提取</h1>
            <p className="mt-1 text-sm text-muted-foreground">选择输入资料，AI 生成内容将作为草稿进入人工审核。</p>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="size-3.5 text-emerald-600" /> 人工审核已启用
          </span>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(310px,0.65fr)]">
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">输入资料</h2>
              <p className="mt-1 text-xs text-muted-foreground">3 / 4 个文件已选择</p>
            </div>
            <button type="button" onClick={() => toast("已打开项目资料选择范围：当前演示已选 3 份有效资料", "info")} className="text-xs font-medium text-primary hover:underline">从资料库添加</button>
          </div>
          <div className="divide-y divide-border">
            {inputFiles.map((file) => (
              <label key={file.name} className="flex cursor-pointer items-center gap-3 px-5 py-3.5 hover:bg-muted/35">
                <input type="checkbox" defaultChecked={file.selected} className="size-4 accent-[var(--primary)]" />
                <span className="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                  <FileText className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{file.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{file.meta}</span>
                </span>
                {file.selected ? <FileCheck2 className="size-4 text-emerald-600" /> : null}
              </label>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <section className="rounded-xl border border-border bg-card p-5">
            <h2 className="text-sm font-semibold text-foreground">执行配置</h2>
            <div className="mt-4 space-y-4">
              <ConfigRow label="Workflow" value="项目需求提取与校验" icon={Sparkles} />
              <ConfigRow label="Model Profile" value="requirement-analysis" icon={FlaskConical} />
              <ConfigRow label="预计耗时" value="约 1 分 30 秒" icon={Clock3} />
            </div>
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <input
                type="checkbox"
                checked={simulateFailure}
                onChange={(event) => setSimulateFailure(event.target.checked)}
                className="mt-0.5 size-4 accent-amber-600"
              />
              <span>
                <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                  <AlertTriangle className="size-3.5 text-amber-600" /> 模拟一次可恢复失败
                </span>
                <span className="mt-1 block text-[11px] leading-4 text-muted-foreground">用于演示 AI Gateway 失败保护与重试。</span>
              </span>
            </label>
            <button
              type="button"
              onClick={startRun}
              className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition hover:opacity-90"
            >
              <Play className="size-4 fill-current" /> 开始执行
            </button>
          </section>
          <div className="rounded-xl border border-border bg-muted/25 p-4 text-xs leading-5 text-muted-foreground">
            <p className="font-medium text-foreground">数据安全说明</p>
            <p className="mt-1">本次调用通过统一 AI Gateway 路由，不在业务页面存储供应商密钥或具体模型配置。</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function ConfigRow({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Sparkles }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></span>
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate text-xs font-medium text-foreground">{value}</p>
      </div>
    </div>
  );
}

function ResultMetrics() {
  const metrics = [
    ["提取需求", "24", "text-foreground"],
    ["潜在重复", "3", "text-amber-700"],
    ["约束冲突", "2", "text-destructive"],
    ["待确认", "5", "text-primary"],
    ["处理文件", "3", "text-foreground"],
    ["总耗时", "01:18", "text-foreground"],
  ];
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {metrics.map(([label, value, color]) => (
        <div key={label} className="rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-[11px] text-muted-foreground">{label}</p>
          <p className={`mt-1 text-xl font-semibold tabular-nums ${color}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}
