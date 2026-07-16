"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Download,
  FileSearch,
  FileText,
  Filter,
  LoaderCircle,
  MapPin,
  RefreshCw,
  Search,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/common/button";
import { ProjectContextHeader } from "@/components/project/ProjectContextHeader";
import type {
  AuthorizedProjectSummary,
  ProjectMockPayload,
} from "@/lib/auth/ui-types";
import {
  documentErrorMessage,
  downloadProjectDocumentVersion,
  listProjectDocuments,
} from "@/lib/documents/client";
import {
  KnowledgeSearchApiError,
  searchProjectKnowledge,
} from "@/lib/knowledge/client";
import type { ProjectDocumentDto } from "@/types/documents";
import type {
  KnowledgeSearchResponse,
  KnowledgeSearchResultDto,
} from "@/types/knowledge-search";

interface ProjectKnowledgePageProps {
  project: AuthorizedProjectSummary;
  data: ProjectMockPayload;
}

type SearchPhase = "idle" | "loading" | "ready" | "error";

function sourceLabel(result: KnowledgeSearchResultDto): string {
  const source = result.source;
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

function searchErrorMessage(error: unknown): string {
  if (error instanceof KnowledgeSearchApiError) {
    if (error.code === "INVALID_SEARCH_REQUEST") {
      return "请输入 2–200 个字符的搜索词。";
    }
    if (error.code === "UNAUTHENTICATED") return "登录已失效，请重新登录。";
    if (error.code === "DOCUMENT_NOT_FOUND") {
      return "筛选的资料不存在或不属于当前项目。";
    }
    return error.message;
  }
  return "项目知识搜索暂时不可用，请稍后重试。";
}

export function ProjectKnowledgePage({
  project,
  data,
}: ProjectKnowledgePageProps) {
  const request = useRef<AbortController | null>(null);
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [response, setResponse] = useState<KnowledgeSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [documents, setDocuments] = useState<ProjectDocumentDto[]>([]);
  const [documentId, setDocumentId] = useState("");
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void listProjectDocuments(project.id, "active", controller.signal)
      .then((result) => setDocuments(result.documents))
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setDocumentsError(documentErrorMessage(caught));
      });
    return () => controller.abort();
  }, [project.id]);

  useEffect(() => () => request.current?.abort(), []);

  const indexedDocuments = useMemo(
    () =>
      documents.filter(
        (document) =>
          document.currentVersion?.ingestion.status === "succeeded",
      ),
    [documents],
  );

  const runSearch = async (nextQuery: string) => {
    const normalized = nextQuery.trim();
    if (normalized.length < 2) {
      setError("请输入至少 2 个字符。");
      setPhase("error");
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setSubmittedQuery(normalized);
    setPhase("loading");
    setError(null);
    try {
      const result = await searchProjectKnowledge(
        project.id,
        {
          query: normalized,
          documentIds: documentId ? [documentId] : [],
          limit: 20,
        },
        controller.signal,
      );
      setResponse(result);
      setPhase("ready");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(searchErrorMessage(caught));
      setPhase("error");
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(query);
  };

  const download = async (result: KnowledgeSearchResultDto) => {
    setDownloading(result.versionId);
    setError(null);
    try {
      await downloadProjectDocumentVersion(
        project.id,
        result.documentId,
        result.versionId,
        result.displayName,
      );
    } catch (caught) {
      setError(documentErrorMessage(caught));
    } finally {
      setDownloading(null);
    }
  };

  const mockRecordCount = [
    data.requirements,
    data.scopes,
    data.actions,
    data.risks,
  ].reduce(
    (total, collection) => total + (Array.isArray(collection) ? collection.length : 0),
    0,
  );

  return (
    <div className="min-h-full bg-background">
      <ProjectContextHeader project={project} activeTab="knowledge" />
      <main className="px-5 py-5 lg:px-8 lg:py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">
                项目知识搜索
              </h2>
              <span className="rounded-full border border-success/20 bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">
                真实全文索引
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              搜索当前项目的有效资料，定位原始片段、页面、章节、Sheet 或 Slide。
            </p>
          </div>
          <div className="rounded-lg border border-border bg-card px-3 py-2 text-right">
            <p className="text-[10px] text-muted-foreground">已建立索引</p>
            <p className="mt-0.5 text-sm font-semibold text-foreground">
              {indexedDocuments.length} / {documents.length} 份
            </p>
          </div>
        </div>

        <aside className="mt-4 flex items-start gap-2 rounded-xl border border-info/20 bg-info-soft px-4 py-3 text-sm text-info">
          <BookOpen className="mt-0.5 size-4 shrink-0" />
          <p>
            当前提供资料搜索与来源定位，尚未启用 AI 综合回答。结果是原始资料片段，不代表 AI 结论。
          </p>
        </aside>

        <section className="mt-5 rounded-xl border border-border bg-card p-5">
          <form onSubmit={submit} className="space-y-3">
            <div className="flex flex-col gap-3 lg:flex-row">
              <label className="relative flex-1">
                <span className="sr-only">搜索项目知识</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="例如：launch date、预算、客户确认"
                  maxLength={200}
                  className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-4 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
              </label>
              <label className="relative min-w-64">
                <span className="sr-only">按资料筛选</span>
                <Filter className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <select
                  value={documentId}
                  onChange={(event) => setDocumentId(event.target.value)}
                  className="h-11 w-full appearance-none rounded-lg border border-input bg-background pl-10 pr-8 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                >
                  <option value="">全部当前有效资料</option>
                  {documents.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <Button type="submit" className="h-11 px-5" loading={phase === "loading"}>
                <FileSearch className="size-4" />搜索
              </Button>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
              <span>支持中文短语、英文全文和基础拼写模糊匹配</span>
              <span>仅检索 Active + Current + Stored + Succeeded 索引</span>
            </div>
          </form>
          {documentsError ? (
            <p className="mt-3 text-xs text-warning">{documentsError}</p>
          ) : null}
        </section>

        {error ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive-soft px-4 py-3 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{error}</span>
            {submittedQuery ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 font-medium hover:underline"
                onClick={() => void runSearch(submittedQuery)}
              >
                <RefreshCw className="size-3.5" />重试
              </button>
            ) : null}
          </div>
        ) : null}

        {phase === "idle" ? (
          <section className="mt-5 grid min-h-72 place-items-center rounded-xl border border-dashed border-border bg-card px-6 text-center">
            <div>
              <span className="mx-auto grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
                <Search className="size-5" />
              </span>
              <h3 className="mt-4 text-sm font-semibold text-foreground">
                搜索项目资料中的原始内容
              </h3>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                命中结果会显示文件名、当前版本、片段和精确来源位置。
              </p>
            </div>
          </section>
        ) : null}

        {phase === "loading" ? (
          <section className="mt-5 space-y-3 rounded-xl border border-border bg-card p-5" role="status">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <LoaderCircle className="size-4 animate-spin text-primary" />
              正在检索当前项目知识索引
            </div>
            {[0, 1, 2].map((item) => (
              <div key={item} className="skeleton h-28 rounded-lg" />
            ))}
          </section>
        ) : null}

        {phase === "ready" && response?.results.length === 0 ? (
          <section className="mt-5 grid min-h-64 place-items-center rounded-xl border border-border bg-card px-6 text-center">
            <div>
              <FileSearch className="mx-auto size-8 text-muted-foreground" />
              <h3 className="mt-3 text-sm font-semibold text-foreground">
                没有找到匹配片段
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                请调整关键词，或检查当前版本是否已建立索引。
              </p>
            </div>
          </section>
        ) : null}

        {phase === "ready" && response?.results.length ? (
          <section className="mt-5 overflow-hidden rounded-xl border border-border bg-card">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  搜索结果
                </h3>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  “{response.query}”命中 {response.resultCount} 个片段
                </p>
              </div>
              <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <ShieldCheck className="size-3.5 text-success" />按项目权限与当前版本过滤
              </span>
            </header>
            <div className="divide-y divide-border">
              {response.results.map((result) => (
                <article key={result.chunkId} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                        <FileText className="size-4" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="max-w-xl truncate text-sm font-semibold text-foreground">
                            {result.displayName}
                          </h4>
                          <span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-medium text-success">
                            当前版本 v{result.versionNumber}
                          </span>
                        </div>
                        <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <MapPin className="size-3.5" />
                          {sourceLabel(result)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        相关度 {Math.round(result.score * 100)}%
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        loading={downloading === result.versionId}
                        disabled={Boolean(downloading)}
                        onClick={() => void download(result)}
                      >
                        <Download className="size-3.5" />下载原文件
                      </Button>
                    </div>
                  </div>
                  {result.headingPath.length ? (
                    <p className="mt-3 text-[11px] font-medium text-primary">
                      {result.headingPath.join(" / ")}
                    </p>
                  ) : null}
                  <blockquote className="mt-3 rounded-lg border-l-2 border-primary/40 bg-muted/35 px-4 py-3 text-sm leading-6 text-foreground">
                    {result.excerpt}
                  </blockquote>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <section className="mt-5 rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <h3 className="text-xs font-semibold text-foreground">
                其他项目管理模块仍为 Mock
              </h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                当前项目的需求、Scope、Action 和风险共 {mockRecordCount} 条演示记录不参与本页真实资料搜索；AI 问答将在 B3 经独立审查后接入。
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

export default ProjectKnowledgePage;
