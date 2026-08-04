"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  Bot,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderKanban,
  ListChecks,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeft,
  Paperclip,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/common/button";
import { withBasePath } from "@/lib/base-path";
import type { AuthorizedProjectSummary, ViewerContext } from "@/lib/auth/ui-types";
import {
  archiveProjectAssistantThread,
  askProjectAssistant,
  createProjectAssistantThread,
  deleteProjectAssistantThread,
  getProjectAssistantThread,
  listProjectAssistantThreads,
  ProjectAssistantApiError,
  listGeneralAssistantModels,
  setGeneralAssistantThreadModel,
} from "@/lib/ai/project-assistant/client";
import { documentErrorMessage } from "@/lib/documents/client";
import type { ProjectDocumentDto } from "@/types/documents";
import type {
  ProjectAssistantCitationDto,
  ProjectAssistantThreadDto,
  ProjectAssistantThreadSummaryDto,
  AssistantContextReference,
} from "@/types/project-assistant";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RequirementOverviewWorkspace } from "@/components/requirement-overview/RequirementOverviewWorkspace";
import { classifyAssistantIntent, intentNeedsProjectEvidence } from "@/lib/ai/project-assistant/intent-router";
import { AssistantMarkdown } from "./AssistantMarkdown";
import { AssistantCitationPreview } from "./AssistantCitationPreview";
import { documentViewerPath, type DocumentLocator } from "@/lib/documents/viewer-route";
import { AssistantHistoryCitationPreview } from "./AssistantHistoryCitationPreview";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type PanelPhase =
  | "loading"
  | "ready"
  | "disabled"
  | "error";

type QuickAction = "requirement_overview" | "project_summary" | "pending_items";

function sourceLabel(citation: ProjectAssistantCitationDto): string {
  const source = citation.source;
  switch (source.type) {
    case "pdf_page":
      return `第 ${source.pageNumber} 页`;
    case "docx_section":
      return `${source.headingPath.join(" / ") || "正文"} · 段落 ${source.paragraphStart}–${source.paragraphEnd}`;
    case "xlsx_range":
      return `${source.sheetName} · 行 ${source.rowStart}–${source.rowEnd}`;
    case "pptx_slide":
      return `第 ${source.slideNumber} 张幻灯片`;
    case "text_lines":
      return `行 ${source.lineStart}–${source.lineEnd}`;
    case "markdown_section":
      return `${source.headingPath.join(" / ") || "正文"} · 行 ${source.lineStart}–${source.lineEnd}`;
  }
}

function assistantErrorMessage(error: unknown): string {
  if (error instanceof ProjectAssistantApiError) {
    const messages: Record<string, string> = {
      AI_INVALID_REQUEST: "请输入问题。",
      AI_SOURCE_NOT_FOUND: "当前项目还没有可供 AI 使用的资料，可以先上传项目文件。",
      AI_RETRIEVAL_FAILED: "资料暂时没有检索成功，你的问题和会话已经保留，可以稍后重试。",
      AI_RATE_LIMITED: "提问过于频繁，请稍后重试。",
      AI_USER_DAILY_LIMIT_REACHED: "今日个人 AI 用量已达上限。",
      AI_PROJECT_DAILY_LIMIT_REACHED: "今日项目 AI 用量已达上限。",
      AI_CONCURRENCY_LIMIT_REACHED: "AI 服务繁忙，请稍后重试。",
      AI_PROVIDER_TIMEOUT: "AI 服务响应超时，请重试。",
      AI_PROVIDER_UNAVAILABLE: "AI 服务暂时没有完成回答，你的输入和资料没有丢失，请稍后重试。",
      AI_EXECUTION_FAILED: "AI 服务暂时没有完成回答，你的输入和资料没有丢失，请稍后重试。",
      AI_CITATION_VALIDATION_FAILED: "回答未通过来源校验，请重试。",
      AI_THREAD_NOT_FOUND: "对话不存在或无权访问。",
    };
    return messages[error.code] || error.message;
  }
  return "项目 AI 助手暂时不可用，请稍后重试。";
}

const scopeLabels: Record<string, string> = {
  organization: "[公司资料]",
  department: "[项目资料]",
  project: "[项目资料]",
  restricted: "[项目资料]",
};

export function ProjectAssistantPanel({
  project,
  focused = false,
  viewer,
  initialThreadId,
}: {
  project: Pick<AuthorizedProjectSummary, "id"> | null;
  focused?: boolean;
  viewer?: ViewerContext;
  initialThreadId?: string | null;
}) {
  const projectId = project?.id ?? null;
  const loadController = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<PanelPhase>("loading");
  const [threads, setThreads] = useState<ProjectAssistantThreadSummaryDto[]>([]);
  const [thread, setThread] = useState<ProjectAssistantThreadDto | null>(null);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [optimisticQuestion, setOptimisticQuestion] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [sourceState, setSourceState] = useState<{
    projectId: string;
    documents: Array<ProjectDocumentDto & { sourceScope: "project" | "organization" }>;
  } | null>(null);
  const [threadSearch, setThreadSearch] = useState("");
  const [requirementOverviewThreadId, setRequirementOverviewThreadId] = useState<string | null>(null);
  const [requirementOverviewProjectId, setRequirementOverviewProjectId] = useState<string | null>(null);
  const [contextOptions, setContextOptions] = useState<{ projects: Array<{ id: string; label: string }>; documents: Array<{ id: string; label: string; sourceType?: "project" | "company" }> }>({ projects: [], documents: [] });
  const [contextReferences, setContextReferences] = useState<AssistantContextReference[]>([]);
  const [picker, setPicker] = useState<"project" | "document" | null>(null);
  const [pendingQuickAction, setPendingQuickAction] = useState<QuickAction | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [models, setModels] = useState<Array<{ id: string; displayName: string; modelId: string }>>([]);
  const [changingModel, setChangingModel] = useState(false);
  const messageViewport = useRef<HTMLDivElement | null>(null);
  const availableSources = useMemo(
    () => sourceState?.projectId === projectId ? sourceState.documents : [],
    [projectId, sourceState],
  );
  const selectedSourceIds = useMemo(() => availableSources.map((item) => item.id), [availableSources]);
  const projectSourceCount = useMemo(() => availableSources.filter((item) => item.sourceScope === "project").length, [availableSources]);
  const templateSourceCount = availableSources.length - projectSourceCount;
  const referencedProjectId = contextReferences.find((item): item is Extract<AssistantContextReference, { type: "project" }> => item.type === "project")?.projectId ?? null;
  const artifactProjectId = projectId ?? referencedProjectId;
  const visibleThreads = useMemo(() => { const query = threadSearch.trim().toLocaleLowerCase("zh-CN"); return query ? threads.filter((item) => item.title.toLocaleLowerCase("zh-CN").includes(query)) : threads; }, [threadSearch, threads]);
  const visibleContextOptions = useMemo(() => {
    const query = pickerSearch.trim().toLocaleLowerCase("zh-CN");
    const values = picker === "project" ? contextOptions.projects : contextOptions.documents;
    return query ? values.filter((item) => item.label.toLocaleLowerCase("zh-CN").includes(query)) : values;
  }, [contextOptions, picker, pickerSearch]);
  const referencedProjectCount = useMemo(
    () => contextReferences.filter((item) => item.type === "project").length,
    [contextReferences],
  );
  const referencedDocumentCount = useMemo(
    () => contextReferences.filter((item) => item.type === "document").length,
    [contextReferences],
  );

  const loadThread = useCallback(
    async (threadId: string, signal?: AbortSignal) => {
      const response = await getProjectAssistantThread(
        projectId,
        threadId,
        signal,
      );
      setRequirementOverviewThreadId((current) => current === threadId ? current : null);
      setThread(response.thread);
      return response.thread;
    },
    [projectId],
  );

  const refreshThreads = useCallback(
    async (preferredThreadId?: string, signal?: AbortSignal) => {
      const response = await listProjectAssistantThreads(projectId, signal);
      setThreads(response.threads);
      const selected =
        preferredThreadId ||
        response.threads.find((item) => item.status === "active")?.id ||
        response.threads[0]?.id;
      if (selected) await loadThread(selected, signal);
      else setThread(null);
    },
    [loadThread, projectId],
  );

  useEffect(() => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const timer = window.setTimeout(() => {
      void refreshThreads(initialThreadId ?? undefined, controller.signal)
        .then(() => setPhase("ready"))
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === "AbortError") return;
          if (
            caught instanceof ProjectAssistantApiError &&
            caught.code === "AI_ASSISTANT_DISABLED"
          ) {
            setPhase("disabled");
            return;
          }
          setError(assistantErrorMessage(caught));
          setPhase("error");
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [initialThreadId, projectId, refreshThreads]);

  useEffect(() => {
    if (projectId) return;
    const controller = new AbortController();
    void fetch(withBasePath("/api/ai/context"), { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("context list failed");
        return response.json() as Promise<typeof contextOptions>;
      })
      .then(setContextOptions)
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) setError("可用资料范围暂时无法加载，请刷新重试。");
      });
    return () => controller.abort();
  }, [projectId]);

  useEffect(() => {
    if (projectId || viewer?.user.productRole !== "super_admin") return;
    void listGeneralAssistantModels().then((response) => setModels(response.models)).catch(() => undefined);
  }, [projectId, viewer?.user.productRole]);

  useEffect(() => {
    messageViewport.current?.scrollTo({ top: messageViewport.current.scrollHeight, behavior: "smooth" });
  }, [thread?.id, thread?.messages.length, sending]);

  useEffect(() => {
    if (!projectId) return;
    const controller = new AbortController();
    void fetch(withBasePath(`/api/projects/${projectId}/ai/sources`), { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("source list failed");
        return response.json() as Promise<{ documents: Array<ProjectDocumentDto & { sourceScope: "project" | "organization" }> }>;
      })
      .then((response) => {
        setSourceState({ projectId, documents: response.documents });
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError("知识来源列表暂时不可用，请刷新重试。");
        }
      });
    return () => controller.abort();
  }, [projectId]);

  const createThread = async () => {
    setCreating(true);
    setError(null);
    try {
      const response = await createProjectAssistantThread(projectId);
      setThread(response.thread);
      await refreshThreads(response.thread.id);
      setPhase("ready");
      return response.thread;
    } catch (caught) {
      setError(assistantErrorMessage(caught));
      return null;
    } finally {
      setCreating(false);
    }
  };

  const sendQuestion = async (
    nextQuestion: string,
    references: AssistantContextReference[] = contextReferences,
  ) => {
    if (sending) return;
    const normalized = nextQuestion.trim();
    if (normalized.length < 2) {
      setError("请输入问题。");
      return;
    }
    const intent = classifyAssistantIntent({ question: normalized, hasAssociatedProject: Boolean(projectId) });
    if (projectId && intentNeedsProjectEvidence(intent) && selectedSourceIds.length === 0) {
      setError("当前项目还没有可供 AI 使用的资料。");
      return;
    }
    setSending(true);
    setError(null);
    setLastQuestion(normalized);
    setQuestion("");
    setOptimisticQuestion(normalized);
    let target = thread?.status === "active" ? thread : null;
    try {
      target = target ?? await createThread();
      if (!target) return;
      const result = await askProjectAssistant(
        projectId,
        target.id,
        normalized,
        crypto.randomUUID(),
        projectId && intentNeedsProjectEvidence(intent) ? selectedSourceIds : [],
        references,
      );
      await refreshThreads(result.thread.id);
    } catch (caught) {
      setError(assistantErrorMessage(caught));
      if (target) await loadThread(target.id).catch(() => undefined);
    } finally {
      setOptimisticQuestion(null);
      setSending(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void sendQuestion(question);
  };

  const chooseContext = (item: { id: string; label: string; sourceType?: "project" | "company" }) => {
    const reference: AssistantContextReference = picker === "project"
      ? { type: "project", projectId: item.id, label: item.label }
      : { type: "document", documentId: item.id, sourceType: item.sourceType ?? "project", label: item.label };
    const referenceKey = reference.type === "project" ? `p:${reference.projectId}` : `d:${reference.documentId}`;
    const nextReferences = (() => {
      const duplicate = contextReferences.some((value) => (value.type === "project" ? `p:${value.projectId}` : `d:${value.documentId}`) === referenceKey);
      return duplicate ? contextReferences : [...contextReferences, reference];
    })();
    setContextReferences(nextReferences);
    const action = picker === "project" ? pendingQuickAction : null;
    setPendingQuickAction(null);
    setPicker(null);
    setPickerSearch("");
    if (!action || reference.type !== "project") return;
    if (action === "requirement_overview") {
      void openRequirementOverview(reference.projectId);
      return;
    }
    const prompt = action === "project_summary"
      ? "请基于当前项目最新有效资料，总结项目现状，并区分已确认事实、风险和信息缺口。"
      : "请基于当前项目最新有效资料，列出仍需确认的事项，并为每项附上相关来源。";
    void sendQuestion(prompt, nextReferences);
  };

  const removeContext = (reference: AssistantContextReference) => {
    setContextReferences((current) => current.filter((item) => item !== reference));
  };

  const startQuickAction = (action: QuickAction) => {
    if (!artifactProjectId) {
      setPendingQuickAction(action);
      setPicker("project");
      setPickerSearch("");
      return;
    }
    if (action === "requirement_overview") {
      void openRequirementOverview(artifactProjectId);
      return;
    }
    void sendQuestion(
      action === "project_summary"
        ? "请基于当前项目最新有效资料，总结项目现状，并区分已确认事实、风险和信息缺口。"
        : "请基于当前项目最新有效资料，列出仍需确认的事项，并为每项附上相关来源。",
    );
  };

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void sendQuestion(question);
    }
  };

  const changeModel = async (generationModelId: string) => {
    if (!thread || changingModel) return;
    setChangingModel(true);
    try {
      await setGeneralAssistantThreadModel(thread.id, generationModelId === "default" ? null : generationModelId);
      await loadThread(thread.id);
    } catch (caught) { setError(assistantErrorMessage(caught)); }
    finally { setChangingModel(false); }
  };

  const openRequirementOverview = async (targetProjectId = artifactProjectId) => {
    if (!targetProjectId) {
      setError("生成需求概览需要先用 # 关联一个项目。");
      return;
    }
    const target = thread?.status === "active" ? thread : await createThread();
    if (target) {
      setRequirementOverviewProjectId(targetProjectId);
      setRequirementOverviewThreadId(target.id);
    }
  };

  const archive = async () => {
    if (!thread || thread.status !== "active") return;
    setError(null);
    try {
      await archiveProjectAssistantThread(projectId, thread.id);
      await refreshThreads();
    } catch (caught) {
      setError(assistantErrorMessage(caught));
    }
  };

  const removeThread = async () => {
    if (!thread || !window.confirm("确认删除这条私人对话？")) return;
    setError(null);
    try {
      await deleteProjectAssistantThread(projectId, thread.id);
      await refreshThreads();
    } catch (caught) {
      setError(assistantErrorMessage(caught));
    }
  };

  const openSource = async (citation: ProjectAssistantCitationDto) => {
    setDownloading(citation.versionId);
    setError(null);
    try {
      if (citation.sourceScope === "organization") {
        const response = await fetch(withBasePath(`/api/company-knowledge/${citation.documentId}/versions/${citation.versionId}/download`), { credentials: "include" });
        if (!response.ok) throw new Error("download failed");
        const url = URL.createObjectURL(await response.blob());
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = citation.displayName;
        anchor.click();
        URL.revokeObjectURL(url);
      } else {
        if (!projectId) throw new Error("project source unavailable");
        const source = citation.source;
        let locator: DocumentLocator = {};
        if (source.type === "pdf_page") locator = { pageNumber: source.pageNumber };
        else if (source.type === "pptx_slide") locator = { slideNumber: source.slideNumber };
        else if (source.type === "xlsx_range") locator = {
          sheetName: source.sheetName,
          cellRange: `R${source.rowStart}C${source.columnStart}:R${source.rowEnd}C${source.columnEnd}`,
        };
        else if (source.type === "text_lines") locator = { lineStart: source.lineStart, lineEnd: source.lineEnd };
        else if (source.type === "markdown_section") locator = { lineStart: source.lineStart, lineEnd: source.lineEnd, heading: source.headingPath.at(-1) };
        else if (source.type === "docx_section") locator = { heading: source.headingPath.at(-1) };
        window.open(
          documentViewerPath({
            projectId,
            documentId: citation.documentId,
            versionId: citation.versionId,
            locator,
          }),
          "_blank",
          "noopener,noreferrer",
        );
      }
    } catch (caught) {
      setError(documentErrorMessage(caught));
    } finally {
      setDownloading(null);
    }
  };

  const historyPanel = <div className="flex h-full min-h-0 flex-col">
    <div className="border-b p-3"><Button type="button" className="w-full" onClick={() => void createThread()} loading={creating}><MessageSquarePlus className="size-3.5" />新建对话</Button><label className="relative mt-3 block"><Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={threadSearch} onChange={(event) => setThreadSearch(event.target.value)} placeholder="搜索会话" className="pl-8" /></label></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-2">{visibleThreads.length === 0 ? <p className="px-3 py-8 text-center text-xs text-muted-foreground">{threads.length ? "没有匹配的会话" : "还没有对话"}</p> : visibleThreads.map((item) => <button key={item.id} type="button" onClick={() => void loadThread(item.id)} className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${thread?.id === item.id ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}><Bot className="size-3.5 shrink-0" /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{item.title}</span><span className="mt-0.5 block text-[10px]">{item.messageCount} 条消息{item.status === "archived" ? " · 已归档" : ""}</span></span><ChevronRight className="size-3 shrink-0" /></button>)}</div>
  </div>;

  if (phase === "disabled") {
    return (
      <section className="mt-5 rounded-xl border border-border bg-card p-6" data-testid="ai-assistant-disabled">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground">
            <Bot className="size-5" />
          </span>
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              项目 AI 助手尚未启用
            </h3>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              当前仍可使用下方项目知识搜索定位原始资料。启用后，回答会经过服务端证据检索和引用校验。
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (phase === "loading") {
    return (
      <section className="mt-5 grid min-h-72 place-items-center rounded-xl border border-border bg-card" role="status">
        <div className="text-center">
          <LoaderCircle className="mx-auto size-6 animate-spin text-primary" />
          <p className="mt-3 text-sm text-muted-foreground">正在加载私人对话</p>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-5 overflow-hidden rounded-xl border border-border bg-card" data-testid="project-ai-assistant" data-focused={focused ? "true" : "false"}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{projectId ? "项目 AI 助手" : "AI 助手"}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {projectId
              ? "助手会先理解你的问题，再按权限决定是否读取项目资料或公司资料，并在返回前校验引用。"
              : "可以直接聊天、写作、润色和分析；只有需要公司制度或项目事实时才会使用资料。"}
          </p>
        </div>
        <Sheet><SheetTrigger asChild><Button type="button" variant="outline" size="sm" className="lg:hidden"><PanelLeft className="size-3.5" />会话历史</Button></SheetTrigger><SheetContent side="left" className="w-[min(88vw,320px)] p-0"><SheetHeader className="sr-only"><SheetTitle>会话历史</SheetTitle><SheetDescription>搜索并打开私人会话</SheetDescription></SheetHeader>{historyPanel}</SheetContent></Sheet>
      </header>

      {error ? (
        <div className="m-4 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive-soft px-4 py-3 text-sm text-destructive" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span className="flex-1">{error}</span>
          {lastQuestion ? (
            <button type="button" className="inline-flex items-center gap-1 font-medium hover:underline" onClick={() => void sendQuestion(lastQuestion)} disabled={sending}>
              <RefreshCw className="size-3.5" />重试
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="border-b border-border bg-muted/20 px-5 py-3"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium">自动资料范围</span>{projectId ? <><Badge variant="outline">项目资料 {projectSourceCount} 份</Badge><Badge variant="outline">公司资料 {templateSourceCount} 份</Badge></> : <><Badge variant="outline">按当前权限自动检索</Badge><span className="text-[10px] text-muted-foreground">输入 # 可限定项目，输入 $ 可限定资料；这些引用不会扩大你的访问权限。</span></>}</div></div>

      <div className="grid min-h-[560px] lg:grid-cols-[280px_1fr]">
        <aside className="hidden border-r bg-muted/20 lg:block">{historyPanel}</aside>

        <div className="flex min-w-0 flex-col">
          {thread ? (
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-foreground">{thread.title}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {thread.status === "active" ? "进行中" : "已归档"} · {thread.messageCount} 条消息
                </p>
                {viewer?.user.productRole === "super_admin" && !projectId ? <label className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground"><span>本会话模型</span><select aria-label="本会话模型" value={thread.generationModelId ?? "default"} onChange={(event) => void changeModel(event.target.value)} disabled={changingModel} className="h-7 max-w-44 rounded border bg-background px-1 text-[10px]"><option value="default">默认场景模型</option>{models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select></label> : null}
              </div>
              <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label="会话操作"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{thread.status === "active" ? <DropdownMenuItem onSelect={() => void archive()}><Archive />归档会话</DropdownMenuItem> : null}{thread.status === "active" ? <DropdownMenuSeparator /> : null}<DropdownMenuItem variant="destructive" onSelect={() => void removeThread()}><Trash2 />删除会话</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
            </div>
          ) : null}

          <div ref={messageViewport} className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
            {!thread || thread.messages.length === 0 ? (
              <div className="grid min-h-72 place-items-center text-center" data-testid="ai-assistant-empty">
                <div>
                  <span className="mx-auto grid size-12 place-items-center rounded-xl bg-primary/8 text-primary">
                    <Sparkles className="size-5" />
                  </span>
                  <h4 className="mt-4 text-sm font-semibold text-foreground">
                    {projectId ? "从项目资料开始提问" : "开始通用对话"}
                  </h4>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                    {projectId ? "例如：总结当前项目现状，或根据资料生成需求文档。" : "例如：你能做什么？如何使用知识库？"}
                  </p>
                </div>
              </div>
            ) : (
              thread.messages.map((message) => (
                <article key={message.id} className={message.role === "user" ? "ml-auto max-w-2xl" : "max-w-3xl"} data-message-role={message.role}>
                  <div className={`rounded-xl px-4 py-3 text-sm leading-6 ${
                    message.role === "user"
                      ? "border border-primary/10 bg-accent text-foreground"
                      : message.status === "failed"
                        ? "border border-destructive/20 bg-destructive-soft text-destructive"
                        : message.status === "insufficient_evidence"
                          ? "border border-warning/20 bg-warning-soft text-foreground"
                        : "bg-card text-foreground"
                  }`}>
                    {message.status === "pending" ? (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" />正在检索证据并生成回答
                      </span>
                    ) : (
                      <AssistantMarkdown>{message.content}</AssistantMarkdown>
                    )}
                  </div>
                  {message.citations.length ? (
                    <div className="mt-2 space-y-2" data-testid="assistant-citations">
                      {message.citations.map((citation) => (
                        <div key={citation.index} className="rounded-lg border border-border bg-muted/25 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="flex min-w-0 items-start gap-2">
                              <span className="grid size-6 shrink-0 place-items-center rounded-md bg-primary/10 text-[10px] font-semibold text-primary">
                                {citation.index}
                              </span>
                              <div className="min-w-0">
                                <p className="truncate text-xs font-semibold text-foreground">
                                  {citation.displayName}
                                </p>
                                <p className="mt-0.5 text-[10px] text-muted-foreground">
                                  v{citation.versionNumber} · {sourceLabel(citation)}
                                </p>
                                <p className="mt-0.5 text-[9px] font-medium text-primary">
                                  {scopeLabels[citation.sourceScope]}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-1">
                            <AssistantCitationPreview citation={citation} projectId={projectId} onOpenSource={() => void openSource(citation)} />
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              loading={downloading === citation.versionId}
                              disabled={Boolean(downloading)}
                              onClick={() => void openSource(citation)}
                            >
                              <ExternalLink className="size-3.5" />打开来源
                            </Button>
                            </div>
                          </div>
                          {citation.headingPath.length ? (
                            <p className="mt-2 text-[10px] font-medium text-primary">
                              {citation.headingPath.join(" / ")}
                            </p>
                          ) : null}
                          <blockquote className="mt-2 border-l-2 border-primary/30 pl-3 text-xs leading-5 text-muted-foreground">
                            {citation.excerpt}
                          </blockquote>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {message.historyReferences.length ? <div className="mt-2 rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2 text-[11px] text-muted-foreground" data-testid="assistant-history-references"><span className="font-medium text-foreground">已引用历史对话：</span>{message.historyReferences.map((reference) => { const openHistory = () => { if (reference.openInCurrentConversation) { void loadThread(reference.threadId); return; } window.location.assign(withBasePath(`/assistant?project=${encodeURIComponent(reference.projectId)}&thread=${encodeURIComponent(reference.threadId)}`)); }; return <span key={reference.threadId} className="ml-1 inline-flex items-center gap-1"><button type="button" className="text-primary underline-offset-2 hover:underline" onClick={openHistory}>[历史会话] {reference.title} · {new Date(reference.updatedAt).toLocaleDateString("zh-CN")}</button><AssistantHistoryCitationPreview projectId={projectId} threadId={reference.threadId} onOpen={openHistory} /></span>; })}<span className="ml-1">（仅作上下文，不是项目事实）</span></div> : null}
                </article>
              ))
            )}
            {optimisticQuestion ? (
              <article className="ml-auto max-w-2xl" data-message-role="user" data-testid="optimistic-user-message">
                <div className="rounded-xl border border-primary/10 bg-accent px-4 py-3 text-sm leading-6 text-foreground">
                  <p className="whitespace-pre-wrap">{optimisticQuestion}</p>
                </div>
              </article>
            ) : null}
            {sending ? (
              <div className="max-w-3xl rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground" role="status">
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle className="size-4 animate-spin text-primary" />
                  {projectId ? "正在检索、生成并验证引用" : "正在思考"}
                </span>
              </div>
            ) : null}
          </div>

          {requirementOverviewProjectId && requirementOverviewThreadId === thread?.id ? <section className="border-t" data-testid="assistant-skill-artifact"><div className="border-b bg-muted/20 px-4 py-3 text-xs text-muted-foreground">需求概览只属于这条当前会话。切换或新建会话后不会悬挂在新消息流中。</div><RequirementOverviewWorkspace projectId={requirementOverviewProjectId} /></section> : null}

          <form onSubmit={submit} className="border-t border-border p-4">
            <section className="mb-4" aria-label="快捷操作">
              <p className="mb-2 text-xs font-medium text-foreground">快捷操作</p>
              <div className="flex flex-wrap gap-2">
                <Tooltip><TooltipTrigger asChild><Button type="button" size="sm" variant="outline" data-testid="quick-action-requirement-overview" onClick={() => startQuickAction("requirement_overview")} disabled={creating || sending || (projectId ? selectedSourceIds.length === 0 : false)}><FileText className="size-3.5" />生成需求概览</Button></TooltipTrigger><TooltipContent>执行固定模板的需求概览 Skill，不代表资料范围。</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild><Button type="button" size="sm" variant="outline" data-testid="quick-action-project-summary" onClick={() => startQuickAction("project_summary")} disabled={sending}><Sparkles className="size-3.5" />总结项目现状</Button></TooltipTrigger><TooltipContent>使用已授权项目资料执行预设任务。</TooltipContent></Tooltip>
                <Tooltip><TooltipTrigger asChild><Button type="button" size="sm" variant="outline" data-testid="quick-action-pending-items" onClick={() => startQuickAction("pending_items")} disabled={sending}><ListChecks className="size-3.5" />列出待确认事项</Button></TooltipTrigger><TooltipContent>使用已授权项目资料执行预设任务。</TooltipContent></Tooltip>
              </div>
            </section>
            <section className="mb-4 rounded-lg border border-dashed bg-muted/20 px-3 py-2.5" aria-label="本次引用" data-testid="assistant-context-references">
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium text-foreground">本次引用</p><span className="text-[10px] text-muted-foreground">已引用 {referencedProjectCount} 个项目、{referencedDocumentCount} 份资料</span></div>
              {contextReferences.length ? <div className="mt-2 flex flex-wrap gap-1.5">{contextReferences.map((reference) => <Badge key={reference.type === "project" ? `project-${reference.projectId}` : `document-${reference.documentId}`} variant="outline" className="h-7 gap-1.5 bg-background pr-1.5 text-xs"><span data-testid={reference.type === "project" ? "project-reference-token" : "document-reference-token"} className="inline-flex items-center gap-1">{reference.type === "project" ? <FolderKanban className="size-3" /> : <Paperclip className="size-3" />}{reference.type === "project" ? "#" : "$"}{reference.label}</span><button type="button" aria-label={`移除 ${reference.label}`} onClick={() => removeContext(reference)} className="rounded-sm px-1 text-muted-foreground hover:bg-muted hover:text-foreground">×</button></Badge>)}</div> : <p className="mt-1 text-xs leading-5 text-muted-foreground">未指定引用，AI 会根据你的权限自动查找相关资料。</p>}
            </section>
            <label className="block">
              <span className="sr-only">向 AI 助手提问</span>
              <textarea
                aria-label="向 AI 助手提问"
                data-testid="assistant-composer-input"
                value={question}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!projectId && (value.endsWith("#") || value.endsWith("$"))) {
                    setQuestion(value.slice(0, -1));
                    setPicker(value.endsWith("#") ? "project" : "document");
                    setPickerSearch("");
                  } else setQuestion(value);
                }}
                onKeyDown={onComposerKeyDown}
                placeholder={projectId ? "向 AI 助手提问；需要项目事实时会自动读取相关资料…" : "直接提问；输入 # 限定项目，输入 $ 限定资料…"}
                maxLength={2_000}
                rows={3}
                disabled={sending || thread?.status === "archived"}
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground" data-testid="assistant-composer-help">
                <ShieldCheck className="size-3 text-success" />
                <span>输入 # 引用项目，输入 $ 引用具体资料。Enter 发送，Shift+Enter 换行。</span>
                <span className="ml-1">使用资料时会由服务端校验引用权限。</span>
              </span>
              <Button type="submit" size="sm" loading={sending} disabled={thread?.status === "archived"} data-testid="assistant-send-button">
                <Send className="size-3.5" />发送
              </Button>
            </div>
          </form>
        </div>
      </div>

      <footer className="grid gap-2 border-t border-border bg-muted/20 px-5 py-3 text-[10px] text-muted-foreground sm:grid-cols-2">
        <p>AI 可直接完成通用聊天、写作、润色和方案讨论；涉及资料事实时才会检索。</p>
        <p className="sm:text-right">项目资料与公司资料会明确标注；资料不足时不会猜测。</p>
      </footer>
      <Dialog open={picker !== null} onOpenChange={(open) => { if (!open) { setPicker(null); setPendingQuickAction(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{picker === "project" ? "限定项目资料" : "限定一份资料"}</DialogTitle><DialogDescription>只显示你已经有权访问的内容；选择后会缩小本次提问的资料范围。</DialogDescription></DialogHeader>
          <Input value={pickerSearch} onChange={(event) => setPickerSearch(event.target.value)} placeholder="搜索名称" autoFocus />
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {visibleContextOptions.map((item) => <Button key={item.id} type="button" variant="ghost" className="w-full justify-start" onClick={() => chooseContext(item)}>{item.label}</Button>)}
            {!visibleContextOptions.length ? <p className="py-6 text-center text-sm text-muted-foreground">没有匹配的可用资料</p> : null}
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
