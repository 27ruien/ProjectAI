"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Archive,
  Bot,
  ChevronRight,
  Download,
  FileText,
  ListChecks,
  LoaderCircle,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeft,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/common/button";
import { withBasePath } from "@/lib/base-path";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import {
  archiveProjectAssistantThread,
  askProjectAssistant,
  createProjectAssistantThread,
  deleteProjectAssistantThread,
  getProjectAssistantThread,
  listProjectAssistantThreads,
  ProjectAssistantApiError,
} from "@/lib/ai/project-assistant/client";
import { documentErrorMessage, downloadProjectDocumentVersion } from "@/lib/documents/client";
import type { ProjectDocumentDto } from "@/types/documents";
import type {
  ProjectAssistantCitationDto,
  ProjectAssistantThreadDto,
  ProjectAssistantThreadSummaryDto,
} from "@/types/project-assistant";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

type PanelPhase =
  | "loading"
  | "ready"
  | "disabled"
  | "error";

type GeneratedArtifact = {
  id: string;
  versionNumber: number;
  status: "generating" | "draft" | "published" | "failed";
  failureCode: string | null;
  projectSourceCount: number;
  companySourceCount: number;
};

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
      AI_RATE_LIMITED: "提问过于频繁，请稍后重试。",
      AI_USER_DAILY_LIMIT_REACHED: "今日个人 AI 用量已达上限。",
      AI_PROJECT_DAILY_LIMIT_REACHED: "今日项目 AI 用量已达上限。",
      AI_CONCURRENCY_LIMIT_REACHED: "AI 服务繁忙，请稍后重试。",
      AI_PROVIDER_TIMEOUT: "AI 服务响应超时，请重试。",
      AI_PROVIDER_UNAVAILABLE: "AI 服务当前不可用。项目资料和常规模板未发生变化，请联系管理员检查模型访问权限。",
      AI_CITATION_VALIDATION_FAILED: "回答未通过来源校验，请重试。",
      AI_THREAD_NOT_FOUND: "对话不存在或无权访问。",
    };
    return messages[error.code] || error.message;
  }
  return "项目 AI 助手暂时不可用，请稍后重试。";
}

const scopeLabels: Record<string, string> = {
  organization: "[常规模板]",
  department: "[项目资料]",
  project: "[项目资料]",
  restricted: "[项目资料]",
};

export function ProjectAssistantPanel({
  project,
  focused = false,
}: {
  project: AuthorizedProjectSummary;
  focused?: boolean;
}) {
  const loadController = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<PanelPhase>("loading");
  const [threads, setThreads] = useState<ProjectAssistantThreadSummaryDto[]>([]);
  const [thread, setThread] = useState<ProjectAssistantThreadDto | null>(null);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastQuestion, setLastQuestion] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [availableSources, setAvailableSources] = useState<Array<ProjectDocumentDto & { sourceScope: "project" | "organization" }>>([]);
  const [threadSearch, setThreadSearch] = useState("");
  const [artifact, setArtifact] = useState<GeneratedArtifact | null>(null);
  const [artifactBusy, setArtifactBusy] = useState(false);
  const [artifactError, setArtifactError] = useState<string | null>(null);
  const selectedSourceIds = useMemo(() => availableSources.map((item) => item.id), [availableSources]);
  const projectSourceCount = useMemo(() => availableSources.filter((item) => item.sourceScope === "project").length, [availableSources]);
  const templateSourceCount = availableSources.length - projectSourceCount;
  const visibleThreads = useMemo(() => { const query = threadSearch.trim().toLocaleLowerCase("zh-CN"); return query ? threads.filter((item) => item.title.toLocaleLowerCase("zh-CN").includes(query)) : threads; }, [threadSearch, threads]);

  const loadThread = useCallback(
    async (threadId: string, signal?: AbortSignal) => {
      const response = await getProjectAssistantThread(
        project.id,
        threadId,
        signal,
      );
      setThread(response.thread);
      return response.thread;
    },
    [project.id],
  );

  const refreshThreads = useCallback(
    async (preferredThreadId?: string, signal?: AbortSignal) => {
      const response = await listProjectAssistantThreads(project.id, signal);
      setThreads(response.threads);
      const selected =
        preferredThreadId ||
        response.threads.find((item) => item.status === "active")?.id ||
        response.threads[0]?.id;
      if (selected) await loadThread(selected, signal);
      else setThread(null);
    },
    [loadThread, project.id],
  );

  useEffect(() => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    const timer = window.setTimeout(() => {
      void refreshThreads(undefined, controller.signal)
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
  }, [project.id, refreshThreads]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(withBasePath(`/api/projects/${project.id}/ai/sources`), { credentials: "include", cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("source list failed");
        return response.json() as Promise<{ documents: Array<ProjectDocumentDto & { sourceScope: "project" | "organization" }> }>;
      })
      .then((response) => {
        setAvailableSources(response.documents);
      })
      .catch((caught: unknown) => {
        if (!(caught instanceof DOMException && caught.name === "AbortError")) {
          setError("知识来源列表暂时不可用，请刷新重试。");
        }
      });
    return () => controller.abort();
  }, [project.id]);

  const loadLatestArtifact = useCallback(async (preferredId?: string) => {
    const response = await fetch(withBasePath(`/api/projects/${project.id}/requirement-documents`), {
      credentials: "include",
      cache: "no-store",
    });
    const body = await response.json() as { documents?: GeneratedArtifact[]; error?: { message?: string } };
    if (!response.ok) throw new Error(body.error?.message ?? "AI 生成文档加载失败");
    const next = body.documents?.find((item) => item.id === preferredId) ?? body.documents?.[0] ?? null;
    setArtifact(next);
    return next;
  }, [project.id]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadLatestArtifact().catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadLatestArtifact]);

  const createThread = async () => {
    setCreating(true);
    setError(null);
    try {
      const response = await createProjectAssistantThread(project.id);
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

  const sendQuestion = async (nextQuestion: string) => {
    const normalized = nextQuestion.trim();
    if (normalized.length < 2) {
      setError("请输入至少 2 个字符的问题。");
      return;
    }
    if (selectedSourceIds.length === 0) {
      setError("当前选择的范围内没有可用于回答的有效资料。");
      return;
    }
    setSending(true);
    setError(null);
    setLastQuestion(normalized);
    try {
      const target =
        thread?.status === "active" ? thread : await createThread();
      if (!target) return;
      const result = await askProjectAssistant(
        project.id,
        target.id,
        normalized,
        crypto.randomUUID(),
        selectedSourceIds,
      );
      setQuestion("");
      await refreshThreads(result.thread.id);
    } catch (caught) {
      setError(assistantErrorMessage(caught));
      if (thread) await loadThread(thread.id).catch(() => undefined);
    } finally {
      setSending(false);
    }
  };

  const generateRequirementDocument = async () => {
    if (artifactBusy) return;
    setArtifactBusy(true);
    setArtifactError(null);
    try {
      const response = await fetch(withBasePath(`/api/projects/${project.id}/requirement-documents`), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = await response.json() as { document?: GeneratedArtifact; error?: { message?: string } };
      if (!response.ok || !body.document) throw new Error(body.error?.message ?? "需求文档生成任务创建失败");
      setArtifact(body.document);
      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        const current = await loadLatestArtifact(body.document.id);
        if (!current || current.status !== "generating") break;
      }
    } catch (caught) {
      setArtifactError(caught instanceof Error ? caught.message : "需求文档生成未完成");
      await loadLatestArtifact().catch(() => undefined);
    } finally {
      setArtifactBusy(false);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void sendQuestion(question);
  };

  const archive = async () => {
    if (!thread || thread.status !== "active") return;
    setError(null);
    try {
      await archiveProjectAssistantThread(project.id, thread.id);
      await refreshThreads();
    } catch (caught) {
      setError(assistantErrorMessage(caught));
    }
  };

  const removeThread = async () => {
    if (!thread || !window.confirm("确认删除这条私人对话？")) return;
    setError(null);
    try {
      await deleteProjectAssistantThread(project.id, thread.id);
      await refreshThreads();
    } catch (caught) {
      setError(assistantErrorMessage(caught));
    }
  };

  const download = async (citation: ProjectAssistantCitationDto) => {
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
        await downloadProjectDocumentVersion(project.id, citation.documentId, citation.versionId, citation.displayName);
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
          <h3 className="text-sm font-semibold text-foreground">项目会话</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            每次提问都会自动检索当前项目资料和相关常规模板，并在返回前校验引用权限。
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

      <div className="border-b border-border bg-muted/20 px-5 py-3"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium">自动使用</span><Badge variant="outline">项目资料 {projectSourceCount} 份</Badge><Badge variant="outline">常规模板 {templateSourceCount} 份</Badge><span className="text-[10px] text-muted-foreground">仅包含当前用户有权访问的最新有效版本</span>{selectedSourceIds.length === 0 ? <span className="text-[11px] text-warning">当前项目暂无可用于 AI 的资料</span> : null}</div></div>

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
              </div>
              <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label="会话操作"><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">{thread.status === "active" ? <DropdownMenuItem onSelect={() => void archive()}><Archive />归档会话</DropdownMenuItem> : null}{thread.status === "active" ? <DropdownMenuSeparator /> : null}<DropdownMenuItem variant="destructive" onSelect={() => void removeThread()}><Trash2 />删除会话</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
            </div>
          ) : null}

          <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
            {!thread || thread.messages.length === 0 ? (
              <div className="grid min-h-72 place-items-center text-center" data-testid="ai-assistant-empty">
                <div>
                  <span className="mx-auto grid size-12 place-items-center rounded-xl bg-primary/8 text-primary">
                    <Sparkles className="size-5" />
                  </span>
                  <h4 className="mt-4 text-sm font-semibold text-foreground">
                    从项目资料开始提问
                  </h4>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                    例如：总结当前项目现状，或根据资料生成需求文档。
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
                      <p className="whitespace-pre-wrap">{message.content}</p>
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
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              loading={downloading === citation.versionId}
                              disabled={Boolean(downloading)}
                              onClick={() => void download(citation)}
                            >
                              <Download className="size-3.5" />原文件
                            </Button>
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
                </article>
              ))
            )}
            {sending ? (
              <div className="max-w-3xl rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground" role="status">
                <span className="inline-flex items-center gap-2">
                  <LoaderCircle className="size-4 animate-spin text-primary" />
                  正在检索、生成并验证引用
                </span>
              </div>
            ) : null}
          </div>

          {artifact || artifactError || artifactBusy ? <GeneratedArtifactCard projectId={project.id} artifact={artifact} busy={artifactBusy} error={artifactError} /> : null}

          <form onSubmit={submit} className="border-t border-border p-4">
            <div className="mb-3 flex flex-wrap gap-2" aria-label="会话快捷操作">
              <Button type="button" size="sm" variant="outline" loading={artifactBusy} onClick={() => void generateRequirementDocument()} disabled={selectedSourceIds.length === 0}><FileText className="size-3.5" />生成需求文档</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void sendQuestion("请基于当前项目最新有效资料，总结项目现状，并区分已确认事实、风险和信息缺口。") } disabled={sending || selectedSourceIds.length === 0}><Sparkles className="size-3.5" />总结项目现状</Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void sendQuestion("请基于当前项目最新有效资料，列出仍需确认的事项，并为每项附上相关来源。") } disabled={sending || selectedSourceIds.length === 0}><ListChecks className="size-3.5" />列出待确认事项</Button>
            </div>
            <label className="block">
              <span className="sr-only">向项目 AI 助手提问</span>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="向当前项目提问，系统会自动补充相关常规模板…"
                maxLength={2_000}
                rows={3}
                disabled={sending || thread?.status === "archived"}
                className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
              />
            </label>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <ShieldCheck className="size-3 text-success" />回答返回前会由服务端校验引用
              </span>
              <Button type="submit" size="sm" loading={sending} disabled={thread?.status === "archived"}>
                <Send className="size-3.5" />发送
              </Button>
            </div>
          </form>
        </div>
      </div>

      <footer className="grid gap-2 border-t border-border bg-muted/20 px-5 py-3 text-[10px] text-muted-foreground sm:grid-cols-2">
        <p>AI 回答仅基于当前用户有权访问的有效资料生成，请结合引用核对。</p>
        <p className="sm:text-right">项目资料与常规模板会明确标注；证据不足时不会猜测。</p>
      </footer>
    </section>
  );
}

function GeneratedArtifactCard({ projectId, artifact, busy, error }: { projectId: string; artifact: GeneratedArtifact | null; busy: boolean; error: string | null }) {
  const repositoryHref = `/knowledge/projects/${projectId}/artifacts`;
  if (error && !artifact) {
    return <div className="border-t border-border bg-destructive-soft px-4 py-3 text-sm text-destructive" role="alert"><span className="inline-flex items-start gap-2"><AlertCircle className="mt-0.5 size-4 shrink-0" />{error}</span></div>;
  }
  if (!artifact) return null;
  const downloadBase = withBasePath(`/api/projects/${projectId}/requirement-documents/${artifact.id}/export`);
  const providerFailure = artifact.failureCode === "REQUIREMENT_PROVIDER_FAILED";
  return <section className="border-t border-border bg-muted/15 px-4 py-4" data-testid="conversation-requirement-artifact">
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-primary"><FileText className="size-4" /></span><div><div className="flex flex-wrap items-center gap-2"><h4 className="text-sm font-semibold">项目需求文档 v{artifact.versionNumber}</h4><Badge variant="outline">{{ generating: "生成中", draft: "AI 草稿", published: "已发布", failed: "生成失败" }[artifact.status]}</Badge></div><p className="mt-1 text-xs text-muted-foreground">项目资料 {artifact.projectSourceCount} 份 · 常规模板 {artifact.companySourceCount} 份</p></div></div>
        {artifact.status === "generating" || busy ? <span className="inline-flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />正在生成并校验引用</span> : null}
      </div>
      {artifact.status === "failed" ? <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive-soft px-3 py-2 text-xs leading-5 text-destructive">{providerFailure ? "AI 服务暂时不可用。项目资料已保留，请联系管理员检查模型访问权限后再试。" : error ?? "本次文档生成未完成，请检查项目资料状态后重试。"}</div> : null}
      {artifact.status === "draft" || artifact.status === "published" ? <div className="mt-4 flex flex-wrap items-center gap-2"><Link href={repositoryHref} className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary-hover">预览与编辑</Link><Link href={repositoryHref} className="inline-flex h-8 items-center rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted">保存到项目</Link><a href={`${downloadBase}?format=md`} className="inline-flex h-8 items-center rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted">下载 Markdown</a><a href={`${downloadBase}?format=docx`} className="inline-flex h-8 items-center rounded-lg border bg-background px-3 text-xs font-medium hover:bg-muted">下载 DOCX</a><span className="text-[10px] text-muted-foreground">已进入项目的“AI 生成文档”</span></div> : null}
      {artifact.status === "failed" ? <div className="mt-3"><Link href={repositoryHref} className="text-xs font-medium text-primary hover:underline">查看失败记录</Link></div> : null}
    </div>
  </section>;
}
