"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Download,
  FileText,
  LoaderCircle,
  Save,
  Scale,
  Sparkles,
} from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Item = {
  id: string;
  label: string;
  status: string;
  value: string;
  citationLabels: string[];
};
type Question = {
  id: string;
  group: string;
  prompt: string;
  required: boolean;
  answer: string;
  status: "pending" | "answered" | "not_applicable";
  citationLabels: string[];
};
type Candidate = {
  id: string;
  candidateOrder: number;
  generationModelId: string;
  modelDisplayName: string;
  providerName: string;
  actualModel: string | null;
  status: "running" | "ready" | "failed";
  items: Item[];
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  failureCode: string | null;
  createdAt: string;
};
type ComparisonRun = {
  id: string;
  status: "running" | "ready" | "failed" | "selected";
  sourceDigest: string;
  promptVersion: string;
  temperatureMilli: number;
  maxOutputTokens: number;
  citationCount: number;
  selectedCandidateId: string | null;
  candidates: Candidate[];
};
type ModelOption = {
  id: string;
  displayName: string;
  modelId: string;
  isDefault: boolean;
  lastTestStatus: string;
};
type ModelOptions = {
  defaultModel: ModelOption;
  alternatives: ModelOption[];
  canCompare: boolean;
  canSelectOther: boolean;
};
type Overview = {
  id: string;
  versionNumber: number;
  status: "prefilled" | "needs_confirmation" | "ready" | "generated" | "failed";
  items: Item[];
  questions: Question[];
  markdown: string;
  failureCode: string | null;
  savedDocumentId: string | null;
  citations: {
    label: string;
    displayName: string;
    sourceScope: string;
    excerpt: string;
  }[];
  comparisonRun: ComparisonRun | null;
};

const labels: Record<string, string> = {
  confirmed: "已确认",
  user_confirmed: "已确认",
  inferred: "AI 推断",
  missing: "缺失",
  conflict: "存在冲突",
  not_applicable: "不适用",
};

export function RequirementOverviewWorkspace({
  projectId,
}: {
  projectId: string;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState<
    "prefill" | "save" | "generate" | "select" | "artifact" | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [models, setModels] = useState<ModelOptions | null>(null);
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([]);
  const [generationDialogOpen, setGenerationDialogOpen] = useState(false);
  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(withBasePath(path), {
      credentials: "include",
      ...init,
    });
    const body = (await response.json()) as {
      overview?: Overview;
      overviews?: Overview[];
      run?: ComparisonRun;
      models?: ModelOptions;
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(body.error?.message ?? "操作未完成");
    return body;
  };
  const load = useCallback(async () => {
    const result = await request(
      `/api/projects/${projectId}/requirement-overviews`,
    );
    setOverview(result.overviews?.[0] ?? null);
    setLoaded(true);
  }, [projectId]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load().catch((caught) => {
        setError(caught instanceof Error ? caught.message : "需求概览加载失败");
        setLoaded(true);
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (overview?.status !== "ready") return;
    const controller = new AbortController();
    void request(
      `/api/projects/${projectId}/requirement-overviews/comparison-models`,
      { signal: controller.signal },
    )
      .then((result) => {
        const available = result.models ?? null;
        setModels(available);
        if (available)
          setSelectedModelIds((current) =>
            current.length ? current : [available.defaultModel.id],
          );
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error ? caught.message : "模型配置加载失败",
          );
      });
    return () => controller.abort();
  }, [overview?.status, projectId]);
  const create = async () => {
    setBusy("prefill");
    setError(null);
    try {
      const result = await request(
        `/api/projects/${projectId}/requirement-overviews`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      setOverview(result.overview ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法建立需求概览");
    } finally {
      setBusy(null);
    }
  };
  const saveAnswers = async () => {
    if (!overview) return;
    setBusy("save");
    setError(null);
    try {
      const result = await request(
        `/api/projects/${projectId}/requirement-overviews/${overview.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            answers: overview.questions.map(({ id, answer, status }) => ({
              id,
              answer,
              notApplicable: status === "not_applicable",
            })),
          }),
        },
      );
      setOverview(result.overview ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败");
    } finally {
      setBusy(null);
    }
  };
  const generate = async (mode: "single" | "compare") => {
    if (!overview || !models) return;
    if (
      overview.comparisonRun &&
      !window.confirm(
        "重新生成会产生新的模型调用和费用；未选择的候选会保留为短期审计记录。是否继续？",
      )
    )
      return;
    const modelIds =
      mode === "single"
        ? [selectedModelIds[0] ?? models.defaultModel.id]
        : selectedModelIds.slice(0, 2);
    setBusy("generate");
    setError(null);
    try {
      const result = await request(
        `/api/projects/${projectId}/requirement-overviews/${overview.id}/generate`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mode, modelIds }),
        },
      );
      const run = result.run;
      if (run) {
        setOverview((current) =>
          current ? { ...current, comparisonRun: run } : current,
        );
        setGenerationDialogOpen(false);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "候选生成失败");
      await load().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };
  const selectCandidate = async (candidateId: string) => {
    if (!overview?.comparisonRun) return;
    setBusy("select");
    setError(null);
    try {
      const result = await request(
        `/api/projects/${projectId}/requirement-overviews/${overview.id}/comparisons/${overview.comparisonRun.id}/select`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ candidateId }),
        },
      );
      setOverview(result.overview ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "选择候选失败");
      await load().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };
  const toggleComparisonModel = (modelId: string) => {
    setSelectedModelIds((current) =>
      current.includes(modelId)
        ? current.filter((id) => id !== modelId)
        : current.length >= 2
          ? [current[1], modelId]
          : [...current, modelId],
    );
  };
  const saveToProject = async () => {
    if (!overview) return;
    setBusy("artifact");
    setError(null);
    try {
      const result = await request(
        `/api/projects/${projectId}/requirement-overviews/${overview.id}/save`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      setOverview(result.overview ?? null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存到项目失败");
    } finally {
      setBusy(null);
    }
  };
  if (!loaded)
    return (
      <div className="border-t p-4 text-xs text-muted-foreground">
        <LoaderCircle className="mr-2 inline size-3 animate-spin" />
        正在加载需求概览
      </div>
    );
  if (!overview)
    return (
      <section
        className="border-t bg-muted/10 px-4 py-5"
        data-testid="requirement-overview-empty"
      >
        <div className="rounded-lg border bg-card p-4">
          <h4 className="text-sm font-semibold">需求概览</h4>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            先从当前项目的有效资料预填事实、范围与资料缺口，再由项目经理集中确认。
          </p>
          <Button
            className="mt-3"
            size="sm"
            disabled={busy === "prefill"}
            onClick={() => void create()}
          >
            {busy === "prefill" ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <Sparkles />
            )}
            开始需求概览
          </Button>
          {error ? (
            <p className="mt-2 text-xs text-destructive">{error}</p>
          ) : null}
        </div>
      </section>
    );
  return (
    <section
      className="border-t bg-muted/10 px-4 py-5"
      data-testid="requirement-overview-workspace"
    >
      <div className="mx-auto max-w-3xl rounded-lg border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold">
                需求概览 v{overview.versionNumber}
              </h4>
              <Badge variant="outline">
                {
                  {
                    prefilled: "资料已预填",
                    needs_confirmation: "等待确认",
                    ready: "可生成",
                    generated: "已生成",
                    failed: "生成失败",
                  }[overview.status]
                }
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              来源、AI 推断与待确认项已分别标注；不会把资料不足当作错误。
            </p>
          </div>
          {overview.status === "generated" ? (
            <a
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
              href={withBasePath(
                `/api/projects/${projectId}/requirement-overviews/${overview.id}/export`,
              )}
            >
              <Download className="size-3.5" />
              下载 Markdown
            </a>
          ) : null}
        </div>
        {error ? (
          <Alert variant="destructive" className="mt-4">
            <AlertTitle>
              {overview.status === "failed"
                ? "AI 服务暂时不可用"
                : "操作未完成"}
            </AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {overview.items.map((item) => (
            <div key={item.id} className="rounded-lg border p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium">{item.label}</p>
                <Badge variant="outline" className="text-[10px]">
                  {labels[item.status] ?? item.status}
                </Badge>
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {item.value}
              </p>
              {item.citationLabels.length ? (
                <p className="mt-2 text-[10px] text-primary">
                  来源：
                  {item.citationLabels.map((label) => `[${label}]`).join(" ")}
                </p>
              ) : null}
            </div>
          ))}
        </div>
        {overview.status !== "generated" ? (
          <div className="mt-5 space-y-4 border-t pt-5">
            <div>
              <h5 className="text-sm font-semibold">请集中确认</h5>
              <p className="mt-1 text-xs text-muted-foreground">
                必填问题完成后才会生成固定格式的需求概览。
              </p>
            </div>
            {overview.questions.map((question) => (
              <div key={question.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-medium">
                    {question.group}
                    {question.required ? (
                      <span className="ml-1 text-destructive">*</span>
                    ) : null}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setOverview((current) =>
                        current
                          ? {
                              ...current,
                              questions: current.questions.map((entry) =>
                                entry.id === question.id
                                  ? {
                                      ...entry,
                                      status:
                                        entry.status === "not_applicable"
                                          ? "pending"
                                          : "not_applicable",
                                      answer:
                                        entry.status === "not_applicable"
                                          ? entry.answer
                                          : "",
                                    }
                                  : entry,
                              ),
                            }
                          : current,
                      )
                    }
                  >
                    {question.status === "not_applicable"
                      ? "恢复填写"
                      : "不适用"}
                  </Button>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {question.prompt}
                </p>
                <Textarea
                  className="mt-3"
                  rows={2}
                  disabled={question.status === "not_applicable"}
                  value={question.answer}
                  onChange={(event) =>
                    setOverview((current) =>
                      current
                        ? {
                            ...current,
                            questions: current.questions.map((entry) =>
                              entry.id === question.id
                                ? {
                                    ...entry,
                                    answer: event.target.value,
                                    status: event.target.value.trim()
                                      ? "answered"
                                      : "pending",
                                  }
                                : entry,
                            ),
                          }
                        : current,
                    )
                  }
                  placeholder="由项目经理确认，或标记为不适用"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 border-t pt-5">
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-6 text-foreground">
              {overview.markdown}
            </pre>
          </div>
        )}
        {overview.status === "ready" ? (
          <section
            className="mt-5 space-y-3 border-t pt-5"
            data-testid="requirement-overview-model-comparison"
          >
            <div>
              <h5 className="flex items-center gap-1.5 text-sm font-semibold">
                <Scale className="size-4" />
                模型候选
              </h5>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                所有候选使用同一份资料、固定 24
                字段模板、相同引用范围和输出配置。候选不会保存到项目；只有选择一个候选后才形成草稿。
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              选择模型和对比方式时会在“生成需求概览”窗口中完成；候选结果会在这里保留，供你比较并确认。
            </p>
            {overview.comparisonRun ? (
              <div className="space-y-3 rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-medium">候选运行</p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {overview.comparisonRun.promptVersion} · 引用{" "}
                      {overview.comparisonRun.citationCount} 条 · 温度{" "}
                      {(overview.comparisonRun.temperatureMilli / 1000).toFixed(
                        2,
                      )}{" "}
                      · 最多 {overview.comparisonRun.maxOutputTokens} tokens
                    </p>
                  </div>
                  <Badge variant="outline">
                    {overview.comparisonRun.status === "ready"
                      ? "请选择一个候选"
                      : overview.comparisonRun.status === "selected"
                        ? "已选择"
                        : overview.comparisonRun.status === "failed"
                          ? "候选失败"
                          : "生成中"}
                  </Badge>
                </div>
                <div className="grid gap-3 lg:grid-cols-2">
                  {overview.comparisonRun.candidates.map(
                    (candidate, index, all) => {
                      const baseline = all[0];
                      const differentFields =
                        index && baseline
                          ? candidate.items.filter((item) => {
                              const before = baseline.items.find(
                                (entry) => entry.id === item.id,
                              );
                              return (
                                before &&
                                (before.value !== item.value ||
                                  before.status !== item.status)
                              );
                            })
                          : [];
                      return (
                        <article
                          key={candidate.id}
                          className="rounded-lg border bg-background p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-medium">
                                候选 {candidate.candidateOrder} ·{" "}
                                {candidate.modelDisplayName}
                              </p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                实际模型：{candidate.actualModel ?? "未完成"}
                              </p>
                            </div>
                            <Badge variant="outline">
                              {candidate.status === "ready"
                                ? "可选择"
                                : candidate.status === "failed"
                                  ? "失败"
                                  : "生成中"}
                            </Badge>
                          </div>
                          <p className="mt-2 text-[11px] text-muted-foreground">
                            输入 {candidate.inputTokens ?? "—"} · 输出{" "}
                            {candidate.outputTokens ?? "—"} · 延迟{" "}
                            {candidate.latencyMs ?? "—"} ms
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            Provider：{candidate.providerName} · 生成于{" "}
                            {new Date(candidate.createdAt).toLocaleString("zh-CN")}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                            <span>
                              已确认{" "}
                              {
                                candidate.items.filter(
                                  (item) =>
                                    item.status === "confirmed" ||
                                    item.status === "user_confirmed",
                                ).length
                              }
                            </span>
                            <span>
                              AI 推断{" "}
                              {
                                candidate.items.filter(
                                  (item) => item.status === "inferred",
                                ).length
                              }
                            </span>
                            <span>
                              缺失{" "}
                              {
                                candidate.items.filter(
                                  (item) => item.status === "missing",
                                ).length
                              }
                            </span>
                            <span>
                              冲突{" "}
                              {
                                candidate.items.filter(
                                  (item) => item.status === "conflict",
                                ).length
                              }
                            </span>
                            <span>
                              引用{" "}
                              {
                                new Set(
                                  candidate.items.flatMap(
                                    (item) => item.citationLabels,
                                  ),
                                ).size
                              }
                            </span>
                            <span>
                              完成度{" "}
                              {Math.round(
                                (candidate.items.filter(
                                  (item) =>
                                    item.status !== "missing" &&
                                    item.status !== "conflict",
                                ).length /
                                  Math.max(candidate.items.length, 1)) *
                                  100,
                              )}
                              %
                            </span>
                          </div>
                          {differentFields.length ? (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              与候选 1 不同：
                              {differentFields
                                .slice(0, 6)
                                .map((item) => item.label)
                                .join("、")}
                              {differentFields.length > 6 ? " 等" : ""}
                            </p>
                          ) : index ? (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              与候选 1 的字段内容一致。
                            </p>
                          ) : (
                            <p className="mt-2 text-[11px] text-muted-foreground">
                              固定模板字段：{candidate.items.length} 项。
                            </p>
                          )}
                          <Button
                            className="mt-3"
                            size="sm"
                            disabled={
                              overview.comparisonRun?.status !== "ready" ||
                              candidate.status !== "ready" ||
                              busy === "select"
                            }
                            onClick={() => void selectCandidate(candidate.id)}
                          >
                            {busy === "select" ? (
                              <LoaderCircle className="animate-spin" />
                            ) : (
                              <CheckCircle2 />
                            )}
                            选择此候选并形成草稿
                          </Button>
                        </article>
                      );
                    },
                  )}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
          {overview.status !== "generated" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy === "save"}
                onClick={() => void saveAnswers()}
              >
                {busy === "save" ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <CheckCircle2 />
                )}
                保存确认
              </Button>
              <Dialog
                open={generationDialogOpen}
                onOpenChange={setGenerationDialogOpen}
              >
                <DialogTrigger asChild>
                  <Button
                    size="sm"
                    disabled={
                      overview.status !== "ready" ||
                      !models ||
                      busy === "generate"
                    }
                    data-testid="requirement-overview-generate-dialog-trigger"
                  >
                    <FileText />
                    生成需求概览
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>生成需求概览</DialogTitle>
                    <DialogDescription>
                      模型只能填写固定 24
                      个字段。所有候选使用相同资料快照、System Prompt、JSON
                      Schema、温度、Token 上限和引用输入。
                    </DialogDescription>
                  </DialogHeader>
                  {models ? (
                    <div className="space-y-4">
                      <div>
                        <p className="text-sm font-medium">单模型生成</p>
                        <label className="mt-2 flex items-center gap-2 text-xs">
                          <input
                            type="radio"
                            name={`dialog-model-${overview.id}`}
                            checked={
                              selectedModelIds.length === 1 &&
                              selectedModelIds[0] === models.defaultModel.id
                            }
                            onChange={() =>
                              setSelectedModelIds([models.defaultModel.id])
                            }
                          />
                          {models.defaultModel.displayName}
                          <Badge variant="outline" className="text-[10px]">
                            默认绑定
                          </Badge>
                        </label>
                        {models.canSelectOther
                          ? models.alternatives.map((model) => (
                              <label
                                key={model.id}
                                className="mt-2 flex items-center gap-2 text-xs"
                              >
                                <input
                                  type="radio"
                                  name={`dialog-model-${overview.id}`}
                                  checked={
                                    selectedModelIds.length === 1 &&
                                    selectedModelIds[0] === model.id
                                  }
                                  onChange={() =>
                                    setSelectedModelIds([model.id])
                                  }
                                />
                                {model.displayName}
                                <Badge
                                  variant="outline"
                                  className="text-[10px]"
                                >
                                  测试通过
                                </Badge>
                              </label>
                            ))
                          : null}
                        <Button
                          className="mt-3"
                          size="sm"
                          disabled={busy === "generate"}
                          onClick={() => void generate("single")}
                        >
                          {busy === "generate" ? (
                            <LoaderCircle className="animate-spin" />
                          ) : (
                            <FileText />
                          )}
                          生成一个候选
                        </Button>
                      </div>
                      <div className="border-t pt-4">
                        <p className="text-sm font-medium">对比生成</p>
                        {models.canCompare ? (
                          <>
                            <p className="mt-1 text-xs text-muted-foreground">
                              选择两个已通过 JSON 能力测试的模型。
                            </p>
                            <div className="mt-2 space-y-2">
                              {[
                                models.defaultModel,
                                ...models.alternatives,
                              ].map((model) => (
                                <label
                                  key={model.id}
                                  className="flex items-center gap-2 text-xs"
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedModelIds.includes(
                                      model.id,
                                    )}
                                    onChange={() =>
                                      toggleComparisonModel(model.id)
                                    }
                                  />
                                  {model.displayName}
                                </label>
                              ))}
                            </div>
                            <Button
                              className="mt-3"
                              variant="outline"
                              size="sm"
                              disabled={
                                selectedModelIds.length !== 2 ||
                                busy === "generate"
                              }
                              onClick={() => void generate("compare")}
                            >
                              {busy === "generate" ? (
                                <LoaderCircle className="animate-spin" />
                              ) : (
                                <Scale />
                              )}
                              比较两个候选
                            </Button>
                          </>
                        ) : (
                          <p className="mt-1 text-xs text-muted-foreground">
                            当前只有一个测试成功的文本模型，暂时无法执行模型对比。
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      正在加载可用模型…
                    </p>
                  )}
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <Button
              size="sm"
              disabled={
                Boolean(overview.savedDocumentId) || busy === "artifact"
              }
              onClick={() => void saveToProject()}
            >
              {busy === "artifact" ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Save />
              )}
              {overview.savedDocumentId ? "已保存到项目" : "保存到项目"}
            </Button>
          )}
        </div>
        {overview.citations.length ? (
          <div className="mt-4 border-t pt-4">
            <p className="text-xs font-semibold">引用</p>
            {overview.citations.map((citation) => (
              <p
                key={citation.label}
                className="mt-1 text-[11px] text-muted-foreground"
              >
                [{citation.label}] [
                {citation.sourceScope === "organization"
                  ? "常规模板"
                  : "项目资料"}
                ] {citation.displayName}
              </p>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
