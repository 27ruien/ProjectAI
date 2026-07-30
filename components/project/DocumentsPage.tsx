"use client";

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  FileCheck2,
  FileText,
  FolderArchive,
  Inbox,
  KeyRound,
  MoreHorizontal,
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
  listProjectDocumentGrants,
  listProjectDocuments,
  reindexProjectDocumentVersion,
  retryProjectDocumentEmbedding,
  restoreProjectDocument,
  setProjectDocumentGrant,
  type ProjectDocumentGrantDto,
} from "@/lib/documents/client";
import { withBasePath } from "@/lib/base-path";
import type { AuthorizedProjectSummary } from "@/lib/auth/ui-types";
import type {
  DocumentListCountsDto,
  DocumentListPermissionsDto,
  DocumentUploadPolicyDto,
  ProjectDocumentDto,
  ProjectDocumentUploadResponse,
  ProjectDocumentVersionDto,
} from "@/types/documents";
import {
  DocumentUploadDrawer,
  type DocumentUploadTarget,
} from "./DocumentUploadDrawer";
import { DocumentVersionDrawer } from "./DocumentVersionDrawer";
import { ProjectContextHeader } from "./ProjectContextHeader";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

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
  return {
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
  }[storageStatus ?? "pending"];
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
      label: "解析完成",
      detail: "已提取可检索文本",
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

function embeddingPresentation(version: ProjectDocumentVersionDto | null) {
  if (!version || version.ingestion.status !== "succeeded") {
    return {
      label: "等待解析",
      detail: "解析完成后自动向量化",
      classes: "border-border bg-muted text-muted-foreground",
    };
  }
  return {
    not_started: {
      label: "等待向量化",
      detail: "等待 qwen3.7-text-embedding 任务",
      classes: "border-info/20 bg-info-soft text-info",
    },
    pending: {
      label: "等待向量化",
      detail: "向量任务已进入队列",
      classes: "border-info/20 bg-info-soft text-info",
    },
    running: {
      label: "正在向量化",
      detail: "正在生成 1024 维文本向量",
      classes: "border-info/20 bg-info-soft text-info",
    },
    succeeded: {
      label: "可用于 AI",
      detail: `${version.embedding.model} · ${version.embedding.dimensions} 维`,
      classes: "border-success/20 bg-success-soft text-success",
    },
    failed: {
      label: "向量化失败",
      detail: "可由项目经理精确重试",
      classes: "border-destructive/20 bg-destructive-soft text-destructive",
    },
    unknown: {
      label: "等待管理员复核",
      detail: "结果状态不确定，禁止自动重试",
      classes: "border-warning/20 bg-warning-soft text-warning",
    },
  }[version.embedding.status];
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
  const [listPermissions, setListPermissions] =
    useState<DocumentListPermissionsDto | null>(null);
  const [search, setSearch] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<DocumentUploadTarget>(null);
  const [versionDocument, setVersionDocument] =
    useState<ProjectDocumentDto | null>(null);
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
        if (isAbortError(caught) || sequence !== requestSequence.current)
          return;
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
        if (isAbortError(caught) || sequence !== requestSequence.current)
          return;
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
        ) || ["not_started", "pending", "running"].includes(
          document.currentVersion?.embedding.status ?? "",
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
      return [
        document.displayName,
        version?.originalFilename,
        version?.extension,
      ]
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
    setUploadTarget({
      documentId: document.id,
      displayName: document.displayName,
    });
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
      await reindexProjectDocumentVersion(project.id, document.id, version.id);
      toast(`已为“${document.displayName}”创建新的解析任务`, "success");
      await loadDocuments({ background: true });
    } catch (caught) {
      setActionError(documentErrorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  const retryEmbedding = async (
    document: ProjectDocumentDto,
    version: ProjectDocumentVersionDto,
  ) => {
    const actionKey = `embedding:${version.id}`;
    setPendingAction(actionKey);
    setActionError(null);
    try {
      await retryProjectDocumentEmbedding(
        project.id,
        document.id,
        version.id,
      );
      toast(`已为“${document.displayName}”重新创建向量化任务`, "success");
      await loadDocuments({ background: true });
    } catch (caught) {
      setActionError(documentErrorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <div className="min-h-full bg-background">
      <ProjectContextHeader project={project} activeTab="files" />
      <main className="px-5 py-5 lg:px-8 lg:py-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-foreground">
              项目资料
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              安全管理项目文件、当前有效版本和历史版本。
            </p>
          </div>
          {canUpload ? (
            <Button type="button" onClick={openNewDocumentUpload}>
              <Upload className="size-4" />
              上传资料
            </Button>
          ) : null}
        </div>

        <aside className="mt-4 rounded-lg border border-info/20 bg-info-soft px-4 py-3 text-sm text-info">文件上传后会自动解析并使用 qwen3.7-text-embedding 生成 1024 维向量；只有状态变为“可用于 AI”的当前版本才进入新检索。</aside>

        {!canUpload && phase === "ready" ? (
          <aside className="mt-3 rounded-lg border border-border bg-card px-3 py-2.5 text-xs text-muted-foreground">
            你拥有查看和下载权限；上传、版本变更和归档操作已按项目权限隐藏。
          </aside>
        ) : null}

        {actionError ? (
          <div
            className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive-soft px-4 py-3 text-sm text-destructive"
            role="alert"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button
              type="button"
              aria-label="关闭错误提示"
              onClick={() => setActionError(null)}
              className="rounded p-1 hover:bg-destructive/10"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ) : null}

        <section
          className="mt-5 overflow-hidden rounded-lg border border-border bg-card"
          aria-busy={phase === "loading" || refreshing}
        >
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div
              className="flex items-center gap-1 rounded-lg bg-muted p-1"
              role="group"
              aria-label="资料状态"
            >
              <button
                type="button"
                aria-pressed={view === "active"}
                onClick={() => changeView("active")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${view === "active" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <FileCheck2 className="size-3.5" />
                有效资料
                <span className="tabular-nums">{counts.active}</span>
              </button>
              <button
                type="button"
                aria-pressed={view === "archived"}
                onClick={() => changeView("archived")}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${view === "archived" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
              >
                <FolderArchive className="size-3.5" />
                归档资料
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
                  <button
                    type="button"
                    aria-label="清除搜索"
                    onClick={() => setSearch("")}
                    className="absolute right-1.5 top-1/2 grid size-5 -translate-y-1/2 place-items-center rounded text-muted-foreground hover:bg-muted"
                  >
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
                <h3 className="mt-4 text-sm font-semibold text-foreground">
                  资料加载失败
                </h3>
                <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                  {listError}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-4"
                  onClick={() => void loadDocuments()}
                >
                  <RefreshCw className="size-3.5" />
                  重新加载
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

          {phase === "ready" &&
          documents.length > 0 &&
          filteredDocuments.length === 0 ? (
            <div className="grid min-h-72 place-items-center px-6 text-center">
              <div>
                <Search className="mx-auto size-7 text-muted-foreground" />
                <h3 className="mt-3 text-sm font-semibold text-foreground">
                  没有匹配的资料
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  请调整搜索关键词。
                </p>
                <button
                  type="button"
                  className="mt-3 text-xs font-medium text-primary hover:underline"
                  onClick={() => setSearch("")}
                >
                  清除搜索
                </button>
              </div>
            </div>
          ) : null}

          {phase === "ready" && filteredDocuments.length > 0 ? (
            <DocumentTable
              documents={filteredDocuments}
              pendingAction={pendingAction}
              onDownload={(document, version) =>
                void download(document, version)
              }
              onVersions={setVersionDocument}
              onUploadVersion={openVersionUpload}
              onReindex={(document, version) => void reindex(document, version)}
              onRetryEmbedding={(document, version) =>
                void retryEmbedding(document, version)
              }
              onLifecycle={(document, kind) =>
                setConfirmAction({ document, kind })
              }
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
          {archived ? (
            <FolderArchive className="size-5" />
          ) : (
            <Inbox className="size-5" />
          )}
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
            <Upload className="size-3.5" />
            上传第一份资料
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
  onRetryEmbedding,
  onLifecycle,
}: {
  documents: ProjectDocumentDto[];
  pendingAction: string | null;
  onDownload: (
    document: ProjectDocumentDto,
    version: ProjectDocumentVersionDto,
  ) => void;
  onVersions: (document: ProjectDocumentDto) => void;
  onUploadVersion: (document: ProjectDocumentDto) => void;
  onReindex: (
    document: ProjectDocumentDto,
    version: ProjectDocumentVersionDto,
  ) => void;
  onRetryEmbedding: (
    document: ProjectDocumentDto,
    version: ProjectDocumentVersionDto,
  ) => void;
  onLifecycle: (
    document: ProjectDocumentDto,
    kind: "archive" | "restore",
  ) => void;
}) {
  return <div className="overflow-x-auto"><Table className="min-w-[900px]"><TableHeader><TableRow>
    <TableHead>文件名称</TableHead><TableHead>类型</TableHead><TableHead>当前版本</TableHead><TableHead>上传人</TableHead><TableHead>更新时间</TableHead><TableHead>处理状态</TableHead><TableHead className="w-12"><span className="sr-only">操作</span></TableHead>
  </TableRow></TableHeader><TableBody>
          {documents.map((document) => {
            const version = document.currentVersion;
            const status = statusPresentation(document);
            const ingestion = ingestionPresentation(version);
            const embedding = embeddingPresentation(version);
            const canDownload =
              document.permissions.canDownload &&
              version?.storageStatus === "stored";
            const busy = Boolean(pendingAction?.endsWith(`:${document.id}`));
            return (
              <TableRow key={document.id}>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <FileText className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p
                        className="max-w-xs truncate font-medium text-foreground"
                        title={document.displayName}
                      >
                        {document.displayName}
                      </p>
                      <p
                        className="mt-0.5 max-w-xs truncate text-[10px] text-muted-foreground"
                        title={version?.originalFilename}
                      >
                        {version?.originalFilename ?? "尚无可用文件版本"}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>{version?.extension.toUpperCase() ?? "—"}</TableCell>
                <TableCell>
                  {version ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <FileCheck2 className="size-3" />v{version.versionNumber}
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      等待可用版本
                    </span>
                  )}
                </TableCell>
                <TableCell>{version?.uploadedBy.displayName ?? document.createdBy.displayName}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(document.updatedAt)}</TableCell>
                <TableCell>
                  {document.status === "archived" ? <><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${status.classes}`}>{status.label}</span><p className="mt-1 max-w-52 text-[10px] text-muted-foreground">已从有效资料中移除</p></> : <div className="space-y-1"><div className="flex flex-wrap gap-1"><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${ingestion.classes}`}>{ingestion.label}</span><span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium ${embedding.classes}`}>{embedding.label}</span></div><p className="max-w-64 text-[10px] text-muted-foreground">{version?.ingestion.status === "succeeded" ? embedding.detail : ingestion.detail}</p></div>}
                </TableCell>
                <TableCell>
                  <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`${document.displayName} 操作`} disabled={Boolean(pendingAction)}><MoreHorizontal /></Button></DropdownMenuTrigger><DropdownMenuContent align="end">
                    {canDownload && version ? <DropdownMenuItem asChild><a href={withBasePath(`/api/projects/${document.projectId}/documents/${document.id}/versions/${version.id}/download?preview=true`)} target="_blank" rel="noreferrer">预览</a></DropdownMenuItem> : null}
                    {canDownload && version ? <DropdownMenuItem onSelect={() => onDownload(document, version)}>下载</DropdownMenuItem> : null}
                    {document.permissions.canUploadVersion && document.status === "active" ? <DropdownMenuItem onSelect={() => onUploadVersion(document)}>上传新版本</DropdownMenuItem> : null}
                    <DropdownMenuItem onSelect={() => onVersions(document)}>查看版本历史</DropdownMenuItem>
                    {version && document.permissions.canReindex && document.status === "active" && version.storageStatus === "stored" ? <DropdownMenuItem onSelect={() => onReindex(document, version)}>重新解析</DropdownMenuItem> : null}
                    {version && document.permissions.canReindex && document.status === "active" && version.embedding.status === "failed" ? <DropdownMenuItem onSelect={() => onRetryEmbedding(document, version)}>重试向量化</DropdownMenuItem> : null}
                    {(document.permissions.canArchive || document.permissions.canRestore) ? <DropdownMenuSeparator /> : null}
                    {document.status === "active" && document.permissions.canArchive ? <DropdownMenuItem variant="destructive" onSelect={() => onLifecycle(document, "archive")}>{busy ? "处理中…" : "归档"}</DropdownMenuItem> : null}
                    {document.status === "archived" && document.permissions.canRestore ? <DropdownMenuItem onSelect={() => onLifecycle(document, "restore")}>{busy ? "处理中…" : "恢复"}</DropdownMenuItem> : null}
                  </DropdownMenuContent></DropdownMenu>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody></Table></div>;
}

export function DocumentGrantDialog({
  projectId,
  document,
  onCancel,
  onCreated,
}: {
  projectId: string;
  document: ProjectDocumentDto;
  onCancel: () => void;
  onCreated: () => Promise<void>;
}) {
  const [subjectType, setSubjectType] = useState<
    "organization" | "department" | "project" | "role" | "user"
  >("user");
  const [subjectId, setSubjectId] = useState("");
  const [permission, setPermission] = useState<
    | "view"
    | "download"
    | "upload"
    | "edit_metadata"
    | "manage_versions"
    | "archive"
    | "manage_permissions"
    | "manage_members"
  >("view");
  const [effect, setEffect] = useState<"allow" | "deny">("allow");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [grants, setGrants] = useState<ProjectDocumentGrantDto[]>([]);
  const [loadingGrants, setLoadingGrants] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void listProjectDocumentGrants(projectId, document.id, controller.signal)
      .then((result) => setGrants(result.grants))
      .catch((caught: unknown) => {
        if (!isAbortError(caught)) setError(documentErrorMessage(caught));
      })
      .finally(() => setLoadingGrants(false));
    return () => controller.abort();
  }, [document.id, projectId]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!subjectId.trim()) {
      setError("请输入组织、部门、项目、角色或用户 ID");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await setProjectDocumentGrant(projectId, document.id, {
        subjectType,
        subjectId: subjectId.trim(),
        permission,
        effect,
      });
      await onCreated();
    } catch (caught) {
      setError(documentErrorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] grid place-items-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-grant-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[var(--overlay)]"
        aria-label="关闭文件授权窗口"
        onClick={onCancel}
      />
      <form
        onSubmit={(event) => void submit(event)}
        className="relative w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-float)]"
      >
        <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <KeyRound className="size-5" />
        </span>
        <h2 id="document-grant-title" className="mt-4 text-base font-semibold">
          文件授权 · {document.displayName}
        </h2>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          规则由服务端校验；显式拒绝优先，查看与下载相互独立。
        </p>
        <section className="mt-4 rounded-lg border bg-muted/30 p-3">
          <h3 className="text-xs font-semibold">当前显式规则</h3>
          {loadingGrants ? (
            <p className="mt-2 text-xs text-muted-foreground">
              正在加载授权规则…
            </p>
          ) : grants.length ? (
            <div className="mt-2 max-h-28 space-y-1.5 overflow-y-auto">
              {grants.map((grant) => (
                <p
                  key={grant.id}
                  className="font-mono text-[10px] text-muted-foreground"
                >
                  {grant.effect.toUpperCase()} · {grant.permission} ·{" "}
                  {grant.subjectType}:{grant.subjectId}
                </p>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              暂无显式规则，未匹配时默认拒绝。
            </p>
          )}
        </section>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5 text-xs font-medium">
            授权对象
            <select
              value={subjectType}
              onChange={(event) =>
                setSubjectType(event.target.value as typeof subjectType)
              }
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
            >
              <option value="user">用户</option>
              <option value="project">项目</option>
              <option value="department">部门</option>
              <option value="organization">组织</option>
              <option value="role">角色</option>
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            对象 ID / Role
            <input
              value={subjectId}
              onChange={(event) => setSubjectId(event.target.value)}
              maxLength={200}
              placeholder="输入受控标识"
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
            />
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            权限
            <select
              value={permission}
              onChange={(event) =>
                setPermission(event.target.value as typeof permission)
              }
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
            >
              {[
                "view",
                "download",
                "upload",
                "edit_metadata",
                "manage_versions",
                "archive",
                "manage_permissions",
                "manage_members",
              ].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 text-xs font-medium">
            效果
            <select
              value={effect}
              onChange={(event) =>
                setEffect(event.target.value as typeof effect)
              }
              className="h-10 w-full rounded-lg border bg-background px-3 text-sm"
            >
              <option value="allow">允许</option>
              <option value="deny">拒绝</option>
            </select>
          </label>
        </div>
        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={submitting}
          >
            取消
          </Button>
          <Button type="submit" loading={submitting} disabled={submitting}>
            保存授权
          </Button>
        </div>
      </form>
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
    <div
      className="fixed inset-0 z-[90] grid place-items-center px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="document-lifecycle-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-[var(--overlay)]"
        aria-label="关闭确认窗口"
        onClick={onCancel}
      />
      <section className="relative w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-[var(--shadow-float)]">
        <span
          className={`grid size-10 place-items-center rounded-xl ${archive ? "bg-warning-soft text-warning" : "bg-success-soft text-success"}`}
        >
          {archive ? (
            <Archive className="size-5" />
          ) : (
            <ArchiveRestore className="size-5" />
          )}
        </span>
        <h2
          id="document-lifecycle-title"
          className="mt-4 text-base font-semibold text-foreground"
        >
          {archive ? "归档项目资料" : "恢复项目资料"}
        </h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {archive
            ? `归档“${action.document.displayName}”后，它将从有效资料列表移除，但所有历史文件和审计记录都会保留。`
            : `恢复“${action.document.displayName}”后，它会重新出现在有效资料列表中。`}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={pending}
          >
            取消
          </Button>
          <Button
            type="button"
            variant={archive ? "danger" : "primary"}
            onClick={onConfirm}
            loading={pending}
          >
            {archive ? "确认归档" : "确认恢复"}
          </Button>
        </div>
      </section>
    </div>
  );
}

export default DocumentsPage;
