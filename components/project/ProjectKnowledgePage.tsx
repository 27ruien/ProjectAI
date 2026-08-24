"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, LoaderCircle, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import { withBasePath } from "@/lib/base-path";
import { ProjectContextHeader } from "./ProjectContextHeader";
import { ProjectEditDialog } from "./ProjectEditDialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type DocumentRow = {
  id: string;
  name: string;
  parseStatus: "uploading" | "processing" | "ready" | "failed";
  failureCode: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  uploadedBy: { id: string; displayName: string };
  createdAt: string;
  updatedAt: string;
};

const statusLabel = {
  uploading: "上传中",
  processing: "解析中",
  ready: "可查询",
  failed: "失败",
} as const;

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

function sizeLabel(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ProjectKnowledgePage({ project }: { project: AuthorizedProjectSummary }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(project.knowledgeStatus === "ready");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");

  const loadDocuments = useCallback(async () => {
    if (project.knowledgeStatus !== "ready") return;
    try {
      const response = await fetch(withBasePath(`/api/projects/${project.id}/knowledge/documents`), {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) throw new Error(await responseError(response, "文件列表加载失败"));
      const body = (await response.json()) as { documents: DocumentRow[] };
      setDocuments(body.documents);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文件列表加载失败");
    } finally {
      setLoadingFiles(false);
    }
  }, [project.id, project.knowledgeStatus]);

  useEffect(() => {
    const timer = setTimeout(() => void loadDocuments(), 0);
    return () => clearTimeout(timer);
  }, [loadDocuments]);

  useEffect(() => {
    if (!documents.some((item) => item.parseStatus === "processing" || item.parseStatus === "uploading")) return;
    const timer = setInterval(() => void loadDocuments(), 5_000);
    return () => clearInterval(timer);
  }, [documents, loadDocuments]);

  const provision = async () => {
    setBusy("provision");
    setError(null);
    try {
      const response = await fetch(withBasePath(`/api/projects/${project.id}/knowledge/provision`), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error(await responseError(response, "知识空间创建失败"));
      location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "知识空间创建失败");
    } finally {
      setBusy(null);
    }
  };

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setBusy("upload");
    setError(null);
    try {
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      const response = await fetch(withBasePath(`/api/projects/${project.id}/knowledge/documents`), {
        method: "POST",
        credentials: "include",
        body: form,
      });
      if (!response.ok) throw new Error(await responseError(response, "文件上传失败"));
      const body = (await response.json()) as { documents: DocumentRow[] };
      setDocuments(body.documents);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文件上传失败");
      await loadDocuments();
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const remove = async (documentId: string) => {
    setBusy(documentId);
    setError(null);
    try {
      const response = await fetch(withBasePath(`/api/projects/${project.id}/knowledge/documents/${documentId}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!response.ok) throw new Error(await responseError(response, "文件删除失败"));
      setDocuments((current) => current.filter((item) => item.id !== documentId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "文件删除失败");
    } finally {
      setBusy(null);
    }
  };

  const retry = async (documentId: string) => {
    setBusy(documentId);
    setError(null);
    try {
      const response = await fetch(withBasePath(`/api/projects/${project.id}/knowledge/documents/${documentId}/retry`), {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      if (!response.ok) throw new Error(await responseError(response, "重试失败"));
      await loadDocuments();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "重试失败");
    } finally {
      setBusy(null);
    }
  };

  const filteredDocuments = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase("zh-CN");
    return documents.filter((document) =>
      (!keyword || document.name.toLocaleLowerCase("zh-CN").includes(keyword)) &&
      (status === "all" || document.parseStatus === status),
    );
  }, [documents, query, status]);

  return (
    <div className="min-h-full">
      <ProjectContextHeader project={project} activeTab="knowledge" actions={project.permissions.canEditProject ? <ProjectEditDialog project={project} /> : undefined} />
      <div className="mx-auto max-w-[1280px] space-y-6 px-4 py-7 sm:px-6 lg:px-10">
        {project.knowledgeStatus !== "ready" ? (
          <Alert variant={project.knowledgeStatus === "failed" ? "destructive" : "default"}>
            <AlertTitle>{project.knowledgeStatus === "failed" ? "项目知识空间创建失败" : "项目知识空间正在创建"}</AlertTitle>
            <AlertDescription className="mt-2">
              {project.knowledgeStatus === "failed" && project.permissions.canManageProject ? (
                <Button size="sm" onClick={() => void provision()} disabled={busy === "provision"}>
                  {busy === "provision" ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}重试创建
                </Button>
              ) : "完成后即可上传和查询项目资料。"}
            </AlertDescription>
          </Alert>
        ) : (
          <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground"><span className="font-medium text-foreground">{documents.length}</span> 个文件 · 支持 PDF、DOCX、XLSX、PPTX、TXT 和 Markdown</p>
                {project.permissions.canUploadDocuments ? <><input ref={fileInput} type="file" multiple className="hidden" accept=".pdf,.docx,.xlsx,.csv,.pptx,.txt,.md,.markdown" onChange={(event) => void upload(Array.from(event.currentTarget.files ?? []))} /><Button onClick={() => fileInput.current?.click()} disabled={busy === "upload"}>{busy === "upload" ? <LoaderCircle className="animate-spin" /> : <Upload />}{busy === "upload" ? "正在上传" : "上传文件"}</Button></> : null}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-between">
                <label className="relative w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索文件" aria-label="搜索文件" className="pl-9" /></label>
                <Select value={status} onValueChange={setStatus}><SelectTrigger className="w-full sm:w-40" aria-label="按解析状态筛选"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem><SelectItem value="uploading">上传中</SelectItem><SelectItem value="processing">解析中</SelectItem><SelectItem value="ready">可查询</SelectItem><SelectItem value="failed">失败</SelectItem></SelectContent></Select>
              </div>
              {loadingFiles ? <div className="border-y p-8 text-center text-sm text-muted-foreground">正在加载文件…</div> : documents.length ? (
                <div className="overflow-hidden border-y"><div className="overflow-x-auto"><Table className="min-w-[760px]"><TableHeader className="bg-muted/25"><TableRow><TableHead>文件名</TableHead><TableHead>状态</TableHead><TableHead>上传人</TableHead><TableHead>更新时间</TableHead><TableHead>大小</TableHead><TableHead className="w-24">操作</TableHead></TableRow></TableHeader><TableBody>{filteredDocuments.map((document) => <TableRow key={document.id} className="h-[52px]"><TableCell><span className="flex items-center gap-2 font-medium"><FileText className="size-4 text-muted-foreground" />{document.name}</span></TableCell><TableCell><Badge variant="outline" className={document.parseStatus === "ready" ? "border-success/20 bg-success-soft text-success" : document.parseStatus === "failed" ? "border-destructive/20 bg-destructive-soft text-destructive" : document.parseStatus === "processing" ? "border-info/20 bg-info-soft text-info" : "text-muted-foreground"}>{statusLabel[document.parseStatus]}</Badge></TableCell><TableCell>{document.uploadedBy.displayName}</TableCell><TableCell className="text-muted-foreground">{new Date(document.updatedAt).toLocaleString("zh-CN")}</TableCell><TableCell className="text-muted-foreground">{sizeLabel(document.sizeBytes)}</TableCell><TableCell><div className="flex gap-1">{document.parseStatus === "failed" && project.permissions.canUploadDocuments ? <Button size="icon-sm" variant="ghost" aria-label="重试解析" onClick={() => void retry(document.id)} disabled={busy === document.id}><RefreshCw /></Button> : null}{project.permissions.canManageDocuments ? <Button size="icon-sm" variant="ghost" aria-label="删除文件" onClick={() => void remove(document.id)} disabled={busy === document.id}><Trash2 /></Button> : null}</div></TableCell></TableRow>)}{!filteredDocuments.length ? <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">没有匹配的文件</TableCell></TableRow> : null}</TableBody></Table></div></div>
              ) : <div className="border-y p-10 text-center text-sm text-muted-foreground">还没有项目文件。</div>}
          </section>
        )}
        {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      </div>
    </div>
  );
}
