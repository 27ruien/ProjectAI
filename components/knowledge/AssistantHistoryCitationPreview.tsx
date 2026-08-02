"use client";

import { useCallback, useState } from "react";
import { ExternalLink, History, LoaderCircle } from "lucide-react";
import { Button } from "@/components/common/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { withBasePath } from "@/lib/base-path";

type HistoryPreview = { title: string; updatedAt: string; excerpt: string };

export function AssistantHistoryCitationPreview({ projectId, threadId, onOpen }: { projectId: string | null; threadId: string; onOpen: () => void }) {
  const [preview, setPreview] = useState<HistoryPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const load = useCallback(async () => {
    if (preview || loading || unavailable) return;
    setLoading(true);
    try {
      const path = projectId
        ? `/api/projects/${encodeURIComponent(projectId)}/ai/history/${encodeURIComponent(threadId)}/preview`
        : `/api/ai/history/${encodeURIComponent(threadId)}/preview`;
      const response = await fetch(withBasePath(path), { credentials: "include", cache: "no-store" });
      const body = await response.json() as { history?: HistoryPreview };
      if (!response.ok || !body.history) throw new Error("history unavailable");
      setPreview(body.history);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [loading, preview, projectId, threadId, unavailable]);
  const content = <div className="space-y-2" data-testid="assistant-history-preview-content">{loading ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3 animate-spin" />正在核验历史会话权限…</p> : unavailable ? <p className="text-xs text-muted-foreground">该历史会话已不可访问。</p> : preview ? <><div><p className="text-xs font-semibold">{preview.title}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{new Date(preview.updatedAt).toLocaleDateString("zh-CN")} · 历史对话</p></div><div className="rounded border bg-muted/30 p-3"><p className="mb-1 text-[11px] font-medium text-foreground">相关消息摘录</p><blockquote className="border-l-2 border-primary/30 pl-3 text-xs leading-5 text-muted-foreground">{preview.excerpt}</blockquote></div><Button type="button" size="sm" variant="outline" onClick={onOpen}><ExternalLink className="size-3.5" />打开会话</Button></> : <p className="text-xs text-muted-foreground">将鼠标停留在历史会话上即可查看摘录。</p>}</div>;
  return <><HoverCard openDelay={180} onOpenChange={(open) => { if (open) void load(); }}><HoverCardTrigger asChild><button type="button" className="hidden items-center gap-1 text-primary underline-offset-2 hover:underline sm:inline-flex" data-testid="assistant-history-hover-trigger"><History className="size-3" />历史会话</button></HoverCardTrigger><HoverCardContent>{content}</HoverCardContent></HoverCard><Sheet onOpenChange={(open) => { if (open) void load(); }}><SheetTrigger asChild><button type="button" className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline sm:hidden" data-testid="assistant-history-sheet-trigger"><History className="size-3" />历史会话</button></SheetTrigger><SheetContent side="bottom"><SheetHeader><SheetTitle>历史会话引用</SheetTitle><SheetDescription>打开前会重新核验当前会话和资料权限。</SheetDescription></SheetHeader><div className="px-4 pb-5">{content}</div></SheetContent></Sheet></>;
}
