"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  RotateCw,
  UploadCloud,
} from "lucide-react";
import { Button } from "@/components/common/button";
import { Drawer } from "@/components/common/drawer";
import {
  DocumentApiError,
  documentErrorMessage,
  listProjectDocumentVersions,
  uploadProjectDocument,
} from "@/lib/documents/client";
import type {
  DocumentStorageStatus,
  DocumentUploadPolicyDto,
  KnowledgeSpaceUploadDestinationDto,
  ProjectDocumentUploadResponse,
} from "@/types/documents";

export type DocumentUploadTarget = {
  documentId: string;
  displayName: string;
} | null;

type UploadPhase = "idle" | "uploading" | "success" | "error";

const PENDING_UPLOAD_POLL_INTERVAL_MS = 2_000;
const PENDING_UPLOAD_TIMEOUT_MS = 60_000;
const terminalUploadStatuses: ReadonlySet<DocumentStorageStatus> = new Set([
  "stored",
  "failed",
  "quarantined",
  "deleted",
]);

type PendingUploadPollOptions = {
  signal?: AbortSignal;
  intervalMs?: number;
  timeoutMs?: number;
  now?: () => number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  loadVersions?: typeof listProjectDocumentVersions;
};

interface DocumentUploadDrawerProps {
  open: boolean;
  projectId: string;
  target: DocumentUploadTarget;
  policy: DocumentUploadPolicyDto;
  destinations: KnowledgeSpaceUploadDestinationDto[];
  onClose: () => void;
  onUploaded: (response: ProjectDocumentUploadResponse) => void | Promise<void>;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function displayNameFromFile(file: File): string {
  const withoutExtension = file.name.replace(/\.[^.]+$/, "").trim();
  return (withoutExtension || "未命名资料").slice(0, 240);
}

function extensionFromFile(file: File): string {
  const extension = file.name.split(".").at(-1)?.toLocaleLowerCase("en-US");
  return extension || "";
}

function uploadAbortError(): DocumentApiError {
  return new DocumentApiError(0, "UPLOAD_ABORTED", "文件上传已取消");
}

function pendingUploadTimeoutError(): DocumentApiError {
  return new DocumentApiError(
    202,
    "UPLOAD_PENDING",
    "文件仍在安全处理中，尚未确认保存成功，请重试确认状态。",
  );
}

function pendingUploadSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  if (parent?.aborted) controller.abort();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    cleanup: () => {
      globalThis.clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

function waitForPendingUpload(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(uploadAbortError());
      return;
    }

    const abort = () => {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      reject(uploadAbortError());
    };
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

function invalidUploadResponse(): DocumentApiError {
  return new DocumentApiError(
    502,
    "INVALID_RESPONSE",
    "上传状态响应无效，请重试确认状态。",
  );
}

/**
 * A replayed upload can return HTTP 202 while its original request is still
 * finalizing. Keep the browser bound to the exact authorized project,
 * document and version until storage reaches a terminal state.
 */
export async function resolvePendingDocumentUpload(
  projectId: string,
  initialResponse: ProjectDocumentUploadResponse,
  options: PendingUploadPollOptions = {},
): Promise<ProjectDocumentUploadResponse> {
  const documentId = initialResponse.document.id;
  const versionId = initialResponse.version.id;
  if (
    initialResponse.document.projectId !== projectId ||
    initialResponse.version.documentId !== documentId
  ) {
    throw invalidUploadResponse();
  }
  if (initialResponse.uploadStatus !== initialResponse.version.storageStatus) {
    throw invalidUploadResponse();
  }
  if (initialResponse.uploadStatus !== "pending") {
    if (!terminalUploadStatuses.has(initialResponse.uploadStatus)) {
      throw invalidUploadResponse();
    }
    return initialResponse;
  }

  const intervalMs = Math.max(1, options.intervalMs ?? PENDING_UPLOAD_POLL_INTERVAL_MS);
  const timeoutMs = Math.max(1, options.timeoutMs ?? PENDING_UPLOAD_TIMEOUT_MS);
  const now = options.now ?? Date.now;
  const wait = options.wait ?? waitForPendingUpload;
  const loadVersions = options.loadVersions ?? listProjectDocumentVersions;
  const startedAt = now();
  const polling = pendingUploadSignal(options.signal, timeoutMs);

  try {
    while (now() - startedAt < timeoutMs) {
      if (polling.signal.aborted) throw uploadAbortError();
      const response = await loadVersions(projectId, documentId, polling.signal);
      if (
        response.document &&
        (response.document.projectId !== projectId || response.document.id !== documentId)
      ) {
        throw invalidUploadResponse();
      }

      const version = response.versions.find((candidate) => candidate.id === versionId);
      if (!version || version.documentId !== documentId) {
        throw invalidUploadResponse();
      }
      if (version.storageStatus !== "pending") {
        if (!terminalUploadStatuses.has(version.storageStatus)) {
          throw invalidUploadResponse();
        }
        return {
          ...initialResponse,
          document: response.document ?? initialResponse.document,
          version,
          uploadStatus: version.storageStatus,
        };
      }

      const remainingMs = timeoutMs - (now() - startedAt);
      if (remainingMs <= 0) break;
      await wait(Math.min(intervalMs, remainingMs), polling.signal);
    }
    throw pendingUploadTimeoutError();
  } catch (error) {
    if (polling.didTimeOut()) throw pendingUploadTimeoutError();
    if (options.signal?.aborted) throw uploadAbortError();
    throw error;
  } finally {
    polling.cleanup();
  }
}

export function DocumentUploadDrawer({
  open,
  projectId,
  target,
  policy,
  destinations,
  onClose,
  onUploaded,
}: DocumentUploadDrawerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [displayName, setDisplayName] = useState(target?.displayName ?? "");
  const [knowledgeSpaceId, setKnowledgeSpaceId] = useState(
    destinations.find((destination) => destination.projectId === projectId)?.id ??
      destinations[0]?.id ??
      "",
  );
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [replayed, setReplayed] = useState(false);

  const isVersionUpload = Boolean(target);
  const allowedExtensions = policy.allowedExtensions.map((value) =>
    value.replace(/^\./, "").toLocaleLowerCase("en-US"),
  );
  const accept = allowedExtensions.map((value) => `.${value}`).join(",");

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (phase !== "error" || !error) return;
    const frame = window.requestAnimationFrame(() => {
      errorRef.current?.scrollIntoView({ block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [error, phase]);

  const selectFile = (selected: File | null) => {
    if (!selected) return;
    const extension = extensionFromFile(selected);
    if (!allowedExtensions.includes(extension)) {
      setFile(null);
      setError(`仅支持 ${allowedExtensions.map((value) => value.toUpperCase()).join("、")} 文件。`);
      setPhase("error");
      return;
    }
    if (selected.size < 1 || selected.size > policy.maxBytes) {
      setFile(null);
      setError(`文件必须大于 0 B 且不超过 ${formatBytes(policy.maxBytes)}。`);
      setPhase("error");
      return;
    }
    setFile(selected);
    if (!isVersionUpload) setDisplayName(displayNameFromFile(selected));
    setIdempotencyKey(crypto.randomUUID());
    setProgress(0);
    setError(null);
    setPhase("idle");
    setReplayed(false);
  };

  const submit = async () => {
    if (!file) return;
    const normalizedName = displayName.trim();
    if (!isVersionUpload && (!normalizedName || normalizedName.length > 240)) {
      setError("资料名称必须为 1 至 240 个字符。");
      setPhase("error");
      return;
    }

    const controller = new AbortController();
    controllerRef.current = controller;
    setPhase("uploading");
    setProgress(0);
    setError(null);
    try {
      let response = await uploadProjectDocument({
        projectId,
        documentId: target?.documentId,
        file,
        displayName: isVersionUpload ? undefined : normalizedName,
        knowledgeSpaceId: isVersionUpload ? undefined : knowledgeSpaceId,
        idempotencyKey: idempotencyKey || crypto.randomUUID(),
        signal: controller.signal,
        onProgress: ({ percent }) => setProgress(percent),
      });
      setProgress(100);
      response = await resolvePendingDocumentUpload(projectId, response, {
        signal: controller.signal,
      });
      if (response.uploadStatus !== "stored") {
        setError(
          documentErrorMessage(
            new DocumentApiError(
              409,
              response.version.failureCode || "UPLOAD_FAILED",
              "文件未能完成安全存储",
            ),
          ),
        );
        setPhase("error");
        return;
      }
      setReplayed(response.replayed);
      setPhase("success");
      await onUploaded(response);
    } catch (caught) {
      if (controller.signal.aborted) return;
      setError(
        caught instanceof DocumentApiError && caught.code === "UPLOAD_PENDING"
          ? caught.message
          : documentErrorMessage(caught),
      );
      setPhase("error");
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  };

  const requestClose = () => {
    if (phase === "uploading") return;
    onClose();
  };

  return (
    <Drawer
      open={open}
      onClose={requestClose}
      title={isVersionUpload ? "上传新版本" : "上传项目资料"}
      description={
        isVersionUpload
          ? `为“${target?.displayName ?? "项目资料"}”创建不可覆盖的新版本。`
          : "文件将保存到当前项目的私有对象存储。"
      }
      width="max-w-lg"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={requestClose}
            disabled={phase === "uploading"}
          >
            {phase === "success" ? "关闭" : "取消"}
          </Button>
          {phase !== "success" ? (
            <Button
              type="button"
              onClick={() => void submit()}
              loading={phase === "uploading"}
              disabled={
                !file ||
                (!isVersionUpload && (!displayName.trim() || !knowledgeSpaceId))
              }
            >
              {phase === "error" ? <RotateCw className="size-4" /> : <UploadCloud className="size-4" />}
              {phase === "error" ? "重试上传" : isVersionUpload ? "上传新版本" : "开始上传"}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        <div
          className="rounded-xl border border-dashed border-border bg-surface px-5 py-7 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            if (phase !== "uploading") selectFile(event.dataTransfer.files.item(0));
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            className="sr-only"
            aria-label="选择上传文件"
            onChange={(event) => selectFile(event.target.files?.item(0) ?? null)}
          />
          <span className="mx-auto grid size-11 place-items-center rounded-xl bg-primary/10 text-primary">
            <UploadCloud className="size-5" />
          </span>
          <p className="mt-3 text-sm font-semibold text-foreground">拖放文件到此处，或选择文件</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            支持 {allowedExtensions.map((value) => value.toUpperCase()).join("、")}，单文件不超过 {formatBytes(policy.maxBytes)}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-4"
            disabled={phase === "uploading"}
            onClick={() => inputRef.current?.click()}
          >
            选择文件
          </Button>
        </div>

        {file ? (
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <FileText className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {extensionFromFile(file).toUpperCase()} · {formatBytes(file.size)}
              </p>
            </div>
          </div>
        ) : null}

        {!isVersionUpload ? (
          <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-foreground">资料名称</span>
            <input
              value={displayName}
              maxLength={240}
              disabled={phase === "uploading" || phase === "success"}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder="选择文件后可修改资料名称"
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            />
            <span className="mt-1.5 block text-[11px] text-muted-foreground">
              资料名称用于列表展示，不会改变原始文件名。
            </span>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-foreground">知识空间</span>
            <select
              value={knowledgeSpaceId}
              disabled={phase === "uploading" || phase === "success"}
              onChange={(event) => setKnowledgeSpaceId(event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-60"
            >
              {destinations.map((destination) => (
                <option key={destination.id} value={destination.id}>
                  {destination.name} · {{
                    organization: "公司",
                    department: "部门",
                    project: "项目",
                    restricted: "受限",
                  }[destination.type]}
                </option>
              ))}
            </select>
            <span className="mt-1.5 block text-[11px] text-muted-foreground">
              仅显示服务端确认可上传的空间；目标空间同时绑定到幂等请求。
            </span>
          </label>
          </div>
        ) : null}

        {phase === "uploading" ? (
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4" role="status">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-foreground">
                {progress < 100 ? "正在上传文件" : "服务端正在校验并安全保存"}
              </span>
              <span className="tabular-nums text-primary">{progress}%</span>
            </div>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-primary/10"
              role="progressbar"
              aria-label="文件上传进度"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div
                className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">上传完成前请保持此页面打开。</p>
          </div>
        ) : null}

        {phase === "success" ? (
          <div className="flex items-start gap-3 rounded-xl border border-success/20 bg-success-soft p-4" role="status">
            <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {isVersionUpload ? "新版本上传成功" : "项目资料上传成功"}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {replayed
                  ? "这是同一上传请求的安全重放，系统没有创建重复文件或版本。"
                  : "文件元数据和对象已保存，刷新页面后仍可查看。"}
              </p>
            </div>
          </div>
        ) : null}

        {error ? (
          <div ref={errorRef} className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive-soft p-3 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <p className="rounded-lg border border-info/15 bg-info-soft px-3 py-2.5 text-xs leading-5 text-info">
          文件安全存储后会进入独立 Worker 的异步解析队列；只有当前有效且授权通过的 Chunk 才能参与检索。
        </p>
      </div>
    </Drawer>
  );
}
