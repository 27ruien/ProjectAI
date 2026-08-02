"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CloudCog, Eye, EyeOff, KeyRound, Plus, RefreshCw, Settings2, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type Provider = {
  id: string; name: string; providerType: "dashscope" | "openai_compatible"; baseUrl: string; region: string;
  credentialMode: "environment" | "managed"; hasApiKey: boolean; apiKeyMasked: string | null; enabled: boolean;
  lastTestStatus: string; lastTestedAt: string | null; lastTestErrorCode: string | null; lastTestLatencyMs: number | null; lastTestRequestId: string | null; modelDiscoverySupported: boolean;
};
type GenerationModel = { id: string; displayName: string; modelId: string; providerProfileId: string; enabled: boolean; supportsJson: boolean; supportsThinking: boolean; disableThinkingForJson: boolean; lastTestStatus: string; lastTestedAt: string | null; lastTestErrorCode: string | null; lastTestLatencyMs: number | null };
type EmbeddingModel = { id: string; displayName: string; modelId: string; providerProfileId: string; dimensions: number; enabled: boolean; lastTestStatus: string };
type Scenario = { id: string; scenario: string; generationModelId: string | null; embeddingModelId: string | null; enabled: boolean };
type Snapshot = { providers: Provider[]; generationModels: GenerationModel[]; embeddingModels: EmbeddingModel[]; scenarios: Scenario[]; vectorDimensions: number; operation?: { modelIds?: string[]; modelDiscoverySupported?: boolean; actualModel?: string; latencyMs?: number; requestId?: string | null } | null };
type ProviderDraft = { name: string; providerType: "dashscope" | "openai_compatible"; baseUrl: string; region: string; apiKey: string };

const names: Record<string, string> = {
  general_chat: "默认文本生成 / 通用对话",
  project_grounded_chat: "项目与公司资料问答",
  requirement_overview_prefill: "需求概览预填",
  requirement_overview_guidance: "需求概览引导",
  requirement_markdown_generation: "需求概览 Markdown",
};

const initialProvider: ProviderDraft = { name: "", providerType: "dashscope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", region: "cn-beijing", apiKey: "" };

function ResultBadge({ status }: { status: string }) {
  const tone = status === "passed" ? "bg-emerald-500/10 text-emerald-700" : status === "failed" ? "bg-rose-500/10 text-rose-700" : "bg-muted text-muted-foreground";
  const label = status === "passed" ? "测试通过" : status === "failed" ? "测试失败" : "未测试";
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${tone}`}>{label}</span>;
}

function providerName(providers: Provider[], id: string) {
  return providers.find((provider) => provider.id === id)?.name ?? "已删除 Provider";
}

export function AiModelManagementPage({ organizationId, verificationProjectId }: { organizationId: string; verificationProjectId: string | null }) {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [providerDialog, setProviderDialog] = useState(false);
  const [providerDraft, setProviderDraft] = useState(initialProvider);
  const [showKey, setShowKey] = useState(false);
  const [replacementKey, setReplacementKey] = useState<Record<string, string>>({});
  const [model, setModel] = useState({ name: "", modelId: "", providerId: "", supportsThinking: true, disableThinkingForJson: true });
  const [embedding, setEmbedding] = useState({ name: "", modelId: "", providerId: "" });
  const [discoveredModels, setDiscoveredModels] = useState<string[]>([]);

  const load = useCallback(async () => {
    const response = await fetch(withBasePath(`/api/admin/ai-configuration?organizationId=${encodeURIComponent(organizationId)}`), { credentials: "include", cache: "no-store" });
    const body = await response.json() as Snapshot & { error?: { message?: string } };
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

  const mutate = async (payload: Record<string, unknown>, successMessage?: string) => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch(withBasePath("/api/admin/ai-configuration"), { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, organizationId }) });
      const body = await response.json() as Snapshot & { error?: { message?: string } };
      if (!response.ok) throw new Error(body.error?.message ?? "配置未保存");
      setData(body);
      if (body.operation?.modelIds) setDiscoveredModels(body.operation.modelIds);
      if (successMessage) setNotice(successMessage);
      return body.operation ?? null;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配置未保存");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const usableModels = useMemo(() => data?.generationModels.filter((item) => item.enabled && item.lastTestStatus === "passed") ?? [], [data]);
  if (!data) return <div className="p-6 text-sm text-muted-foreground">正在加载 Provider 与模型配置…</div>;

  return <main className="mx-auto max-w-7xl space-y-6 pb-10">
    <header className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-xs font-medium text-primary">管理设置</p><h1 className="mt-1 text-xl font-semibold tracking-tight">Provider 与模型</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">在这里安全配置 Provider、API Key、文本模型和业务场景。API Key 仅通过一次加密请求提交；保存后不会回显、不会进入浏览器存储或日志。</p></div>
      <Badge variant="outline" className="w-fit">服务器加密凭据库</Badge>
    </header>
    {error ? <Alert variant="destructive"><AlertTitle>操作未完成</AlertTitle><AlertDescription>{error}</AlertDescription></Alert> : null}
    {notice ? <Alert><CheckCircle2 className="size-4" /><AlertTitle>已完成</AlertTitle><AlertDescription>{notice}</AlertDescription></Alert> : null}

    <section className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><CloudCog className="size-4 text-primary" /><div><h2 className="text-sm font-semibold">1. Provider</h2><p className="text-xs text-muted-foreground">先保存凭据并测试连接，再启用并添加模型。</p></div></div>
        <Dialog open={providerDialog} onOpenChange={setProviderDialog}><DialogTrigger asChild><Button size="sm"><Plus />添加 Provider</Button></DialogTrigger><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>添加 Provider</DialogTitle><DialogDescription>第 1 步填写基础信息；第 2 步一次性输入 API Key；保存后先测试连接再启用。</DialogDescription></DialogHeader><div className="space-y-3"><div className="grid gap-3 sm:grid-cols-2"><Input value={providerDraft.name} onChange={(event) => setProviderDraft({ ...providerDraft, name: event.target.value })} placeholder="Provider 名称" /><Select value={providerDraft.providerType} onValueChange={(providerType: "dashscope" | "openai_compatible") => setProviderDraft({ ...providerDraft, providerType })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="dashscope">DashScope</SelectItem><SelectItem value="openai_compatible">OpenAI Compatible</SelectItem></SelectContent></Select></div><Input value={providerDraft.baseUrl} onChange={(event) => setProviderDraft({ ...providerDraft, baseUrl: event.target.value })} placeholder="HTTPS Base URL" /><Input value={providerDraft.region} onChange={(event) => setProviderDraft({ ...providerDraft, region: event.target.value })} placeholder="Region，例如 cn-beijing" /><div className="relative"><Input type={showKey ? "text" : "password"} autoComplete="new-password" value={providerDraft.apiKey} onChange={(event) => setProviderDraft({ ...providerDraft, apiKey: event.target.value })} placeholder="API Key（保存后不再显示）" /><Button type="button" size="icon-sm" variant="ghost" className="absolute right-1 top-1" onClick={() => setShowKey(!showKey)} aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}>{showKey ? <EyeOff /> : <Eye />}</Button></div><p className="text-xs leading-5 text-muted-foreground">DashScope 北京地址示例：`https://{'{'}WorkspaceId{'}'}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`。不保存示例 WorkspaceId。</p></div><DialogFooter><Button variant="outline" onClick={() => setProviderDialog(false)}>取消</Button><Button disabled={busy || !providerDraft.name.trim()} onClick={async () => { const result = await mutate({ action: "create_provider", ...providerDraft }, "Provider 已保存。请执行连接测试后启用。"); if (result !== null) { setProviderDraft(initialProvider); setShowKey(false); setProviderDialog(false); } }}>保存 Provider</Button></DialogFooter></DialogContent></Dialog>
      </div>
      <div className="mt-5 overflow-x-auto"><table className="min-w-[1100px] w-full text-left text-xs"><thead className="border-b text-muted-foreground"><tr><th className="px-2 py-2">Provider</th><th className="px-2 py-2">地址 / 区域</th><th className="px-2 py-2">API Key</th><th className="px-2 py-2">模型</th><th className="px-2 py-2">连接测试</th><th className="px-2 py-2">启用</th><th className="px-2 py-2 text-right">操作</th></tr></thead><tbody>{data.providers.map((item) => { const modelCount = data.generationModels.filter((model) => model.providerProfileId === item.id).length + data.embeddingModels.filter((model) => model.providerProfileId === item.id).length; return <tr key={item.id} className="border-b last:border-0"><td className="px-2 py-3"><p className="font-medium">{item.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{item.providerType}</p></td><td className="px-2 py-3"><p className="max-w-72 truncate font-mono text-[10px]">{item.baseUrl}</p><p className="mt-1 text-[10px] text-muted-foreground">{item.region}</p></td><td className="px-2 py-3"><p>{item.hasApiKey ? "已配置" : "未配置"}{item.apiKeyMasked ? ` · ${item.apiKeyMasked}` : ""}</p><div className="mt-1 flex gap-1"><Input type="password" autoComplete="new-password" className="h-7 w-36 text-[10px]" value={replacementKey[item.id] ?? ""} onChange={(event) => setReplacementKey({ ...replacementKey, [item.id]: event.target.value })} placeholder="替换 API Key" /><Button size="sm" variant="outline" disabled={busy || !(replacementKey[item.id] ?? "").trim()} onClick={() => void mutate({ action: "replace_provider_api_key", providerId: item.id, apiKey: replacementKey[item.id] }, "API Key 已替换；请重新测试 Provider 和模型。").then(() => setReplacementKey({ ...replacementKey, [item.id]: "" }))}>替换</Button></div></td><td className="px-2 py-3">{modelCount} 个</td><td className="px-2 py-3"><ResultBadge status={item.lastTestStatus} />{item.lastTestLatencyMs !== null ? <p className="mt-1 text-[10px] text-muted-foreground">{item.lastTestLatencyMs} ms</p> : null}</td><td className="px-2 py-3"><Switch checked={item.enabled} disabled={busy || (item.lastTestStatus !== "passed" && !item.enabled)} onCheckedChange={(enabled) => void mutate({ action: "set_provider_enabled", providerId: item.id, enabled }, enabled ? "Provider 已启用。" : "Provider 已停用。")} /></td><td className="px-2 py-3 text-right"><div className="flex justify-end gap-1"><Button size="sm" variant="outline" disabled={busy || !item.hasApiKey} onClick={() => void mutate({ action: "test_provider", providerId: item.id }, "Provider 测试完成。可自动读取的模型已显示在文本模型区域。")}> <RefreshCw />测试</Button><Button size="icon-sm" variant="ghost" disabled={busy} aria-label={`删除 ${item.name}`} onClick={() => { if (window.confirm(`确认删除 Provider「${item.name}」吗？仅未关联模型的 Provider 可以删除。`)) void mutate({ action: "delete_provider", providerId: item.id }, "Provider 已删除。"); }}><Trash2 /></Button></div></td></tr>; })}</tbody></table></div>
      {discoveredModels.length ? <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs"><b>Provider 自动发现模型：</b><span className="ml-2 text-muted-foreground">{discoveredModels.join("、")}</span></div> : <p className="mt-4 text-xs text-muted-foreground">若 Provider 不支持自动读取模型列表，可直接手动添加 Model ID。</p>}
    </section>

    <section className="grid gap-6 xl:grid-cols-[1.4fr_0.6fr]">
      <div className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /><div><h2 className="text-sm font-semibold">2. 文本模型</h2><p className="text-xs text-muted-foreground">测试成功、Provider 已启用且支持 JSON 的模型才可启用。</p></div></div><div className="mt-4 grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]"><Input value={model.name} onChange={(event) => setModel({ ...model, name: event.target.value })} placeholder="显示名称" /><Input value={model.modelId} onChange={(event) => setModel({ ...model, modelId: event.target.value })} placeholder="Model ID" /><Select value={model.providerId} onValueChange={(providerId) => setModel({ ...model, providerId })}><SelectTrigger><SelectValue placeholder="选择 Provider" /></SelectTrigger><SelectContent>{data.providers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><Button disabled={busy || !model.name || !model.modelId || !model.providerId} onClick={() => void mutate({ action: "create_generation_model", displayName: model.name, modelId: model.modelId, providerProfileId: model.providerId, supportsJson: true, supportsThinking: model.supportsThinking, disableThinkingForJson: model.disableThinkingForJson }, "文本模型已添加，请先测试。")}>添加</Button></div><div className="mt-3 grid gap-2 text-xs text-muted-foreground"><label className="flex items-center gap-2"><Switch checked={model.supportsThinking} onCheckedChange={(supportsThinking) => setModel({ ...model, supportsThinking })} />模型支持 Thinking。</label><label className="flex items-center gap-2"><Switch checked={model.disableThinkingForJson} onCheckedChange={(disableThinkingForJson) => setModel({ ...model, disableThinkingForJson })} />结构化 JSON 请求关闭 Thinking；将以此组合测试并保存。</label></div><div className="mt-4 overflow-x-auto"><table className="min-w-[900px] w-full text-left text-xs"><thead className="border-b text-muted-foreground"><tr><th className="px-2 py-2">模型</th><th>Provider</th><th>能力</th><th>测试</th><th>启用</th><th className="text-right">操作</th></tr></thead><tbody>{data.generationModels.map((item) => <tr key={item.id} className="border-b last:border-0"><td className="px-2 py-3"><p className="font-medium">{item.displayName}</p><p className="font-mono text-[10px] text-muted-foreground">{item.modelId}</p></td><td>{providerName(data.providers, item.providerProfileId)}</td><td><span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">JSON</span>{item.supportsThinking ? <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">Thinking</span> : null}{item.disableThinkingForJson ? <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px]">JSON 关闭 Thinking</span> : null}</td><td><ResultBadge status={item.lastTestStatus} />{item.lastTestLatencyMs !== null ? <p className="mt-1 text-[10px] text-muted-foreground">{item.lastTestLatencyMs} ms</p> : null}</td><td><Switch checked={item.enabled} disabled={busy || (!item.enabled && item.lastTestStatus !== "passed")} onCheckedChange={(enabled) => void mutate({ action: "set_generation_model_enabled", modelId: item.id, enabled }, enabled ? "模型已启用。" : "模型已停用。")} /></td><td className="text-right"><div className="flex justify-end gap-1">{verificationProjectId ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void mutate({ action: "test_generation_model", projectId: verificationProjectId, modelId: item.id }, "模型结构化输出测试完成。")}><RefreshCw />测试</Button> : <span className="text-muted-foreground">需要可验证项目</span>}<Button size="icon-sm" variant="ghost" disabled={busy} aria-label={`删除 ${item.displayName}`} onClick={() => { if (window.confirm(`确认删除模型「${item.displayName}」吗？已被场景或历史产物使用的模型不能删除。`)) void mutate({ action: "delete_generation_model", modelId: item.id }, "模型已删除。"); }}><Trash2 /></Button></div></td></tr>)}</tbody></table></div></div>
      <div className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-center gap-2"><Settings2 className="size-4 text-primary" /><div><h2 className="text-sm font-semibold">3. 向量模型</h2><p className="text-xs text-muted-foreground">当前索引固定为 {data.vectorDimensions} 维。切换向量默认模型必须进入独立的重向量化流程，不会自动混用旧向量。</p></div></div><div className="mt-4 space-y-2">{data.embeddingModels.map((item) => <div key={item.id} className="rounded-lg border p-3 text-xs"><p className="font-medium">{item.displayName}</p><p className="mt-1 font-mono text-[10px] text-muted-foreground">{item.modelId} · {item.dimensions} 维 · {providerName(data.providers, item.providerProfileId)}</p><div className="mt-2"><ResultBadge status={item.lastTestStatus} /></div></div>)}</div><div className="mt-4 grid gap-2"><Input value={embedding.name} onChange={(event) => setEmbedding({ ...embedding, name: event.target.value })} placeholder="新增向量模型显示名称" /><Input value={embedding.modelId} onChange={(event) => setEmbedding({ ...embedding, modelId: event.target.value })} placeholder="1024 维 Model ID" /><Select value={embedding.providerId} onValueChange={(providerId) => setEmbedding({ ...embedding, providerId })}><SelectTrigger><SelectValue placeholder="Provider" /></SelectTrigger><SelectContent>{data.providers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select><Button variant="outline" disabled={busy || !embedding.name || !embedding.modelId || !embedding.providerId} onClick={() => void mutate({ action: "create_embedding_model", displayName: embedding.name, modelId: embedding.modelId, providerProfileId: embedding.providerId, dimensions: 1024 }, "向量模型已登记；不会自动切换当前索引。")}><Plus />登记 1024 维模型</Button></div></div>
    </section>

    <section className="rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /><div><h2 className="text-sm font-semibold">4. 默认模型与场景绑定</h2><p className="text-xs text-muted-foreground">默认文本模型由“通用对话”场景决定；业务页面只能使用场景绑定，不能提交 Provider 或 API Key。</p></div></div><div className="mt-4 space-y-2">{data.scenarios.map((item) => <div key={item.id} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[210px_1fr_1fr_auto]"><div className="self-center"><p className="text-xs font-medium">{names[item.scenario] ?? item.scenario}</p>{item.scenario === "general_chat" ? <p className="mt-1 text-[10px] text-primary">默认文本模型</p> : null}</div><Select value={item.generationModelId ?? "none"} onValueChange={(generationModelId) => void mutate({ action: "bind_scenario", scenario: item.scenario, generationModelId: generationModelId === "none" ? null : generationModelId, embeddingModelId: item.embeddingModelId, enabled: item.enabled }, "场景绑定已更新；新请求立即使用新配置。")}><SelectTrigger><SelectValue placeholder="文本模型" /></SelectTrigger><SelectContent><SelectItem value="none">不使用文本模型</SelectItem>{usableModels.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.displayName}</SelectItem>)}</SelectContent></Select><Select value={item.embeddingModelId ?? "none"} disabled onValueChange={() => undefined}><SelectTrigger><SelectValue placeholder="向量模型（需重向量化）" /></SelectTrigger><SelectContent><SelectItem value="none">保持当前索引</SelectItem></SelectContent></Select><Switch checked={item.enabled} disabled={busy} onCheckedChange={(enabled) => void mutate({ action: "bind_scenario", scenario: item.scenario, generationModelId: item.generationModelId, embeddingModelId: item.embeddingModelId, enabled }, enabled ? "场景已启用。" : "场景已停用。")} /></div>)}</div></section>

    <section className="rounded-xl border border-primary/15 bg-primary/[0.035] p-5"><div className="flex items-center gap-2"><KeyRound className="size-4 text-primary" /><h2 className="text-sm font-semibold">使用帮助</h2></div><ol className="mt-3 grid gap-2 text-xs leading-5 text-muted-foreground md:grid-cols-2"><li>1. 添加 Provider，填写 HTTPS 地址、区域和 API Key。</li><li>2. 测试连接；403 表示 Key 没有资源或模型权限，429 才是额度、限流或并发问题。</li><li>3. 自动读取模型列表，或手动输入 Model ID。</li><li>4. 测试结构化输出，成功后启用并绑定业务场景。</li><li>5. 替换 API Key 后无需改代码、提交 CI 或重启；后续请求会读取新的加密凭据。</li><li>6. 不保存或回显 API Key；审计只记录 Provider/模型 ID、状态、Request ID 和延迟。</li></ol></section>
  </main>;
}
