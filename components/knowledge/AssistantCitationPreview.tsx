"use client";

/* eslint-disable @next/next/no-img-element */

import { useCallback, useState } from "react";
import { ExternalLink, FileSearch, LoaderCircle } from "lucide-react";
import { Button } from "@/components/common/button";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { withBasePath } from "@/lib/base-path";
import type { ProjectAssistantCitationDto } from "@/types/project-assistant";

type CitationPreview = {
  citationId: string;
  sourceId: string;
  displayName: string;
  versionNumber: number;
  mimeType: string;
  sourceScope: string;
  sourceType: "project_document" | "company_document" | "conversation";
  documentVersionId: string | null;
  chunkId: string | null;
  pageNumber: number | null;
  slideNumber: number | null;
  sheetName: string | null;
  cellRange: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  locator: string;
  headingPath: string[];
  excerpt: string;
  thumbnailUrl: string | null;
};

export function AssistantCitationPreview({ citation, projectId, onOpenSource }: { citation: ProjectAssistantCitationDto; projectId: string | null; onOpenSource: () => void }) {
  const [preview, setPreview] = useState<CitationPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const load = useCallback(async () => {
    if (preview || loading || unavailable) return;
    setLoading(true);
    try {
      const path = projectId
        ? `/api/projects/${encodeURIComponent(projectId)}/ai/citations/${encodeURIComponent(citation.id)}/preview`
        : `/api/ai/citations/${encodeURIComponent(citation.id)}/preview`;
      const response = await fetch(withBasePath(path), { credentials: "include", cache: "no-store" });
      if (!response.ok) throw new Error("citation unavailable");
      const body = await response.json() as { citation?: CitationPreview };
      if (!body.citation) throw new Error("citation unavailable");
      setPreview(body.citation);
    } catch {
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [citation.id, loading, preview, projectId, unavailable]);
  const sourceLabel = preview?.sourceType === "company_document" ? "公司资料" : preview?.sourceType === "conversation" ? "历史会话" : "项目资料";
  const content = <div className="space-y-2" data-testid="assistant-citation-preview-content">{loading ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3 animate-spin" />正在核验引用权限…</p> : unavailable ? <p className="text-xs text-muted-foreground">该引用已不可访问或资料版本已变化。</p> : preview ? <><div><p className="text-xs font-semibold">{preview.displayName}</p><p className="mt-0.5 text-[11px] text-muted-foreground">v{preview.versionNumber} · {sourceLabel} · {preview.locator}</p></div>{preview.headingPath.length ? <p className="text-[11px] font-medium text-primary">{preview.headingPath.join(" / ")}</p> : null}{preview.thumbnailUrl ? <><span className="sr-only">已缓存来源缩略图</span>{/* The server only returns a short-lived, re-authorized cached preview URL. */}<img src={preview.thumbnailUrl} alt={`${preview.displayName} 来源缩略图`} className="max-h-40 w-full rounded border object-cover" /></> : null}<div className="rounded border bg-muted/30 p-3"><p className="mb-1 text-[11px] font-medium text-foreground">内容快照</p><blockquote className="border-l-2 border-primary/30 pl-3 text-xs leading-5 text-muted-foreground">{preview.excerpt}</blockquote></div><Button type="button" size="sm" variant="outline" onClick={onOpenSource}><ExternalLink className="size-3.5" />打开来源</Button></> : <p className="text-xs text-muted-foreground">将鼠标停留在引用上即可核验来源。</p>}</div>;
  return <><HoverCard openDelay={180} onOpenChange={(open) => { if (open) void load(); }}><HoverCardTrigger asChild><button type="button" className="hidden items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 sm:inline-flex" data-testid="assistant-citation-hover-trigger"><FileSearch className="size-3" />预览引用</button></HoverCardTrigger><HoverCardContent>{content}</HoverCardContent></HoverCard><Sheet onOpenChange={(open) => { if (open) void load(); }}><SheetTrigger asChild><button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/10 sm:hidden" data-testid="assistant-citation-sheet-trigger"><FileSearch className="size-3" />预览引用</button></SheetTrigger><SheetContent side="bottom"><SheetHeader><SheetTitle>引用预览</SheetTitle><SheetDescription>每次打开都会重新校验当前资料权限。</SheetDescription></SheetHeader><div className="px-4 pb-5">{content}</div></SheetContent></Sheet></>;
}
