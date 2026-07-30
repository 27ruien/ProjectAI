"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  Bot,
  ChevronRight,
  Download,
  LoaderCircle,
  MessageSquarePlus,
  RefreshCw,
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

type PanelPhase =
  | "loading"
  | "ready"
  | "disabled"
  | "error";

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
      AI_PROVIDER_UNAVAILABLE: "AI 服务暂时不可用，请稍后重试。",
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
  const [sourceMode, setSourceMode] = useState<"project" | "organization" | "both">("both");
  const selectedSourceIds = useMemo(
    () => availableSources.filter((item) => sourceMode === "both" || item.sourceScope === sourceMode).map((item) => item.id),
    [availableSources, sourceMode],
  );

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
      setError(sourceMode === "organization" ? "当前没有已发布且可访问的公司资料。" : "当前没有可用于回答的有效资料。");
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
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">AI 对话</h3>
            <span className="rounded-full border border-primary/20 bg-primary/5 px-2 py-0.5 text-[10px] font-medium text-primary">
              Qwen · Grounded
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            每次提问都会重新检索当前有效资料，并在返回前校验引用。
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => void createThread()} loading={creating}>
          <MessageSquarePlus className="size-3.5" />新建对话
        </Button>
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

      <div className="border-b border-border bg-muted/10 px-5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-foreground">本次回答的知识来源</p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">公司资料仅包含已发布、未失效且当前用户可见的版本。</p>
          </div>
          <div className="flex rounded-lg border bg-background p-0.5">{([
            ["project", "项目资料"],
            ["organization", "公司资料"],
            ["both", "两者"],
          ] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setSourceMode(value)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${sourceMode === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div>
        </div>
        <div className="mt-2 flex max-h-28 flex-wrap gap-2 overflow-y-auto">
          {availableSources.filter((item) => sourceMode === "both" || item.sourceScope === sourceMode).map((document) => <span key={document.id} className="inline-flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-2.5 py-1.5 text-[11px] text-primary"><span className="max-w-48 truncate">{document.displayName}</span><span className="rounded bg-background px-1.5 py-0.5 text-[9px]">{document.sourceScope === "organization" ? "公司资料" : "项目资料"}</span></span>)}
          {selectedSourceIds.length === 0 ? <p className="text-[11px] text-warning">该范围暂无有效资料。</p> : null}
        </div>
      </div>

      <div className="grid min-h-[560px] lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-border bg-muted/20 lg:border-b-0 lg:border-r">
          <div className="border-b border-border px-4 py-3 text-[11px] font-medium text-muted-foreground">
            我的对话 · 默认仅自己可见
          </div>
          <div className="max-h-[500px] overflow-y-auto p-2">
            {threads.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                还没有对话
              </p>
            ) : (
              threads.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void loadThread(item.id)}
                  className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left transition-colors ${
                    thread?.id === item.id
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:bg-card/70 hover:text-foreground"
                  }`}
                >
                  <Bot className="size-3.5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{item.title}</span>
                    <span className="mt-0.5 block text-[10px]">
                      {item.messageCount} 条消息{item.status === "archived" ? " · 已归档" : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-3 shrink-0" />
                </button>
              ))
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          {thread ? (
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-foreground">{thread.title}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  {thread.status === "active" ? "进行中" : "已归档"} · {thread.messageCount} 条消息
                </p>
              </div>
              <div className="flex items-center gap-3">{thread.status === "active" ? <button type="button" onClick={() => void archive()} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"><Archive className="size-3.5" />归档</button> : null}<button type="button" onClick={() => void removeThread()} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive"><Trash2 className="size-3.5" />删除</button></div>
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
                    从项目和公司资料开始提问
                  </h4>
                  <p className="mt-1 max-w-sm text-sm leading-6 text-muted-foreground">
                    例如：当前需求是否符合公司的项目管理规范？
                  </p>
                </div>
              </div>
            ) : (
              thread.messages.map((message) => (
                <article key={message.id} className={message.role === "user" ? "ml-auto max-w-2xl" : "max-w-3xl"} data-message-role={message.role}>
                  <div className={`rounded-xl px-4 py-3 text-sm leading-6 ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : message.status === "failed"
                        ? "border border-destructive/20 bg-destructive-soft text-destructive"
                        : message.status === "insufficient_evidence"
                          ? "border border-warning/20 bg-warning-soft text-foreground"
                          : "border border-border bg-background text-foreground"
                  }`}>
                    {message.status === "pending" ? (
                      <span className="inline-flex items-center gap-2 text-muted-foreground">
                        <LoaderCircle className="size-4 animate-spin" />正在检索证据并生成回答
                      </span>
                    ) : (
                      <p className="whitespace-pre-wrap">{message.content}</p>
                    )}
                  </div>
                  {message.role === "assistant" && message.fallbackUsed ? (
                    <p className="mt-1.5 text-[10px] text-warning">
                      主模型暂时不可用，本次回答由备用模型完成。
                    </p>
                  ) : null}
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

          <form onSubmit={submit} className="border-t border-border p-4">
            <label className="block">
              <span className="sr-only">向项目 AI 助手提问</span>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="向当前项目和公司资料提问…"
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
        <p>AI 回答仅基于选定范围内的有效资料生成，请结合引用核对。</p>
        <p className="sm:text-right">项目与公司来源会明确标注；证据不足时不会猜测。</p>
      </footer>
    </section>
  );
}
