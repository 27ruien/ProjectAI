"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  CloudCog,
  Eye,
  EyeOff,
  KeyRound,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ConfirmDialog } from "@/components/common/confirm-dialog";

type Provider = {
  id: string;
  name: string;
  providerType: "dashscope" | "openai_compatible";
  baseUrl: string;
  region: string;
  credentialMode: "environment" | "managed";
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  enabled: boolean;
  lastTestStatus: string;
  lastTestedAt: string | null;
  lastTestErrorCode: string | null;
  lastTestLatencyMs: number | null;
  lastTestRequestId: string | null;
  modelDiscoverySupported: boolean;
};
type GenerationModel = {
  id: string;
  displayName: string;
  modelId: string;
  providerProfileId: string;
  enabled: boolean;
  supportsJson: boolean;
  supportsThinking: boolean;
  disableThinkingForJson: boolean;
  lastTestStatus: string;
  lastTestedAt: string | null;
  lastTestErrorCode: string | null;
  lastTestLatencyMs: number | null;
  lastTestRequestId: string | null;
};
type EmbeddingModel = {
  id: string;
  displayName: string;
  modelId: string;
  providerProfileId: string;
  dimensions: number;
  enabled: boolean;
  lastTestStatus: string;
};
type Scenario = {
  id: string;
  scenario: string;
  generationModelId: string | null;
  embeddingModelId: string | null;
  enabled: boolean;
};
type Snapshot = {
  providers: Provider[];
  generationModels: GenerationModel[];
  embeddingModels: EmbeddingModel[];
  scenarios: Scenario[];
  vectorDimensions: number;
  operation?: {
    modelIds?: string[];
    modelDiscoverySupported?: boolean;
    actualModel?: string;
    latencyMs?: number;
    requestId?: string | null;
  } | null;
};
type ProviderDraft = {
  name: string;
  providerType: "dashscope" | "openai_compatible";
  baseUrl: string;
  region: string;
  apiKey: string;
};
type DiscoveredModelResult = {
  providerId: string;
  providerName: string;
  modelIds: string[];
};

const names: Record<string, string> = {
  general_chat: "默认文本生成 / 通用对话",
  project_grounded_chat: "项目与公司资料问答",
  requirement_overview_prefill: "需求概览预填",
  requirement_overview_guidance: "需求概览引导",
  requirement_markdown_generation: "需求概览 Markdown",
};

const initialProvider: ProviderDraft = {
  name: "",
  providerType: "dashscope",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  region: "cn-beijing",
  apiKey: "",
};

function ResultBadge({ status }: { status: string }) {
  const tone =
    status === "passed"
      ? "border border-success/20 bg-success-soft text-success"
      : status === "failed"
        ? "border border-destructive/20 bg-destructive-soft text-destructive"
        : "bg-muted text-muted-foreground";
  const label =
    status === "passed"
      ? "测试通过"
      : status === "failed"
        ? "测试失败"
        : "未测试";
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}
    >
      {label}
    </span>
  );
}

function providerName(providers: Provider[], id: string) {
  return (
    providers.find((provider) => provider.id === id)?.name ?? "已删除 Provider"
  );
}

function isTextGenerationModel(modelId: string): boolean {
  return !/(?:audio|asr|embedding|image|ocr|rerank|speech|sre|tts|vision)(?:[./:_-]|$)/i.test(
    modelId,
  );
}

function modelDisplayName(modelId: string): string {
  return modelId
    .split(/[-_/]+/)
    .filter(Boolean)
    .map((part) => {
      if (/^qwen\d/i.test(part))
        return part.replace(/^qwen/i, "Qwen ").replace(/(\d)([a-z])/i, "$1 $2");
      if (/^\d/.test(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");
}

function providerActivationHint(provider: Provider): string {
  if (provider.enabled && provider.lastTestStatus === "failed")
    return "已启用，但最近连接测试失败";
  if (provider.enabled) return "已启用，可添加并测试模型";
  if (provider.lastTestStatus === "passed") return "连接已通过，下一步请启用";
  if (!provider.hasApiKey) return "请先配置 API Key";
  return "请先执行连接测试";
}

export function AiModelManagementPage({
  organizationId,
  verificationProjectId,
}: {
  organizationId: string;
  verificationProjectId: string | null;
}) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providerDialog, setProviderDialog] = useState(false);
  const [providerDeleteTarget, setProviderDeleteTarget] = useState<Provider | null>(null);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(
    null,
  );
  const [providerDraft, setProviderDraft] = useState(initialProvider);
  const [showKey, setShowKey] = useState(false);
  const [replacementKey, setReplacementKey] = useState<Record<string, string>>(
    {},
  );
  const [model, setModel] = useState({
    name: "",
    modelId: "",
    providerId: "",
    supportsThinking: true,
    disableThinkingForJson: true,
  });
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [modelDeleteTarget, setModelDeleteTarget] =
    useState<GenerationModel | null>(null);
  const [embedding, setEmbedding] = useState({
    name: "",
    modelId: "",
    providerId: "",
  });
  const [discoveredModels, setDiscoveredModels] =
    useState<DiscoveredModelResult | null>(null);
  const [discoveredModelSearch, setDiscoveredModelSearch] = useState("");

  const load = useCallback(async () => {
    const response = await fetch(
      withBasePath(
        `/api/admin/ai-configuration?organizationId=${encodeURIComponent(organizationId)}`,
      ),
      { credentials: "include", cache: "no-store" },
    );
    const body = (await response.json()) as Snapshot & {
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(body.error?.message ?? "AI 配置加载失败");
    setData(body);
  }, [organizationId]);

  const reportLoadError = useCallback((caught: unknown) => {
    setError(caught instanceof Error ? caught.message : "AI 配置加载失败");
  }, []);
  const startLoad = useCallback(() => {
    void load().catch(reportLoadError);
  }, [load, reportLoadError]);
  useEffect(() => {
    const timer = window.setTimeout(startLoad, 0);
    return () => window.clearTimeout(timer);
  }, [startLoad]);

  const mutate = async (
    payload: Record<string, unknown>,
    successMessage?: string,
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        withBasePath("/api/admin/ai-configuration"),
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ...payload, organizationId }),
        },
      );
      const body = (await response.json()) as Snapshot & {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(body.error?.message ?? "配置未保存");
      setData(body);
      if (successMessage) setNotice(successMessage);
      return body.operation ?? null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配置未保存");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const usableModels = useMemo(
    () =>
      data?.generationModels.filter(
        (item) => item.enabled && item.lastTestStatus === "passed",
      ) ?? [],
    [data],
  );
  const defaultChatScenario = data?.scenarios.find((item) => item.scenario === "general_chat") ?? null;
  const defaultTextModel = data?.generationModels.find((item) => item.id === defaultChatScenario?.generationModelId) ?? null;
  const currentEmbeddingModel = data?.embeddingModels.find((item) => item.enabled) ?? data?.embeddingModels[0] ?? null;
  const selectedProvider = useMemo(
    () =>
      data?.providers.find((provider) => provider.id === model.providerId) ??
      null,
    [data, model.providerId],
  );
  const selectedProviderReady = Boolean(
    selectedProvider?.enabled && selectedProvider.lastTestStatus === "passed",
  );
  const discoveredTextModels = useMemo(() => {
    const normalizedSearch = discoveredModelSearch.trim().toLowerCase();
    return (discoveredModels?.modelIds ?? [])
      .filter(isTextGenerationModel)
      .filter(
        (modelId) =>
          !normalizedSearch || modelId.toLowerCase().includes(normalizedSearch),
      );
  }, [discoveredModelSearch, discoveredModels]);
  if (!data)
    return (
      <div className="p-6 text-sm text-muted-foreground">
        正在加载 Provider 与模型配置…
      </div>
    );

  return (
    <main className="mx-auto max-w-7xl space-y-6 pb-10">
      <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium text-primary">管理设置</p>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">
            Provider 与模型
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
            在这里安全配置 Provider、API Key、文本模型和业务场景。API Key
            仅通过一次加密请求提交；保存后不会回显、不会进入浏览器存储或日志。
          </p>
        </div>
        <Badge variant="outline" className="w-fit">
          服务器加密凭据库
        </Badge>
      </header>
      {error ? (
        <Alert variant="destructive">
          <AlertTitle>操作未完成</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? (
        <Alert>
          <CheckCircle2 className="size-4" />
          <AlertTitle>已完成</AlertTitle>
          <AlertDescription>{notice}</AlertDescription>
        </Alert>
      ) : null}

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CloudCog className="size-4 text-primary" />
            <div>
              <h2 className="text-sm font-semibold">1. Provider</h2>
              <p className="text-xs text-muted-foreground">
                先保存凭据并测试连接，再启用并添加模型。
              </p>
            </div>
          </div>
          <Dialog
            open={providerDialog}
            onOpenChange={(open) => {
              setProviderDialog(open);
              if (!open) {
                setEditingProviderId(null);
                setProviderDraft(initialProvider);
                setShowKey(false);
              }
            }}
          >
            <DialogTrigger asChild>
              <Button
                size="sm"
                onClick={() => {
                  setEditingProviderId(null);
                  setProviderDraft(initialProvider);
                }}
              >
                <Plus />
                添加 Provider
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader>
                <DialogTitle>
                  {editingProviderId ? "编辑 Provider" : "添加 Provider"}
                </DialogTitle>
                <DialogDescription>
                  {editingProviderId
                    ? "修改地址或区域会自动停用 Provider，并要求重新测试。API Key 保持不变；如需替换，请使用列表中的替换入口。"
                    : "第 1 步填写基础信息；第 2 步一次性输入 API Key；保存后先测试连接再启用。"}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    value={providerDraft.name}
                    onChange={(event) =>
                      setProviderDraft({
                        ...providerDraft,
                        name: event.target.value,
                      })
                    }
                    placeholder="Provider 名称"
                  />
                  <Select
                    value={providerDraft.providerType}
                    onValueChange={(
                      providerType: "dashscope" | "openai_compatible",
                    ) => setProviderDraft({ ...providerDraft, providerType })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dashscope">DashScope</SelectItem>
                      <SelectItem value="openai_compatible">
                        OpenAI Compatible
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  value={providerDraft.baseUrl}
                  onChange={(event) =>
                    setProviderDraft({
                      ...providerDraft,
                      baseUrl: event.target.value,
                    })
                  }
                  placeholder="HTTPS Base URL"
                />
                <Input
                  value={providerDraft.region}
                  onChange={(event) =>
                    setProviderDraft({
                      ...providerDraft,
                      region: event.target.value,
                    })
                  }
                  placeholder="Region，例如 cn-beijing"
                />
                {!editingProviderId ? (
                  <div className="relative">
                    <Input
                      type={showKey ? "text" : "password"}
                      autoComplete="new-password"
                      value={providerDraft.apiKey}
                      onChange={(event) =>
                        setProviderDraft({
                          ...providerDraft,
                          apiKey: event.target.value,
                        })
                      }
                      placeholder="API Key（保存后不再显示）"
                    />
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="absolute right-1 top-1"
                      onClick={() => setShowKey(!showKey)}
                      aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                    >
                      {showKey ? <EyeOff /> : <Eye />}
                    </Button>
                  </div>
                ) : null}
                <p className="text-xs leading-5 text-muted-foreground">
                  DashScope 北京地址示例：`https://{"{"}WorkspaceId{"}"}
                  .cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。不保存示例
                  WorkspaceId。
                </p>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setProviderDialog(false)}
                >
                  取消
                </Button>
                <Button
                  disabled={busy || !providerDraft.name.trim()}
                  onClick={async () => {
                    const result = await mutate(
                      editingProviderId
                        ? {
                            action: "update_provider",
                            providerId: editingProviderId,
                            name: providerDraft.name,
                            providerType: providerDraft.providerType,
                            baseUrl: providerDraft.baseUrl,
                            region: providerDraft.region,
                          }
                        : { action: "create_provider", ...providerDraft },
                      editingProviderId
                        ? "Provider 已更新，请重新测试后启用。"
                        : "Provider 已保存。请执行连接测试后启用。",
                    );
                    if (result !== null) {
                      setProviderDraft(initialProvider);
                      setEditingProviderId(null);
                      setShowKey(false);
                      setProviderDialog(false);
                    }
                  }}
                >
                  {editingProviderId ? "保存修改" : "保存 Provider"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {data.providers.map((item) => {
            const modelCount = data.generationModels.filter((entry) => entry.providerProfileId === item.id).length + data.embeddingModels.filter((entry) => entry.providerProfileId === item.id).length;
            const tested = item.lastTestStatus === "passed";
            return <article key={item.id} className="rounded-xl border bg-background p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-medium">{item.name}</h3><Badge variant="outline">{item.providerType}</Badge>{item.enabled ? <Badge className="border-success/20 bg-success-soft text-success">已启用</Badge> : <Badge variant="secondary">未启用</Badge>}</div><p className="mt-2 truncate font-mono text-[10px] text-muted-foreground" title={item.baseUrl}>{item.baseUrl}</p><p className="mt-1 text-xs text-muted-foreground">{item.region} · {modelCount} 个模型</p></div><ResultBadge status={item.lastTestStatus} /></div>
              <dl className="mt-4 grid grid-cols-2 gap-3 rounded-lg bg-muted/35 p-3 text-xs"><div><dt className="text-muted-foreground">API Key</dt><dd className="mt-1 font-medium">{item.hasApiKey ? `已配置${item.apiKeyMasked ? ` · ${item.apiKeyMasked}` : ""}` : "未配置"}</dd></div><div><dt className="text-muted-foreground">连接测试</dt><dd className="mt-1 font-medium">{tested ? `通过${item.lastTestLatencyMs !== null ? ` · ${item.lastTestLatencyMs} ms` : ""}` : item.lastTestErrorCode ?? "尚未通过"}</dd></div></dl>
              <div className="mt-4 flex gap-2"><Input type="password" autoComplete="new-password" className="min-w-0 flex-1" value={replacementKey[item.id] ?? ""} onChange={(event) => setReplacementKey({ ...replacementKey, [item.id]: event.target.value })} placeholder="输入新 API Key" /><Button variant="outline" disabled={busy || !(replacementKey[item.id] ?? "").trim()} onClick={() => void mutate({ action: "replace_provider_api_key", providerId: item.id, apiKey: replacementKey[item.id] }, "API Key 已替换；请重新测试 Provider 和模型。").then(() => setReplacementKey({ ...replacementKey, [item.id]: "" }))}>替换</Button></div>
              <p className="mt-2 text-[11px] text-muted-foreground">{providerActivationHint(item)}</p>
              <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
                <Button variant="outline" disabled={busy || !item.hasApiKey} onClick={() => void mutate({ action: "test_provider", providerId: item.id }, item.enabled ? "Provider 连接测试通过。下方已显示可添加的文本模型。" : "Provider 连接测试通过。下一步请启用 Provider，再从下方选择模型。").then((operation) => { if (operation?.modelIds?.length) { setDiscoveredModels({ providerId: item.id, providerName: item.name, modelIds: operation.modelIds }); setDiscoveredModelSearch(""); } })}><RefreshCw />测试连接</Button>
                <Button variant={item.enabled ? "outline" : "default"} disabled={busy || (!tested && !item.enabled)} onClick={() => void mutate({ action: "set_provider_enabled", providerId: item.id, enabled: !item.enabled }, item.enabled ? "Provider 已停用。" : "Provider 已启用。现在可以从下方选择并添加文本模型。")}>{item.enabled ? "停用" : "启用 Provider"}</Button>
                <Button variant="ghost" disabled={busy} onClick={() => { setEditingProviderId(item.id); setProviderDraft({ name: item.name, providerType: item.providerType, baseUrl: item.baseUrl, region: item.region, apiKey: "" }); setProviderDialog(true); }}>编辑</Button>
                <Button variant="ghost" size="icon" disabled={busy} aria-label={`删除 ${item.name}`} onClick={() => setProviderDeleteTarget(item)}><Trash2 /></Button>
              </div>
            </article>;
          })}
        </div>
        <div className="mt-4 rounded-lg border bg-muted/20 p-3 text-xs leading-5 text-muted-foreground">
          <b className="text-foreground">启用顺序：</b>保存 Provider → 测试连接 →
          点击“启用 Provider” → 在下方选择文本模型。连接测试通过不会自动启用，避免未经确认的 Provider 被业务使用。
        </div>
      </section>
      <ConfirmDialog open={providerDeleteTarget !== null} onOpenChange={(open) => { if (!open && !busy) setProviderDeleteTarget(null); }} title={`删除 Provider「${providerDeleteTarget?.name ?? ""}」？`} description="仅未关联模型的 Provider 可以删除。已加密保存的凭据会一并删除，操作不可撤销。" confirmLabel="删除 Provider" destructive busy={busy} onConfirm={() => { if (!providerDeleteTarget) return; void mutate({ action: "delete_provider", providerId: providerDeleteTarget.id }, "Provider 已删除。").then((result) => { if (result !== null) setProviderDeleteTarget(null); }); }} />

      <section className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" />
            <div>
              <h2 className="text-sm font-semibold">2. 文本模型</h2>
              <p className="text-xs text-muted-foreground">
                从 Provider 返回的模型列表中选择；添加后测试 JSON，再启用模型。
              </p>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4 text-xs">
            <p className="font-medium text-foreground">Model ID 是什么？</p>
            <p className="mt-1 leading-5 text-muted-foreground">
              Model ID 是服务商提供的“模型调用名称”，例如
              <code className="mx-1 rounded bg-background px-1.5 py-0.5">
                qwen3.7-max
              </code>
              。它不是账号 ID、Provider ID 或数据库 ID。完成上方连接测试后，直接从自动发现列表选择即可，不需要手抄。
            </p>
          </div>
          {discoveredModels ? (
            <div className="mt-4 rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    从 {discoveredModels.providerName} 选择文本模型
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Provider 共返回 {discoveredModels.modelIds.length} 个模型；这里已过滤音频、图片、OCR、向量等非文本模型。
                  </p>
                </div>
                {data.providers.find(
                  (provider) => provider.id === discoveredModels.providerId,
                )?.enabled ? (
                  <Badge variant="outline">Provider 已启用</Badge>
                ) : (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        {
                          action: "set_provider_enabled",
                          providerId: discoveredModels.providerId,
                          enabled: true,
                        },
                        "Provider 已启用。请选择一个文本模型。",
                      )
                    }
                  >
                    启用 Provider
                  </Button>
                )}
              </div>
              <Input
                className="mt-3"
                value={discoveredModelSearch}
                onChange={(event) =>
                  setDiscoveredModelSearch(event.target.value)
                }
                placeholder="搜索模型，例如 qwen3.7-max"
              />
              <div className="mt-3 flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                {discoveredTextModels.slice(0, 40).map((modelId) => (
                  <Button
                    key={modelId}
                    size="sm"
                    variant={model.modelId === modelId ? "default" : "outline"}
                    aria-label={`选择模型 ${modelId}`}
                    onClick={() => {
                      setModel({
                        ...model,
                        name: modelDisplayName(modelId),
                        modelId,
                        providerId: discoveredModels.providerId,
                      });
                      setNotice(
                        `已选择 ${modelId}。确认显示名称后，点击“添加文本模型”。`,
                      );
                    }}
                  >
                    {modelId}
                  </Button>
                ))}
                {!discoveredTextModels.length ? (
                  <p className="text-xs text-muted-foreground">
                    没有找到匹配的文本生成模型，请换一个关键词。
                  </p>
                ) : null}
              </div>
              {discoveredTextModels.length > 40 ? (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  当前显示前 40 个结果，请输入更具体的名称缩小范围。
                </p>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              还没有自动发现结果。请先在上方对目标 Provider 执行“测试”；如果服务商不支持模型列表，再手动填写其官方文档中的 Model ID。
            </p>
          )}
          <div className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
            <Input
              value={model.name}
              onChange={(event) =>
                setModel({ ...model, name: event.target.value })
              }
              placeholder="显示名称，例如 Qwen 3.7 Max"
            />
            <Input
              value={model.modelId}
              onChange={(event) =>
                setModel({ ...model, modelId: event.target.value })
              }
              placeholder="Model ID，例如 qwen3.7-max"
            />
            <Select
              value={model.providerId}
              onValueChange={(providerId) => setModel({ ...model, providerId })}
            >
              <SelectTrigger>
                <SelectValue placeholder="选择 Provider" />
              </SelectTrigger>
              <SelectContent>
                {data.providers.map((item) => (
                  <SelectItem
                    key={item.id}
                    value={item.id}
                    disabled={
                      !item.enabled || item.lastTestStatus !== "passed"
                    }
                  >
                    {item.name}
                    {!item.enabled
                      ? "（未启用）"
                      : item.lastTestStatus !== "passed"
                        ? "（连接未通过）"
                        : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={
                busy ||
                !model.name ||
                !model.modelId ||
                !model.providerId ||
                !selectedProviderReady
              }
              onClick={() =>
                void mutate(
                  editingModelId
                    ? {
                        action: "update_generation_model",
                        modelId: editingModelId,
                        displayName: model.name,
                        providerModelId: model.modelId,
                        providerProfileId: model.providerId,
                        supportsJson: true,
                        supportsThinking: model.supportsThinking,
                        disableThinkingForJson: model.disableThinkingForJson,
                      }
                    : {
                        action: "create_generation_model",
                        displayName: model.name,
                        modelId: model.modelId,
                        providerProfileId: model.providerId,
                        supportsJson: true,
                        supportsThinking: model.supportsThinking,
                        disableThinkingForJson: model.disableThinkingForJson,
                      },
                  editingModelId
                    ? "文本模型已更新，请重新测试。"
                    : "文本模型已添加，请先测试。",
                ).then((result) => {
                  if (result !== null) {
                    setEditingModelId(null);
                    setModel({
                      name: "",
                      modelId: "",
                      providerId: "",
                      supportsThinking: true,
                      disableThinkingForJson: true,
                    });
                  }
                })
              }
            >
              {editingModelId ? "保存修改" : "添加文本模型"}
            </Button>
          </div>
          {selectedProvider && !selectedProviderReady ? (
            <p className="mt-2 text-xs text-amber-700">
              当前 Provider 尚未同时满足“连接测试通过”和“已启用”，暂时不能添加模型。请先完成上方启用步骤。
            </p>
          ) : null}
          {editingModelId ? (
            <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              正在编辑文本模型；保存后会停用并清除原测试结果。
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditingModelId(null);
                  setModel({
                    name: "",
                    modelId: "",
                    providerId: "",
                    supportsThinking: true,
                    disableThinkingForJson: true,
                  });
                }}
              >
                取消编辑
              </Button>
            </div>
          ) : null}
          <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
            <label className="flex items-center gap-2">
              <Switch
                checked={model.supportsThinking}
                onCheckedChange={(supportsThinking) =>
                  setModel({ ...model, supportsThinking })
                }
              />
              模型支持 Thinking。
            </label>
            <label className="flex items-center gap-2">
              <Switch
                checked={model.disableThinkingForJson}
                onCheckedChange={(disableThinkingForJson) =>
                  setModel({ ...model, disableThinkingForJson })
                }
              />
              结构化 JSON 请求关闭 Thinking；将以此组合测试并保存。
            </label>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-[900px] w-full text-left text-xs">
              <thead className="border-b text-muted-foreground">
                <tr>
                  <th className="px-2 py-2">模型</th>
                  <th>Provider</th>
                  <th>能力</th>
                  <th>测试</th>
                  <th>启用</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.generationModels.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="px-2 py-3">
                      <p className="font-medium">{item.displayName}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {item.modelId}
                      </p>
                    </td>
                    <td>
                      {providerName(data.providers, item.providerProfileId)}
                    </td>
                    <td>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                        JSON
                      </span>
                      {item.supportsThinking ? (
                        <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                          Thinking
                        </span>
                      ) : null}
                      {item.disableThinkingForJson ? (
                        <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">
                          JSON 关闭 Thinking
                        </span>
                      ) : null}
                    </td>
                    <td>
                      <ResultBadge status={item.lastTestStatus} />
                      {item.lastTestLatencyMs !== null ? (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          {item.lastTestLatencyMs} ms
                        </p>
                      ) : null}
                      {item.lastTestRequestId ? (
                        <p className="mt-1 max-w-32 truncate font-mono text-[10px] text-muted-foreground">
                          {item.lastTestRequestId}
                        </p>
                      ) : null}
                      {item.lastTestErrorCode ? (
                        <p className="mt-1 text-[10px] text-rose-700">
                          {item.lastTestErrorCode}
                        </p>
                      ) : null}
                    </td>
                    <td>
                      <Button
                        size="sm"
                        variant={item.enabled ? "outline" : "default"}
                        disabled={
                          busy ||
                          (!item.enabled && item.lastTestStatus !== "passed")
                        }
                        onClick={() =>
                          void mutate(
                            {
                              action: "set_generation_model_enabled",
                              modelId: item.id,
                              enabled: !item.enabled,
                            },
                            item.enabled ? "模型已停用。" : "模型已启用。",
                          )
                        }
                      >
                        {item.enabled
                          ? "停用"
                          : item.lastTestStatus === "passed"
                            ? "启用模型"
                            : "先测试模型"}
                      </Button>
                    </td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setEditingModelId(item.id);
                            setModel({
                              name: item.displayName,
                              modelId: item.modelId,
                              providerId: item.providerProfileId,
                              supportsThinking: item.supportsThinking,
                              disableThinkingForJson:
                                item.disableThinkingForJson,
                            });
                          }}
                        >
                          编辑
                        </Button>
                        {verificationProjectId ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              void mutate(
                                {
                                  action: "test_generation_model",
                                  projectId: verificationProjectId,
                                  modelId: item.id,
                                },
                                "模型结构化输出测试完成。",
                              )
                            }
                          >
                            <RefreshCw />
                            测试 JSON
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">
                            需要可验证项目
                          </span>
                        )}
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          disabled={busy}
                          aria-label={`删除 ${item.displayName}`}
                          onClick={() => setModelDeleteTarget(item)}
                        >
                          <Trash2 />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="rounded-xl border bg-card p-5 shadow-sm">
          <div className="flex items-center gap-2">
            <Settings2 className="size-4 text-primary" />
            <div>
              <h2 className="text-sm font-semibold">2.2 向量模型</h2>
              <p className="text-xs text-muted-foreground">
                当前索引固定为 {data.vectorDimensions}{" "}
                维。切换向量默认模型必须进入独立的重向量化流程，不会自动混用旧向量。
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            {data.embeddingModels.map((item) => (
              <div key={item.id} className="rounded-lg border p-3 text-xs">
                <p className="font-medium">{item.displayName}</p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {item.modelId} · {item.dimensions} 维 ·{" "}
                  {providerName(data.providers, item.providerProfileId)}
                </p>
                <div className="mt-2">
                  <ResultBadge status={item.lastTestStatus} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-2">
            <Input
              value={embedding.name}
              onChange={(event) =>
                setEmbedding({ ...embedding, name: event.target.value })
              }
              placeholder="新增向量模型显示名称"
            />
            <Input
              value={embedding.modelId}
              onChange={(event) =>
                setEmbedding({ ...embedding, modelId: event.target.value })
              }
              placeholder="1024 维 Model ID"
            />
            <Select
              value={embedding.providerId}
              onValueChange={(providerId) =>
                setEmbedding({ ...embedding, providerId })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Provider" />
              </SelectTrigger>
              <SelectContent>
                {data.providers.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              disabled={
                busy ||
                !embedding.name ||
                !embedding.modelId ||
                !embedding.providerId
              }
              onClick={() =>
                void mutate(
                  {
                    action: "create_embedding_model",
                    displayName: embedding.name,
                    modelId: embedding.modelId,
                    providerProfileId: embedding.providerId,
                    dimensions: 1024,
                  },
                  "向量模型已登记；不会自动切换当前索引。",
                )
              }
            >
              <Plus />
              登记 1024 维模型
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /><div><h2 className="text-sm font-semibold">3. 默认模型</h2><p className="text-xs text-muted-foreground">这里只显示当前生效默认值；修改业务使用方式请在下方场景绑定中操作。</p></div></div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border bg-background p-4"><p className="text-xs text-muted-foreground">默认文本模型</p><p className="mt-2 font-medium">{defaultTextModel?.displayName ?? "尚未配置"}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{defaultTextModel?.modelId ?? "请为通用对话绑定已测试模型"}</p></div>
          <div className="rounded-lg border bg-background p-4"><p className="text-xs text-muted-foreground">当前向量模型</p><p className="mt-2 font-medium">{currentEmbeddingModel?.displayName ?? "尚未配置"}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{currentEmbeddingModel ? `${currentEmbeddingModel.modelId} · ${currentEmbeddingModel.dimensions} 维` : "切换需要独立重向量化流程"}</p></div>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold">4. 场景绑定</h2>
            <p className="text-xs text-muted-foreground">
              默认文本模型由“通用对话”场景决定；业务页面只能使用场景绑定，不能提交
              Provider 或 API Key。
            </p>
          </div>
        </div>
        <div className="mt-4 space-y-2">
          {data.scenarios.map((item) => (
            <div
              key={item.id}
              className="grid gap-3 rounded-lg border p-3 md:grid-cols-[210px_1fr_1fr_auto]"
            >
              <div className="self-center">
                <p className="text-xs font-medium">
                  {names[item.scenario] ?? item.scenario}
                </p>
                {item.scenario === "general_chat" ? (
                  <p className="mt-1 text-[10px] text-primary">默认文本模型</p>
                ) : null}
              </div>
              <Select
                value={item.generationModelId ?? "none"}
                onValueChange={(generationModelId) =>
                  void mutate(
                    {
                      action: "bind_scenario",
                      scenario: item.scenario,
                      generationModelId:
                        generationModelId === "none" ? null : generationModelId,
                      embeddingModelId: item.embeddingModelId,
                      enabled: item.enabled,
                    },
                    "场景绑定已更新；新请求立即使用新配置。",
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="文本模型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不使用文本模型</SelectItem>
                  {usableModels.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={item.embeddingModelId ?? "none"}
                disabled
                onValueChange={() => undefined}
              >
                <SelectTrigger>
                  <SelectValue placeholder="向量模型（需重向量化）" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">保持当前索引</SelectItem>
                </SelectContent>
              </Select>
              <Switch
                checked={item.enabled}
                disabled={busy}
                onCheckedChange={(enabled) =>
                  void mutate(
                    {
                      action: "bind_scenario",
                      scenario: item.scenario,
                      generationModelId: item.generationModelId,
                      embeddingModelId: item.embeddingModelId,
                      enabled,
                    },
                    enabled ? "场景已启用。" : "场景已停用。",
                  )
                }
              />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-primary/15 bg-primary/[0.035] p-5">
        <div className="flex items-center gap-2">
          <KeyRound className="size-4 text-primary" />
          <h2 className="text-sm font-semibold">使用帮助</h2>
        </div>
        <ol className="mt-3 grid gap-2 text-xs leading-5 text-muted-foreground md:grid-cols-2">
          <li>1. 添加 Provider，填写 HTTPS 地址、区域和 API Key。</li>
          <li>
            2. 测试连接；403 表示 Key 没有资源或模型权限，429
            才是额度、限流或并发问题。
          </li>
          <li>3. 自动读取模型列表，或手动输入 Model ID。</li>
          <li>4. 测试结构化输出，成功后启用并绑定业务场景。</li>
          <li>
            5. 替换 API Key 后无需改代码、提交 CI
            或重启；后续请求会读取新的加密凭据。
          </li>
          <li>
            6. 不保存或回显 API Key；审计只记录 Provider/模型 ID、状态、Request
            ID 和延迟。
          </li>
        </ol>
      </section>
      <ConfirmDialog
        open={modelDeleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setModelDeleteTarget(null);
        }}
        title={`删除模型「${modelDeleteTarget?.displayName ?? ""}」？`}
        description="已被业务场景或历史产物引用的模型不能删除。删除操作不可撤销。"
        confirmLabel="删除模型"
        destructive
        busy={busy}
        onConfirm={() => {
          if (!modelDeleteTarget) return;
          void mutate(
            {
              action: "delete_generation_model",
              modelId: modelDeleteTarget.id,
            },
            "模型已删除。",
          ).then((result) => {
            if (result !== null) setModelDeleteTarget(null);
          });
        }}
      />
    </main>
  );
}
