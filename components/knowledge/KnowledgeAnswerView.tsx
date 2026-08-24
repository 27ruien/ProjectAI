"use client";

import { useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, FileText } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

export type KnowledgeAnswerPayload = {
  status: "answered" | "insufficient_evidence";
  answer: string | null;
  citations: Array<{
    label: string;
    projectId: string;
    projectName: string;
    documentName: string;
    excerpt: string;
    similarity: number | null;
  }>;
  unavailableProjects: Array<{ id: string; name: string }>;
  metrics: {
    projectCount: number;
    datasetCount: number;
    retrievedChunkCount: number;
    contextChars: number;
    inputTokens: number | null;
    outputTokens: number | null;
    tokenUsageEstimated: boolean;
    latencyMs: number;
  };
};

function MarkdownAnswer({ answer, compact }: { answer: string; compact: boolean }) {
  const lines = answer.split(/\r?\n/u);
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trimEnd() ?? "";
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (heading) {
      const level = heading[1]?.length ?? 3;
      const className = level === 1
        ? "text-lg font-semibold leading-7"
        : "text-base font-semibold leading-6";
      blocks.push(<h3 key={`heading-${index}`} className={className}>{heading[2]}</h3>);
      index += 1;
      continue;
    }

    const unordered = line.match(/^[-*]\s+(.+)$/u);
    const ordered = line.match(/^\d+[.)]\s+(.+)$/u);
    if (unordered || ordered) {
      const items: string[] = [];
      const isOrdered = Boolean(ordered);
      while (index < lines.length) {
        const candidate = lines[index]?.trim() ?? "";
        const match = candidate.match(isOrdered ? /^\d+[.)]\s+(.+)$/u : /^[-*]\s+(.+)$/u);
        if (!match) break;
        items.push(match[1] ?? "");
        index += 1;
      }
      const children = items.map((item, itemIndex) => <li key={`${index}-${itemIndex}`}>{item}</li>);
      blocks.push(isOrdered
        ? <ol key={`list-${index}`} className="ml-5 list-decimal space-y-1.5 pl-1 marker:text-muted-foreground">{children}</ol>
        : <ul key={`list-${index}`} className="ml-5 list-disc space-y-1.5 pl-1 marker:text-muted-foreground">{children}</ul>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index]?.trimEnd() ?? "";
      if (!candidate.trim() || /^(#{1,3})\s+|^[-*]\s+|^\d+[.)]\s+/u.test(candidate)) break;
      paragraph.push(candidate);
      index += 1;
    }
    blocks.push(<p key={`paragraph-${index}`} className="whitespace-pre-wrap">{paragraph.join("\n")}</p>);
  }

  return <div className={cn("space-y-3 text-sm leading-7 text-foreground", !compact && "max-w-3xl")}>{blocks}</div>;
}

export function KnowledgeAnswerView({ result, compact = false }: { result: KnowledgeAnswerPayload; compact?: boolean }) {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [expandedSource, setExpandedSource] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (result.status === "insufficient_evidence") {
    return (
      <Alert className="bg-muted/30">
        <AlertTitle>当前项目知识中没有找到足够信息</AlertTitle>
        <AlertDescription>可以换一种问法，或先上传并等待相关文件解析完成。</AlertDescription>
      </Alert>
    );
  }
  const copyAnswer = async () => {
    if (!result.answer) return;
    await navigator.clipboard.writeText(result.answer);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };
  return (
    <div className="space-y-4" data-testid="knowledge-answer">
      <section>
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-xs font-semibold text-muted-foreground">回答</h3>
          <button type="button" onClick={() => void copyAnswer()} className="inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="复制回答">
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copied ? "已复制" : "复制"}
          </button>
        </div>
        <MarkdownAnswer answer={result.answer ?? ""} compact={compact} />
      </section>
      {result.citations.length ? <section className="border-t pt-3">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-2 text-left text-xs font-semibold text-foreground"
          aria-expanded={sourcesOpen}
          onClick={() => setSourcesOpen((value) => !value)}
        >
          <span>引用来源 <span className="font-normal text-muted-foreground">· {result.citations.length}</span></span>
          <ChevronDown className={cn("size-3.5 transition-transform", sourcesOpen && "rotate-180")} />
        </button>
        {sourcesOpen ? <div className="mt-3 space-y-2" data-testid="ai-sources">
          {result.citations.map((citation, citationIndex) => {
            const expanded = expandedSource === citation.label;
            return <article key={citation.label} className="rounded-lg border bg-muted/20 p-3">
              <button
                type="button"
                className="flex w-full items-start gap-2 text-left"
                aria-expanded={expanded}
                onClick={() => setExpandedSource(expanded ? null : citation.label)}
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{citation.documentName}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{citation.projectName}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">来源 {citationIndex + 1}</span>
              </button>
              <p className={cn("mt-2 pl-6 text-xs leading-5 text-muted-foreground", !expanded && "line-clamp-2")}>{citation.excerpt}</p>
              <button type="button" className="mt-1.5 pl-6 text-xs text-primary hover:underline" onClick={() => setExpandedSource(expanded ? null : citation.label)}>{expanded ? "收起片段" : "展开片段"}</button>
            </article>;
          })}
        </div> : null}
      </section> : null}
      {result.unavailableProjects.length ? (
        <Alert>
          <AlertTitle>部分项目知识暂时不可用</AlertTitle>
          <AlertDescription>{result.unavailableProjects.map((item) => item.name).join("、")}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
