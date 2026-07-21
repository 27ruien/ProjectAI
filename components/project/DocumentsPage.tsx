"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Download,
  FileCheck2,
  FileText,
  FolderArchive,
  History,
  Inbox,
  Info,
  RefreshCw,
  Search,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/common/button";
import { useToast } from "@/components/common/toast";
import {
  archiveProjectDocument,
  documentErrorMessage,
  downloadProjectDocumentVersion,
  listProjectDocuments,
  reindexProjectDocumentVersion,
  restoreProjectDocument,
  setProjectDocumentVisibility,
} from "@/lib/documents/client";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import type {
  DocumentListCountsDto,
  DocumentListPermissionsDto,
  DocumentUploadPolicyDto,
  ProjectDocumentDto,
  ProjectDocumentUploadResponse,
  ProjectDocumentVersionDto,
} from "@/types/documents";
import { DocumentUploadDrawer, type DocumentUploadTarget } from "./DocumentUploadDrawer";
import { DocumentVersionDrawer } from "./DocumentVersionDrawer";
import { ProjectContextHeader } from "./ProjectContextHeader";

interface DocumentsPageProps {
  project: AuthorizedProjectSummary;
}

type DocumentView = "active" | "archived";
type LoadPhase = "loading" | "ready" | "error";
type ConfirmAction = {
  document: ProjectDocumentDto;
  kind: "archive" | "restore";
} | null;

const defaultPolicy: DocumentUploadPolicyDto = {
  maxBytes: 50 * 1024 * 1024,
  allowedExtensions: ["pdf", "docx", "xlsx", "pptx", "txt", "md"],
};

const emptyCounts: DocumentListCountsDto = { active: 0, archived: 0 };

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function statusPresentation(document: ProjectDocumentDto) {
  if (document.status === "archived") {
    return {
      label: "已归档",
      classes: "border-warning/20 bg-warning-soft text-warning",
    };
  }
  if (document.status === "failed") {
    return {
      label: "上传失败",
      classes: "border-destructive/20 bg-destructive-soft text-destructive",
    };
  }
  if (document.status === "pending") {
    return {
      label: "处理中",
      classes: "border-info/20 bg-info-soft text-info",
    };
  }
  const storageStatus = document.currentVersion?.storageStatus;
  return (
    {
      pending: {
        label: "处理中",
        classes: "border-info/20 bg-info-soft text-info",
      },
      stored: {
        label: "已存储",
        classes: "border-success/20 bg-success-soft text-success",
      },
      failed: {
        label: "上传失败",
        classes: "border-destructive/20 bg-destructive-soft text-destructive",
      },
      quarantined: {
        label: "已隔离",
        classes: "border-warning/20 bg-warning-soft text-warning",
      },
      deleted: {
        label: "不可用",
        classes: "border-border bg-muted text-muted-foreground",
      },
    }[storageStatus ?? "pending"]
  );
}

function ingestionPresentation(version: ProjectDocumentVersionDto | null) {
  if (!version || version.storageStatus !== "stored") {
    return {
      label: "尚未开始",
      detail: "文件尚未完成存储",
      classes: "border-border bg-muted text-muted-foreground",
    };
  }
  return {
    not_started: {
      label: "尚未开始",
      detail: "等待创建解析任务",
      classes: "border-border bg-muted text-muted-foreground",
    },
    pending: {
      label: "等待解析",
      detail: "解析任务已进入队列",
      classes: "border-info/20 bg-info-soft text-info",
    },
    running: {
      label: "正在解析",
      detail: "正在提取结构并建立索引",
      classes: "border-info/20 bg-info-soft text-info",
    },
    succeeded: {
      label: "知识索引已建立",
      detail: `${version.ingestion.sectionCount} Section · ${version.ingestion.chunkCount} Chunk`,
      classes: "border-success/20 bg-success-soft text-success",
    },
    failed: {
      label: "解析失败",
      detail: version.ingestion.failureCode ?? "可由项目经理重新解析",
      classes: "border-destructive/20 bg-destructive-soft text-destructive",
    },
    needs_ocr: {
      label: "该 PDF 需要 OCR",
      detail: "原文件仍可下载，本阶段不执行 OCR",
      classes: "border-warning/20 bg-warning-soft text-warning",
    },
  }[version.ingestion.status];
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function DocumentsPage({ project }: DocumentsPageProps) {
  const { toast } = useToast();
  const requestSequence = useRef(0);
  const [view, setView] = useState<DocumentView>("active");
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [documents, setDocuments] = useState<ProjectDocumentDto[]>([]);
  const [counts, setCounts] = useState<DocumentListCountsDto>(emptyCounts);
  const [policy, setPolicy] = useState<DocumentUploadPolicyDto>(defaultPolicy);
  const [listPermissions, setListPermissions] = useState<DocumentListPermissionsDto | null>(null);
  const [search, setSearch] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<DocumentUploadTarget>(null);
  const [versionDocument, setVersionDocument] = useState<ProjectDocumentDto | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  const loadDocuments = useCallback(
    async (options: { signal?: AbortSignal; background?: boolean } = {}) => {
      const sequence = ++requestSequence.current;
      if (options.background) setRefreshing(true);
      else setPhase("loading");
      setListError(null);
      try {
        const response = await listProjectDocuments(
          project.id,
          view,
          options.signal,
        );
        if (sequence !== requestSequence.current) return;
        setDocuments(response.documents);
        setCounts(response.counts);
        setPolicy(response.uploadPolicy);
        setListPermissions(response.permissions);
        setPhase("ready");
      } catch (caught) {
        if (isAbortError(caught) || sequence !== requestSequence.current) return;
        const message = documentErrorMessage(caught);
        if (options.background) setActionError(message);
        else {
          setListError(message);
          setPhase("error");
        }
      } finally {
        if (sequence === requestSequence.current) setRefreshing(false);
      }
    },
    [project.id, view],
  );

  useEffect(() => {
    const sequence = ++requestSequence.current;
    const controller = new AbortController();
    void listProjectDocuments(project.id, view, controller.signal)
      .then((response) => {
        if (sequence !== requestSequence.current) return;
        setDocuments(response.documents);
        setCounts(response.counts);
        setPolicy(response.uploadPolicy);
        setListPermissions(response.permissions);
        setListError(null);
        setPhase("ready");
      })
      .catch((caught: unknown) => {
        if (isAbortError(caught) || sequence !== requestSequence.current) return;
        setListError(documentErrorMessage(caught));
        setPhase("error");
      });
    return () => controller.abort();
  }, [project.id, view]);

  useEffect(() => {
    if (
      phase !== "ready" ||
      !documents.some((document) =>
        ["pending", "running"].includes(
          document.currentVersion?.ingestion.status ?? "",
        ),
      )
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      void loadDocuments({ background: true });
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [documents, loadDocuments, phase]);

  const changeView = (nextView: DocumentView) => {
    if (nextView === view) return;
    setPhase("loading");
    setListError(null);
    setSearch("");
    setView(nextView);
  };

  const filteredDocuments = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("zh-CN");
    if (!keyword) return documents;
    return documents.filter((document) => {
      const version = document.currentVersion;
      return [document.displayName, version?.originalFilename, version?.extension]
        .filter(Boolean)
        .some((value) => value?.toLocaleLowerCase("zh-CN").includes(keyword));
    });
  }, [documents, search]);

  const canUpload = Boolean(
    listPermissions?.canUpload && project.permissions.canUploadDocuments,
  );

  const openNewDocumentUpload = () => {
    setUploadTarget(null);
    setUploadOpen(true);
  };

  const openVersionUpload = (document: ProjectDocumentDto) => {
    setVersionDocument(null);
    setUploadTarget({ documentId: document.id, displayName: document.displayName });
    setUploadOpen(true);
  };

  const uploaded = async (response: ProjectDocumentUploadResponse) => {
    toast(
      response.replayed
        ? "上传请求已安全重放，没有创建重复版本"
        : response.uploadStatus === "stored"
          ? "文件已真实存储"
          : "上传请求已接收，正在保存文件",
      "success",
    );
    if (view !== "active") setView("active");
    else await loadDocuments({ background: true });
  };

  const download = async (
    document: ProjectDocumentDto,
    version: ProjectDocumentVersionDto,
  ) => {
    const actionKey = `download:${version.id}`;
    setPendingAction(actionKey);
    setActionError(null);
    try {
      await downloadProjectDocumentVersion(
        project.id,
        document.id,
        version.id,
        version.originalFilename,
      );
      toast(`已准备下载“${document.displayName}”`, "success");
    } catch (caught) {
      setActionError(documentErrorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  const confirmLifecycleAction = async () => {
    if (!confirmAction) return;
    const { document, kind } = confirmAction;
    const actionKey = `${kind}:${document.id}`;
    setConfirmAction(null);
    setPendingAction(actionKey);
    setActionError(null);
    try {
      if (kind === "archive") {
        await archiveProjectDocument(project.id, document.id);
        toast(`“${document.displayName}”已归档`, "success");
      } else {
        await restoreProjectDocument(project.id, document.id);
        toast(`“${document.displayName}”已恢复`, "success");
      }
      await loadDocuments({ background: true });
    } catch (caught) {
      setActionError(documentErrorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  const reindex = async (
    document: ProjectDocumentDto,
    version: ProjectDocumentVersionDto,
  ) => {
    const actionKey = `reindex:${version.id}`;
    setPendingAction(actionKey);
    setActionError(null);
    try {
      await reindexProjectDocumentVersion(
        project.id,
        document.id,
        version.id,
      );
      toast(`已为“${document.displayName}”创建新的解析任务`, "success");
      await loadDocuments({ background: true });
    } catch (caught) {
      setActionError(documentErrorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  const changeVisibility = async (
    document: ProjectDocumentDto,
    visibility: ProjectDocumentDto["visibility"],
  ) => {
    const actionKey = `visibility:${document.id}`;
    setPendingAction(actionKey);
    setActionError(null);
    try {
      await setProjectDocumentVisibility(project.id, document.id, visibility);
      toast(`“${document.displayName}”的可见范围已更新`, "success");
      await loadDocuments({ background: true });
    } catch (caught) {
      setActionError(documentErrorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="min-h-full bg-background">
      <ProjectContextHeader project={project} activeTab="documents" />
      <main className="px-5 py-5 lg:px-8 lg:py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">项目资料</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              安全管理项目文件、当前有效版本和历史版本。
            </p>
          </div>
          {canUpload ? (
            <Button type="button" onClick={openNewDocumentUpload}>
              <Upload className="size-4" />上传资料
            </Button>
          ) : null}
        </div>

        <aside className="mt-4 flex items-start gap-2 rounded-xl border border-info/20 bg-info-soft px-4 py-3 text-sm text-info">
          <Info className="mt-0.5 size-4 shrink-0" />
          <p>
            <strong className="font-semibold">文件已真实存储；</strong>
            当前有效版本会异步建立全文知识索引；AI 综合问答将在下一阶段启用。
          </p>
        </aside>

        {!canUpload && phase === "ready" ? (
          <aside className="mt-3 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
            你拥有查看和下载权限；上传、版本变更和归档操作已按项目权限隐藏。
          </aside>
        ) : null}

        {actionError ? (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive-soft px-4 py-3 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button type="button" aria-label="关闭错误提示" onClick={() => setActionError(null)} className="rounded p-1 hover:bg-destructive/10">
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}

        <section className="mt-5 overflow-hidden rounded-xl border border-border bg-card" aria-busy={phase === "loading" || refreshing}>
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex items-center gap-1 rounded-lg bg-muted p-1" role="group" aria-label="资料状态">
              <button
                type="button"
                aria-pressed={view === "active"}
                onClick={() => changeView("active")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${view === "active" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <FileCheck2 className="size-3.5" />有效资料
                <span className="tabular-nums">{counts.active}</span>
              </button>
              <button
                type="button"
                aria-pressed={view === "archived"}
                onClick={() => changeView("archived")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${view === "archived" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <FolderArchive className="size-3.5" />归档资料
                <span className="tabular-nums">{counts.archived}</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <span className="sr-only">搜索项目资料</span>
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="搜索资料名称"
                  className="h-8 w-56 rounded-lg border border-input bg-background pl-8 pr-8 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
                {search ? (
                  <button type="button" aria-label="清除搜索" onClick={() => setSearch("")} className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted">
                    <X className="size-3" />
                  </button>
                ) : null}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="刷新资料列表"
                loading={refreshing}
                onClick={() => void loadDocuments({ background: true })}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
          </header>

          {phase === "loading" ? <DocumentsLoading /> : null}

          {phase === "error" ? (
            <div className="grid min-h-80 place-items-center px-6 text-center">
              <div>
                <span className="mx-auto grid size-11 place-items-center rounded-xl bg-destructive-soft text-destructive">
                  <AlertCircle className="size-5" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-foreground">资料加载失败</h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">{listError}</p>
                <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void loadDocuments()}>
                  <RefreshCw className="size-3.5" />重新加载
                </Button>
              </div>
            </div>
          ) : null}

          {phase === "ready" && documents.length === 0 ? (
            <DocumentsEmpty
              archived={view === "archived"}
              canUpload={canUpload}
              onUpload={openNewDocumentUpload}
            />
          ) : null}

          {phase === "ready" && documents.length > 0 && filteredDocuments.length === 0 ? (
            <div className="grid min-h-72 place-items-center px-6 text-center">
              <div>
                <Search className="mx-auto size-7 text-muted-foreground" />
                <h3 className="mt-3 text-sm font-semibold text-foreground">没有匹配的资料</h3>
                <p className="mt-1 text-xs text-muted-foreground">请调整搜索关键词。</p>
                <button type="button" className="mt-3 text-xs font-medium text-primary hover:underline" onClick={() => setSearch("")}>清除搜索</button>
              </div>
            </div>
          ) : null}

          {phase === "ready" && filteredDocuments.length > 0 ? (
            <DocumentTable
              documents={filteredDocuments}
              pendingAction={pendingAction}
              onDownload={(document, version) => void download(document, version)}
              onVersions={setVersionDocument}
              onUploadVersion={openVersionUpload}
              onReindex={(document, version) => void reindex(document, version)}
              onVisibility={(document, visibility) =>
                void changeVisibility(document, visibility)
              }
              onLifecycle={(document, kind) => setConfirmAction({ document, kind })}
            />
          ) : null}
        </section>
      </main>

      {uploadOpen ? (
        <DocumentUploadDrawer
          open
          projectId={project.id}
          target={uploadTarget}
          policy={policy}
          destinations={listPermissions?.uploadDestinations ?? []}
          onClose={() => setUploadOpen(false)}
          onUploaded={uploaded}
        />
      ) : null}

      {versionDocument ? (
        <DocumentVersionDrawer
          open
          projectId={project.id}
          document={versionDocument}
          onClose={() => setVersionDocument(null)}
          onChanged={() => loadDocuments({ background: true })}
          onUploadVersion={openVersionUpload}
        />
      ) : null}

      <ConfirmLifecycleDialog
        action={confirmAction}
        pending={Boolean(pendingAction)}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void confirmLifecycleAction()}
      />
    </div>
  );
}

function DocumentsLoading() {
  return (
    <div className="space-y-2 p-4" role="status" aria-label="正在加载项目资料">
      {[0, 1, 2, 3, 4].map((index) => (
        <div key={index} className="skeleton h-16 rounded-lg" />
      ))}
    </div>
  );
}

function DocumentsEmpty({
  archived,
  canUpload,
  onUpload,
}: {
  archived: boolean;
  canUpload: boolean;
  onUpload: () => void;
}) {
  return (
    <div className="grid min-h-80 place-items-center px-6 text-center">
      <div>
        <span className="mx-auto grid size-12 place-items-center rounded-xl bg-muted text-muted-foreground">
          {archived ? <FolderArchive className="size-5" /> : <Inbox className="size-5" />}
        </span>
        <h3 className="mt-4 text-sm font-semibold text-foreground">
          {archived ? "暂无归档资料" : "暂无项目资料"}
        </h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {archived
            ? "归档后的资料会保留版本和审计记录，并显示在这里。"
            : canUpload
              ? "上传第一份文件，建立可追溯的项目资料版本。"
              : "项目成员尚未上传可查看的文件。"}
        </p>
        {!archived && canUpload ? (
          <Button type="button" size="sm" className="mt-4" onClick={onUpload}>
            <Upload className="size-3.5" />上传第一份资料
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function DocumentTable({
  documents,
  pendingAction,
  onDownload,
  onVersions,
  onUploadVersion,
  onReindex,
  onVisibility,
  onLifecycle,
}: {
  documents: ProjectDocumentDto[];
  pendingAction: string | null;
  onDownload: (document: ProjectDocumentDto, version: ProjectDocumentVersionDto) => void;
  onVersions: (document: ProjectDocumentDto) => void;
  onUploadVersion: (document: ProjectDocumentDto) => void;
  onReindex: (
    document: ProjectDocumentDto,
    version: ProjectDocumentVersionDto,
  ) => void;
  onVisibility: (
    document: ProjectDocumentDto,
    visibility: ProjectDocumentDto["visibility"],
  ) => void;
  onLifecycle: (document: ProjectDocumentDto, kind: "archive" | "restore") => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1040px] text-left">
        <thead className="border-b border-border bg-surface">
          <tr className="text-[11px] font-semibold text-muted-foreground">
            <th className="px-4 py-3">资料名称</th>
            <th className="px-3 py-3">文件类型</th>
            <th className="px-3 py-3">当前版本</th>
            <th className="px-3 py-3">文件大小</th>
            <th className="px-3 py-3">存储状态</th>
            <th className="px-3 py-3">可见范围</th>
            <th className="px-3 py-3">解析与索引</th>
            <th className="px-3 py-3">上传者</th>
            <th className="px-3 py-3">更新时间</th>
            <th className="px-4 py-3 text-right">操作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {documents.map((document) => {
            const version = document.currentVersion;
            const status = statusPresentation(document);
            const ingestion = ingestionPresentation(version);
            const canDownload =
              document.permissions.canDownload && version?.storageStatus === "stored";
            const busy = Boolean(pendingAction?.endsWith(`:${document.id}`));
            return (
              <tr key={document.id} className="transition-colors hover:bg-muted/30">
                <td className="px-4 py-3.5">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <FileText className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="max-w-xs truncate text-sm font-medium text-foreground" title={document.displayName}>{document.displayName}</p>
                      <p className="mt-0.5 max-w-xs truncate text-[10px] text-muted-foreground" title={version?.originalFilename}>{version?.originalFilename ?? "尚无可用文件版本"}</p>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-3.5 text-xs text-foreground">{version?.extension.toUpperCase() ?? "—"}</td>
                <td className="px-3 py-3.5">
                  {version ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                      <FileCheck2 className="size-3" />v{version.versionNumber}
                    </span>
                  ) : <span className="text-xs text-muted-foreground">等待可用版本</span>}
                </td>
                <td className="px-3 py-3.5 text-xs tabular-nums text-foreground">{version ? formatBytes(version.sizeBytes) : "—"}</td>
                <td className="px-3 py-3.5"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.classes}`}>{status.label}</span></td>
                <td className="px-3 py-3.5">
                  {document.permissions.canArchive && document.status === "active" ? (
                    <select
                      aria-label={`设置 ${document.displayName} 的可见范围`}
                      value={document.visibility}
                      disabled={Boolean(pendingAction)}
                      onChange={(event) =>
                        onVisibility(
                          document,
                          event.target.value as ProjectDocumentDto["visibility"],
                        )
                      }
                      className="h-8 rounded-md border bg-background px-2 text-[10px]"
                    >
                      <option value="private">项目私有</option>
                      <option value="department_shared">部门共享</option>
                      <option value="organization_shared">公司共享</option>
                      <option value="restricted">受限授权</option>
                    </select>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">
                      {{
                        private: "项目私有",
                        department_shared: "部门共享",
                        organization_shared: "公司共享",
                        restricted: "受限授权",
                      }[document.visibility]}
                    </span>
                  )}
                </td>
                <td className="px-3 py-3.5">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${ingestion.classes}`}>{ingestion.label}</span>
                  <p className="mt-1 max-w-52 text-[9px] text-muted-foreground">{ingestion.detail}</p>
                </td>
                <td className="px-3 py-3.5 text-xs text-foreground">{version?.uploadedBy.displayName ?? document.createdBy.displayName}</td>
                <td className="px-3 py-3.5 text-xs text-muted-foreground">{formatDate(document.updatedAt)}</td>
                <td className="px-4 py-3.5">
                  <div className="flex items-center justify-end gap-1">
                    {canDownload && version ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`下载 ${document.displayName}`}
                        title="下载当前版本"
                        loading={pendingAction === `download:${version.id}`}
                        disabled={Boolean(pendingAction)}
                        onClick={() => onDownload(document, version)}
                      >
                        <Download className="size-3.5" />
                      </Button>
                    ) : null}
                    <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`查看 ${document.displayName} 的版本历史`} title="版本历史" disabled={Boolean(pendingAction)} onClick={() => onVersions(document)}>
                      <History className="size-3.5" />
                    </Button>
                    {version &&
                    document.permissions.canReindex &&
                    document.status === "active" &&
                    version.storageStatus === "stored" ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`重新解析 ${document.displayName}`}
                        title="重新解析"
                        loading={pendingAction === `reindex:${version.id}`}
                        disabled={Boolean(pendingAction)}
                        onClick={() => onReindex(document, version)}
                      >
                        <RefreshCw className="size-3.5" />
                      </Button>
                    ) : null}
                    {document.permissions.canUploadVersion && document.status === "active" ? (
                      <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`为 ${document.displayName} 上传新版本`} title="上传新版本" disabled={Boolean(pendingAction)} onClick={() => onUploadVersion(document)}>
                        <Upload className="size-3.5" />
                      </Button>
                    ) : null}
                    {document.status === "active" && document.permissions.canArchive ? (
                      <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`归档 ${document.displayName}`} title="归档资料" loading={busy && pendingAction === `archive:${document.id}`} disabled={Boolean(pendingAction)} onClick={() => onLifecycle(document, "archive")}>
                        <Archive className="size-3.5" />
                      </Button>
                    ) : null}
                    {document.status === "archived" && document.permissions.canRestore ? (
                      <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`恢复 ${document.displayName}`} title="恢复资料" loading={busy && pendingAction === `restore:${document.id}`} disabled={Boolean(pendingAction)} onClick={() => onLifecycle(document, "restore")}>
                        <ArchiveRestore className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ConfirmLifecycleDialog({
  action,
  pending,
  onCancel,
  onConfirm,
}: {
  action: ConfirmAction;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!action) return null;
  const archive = action.kind === "archive";
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center px-4" role="dialog" aria-modal="true" aria-labelledby="document-lifecycle-title">
      <button type="button" className="absolute inset-0 bg-[var(--overlay)]" aria-label="关闭确认窗口" onClick={onCancel} />
      <section className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-float)]">
        <span className={`grid size-10 place-items-center rounded-xl ${archive ? "bg-warning-soft text-warning" : "bg-success-soft text-success"}`}>
          {archive ? <Archive className="size-5" /> : <ArchiveRestore className="size-5" />}
        </span>
        <h2 id="document-lifecycle-title" className="mt-4 text-base font-semibold text-foreground">
          {archive ? "归档项目资料" : "恢复项目资料"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {archive
            ? `归档“${action.document.displayName}”后，它将从有效资料列表移除，但所有历史文件和审计记录都会保留。`
            : `恢复“${action.document.displayName}”后，它会重新出现在有效资料列表中。`}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>取消</Button>
          <Button type="button" variant={archive ? "danger" : "primary"} onClick={onConfirm} loading={pending}>
            {archive ? "确认归档" : "确认恢复"}
          </Button>
        </div>
      </section>
    </div>
  );
}

export default DocumentsPage;
