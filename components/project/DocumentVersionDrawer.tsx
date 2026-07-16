"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FileClock,
  FileText,
  History,
  RotateCw,
  Upload,
} from "lucide-react";
import { Button } from "@/components/common/button";
import { Drawer } from "@/components/common/drawer";
import {
  documentErrorMessage,
  downloadProjectDocumentVersion,
  listProjectDocumentVersions,
  setCurrentProjectDocumentVersion,
} from "@/lib/documents/client";
import type {
  ProjectDocumentDto,
  ProjectDocumentVersionDto,
} from "@/types/documents";

interface DocumentVersionDrawerProps {
  open: boolean;
  projectId: string;
  document: ProjectDocumentDto | null;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
  onUploadVersion: (document: ProjectDocumentDto) => void;
}

type LoadState = "loading" | "ready" | "error";

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string | null): string {
  if (!value) return "尚未完成存储";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function versionStatus(version: ProjectDocumentVersionDto) {
  const status = {
    pending: { label: "处理中", classes: "bg-info-soft text-info" },
    stored: { label: "可用", classes: "bg-success-soft text-success" },
    failed: { label: "上传失败", classes: "bg-destructive-soft text-destructive" },
    quarantined: { label: "已隔离", classes: "bg-warning-soft text-warning" },
    deleted: { label: "已删除", classes: "bg-muted text-muted-foreground" },
  }[version.storageStatus];
  return status;
}

export function DocumentVersionDrawer({
  open,
  projectId,
  document,
  onClose,
  onChanged,
  onUploadVersion,
}: DocumentVersionDrawerProps) {
  const [state, setState] = useState<LoadState>("loading");
  const [versions, setVersions] = useState<ProjectDocumentVersionDto[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!document) return;
      setState("loading");
      setError(null);
      try {
        const response = await listProjectDocumentVersions(
          projectId,
          document.id,
          signal,
        );
        setVersions(
          [...response.versions].sort(
            (left, right) => right.versionNumber - left.versionNumber,
          ),
        );
        setState("ready");
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(documentErrorMessage(caught));
        setState("error");
      }
    },
    [document, projectId],
  );

  useEffect(() => {
    if (!open || !document) return;
    const controller = new AbortController();
    void listProjectDocumentVersions(projectId, document.id, controller.signal)
      .then((response) => {
        setVersions(
          [...response.versions].sort(
            (left, right) => right.versionNumber - left.versionNumber,
          ),
        );
        setState("ready");
      })
      .catch((caught: unknown) => {
        if (caught instanceof DOMException && caught.name === "AbortError") return;
        setError(documentErrorMessage(caught));
        setState("error");
      });
    return () => controller.abort();
  }, [document, open, projectId]);

  const setCurrent = async (version: ProjectDocumentVersionDto) => {
    if (!document) return;
    setPendingAction(`current:${version.id}`);
    setError(null);
    try {
      await setCurrentProjectDocumentVersion(projectId, document.id, version.id);
      await load();
      await onChanged();
    } catch (caught) {
      setError(documentErrorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  const download = async (version: ProjectDocumentVersionDto) => {
    if (!document) return;
    setPendingAction(`download:${version.id}`);
    setError(null);
    try {
      await downloadProjectDocumentVersion(
        projectId,
        document.id,
        version.id,
        version.originalFilename,
      );
    } catch (caught) {
      setError(documentErrorMessage(caught));
    } finally {
      setPendingAction(null);
    }
  };

  const canUploadVersion =
    Boolean(document?.permissions.canUploadVersion) && document?.status === "active";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="版本历史"
      description={document?.displayName}
      width="max-w-2xl"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">历史对象不会被新版本覆盖或删除。</p>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>关闭</Button>
            {document && canUploadVersion ? (
              <Button type="button" onClick={() => onUploadVersion(document)}>
                <Upload className="size-4" />上传新版本
              </Button>
            ) : null}
          </div>
        </div>
      }
    >
      {state === "loading" ? (
        <div className="space-y-3" role="status" aria-label="正在加载版本历史">
          {[0, 1, 2].map((index) => (
            <div key={index} className="skeleton h-24 rounded-xl" />
          ))}
        </div>
      ) : null}

      {state === "error" ? (
        <div className="grid min-h-64 place-items-center text-center">
          <div>
            <span className="mx-auto grid size-11 place-items-center rounded-xl bg-destructive-soft text-destructive">
              <AlertCircle className="size-5" />
            </span>
            <h3 className="mt-4 text-sm font-semibold text-foreground">版本历史加载失败</h3>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
            <Button type="button" variant="outline" size="sm" className="mt-4" onClick={() => void load()}>
              <RotateCw className="size-3.5" />重新加载
            </Button>
          </div>
        </div>
      ) : null}

      {state === "ready" && versions.length === 0 ? (
        <div className="grid min-h-64 place-items-center text-center">
          <div>
            <History className="mx-auto size-8 text-muted-foreground" />
            <h3 className="mt-3 text-sm font-semibold text-foreground">暂无版本记录</h3>
            <p className="mt-1 text-xs text-muted-foreground">该资料尚未形成可查看的文件版本。</p>
          </div>
        </div>
      ) : null}

      {state === "ready" && versions.length > 0 ? (
        <div className="space-y-3">
          {versions.map((version) => {
            const status = versionStatus(version);
            const canDownload =
              Boolean(document?.permissions.canDownload) &&
              version.storageStatus === "stored";
            const canSetCurrent =
              Boolean(document?.permissions.canSetCurrent) &&
              document?.status === "active" &&
              version.storageStatus === "stored" &&
              !version.isCurrent;
            return (
              <article key={version.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className={`grid size-9 shrink-0 place-items-center rounded-lg ${version.isCurrent ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {version.storageStatus === "pending" ? <FileClock className="size-4" /> : <FileText className="size-4" />}
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">版本 {version.versionNumber}</h3>
                        {version.isCurrent ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                            <CheckCircle2 className="size-3" />当前版本
                          </span>
                        ) : null}
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.classes}`}>{status.label}</span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">{version.originalFilename}</p>
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        {version.extension.toUpperCase()} · {formatBytes(version.sizeBytes)} · {version.uploadedBy.displayName} · {formatDate(version.storedAt ?? version.createdAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {canSetCurrent ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        loading={pendingAction === `current:${version.id}`}
                        disabled={Boolean(pendingAction)}
                        onClick={() => void setCurrent(version)}
                      >
                        设为当前
                      </Button>
                    ) : null}
                    {canDownload ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        aria-label={`下载版本 ${version.versionNumber}`}
                        loading={pendingAction === `download:${version.id}`}
                        disabled={Boolean(pendingAction)}
                        onClick={() => void download(version)}
                      >
                        <Download className="size-3.5" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : null}

      {error && state === "ready" ? (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive-soft p-3 text-sm text-destructive" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          {error}
        </div>
      ) : null}
    </Drawer>
  );
}
