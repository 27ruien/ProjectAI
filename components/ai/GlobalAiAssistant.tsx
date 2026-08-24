"use client";

import { type FormEvent, useMemo, useState } from "react";
import { Bot, ChevronRight, Clock3, LoaderCircle, Send, Sparkles, X } from "lucide-react";
import type { AuthorizedProjectSummary, ViewerContext } from "@/lib/auth/ui-types";
import { withBasePath } from "@/lib/base-path";
import { KnowledgeAnswerView, type KnowledgeAnswerPayload } from "@/components/knowledge/KnowledgeAnswerView";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";

type SessionMessage = {
  id: string;
  contextLabel: string;
  question: string;
  result: KnowledgeAnswerPayload;
};

const suggestions = [
  "总结这个项目的关键信息",
  "目前有哪些事项需要关注？",
  "查找过去的重要决策",
];

async function responseMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function GlobalAiAssistant({
  viewer,
  currentProject,
}: {
  viewer: ViewerContext;
  currentProject?: AuthorizedProjectSummary;
}) {
  const defaultContext = currentProject?.id ?? "all";
  const [open, setOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [context, setContext] = useState(defaultContext);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<SessionMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authorizedProjects = useMemo(() => viewer.projects, [viewer.projects]);
  const selectedProject = authorizedProjects.find((project) => project.id === context);
  const contextLabel = selectedProject?.name ?? "我的全部项目";

  const ask = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (trimmedQuestion.length < 2 || loading) return;
    setLoading(true);
    setError(null);
    try {
      const crossProject = context === "all";
      const response = await fetch(withBasePath(crossProject
        ? "/api/projects/knowledge/ask"
        : `/api/projects/${context}/knowledge/ask`), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(crossProject
          ? { question: trimmedQuestion, projectIds: authorizedProjects.map((project) => project.id) }
          : { question: trimmedQuestion }),
      });
      if (!response.ok) throw new Error(await responseMessage(response, "Project AI 查询失败"));
      const result = (await response.json()) as KnowledgeAnswerPayload;
      setMessages((current) => [...current, {
        id: `${Date.now()}-${current.length}`,
        contextLabel,
        question: trimmedQuestion,
        result,
      }]);
      setQuestion("");
      setHistoryOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Project AI 查询失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="lg"
        onClick={() => setOpen(true)}
        className="fixed bottom-7 right-7 z-40 h-10 gap-2 rounded-lg px-3.5 shadow-[var(--shadow-float)]"
        aria-label="打开 Project AI"
        data-testid="global-ai-launcher"
      >
        <Sparkles className="size-4" />
        <span>问 AI</span>
      </Button>

      <Sheet open={open} onOpenChange={setOpen} modal={false}>
        <SheetContent
          side="right"
          showCloseButton={false}
          showOverlay={false}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="w-[min(440px,100vw)]! gap-0 border-l bg-background p-0 shadow-[0_0_24px_rgba(24,24,27,0.09)] sm:max-w-[440px]!"
          data-testid="ai-drawer"
        >
          <div className="flex h-12 shrink-0 items-center border-b px-4">
            <Sparkles className="mr-2 size-4 text-primary" aria-hidden="true" />
            <SheetTitle className="flex-1 text-sm font-semibold">Project AI</SheetTitle>
            <SheetDescription className="sr-only">使用你有权访问的项目知识提问。</SheetDescription>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="查看本次会话"
              title="本次会话"
              onClick={() => setHistoryOpen((value) => !value)}
            >
              <Clock3 />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭 Project AI" onClick={() => setOpen(false)}>
              <X />
            </Button>
          </div>

          <div className="shrink-0 border-b bg-muted/25 px-4 py-3">
            <label className="flex items-center justify-between gap-3 text-xs font-medium text-muted-foreground">
              <span>回答范围</span>
              <Select value={context} onValueChange={setContext}>
                <SelectTrigger className="h-8 min-w-0 max-w-[260px] border-0 bg-transparent px-2 text-foreground shadow-none" aria-label="AI 回答范围">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="all">我的全部项目</SelectItem>
                  {authorizedProjects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5" aria-live="polite">
            {historyOpen ? (
              <section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-base font-semibold">本次会话</h2>
                  <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(false)}>返回对话</Button>
                </div>
                {messages.length ? (
                  <div className="divide-y border-y">
                    {[...messages].reverse().map((message) => (
                      <button key={message.id} type="button" className="block w-full py-3 text-left" onClick={() => setHistoryOpen(false)}>
                        <span className="line-clamp-1 text-sm font-medium">{message.question}</span>
                        <span className="mt-1 block text-xs text-muted-foreground">{message.contextLabel}</span>
                      </button>
                    ))}
                  </div>
                ) : <p className="py-12 text-center text-sm text-muted-foreground">本次会话还没有问题。</p>}
              </section>
            ) : messages.length ? (
              <div className="space-y-7">
                {messages.map((message) => (
                  <article key={message.id} className="space-y-4">
                    <div className="ml-8 rounded-lg bg-muted px-3 py-2.5 text-sm leading-6">
                      <p>{message.question}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{message.contextLabel}</p>
                    </div>
                    <div className="flex gap-2.5">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border bg-background text-primary"><Bot className="size-3.5" /></span>
                      <div className="min-w-0 flex-1"><KnowledgeAnswerView result={message.result} compact /></div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className="mx-auto w-full max-w-sm pt-10 pb-8 text-left">
                <span className="grid size-9 place-items-center rounded-lg border bg-muted/30 text-primary"><Sparkles className="size-4" /></span>
                <h2 className="mt-4 text-base font-semibold">想了解什么？</h2>
                <p className="mt-1.5 text-sm leading-6 text-muted-foreground">回答范围限定在「{contextLabel}」，并显示引用来源。</p>
                <div className="mt-6 border-t">
                  <p className="py-2.5 text-xs font-medium text-muted-foreground">你可以试试</p>
                  {suggestions.map((suggestion) => (
                    <button key={suggestion} type="button" onClick={() => setQuestion(suggestion)} className="flex w-full items-center justify-between gap-3 border-t py-2.5 text-left text-sm text-foreground transition-colors hover:text-primary">
                      <span>{suggestion}</span><ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="shrink-0 border-t bg-background p-4">
            {error ? <Alert variant="destructive" className="mb-3"><AlertDescription>{error}</AlertDescription></Alert> : null}
            <form onSubmit={ask} className="relative">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
                rows={2}
                minLength={2}
                maxLength={2000}
                required
                placeholder="询问项目知识…"
                aria-label="向 Project AI 提问"
                className="max-h-32 min-h-16 resize-none pr-12"
              />
              <Button type="submit" size="icon" className="absolute bottom-2 right-2" disabled={loading || question.trim().length < 2} aria-label="发送问题">
                {loading ? <LoaderCircle className="animate-spin" /> : <Send />}
              </Button>
            </form>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">Project AI 仅依据已解析的项目资料回答，并显示来源。</p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
