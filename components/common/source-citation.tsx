"use client";

import { useState } from "react";
import { FileText, Link2, ShieldCheck } from "lucide-react";
import { Badge } from "./badge";
import { Button } from "./button";
import { Drawer } from "./drawer";

export type CitationLike = {
  id?: string;
  sourceId?: string;
  documentId?: string;
  documentName?: string;
  sourceName?: string;
  section?: string;
  pageNumber?: number;
  sourceDate?: string;
  status?: string;
  isEffectiveVersion?: boolean;
  citationText?: string;
  text?: string;
  trustLevel?: string;
};

export function SourceCitation({ citation, compact = false }: { citation: CitationLike; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const title = citation.documentName ?? citation.sourceName ?? "项目资料";
  const quote = citation.citationText ?? citation.text ?? "当前引用片段暂无预览。";
  return <><article className="rounded-lg border bg-surface p-3"><div className="flex items-start gap-2.5"><span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-card text-primary"><FileText className="size-3.5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><p className="truncate text-xs font-semibold text-foreground">{title}</p>{citation.isEffectiveVersion ? <Badge tone="success">当前有效</Badge> : <Badge>历史来源</Badge>}</div><p className="mt-0.5 text-[11px] text-muted-foreground">{[citation.section, citation.pageNumber ? `第 ${citation.pageNumber} 页` : undefined, citation.sourceDate].filter(Boolean).join(" · ")}</p>{!compact ? <blockquote className="mt-2 border-l-2 border-primary/25 pl-2.5 text-xs leading-5 text-muted-foreground">“{quote}”</blockquote> : null}<div className="mt-2 flex items-center justify-between"><span className="inline-flex items-center gap-1 text-[10px] text-success"><ShieldCheck className="size-3" />{citation.trustLevel === "high" ? "高可信" : "已验证来源"}</span><Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" aria-label="展开来源引用" onClick={() => setOpen(true)}><Link2 className="size-3" />跳转来源</Button></div></div></div></article><Drawer open={open} onClose={() => setOpen(false)} title="来源详情" description="核对文件版本、定位信息与原文片段。" width="max-w-lg"><div className="space-y-5"><section className="rounded-xl border bg-surface p-4"><div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-lg bg-card text-primary"><FileText className="size-5" /></span><div className="min-w-0"><h3 className="break-words text-sm font-semibold text-foreground">{title}</h3><p className="mt-1 text-xs text-muted-foreground">{[citation.section, citation.pageNumber ? `第 ${citation.pageNumber} 页` : undefined, citation.sourceDate].filter(Boolean).join(" · ") || "暂无定位信息"}</p><div className="mt-2">{citation.isEffectiveVersion ? <Badge tone="success">当前有效版本</Badge> : <Badge>历史来源</Badge>}</div></div></div></section><section><h3 className="text-xs font-semibold text-foreground">引用片段</h3><blockquote className="mt-2 rounded-xl border-l-4 border-primary/30 bg-primary/[0.035] p-4 text-sm leading-6 text-foreground">“{quote}”</blockquote></section><p className="text-xs leading-5 text-muted-foreground">当前为 Mock 来源预览。正式版本应在权限校验后打开对应文档位置，并保留访问审计。</p></div></Drawer></>;
}
