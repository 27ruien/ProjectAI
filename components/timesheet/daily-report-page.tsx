"use client";

import {
  AlertTriangle,
  Bot,
  Check,
  Clipboard,
  CloudOff,
  Download,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Scissors,
  Send,
  Square,
  Trash2,
  Unplug,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ViewerContext } from "@/lib/auth/ui-types";
import {
  TIMESHEET_CATEGORIES,
  TIMESHEET_STATUSES,
  TIMESHEET_SYNC_PROTOCOL_VERSION,
} from "@/lib/timesheets/contracts";
import {
  TimesheetApiError,
  timesheetMutation,
  timesheetRequest,
} from "@/lib/timesheets/client";

type WorkLog = {
  id: string;
  recordDate: string;
  recordedAt: string;
  rawText: string;
  source: string;
  projectId: string | null;
  projectHint: string | null;
  hoursHint: number | null;
  statusHint: string | null;
  includedInDraft: boolean;
  consumptionStatus: "unprocessed" | "included" | "submitted";
};

type Confidence = {
  description: number;
  project: number;
  hours: number;
  overtimeHours?: number;
  category: number;
  status: number;
  urgency?: number;
  progress?: number;
};

type DraftTask = {
  id?: string;
  description: string;
  projectId: string | null;
  projectName?: string;
  hours: number | null;
  regularHours: number | null;
  overtimeHours: number | null;
  categoryId: string | null;
  categoryName?: string;
  workStatus: string | null;
  workStatusName?: string;
  urgency: string | null;
  progress: number | null;
  confidence: Confidence;
  needsReview: boolean;
  reviewFields: Array<
    | "description"
    | "project"
    | "hours"
    | "overtimeHours"
    | "category"
    | "status"
    | "urgency"
    | "progress"
  >;
  sourceRecordIds: string[];
  sortOrder?: number;
  submissionStatus: "draft" | "confirmed" | "syncing" | "submitted" | "failed" | "unknown" | "cancelled";
  submittedAt: string | null;
  externalReference: string | null;
  externalUrl: string | null;
  savedAt: string | null;
};

type Draft = {
  id: string;
  reportDate: string;
  status: string;
  version: number;
  totalHours: number;
  warnings: string[];
  unresolvedRecordIds: string[];
  confirmedAt: string | null;
  updatedAt: string;
  aiProvider: string | null;
  aiModel: string | null;
  tasks: DraftTask[];
  submittedTasks: DraftTask[];
  summary: {
    pendingCount: number;
    submittedCount: number;
    pendingHours: number;
    submittedHours: number;
    cumulativeHours: number;
  };
};

type SyncItem = {
  taskId: string;
  idempotencyKey: string;
  status: string;
  attemptCount: number;
  externalReference: string | null;
  externalUrl: string | null;
  verified: boolean;
  savedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type SyncBatch = {
  syncBatchId: string;
  requestId: string;
  draftId: string;
  status: string;
  dryRun: boolean;
  createdAt: string;
  items: SyncItem[];
};

type ExtensionMessage = {
  source?: unknown;
  type?: unknown;
  version?: unknown;
  request_id?: unknown;
  sync_batch_id?: unknown;
  timestamp?: unknown;
  status?: unknown;
  extension_version?: unknown;
  items?: unknown;
};

type ConfirmationState =
  | "idle"
  | "validating"
  | "submitting"
  | "success"
  | "validation_error"
  | "conflict_error"
  | "server_error";

type WorkLogState = "idle" | "submitting" | "success" | "error";

type TaskField =
  | "description"
  | "project"
  | "regularHours"
  | "overtimeHours"
  | "category"
  | "status";

type ConfirmationIssue = {
  taskIndex: number;
  field: TaskField;
  message: string;
};

function validHours(value: number | null): value is number {
  return (
    value !== null &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 24 &&
    Number.isInteger(value * 4)
  );
}

function confirmationIssues(tasks: DraftTask[]): ConfirmationIssue[] {
  return tasks.flatMap((task, taskIndex) => {
    const issues: ConfirmationIssue[] = [];
    const taskLabel = `任务 ${taskIndex + 1}`;
    if (task.description.trim().length < 2) {
      issues.push({
        taskIndex,
        field: "description",
        message: `${taskLabel}：请填写至少 2 个字的任务详情`,
      });
    }
    if (!task.projectId) {
      issues.push({
        taskIndex,
        field: "project",
        message: `${taskLabel}：请选择项目`,
      });
    }
    if (!validHours(task.regularHours)) {
      issues.push({
        taskIndex,
        field: "regularHours",
        message: `${taskLabel}：请填写 0–24 小时、以 0.25 为步长的正常工时`,
      });
    }
    if (!validHours(task.overtimeHours)) {
      issues.push({
        taskIndex,
        field: "overtimeHours",
        message: `${taskLabel}：请填写 0–24 小时、以 0.25 为步长的加班工时；没有加班请填 0`,
      });
    }
    if (
      validHours(task.regularHours) &&
      validHours(task.overtimeHours) &&
      task.regularHours + task.overtimeHours > 24
    ) {
      issues.push({
        taskIndex,
        field: "overtimeHours",
        message: `${taskLabel}：正常与加班工时合计不能超过 24 小时`,
      });
    }
    if (!task.categoryId) {
      issues.push({
        taskIndex,
        field: "category",
        message: `${taskLabel}：请选择分类`,
      });
    }
    if (!task.workStatus) {
      issues.push({
        taskIndex,
        field: "status",
        message: `${taskLabel}：请选择状态`,
      });
    }
    return issues;
  });
}

function confirmationServerMessage(error: unknown): string {
  if (!(error instanceof TimesheetApiError)) {
    return error instanceof Error ? error.message : "确认失败，请稍后重试";
  }
  if (error.status === 401) return "登录已失效，请重新登录后再确认";
  if (error.status === 403 || error.status === 404) {
    return "你没有权限确认这份日报，或日报已不可访问";
  }
  if (error.status === 409) return "日报已被其他请求修改，请刷新后重试";
  if (error.status === 422) return error.message || "请检查日报必填字段";
  if (error.status >= 500) return "服务暂时不可用，日报尚未确认，请稍后重试";
  return error.message;
}

function todayInShanghai(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function localDateTimeInShanghai(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}T${value.hour}:${value.minute}`;
}

function requestQuery(organizationId: string, reportDate?: string): string {
  const query = new URLSearchParams({ organizationId });
  if (reportDate) query.set("date", reportDate);
  return query.toString();
}

function confidenceLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function DailyReportPage({
  viewer,
  wecomSyncEnabled,
  aiMode,
  aiProvider,
  aiProviderConfigured,
  aiModelProfileId,
  syncProvider,
}: {
  viewer: ViewerContext;
  wecomSyncEnabled: boolean;
  aiMode: "mock" | "real";
  aiProvider: "fake" | "qwen";
  aiProviderConfigured: boolean;
  aiModelProfileId: string;
  syncProvider: "mock_smartsheet" | "wecom_extension";
}) {
  const reportDate = todayInShanghai();
  const organizations = useMemo(
    () => [...new Set(viewer.projects.map((project) => project.organizationId))],
    [viewer.projects],
  );
  const [organizationId, setOrganizationId] = useState(organizations[0] ?? "");
  const projects = useMemo(
    () => viewer.projects.filter((project) => project.organizationId === organizationId),
    [organizationId, viewer.projects],
  );
  const [records, setRecords] = useState<WorkLog[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tasks, setTasks] = useState<DraftTask[]>([]);
  const [batches, setBatches] = useState<SyncBatch[]>([]);
  const [rawText, setRawText] = useState("");
  const [projectId, setProjectId] = useState("");
  const [recordedAt, setRecordedAt] = useState(localDateTimeInShanghai());
  const [editingRecord, setEditingRecord] = useState<WorkLog | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [dryRun, setDryRun] = useState(true);
  const [phase, setPhase] = useState<"loading" | "ready" | "working" | "error">(
    "loading",
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"info" | "success" | "error">("info");
  const [workLogState, setWorkLogState] = useState<WorkLogState>("idle");
  const [confirmationState, setConfirmationState] =
    useState<ConfirmationState>("idle");
  const [confirmationErrors, setConfirmationErrors] = useState<ConfirmationIssue[]>([]);
  const [dirty, setDirty] = useState(false);
  const [extension, setExtension] = useState<{
    connected: boolean;
    version: string | null;
  }>({ connected: false, version: null });
  const [activeBatch, setActiveBatch] = useState<SyncBatch | null>(null);
  const statusWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const confirmationInFlight = useRef(false);

  const load = useCallback(async () => {
    if (!organizationId) {
      setPhase("ready");
      return;
    }
    setPhase("loading");
    try {
      const query = requestQuery(organizationId, reportDate);
      const [recordPayload, draftPayload, syncPayload] = await Promise.all([
        timesheetRequest<{ records: WorkLog[] }>(`/api/timesheets/work-logs?${query}`),
        timesheetRequest<{ draft: Draft | null }>(`/api/timesheets/drafts?${query}`),
        wecomSyncEnabled
          ? timesheetRequest<{ batches: SyncBatch[] }>(
              `/api/timesheets/sync-batches?${requestQuery(organizationId)}`,
            )
          : Promise.resolve({ batches: [] as SyncBatch[] }),
      ]);
      setRecords(recordPayload.records);
      setDraft(draftPayload.draft);
      setTasks(draftPayload.draft?.tasks ?? []);
      setBatches(syncPayload.batches);
      setActiveBatch(
        syncPayload.batches.find((batch) =>
          [
            "pending",
            "validating",
            "waiting_for_board",
            "waiting_for_login",
            "running",
            "paused",
          ].includes(batch.status),
        ) ?? null,
      );
      setDirty(false);
      setConfirmationErrors([]);
      setConfirmationState(
        draftPayload.draft?.status === "confirmed" &&
          (draftPayload.draft?.tasks.length ?? 0) > 0
          ? "success"
          : "idle",
      );
      setPhase("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "工作日报加载失败");
      setNoticeTone("error");
      setPhase("error");
    }
  }, [organizationId, reportDate, wecomSyncEnabled]);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!wecomSyncEnabled || syncProvider !== "wecom_extension") return;
    const receive = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return;
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data as ExtensionMessage;
      if (
        message.source !== "project-ai-extension" ||
        message.version !== TIMESHEET_SYNC_PROTOCOL_VERSION ||
        typeof message.type !== "string"
      ) {
        return;
      }
      if (message.type === "PROJECT_AI_EXTENSION_READY") {
        setExtension({
          connected: true,
          version:
            typeof message.extension_version === "string"
              ? message.extension_version
              : null,
        });
        return;
      }
      if (
        typeof message.request_id !== "string" ||
        typeof message.sync_batch_id !== "string" ||
        typeof message.timestamp !== "string" ||
        typeof message.status !== "string"
      ) {
        return;
      }
      const typeToStatus: Record<string, string> = {
        PROJECT_AI_SYNC_ACCEPTED: "validating",
        PROJECT_AI_SYNC_PROGRESS: message.status,
        PROJECT_AI_SYNC_COMPLETED:
          message.status === "partially_synced" ? "partially_synced" : "synced",
        PROJECT_AI_SYNC_FAILED: "failed",
        PROJECT_AI_SYNC_CANCELLED: "cancelled",
      };
      const status = typeToStatus[message.type];
      if (!status) return;
      const syncBatchId = message.sync_batch_id;
      const items = Array.isArray(message.items) ? message.items : [];
      statusWriteQueue.current = statusWriteQueue.current
        .then(async () => {
          const { batch } = await timesheetMutation<{ batch: SyncBatch }>(
            `/api/timesheets/sync-batches/${encodeURIComponent(syncBatchId)}`,
            "PATCH",
            { organizationId, status, items },
          );
          setActiveBatch(batch);
          if (["synced", "failed", "cancelled", "partially_synced"].includes(batch.status)) {
            setNotice(`同步批次状态：${batch.status}`);
            setNoticeTone(batch.status === "synced" ? "success" : "error");
            await load();
          }
        })
        .catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : "同步状态保存失败");
          setNoticeTone("error");
        });
    };
    window.addEventListener("message", receive);
    window.postMessage(
      {
        source: "project-ai",
        type: "PROJECT_AI_EXTENSION_PING",
        version: TIMESHEET_SYNC_PROTOCOL_VERSION,
      },
      window.location.origin,
    );
    return () => window.removeEventListener("message", receive);
  }, [load, organizationId, syncProvider, wecomSyncEnabled]);

  const run = async (operation: () => Promise<void>, success?: string) => {
    setPhase("working");
    setNotice(null);
    try {
      await operation();
      if (success) {
        setNotice(success);
        setNoticeTone("success");
      }
      setPhase("ready");
      return true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
      setNoticeTone("error");
      setPhase("ready");
      return false;
    }
  };

  const addRecord = async () => {
    if (!rawText.trim() || !organizationId) return;
    setWorkLogState("submitting");
    const succeeded = await run(async () => {
      await timesheetMutation("/api/timesheets/work-logs", "POST", {
        organizationId,
        recordDate: reportDate,
        recordedAt: `${recordedAt}:00+08:00`,
        rawText: rawText.trim(),
        source: "manual",
        projectId: projectId || null,
      });
      setRawText("");
      setRecordedAt(localDateTimeInShanghai());
      await load();
    }, "随记已保存");
    setWorkLogState(succeeded ? "success" : "error");
  };

  const saveRecord = async () => {
    if (!editingRecord) return;
    setWorkLogState("submitting");
    const succeeded = await run(async () => {
      await timesheetMutation(
        `/api/timesheets/work-logs/${encodeURIComponent(editingRecord.id)}`,
        "PATCH",
        {
          organizationId,
          changes: {
            rawText: editingRecord.rawText,
            projectId: editingRecord.projectId,
            recordedAt: editingRecord.recordedAt,
          },
        },
      );
      setEditingRecord(null);
      await load();
    }, "随记已更新；已有确认将自动失效");
    setWorkLogState(succeeded ? "success" : "error");
  };

  const removeRecord = async (record: WorkLog) => {
    if (!window.confirm("确认删除这条随记？关联草稿将回到待审核状态。")) return;
    setWorkLogState("submitting");
    const succeeded = await run(async () => {
      await timesheetMutation(
        `/api/timesheets/work-logs/${encodeURIComponent(record.id)}?${requestQuery(organizationId)}`,
        "DELETE",
      );
      await load();
    }, "随记已删除");
    setWorkLogState(succeeded ? "success" : "error");
  };

  const generate = async () => {
    if (!aiProviderConfigured) {
      setNotice("真实 AI Provider 尚未配置；随记功能仍可使用，也可显式切换到 Mock 测试模式。");
      setNoticeTone("error");
      return;
    }
    if (records.length === 0) {
      setNotice("请先添加至少一条今日随记；系统不会调用模型生成空日报。");
      setNoticeTone("info");
      return;
    }
    await run(async () => {
      const payload = await timesheetMutation<{ draft: Draft }>(
        "/api/timesheets/drafts/generate",
        "POST",
        { organizationId, reportDate, timezone: "Asia/Shanghai" },
      );
      setDraft(payload.draft);
      setTasks(payload.draft.tasks);
      setDirty(false);
      await load();
    }, `AI 工时草稿已生成（${aiMode === "real" ? "真实 AI" : "Mock AI"}），请整批核对后确认`);
  };

  const changeTask = (index: number, changes: Partial<DraftTask>) => {
    setTasks((current) =>
      current.map((task, taskIndex) =>
        taskIndex === index ? { ...task, ...changes } : task,
      ),
    );
    setDirty(true);
    setConfirmationState("idle");
    setConfirmationErrors((current) =>
      current.filter((issue) => issue.taskIndex !== index),
    );
  };

  const saveDraft = async (): Promise<Draft | null> => {
    if (!draft) return null;
    const payload = await timesheetMutation<{ draft: Draft }>(
      `/api/timesheets/drafts/${encodeURIComponent(draft.id)}`,
      "PATCH",
      {
        organizationId,
        expectedVersion: draft.version,
        tasks: tasks.map((task) => ({
          id: task.id,
          description: task.description,
          projectId: task.projectId,
          regularHours: task.regularHours,
          overtimeHours: task.overtimeHours,
          categoryId: task.categoryId,
          workStatus: task.workStatus,
          urgency: task.urgency,
          progress: task.progress,
          confidence: task.confidence,
          needsReview: task.needsReview,
          reviewFields: task.reviewFields,
          sourceRecordIds: task.sourceRecordIds,
        })),
      },
    );
    setDraft(payload.draft);
    setTasks(payload.draft.tasks);
    setDirty(false);
    return payload.draft;
  };

  const confirmDraft = async () => {
    if (!draft || confirmationInFlight.current) return;
    setConfirmationState("validating");
    const issues = confirmationIssues(tasks);
    if (issues.length > 0) {
      setConfirmationErrors(issues);
      setConfirmationState("validation_error");
      setNotice("请修正下方必填字段后再确认本次工时");
      setNoticeTone("error");
      window.requestAnimationFrame(() => {
        const first = issues[0];
        const target = document.querySelector<HTMLElement>(
          `[data-task-index="${first.taskIndex}"][data-task-field="${first.field}"]`,
        );
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      });
      return;
    }
    confirmationInFlight.current = true;
    setConfirmationErrors([]);
    setConfirmationState("submitting");
    setNotice(null);
    try {
      const saved = dirty ? await saveDraft() : draft;
      if (!saved) throw new Error("日报草稿不存在");
      const payload = await timesheetMutation<{ draft: Draft }>(
        `/api/timesheets/drafts/${encodeURIComponent(saved.id)}/confirm`,
        "POST",
        { organizationId, expectedVersion: saved.version },
      );
      setDraft(payload.draft);
      setTasks(payload.draft.tasks);
      setDirty(false);
      setConfirmationState("success");
      setNotice("本次工时已整批确认；确认不会自动发起同步");
      setNoticeTone("success");
    } catch (error) {
      const state =
        error instanceof TimesheetApiError && error.status === 422
          ? "validation_error"
          : error instanceof TimesheetApiError && error.status === 409
            ? "conflict_error"
            : "server_error";
      setConfirmationState(state);
      setNotice(confirmationServerMessage(error));
      setNoticeTone("error");
    } finally {
      confirmationInFlight.current = false;
    }
  };

  const splitTask = (index: number) => {
    const task = tasks[index];
    const firstHours = task.regularHours === null
      ? null
      : task.regularHours < 0.5
        ? task.regularHours
        : Math.max(0.25, Math.floor(task.regularHours * 2) / 4);
    const secondHours = task.regularHours === null || firstHours === null
      ? null
      : task.regularHours - firstHours;
    const firstOvertime = task.overtimeHours
      ? Math.max(0.25, Math.floor(task.overtimeHours * 2) / 4)
      : task.overtimeHours;
    const secondOvertime =
      task.overtimeHours && firstOvertime ? task.overtimeHours - firstOvertime : task.overtimeHours;
    const first = {
      ...task,
      id: undefined,
      description: `${task.description}（拆分 1）`,
      hours: firstHours,
      regularHours: firstHours,
      overtimeHours: firstOvertime,
      needsReview: true,
      reviewFields: ["description", "hours"] as DraftTask["reviewFields"],
    };
    const second = {
      ...task,
      id: undefined,
      description: `${task.description}（拆分 2）`,
      hours: secondHours,
      regularHours: secondHours,
      overtimeHours:
        secondOvertime !== null && secondOvertime >= 0 ? secondOvertime : null,
      needsReview: true,
      reviewFields: ["description", "hours"] as DraftTask["reviewFields"],
    };
    setTasks((current) => [
      ...current.slice(0, index),
      first,
      second,
      ...current.slice(index + 1),
    ]);
    setDirty(true);
  };

  const mergeTasks = () => {
    const selected = tasks.filter((task) => task.id && selectedTaskIds.includes(task.id));
    if (selected.length < 2) {
      setNotice("请至少选择两条任务进行合并");
      setNoticeTone("error");
      return;
    }
    const [first] = selected;
    if (
      selected.some(
        (task) =>
          task.projectId !== first.projectId ||
          task.categoryId !== first.categoryId ||
          task.workStatus !== first.workStatus,
      )
    ) {
      setNotice("只有项目、分类和状态完全一致的任务可以合并");
      setNoticeTone("error");
      return;
    }
    const merged: DraftTask = {
      ...first,
      id: undefined,
      description: selected.map((task) => task.description).join("；"),
      hours: selected.every((task) => task.regularHours !== null)
        ? selected.reduce((sum, task) => sum + (task.regularHours ?? 0), 0)
        : null,
      regularHours: selected.every((task) => task.regularHours !== null)
        ? selected.reduce((sum, task) => sum + (task.regularHours ?? 0), 0)
        : null,
      overtimeHours: selected.every((task) => task.overtimeHours !== null)
        ? selected.reduce((sum, task) => sum + (task.overtimeHours ?? 0), 0)
        : null,
      sourceRecordIds: [...new Set(selected.flatMap((task) => task.sourceRecordIds))],
      needsReview: true,
      reviewFields: ["description", "hours"],
    };
    setTasks((current) => [
      ...current.filter((task) => !task.id || !selectedTaskIds.includes(task.id)),
      merged,
    ]);
    setSelectedTaskIds([]);
    setDirty(true);
  };

  const copyJson = async () => {
    if (!draft?.confirmedAt || dirty) return;
    await run(async () => {
      const payload = await timesheetRequest<Draft>(
        `/api/timesheets/drafts/${encodeURIComponent(draft.id)}/export?${requestQuery(organizationId)}`,
      );
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    }, "已从服务端重新校验并复制确认版 JSON");
  };

  const downloadJson = async () => {
    if (!draft?.confirmedAt || dirty) return;
    await run(async () => {
      const payload = await timesheetRequest<Draft>(
        `/api/timesheets/drafts/${encodeURIComponent(draft.id)}/export?${requestQuery(organizationId)}`,
      );
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(payload, null, 2)], {
          type: "application/json",
        }),
      );
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `projectai-timesheet-${draft.reportDate}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    }, "已从服务端重新校验并下载确认版 JSON");
  };

  const downloadSyncResult = () => {
    const batch = activeBatch ?? batches[0];
    if (!batch) return;
    const result = {
      version: TIMESHEET_SYNC_PROTOCOL_VERSION,
      sync_batch_id: batch.syncBatchId,
      status: batch.status,
      dry_run: batch.dryRun,
      created_at: batch.createdAt,
      items: batch.items.map((item) => ({
        task_id: item.taskId,
        status: item.status,
        attempt_count: item.attemptCount,
        error_code: item.errorCode,
        error_message: item.errorMessage,
      })),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(result, null, 2)], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `projectai-wecom-sync-${batch.syncBatchId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const openWecomBoard = () => {
    if (
      !wecomSyncEnabled ||
      syncProvider !== "wecom_extension" ||
      !extension.connected
    ) return;
    window.postMessage(
      {
        source: "project-ai",
        type: "PROJECT_AI_OPEN_WECOM_BOARD",
        version: TIMESHEET_SYNC_PROTOCOL_VERSION,
      },
      window.location.origin,
    );
    setNotice("已请求扩展打开已配置的企业微信任务看板");
    setNoticeTone("info");
  };

  const startSync = async () => {
    if (
      !wecomSyncEnabled ||
      !draft?.confirmedAt ||
      dirty ||
      (syncProvider === "wecom_extension" && !extension.connected)
    ) return;
    await run(async () => {
      const response = await timesheetMutation<{
        batch: SyncBatch;
        payload: Record<string, unknown> & { request_id: string; sync_batch_id: string };
      }>("/api/timesheets/sync-batches", "POST", {
        organizationId,
        draftId: draft.id,
        expectedVersion: draft.version,
        requestId: crypto.randomUUID(),
        dryRun,
      });
      setActiveBatch(response.batch);
      if (syncProvider === "mock_smartsheet") {
        const completed = await timesheetMutation<{ batch: SyncBatch }>(
          `/api/timesheets/sync-batches/${encodeURIComponent(response.batch.syncBatchId)}/execute-mock`,
          "POST",
          { organizationId },
        );
        setActiveBatch(null);
        setNotice(`Mock SmartSheet 批次已完成：${completed.batch.status}`);
        setNoticeTone(completed.batch.status === "synced" ? "success" : "error");
        await load();
      } else {
        window.postMessage(
          {
            source: "project-ai",
            type: "PROJECT_AI_SYNC_TIMESHEET",
            version: TIMESHEET_SYNC_PROTOCOL_VERSION,
            requestId: response.payload.request_id,
            payload: response.payload,
          },
          window.location.origin,
        );
      }
    }, syncProvider === "mock_smartsheet"
      ? undefined
      : dryRun
        ? "Dry Run 批次已发送到扩展"
        : "同步批次已发送到扩展");
  };

  const controlSync = (action: "pause" | "resume" | "cancel") => {
    if (!wecomSyncEnabled || !activeBatch || syncProvider !== "wecom_extension") return;
    window.postMessage(
      {
        source: "project-ai",
        type: "PROJECT_AI_SYNC_CONTROL",
        version: TIMESHEET_SYNC_PROTOCOL_VERSION,
        requestId: activeBatch.requestId,
        syncBatchId: activeBatch.syncBatchId,
        action,
      },
      window.location.origin,
    );
  };

  const reconcileUnknown = async (
    batch: SyncBatch,
    taskId: string,
    resolution: "saved" | "failed",
  ) => {
    if (syncProvider !== "mock_smartsheet") return;
    await run(async () => {
      const items = batch.items.map((item) => {
        if (item.taskId !== taskId) {
          return {
            taskId: item.taskId,
            status: item.status,
            attemptCount: item.attemptCount,
            externalReference: item.externalReference,
            externalUrl: item.externalUrl,
            verified: item.verified,
            errorCode: item.errorCode,
            errorMessage: item.errorMessage,
          };
        }
        return resolution === "saved"
          ? {
              taskId,
              status: "saved",
              attemptCount: item.attemptCount,
              externalReference: "manual-reconciliation",
              externalUrl: null,
              verified: true,
              errorCode: null,
              errorMessage: null,
            }
          : {
              taskId,
              status: "failed",
              attemptCount: item.attemptCount,
              externalReference: null,
              externalUrl: null,
              verified: false,
              errorCode: "MANUAL_RECONCILIATION_NOT_SAVED",
              errorMessage: "用户人工核对后确认未保存",
            };
      });
      const statuses = items.map((item) => item.status);
      const status = statuses.every((value) => value === "saved")
        ? "synced"
        : statuses.every((value) => value === "failed")
          ? "failed"
          : statuses.every((value) => value === "cancelled")
            ? "cancelled"
            : "partially_synced";
      await timesheetMutation(
        `/api/timesheets/sync-batches/${encodeURIComponent(batch.syncBatchId)}`,
        "PATCH",
        { organizationId, status, items },
      );
      await load();
    }, resolution === "saved" ? "未知项已人工核对为已保存" : "未知项已人工核对为未保存");
  };

  const totalHours = tasks.reduce(
    (sum, task) => sum + (task.regularHours ?? 0) + (task.overtimeHours ?? 0),
    0,
  );
  const hasFailedTasks = tasks.some((task) => task.submissionStatus === "failed");
  const hasUnknownTasks = tasks.some((task) => task.submissionStatus === "unknown");
  const currentSyncItem = activeBatch?.items.find((item) =>
    ["validating", "waiting_for_login", "running", "unknown"].includes(
      item.status,
    ),
  );
  const currentSyncTask = currentSyncItem
    ? tasks.find((task) => task.id === currentSyncItem.taskId)
    : null;
  const effectiveDraftStatus =
    dirty && draft?.status === "confirmed" ? "needs_review" : draft?.status;
  const taskError = (taskIndex: number, field: TaskField) =>
    confirmationErrors.find(
      (issue) => issue.taskIndex === taskIndex && issue.field === field,
    );

  if (!organizationId) {
    return (
      <div className="rounded-xl border border-warning/25 bg-warning-soft p-6 text-sm text-warning">
        当前账号没有可用于日报的已授权项目组织。
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="daily-report-page" aria-busy={phase === "loading"}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Bot className="size-3.5" /> 随手记录 → AI 草稿 → 整批确认 → 独立同步
          </p>
          <h1 className="mt-1 text-2xl font-semibold">工作日报</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {reportDate} · 确认只锁定本批工时，不会自动同步或点击企业微信最终提交。
          </p>
        </div>
        {organizations.length > 1 ? (
          <select
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
            className="h-9 rounded-lg border border-input bg-card px-3 text-xs"
            aria-label="日报组织"
          >
            {organizations.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        ) : null}
      </header>

      {notice ? (
        <div
          role={noticeTone === "error" ? "alert" : "status"}
          className={`rounded-lg border px-4 py-3 text-sm ${
            noticeTone === "error"
              ? "border-danger/20 bg-danger-soft text-danger"
              : noticeTone === "success"
                ? "border-success/20 bg-success-soft text-success"
                : "border-info/20 bg-info-soft text-info"
          }`}
        >
          {notice}
        </div>
      ) : null}

      {phase === "loading" ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground" aria-live="polite">
          <LoaderCircle className="size-4 animate-spin" />正在加载今日日报…
        </div>
      ) : null}

      <section className="rounded-xl border-2 border-primary/25 bg-card shadow-sm" data-testid="work-log-section">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold">今日随记</h2>
          <p className="mt-1 text-xs text-muted-foreground">从这里创建今天的第一条记录；只记录事实即可，正式字段可以稍后审核。</p>
        </div>
        <div className="grid gap-3 p-5 lg:grid-cols-[1fr_220px_190px_auto]">
          <label>
            <span className="mb-1 block text-xs font-medium">随记内容（必填）</span>
            <textarea
              disabled={workLogState === "submitting"}
              value={rawText}
              onChange={(event) => {
                setRawText(event.target.value);
                if (workLogState !== "submitting") setWorkLogState("idle");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void addRecord();
                }
              }}
              rows={2}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              placeholder="例如：完成虚构验收准备，1 小时，已完成"
            />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium">项目（可选）</span>
            <select
              disabled={workLogState === "submitting"}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-xs"
            >
              <option value="">暂不选择项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium">记录时间（必填）</span>
            <input
              disabled={workLogState === "submitting"}
              type="datetime-local"
              value={recordedAt}
              onChange={(event) => setRecordedAt(event.target.value)}
              className="h-10 w-full rounded-lg border border-input bg-background px-3 text-xs"
            />
          </label>
          <button
            disabled={!rawText.trim() || workLogState === "submitting"}
            onClick={() => void addRecord()}
            className="mt-5 inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            {workLogState === "submitting" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            {workLogState === "submitting" ? "保存中…" : "保存随记"}
          </button>
        </div>
        <p className="border-t border-border px-5 py-2 text-xs text-muted-foreground" data-testid="work-log-state" data-state={workLogState} aria-live="polite">
          {workLogState === "idle" ? "填写后保存，记录会立即出现在下方列表。" : null}
          {workLogState === "submitting" ? "正在保存随记…" : null}
          {workLogState === "success" ? "随记操作成功，页面与数据库已同步。" : null}
          {workLogState === "error" ? "随记操作失败；输入内容已保留，请根据上方错误重试。" : null}
        </p>
        <div className="divide-y divide-border border-t border-border">
          {records.map((record) => (
            <article key={record.id} className="flex flex-wrap items-start gap-3 px-5 py-4">
              {editingRecord?.id === record.id ? (
                <div className="grid flex-1 gap-2 md:grid-cols-[1fr_220px_auto]">
                  <textarea
                    value={editingRecord.rawText}
                    onChange={(event) => setEditingRecord({ ...editingRecord, rawText: event.target.value })}
                    className="rounded-lg border border-input px-3 py-2 text-xs"
                  />
                  <select
                    value={editingRecord.projectId ?? ""}
                    onChange={(event) => setEditingRecord({ ...editingRecord, projectId: event.target.value || null })}
                    className="h-9 rounded-lg border border-input px-3 text-xs"
                  >
                    <option value="">待匹配</option>
                    {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                  </select>
                  <button onClick={() => void saveRecord()} className="inline-flex h-9 items-center gap-1 rounded-lg bg-primary px-3 text-xs text-white"><Save className="size-3.5" />保存</button>
                </div>
              ) : (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                      <span>{new Date(record.recordedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                      <span>{record.source}</span>
                      <span>{projects.find((project) => project.id === record.projectId)?.name ?? "待匹配项目"}</span>
                      <span className={`rounded-full px-2 py-0.5 ${
                        record.consumptionStatus === "submitted"
                          ? "bg-muted text-muted-foreground"
                          : record.consumptionStatus === "included"
                            ? "bg-success-soft text-success"
                            : "bg-info-soft text-info"
                      }`}>
                        {record.consumptionStatus === "submitted"
                          ? "已提交"
                          : record.consumptionStatus === "included"
                            ? "已纳入本次"
                            : "未整理"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm leading-6">{record.rawText}</p>
                  </div>
                  <button disabled={record.consumptionStatus === "submitted"} onClick={() => setEditingRecord(record)} className="rounded-lg border border-border px-3 py-1.5 text-xs disabled:opacity-40">编辑</button>
                  <button disabled={record.consumptionStatus === "submitted"} onClick={() => void removeRecord(record)} className="rounded-lg border border-danger/20 p-2 text-danger disabled:opacity-40" aria-label="删除随记"><Trash2 className="size-3.5" /></button>
                </>
              )}
            </article>
          ))}
          {!records.length ? <p className="p-8 text-center text-sm text-muted-foreground">今天还没有随记。请在上方输入事实记录并点击“保存随记”。</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">AI 整理今日工时</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${aiMode === "real" ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`} data-testid="ai-mode">
                {aiMode === "real"
                  ? aiProviderConfigured
                    ? "真实 AI 人工 UAT"
                    : "真实 AI 未配置"
                  : "Mock AI 流程测试"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              服务端 Provider：{aiProvider} · Profile：{aiModelProfileId}。只使用当前用户未提交的随记和已授权项目。
            </p>
            {aiMode === "mock" ? <p className="mt-1 text-xs text-warning">当前使用 Mock AI，仅用于功能测试，不代表真实 AI 输出质量。</p> : null}
            {aiMode === "real" && !aiProviderConfigured ? <p className="mt-1 text-xs text-danger">真实 AI Provider 尚未配置；日报随记仍可使用，AI 整理暂不可用。</p> : null}
          </div>
          <button
            disabled={!aiProviderConfigured || !records.some((record) => record.consumptionStatus !== "submitted") || phase === "working"}
            onClick={() => void generate()}
            data-testid="ai-generate"
            data-state={phase === "working" ? "submitting" : "idle"}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-medium text-white disabled:opacity-40"
          >
            {phase === "working" ? <LoaderCircle className="size-4 animate-spin" /> : <Bot className="size-4" />}
            AI 整理今日工时
          </button>
        </div>
        {!records.length ? (
          <p className="mt-3 text-xs text-warning" data-testid="ai-disabled-reason">请先添加至少一条今日随记，AI 整理才会启用。</p>
        ) : null}
      </section>

      {draft ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">本次待提交</h2>
              <p className="text-xs text-muted-foreground" data-testid="draft-status">Draft v{draft.version} · {effectiveDraftStatus} · {tasks.length} 条待处理</p>
              <p className="mt-1 text-[10px] text-muted-foreground">本次生成：{draft.aiProvider ?? "未记录"} / {draft.aiModel ?? "未记录"}；低置信度只提示，不增加逐条审核门禁。</p>
            </div>
            <button onClick={mergeTasks} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs"><RefreshCw className="size-3.5" />合并所选</button>
          </div>
          {draft.warnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning-soft px-4 py-3 text-xs text-warning"><AlertTriangle className="mt-0.5 size-3.5" />{warning}</div>
          ))}
          {tasks.map((task, index) => (
            <article key={task.id ?? `new-${index}`} className="rounded-xl border border-border bg-card p-5" data-task-status={task.submissionStatus}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    disabled={!task.id}
                    checked={Boolean(task.id && selectedTaskIds.includes(task.id))}
                    onChange={(event) => task.id && setSelectedTaskIds((current) => event.target.checked ? [...current, task.id!] : current.filter((id) => id !== task.id))}
                  />
                  任务 {index + 1} · {task.submissionStatus}
                </label>
                <div className="flex gap-2">
                  <button disabled={["syncing", "failed", "unknown"].includes(task.submissionStatus)} onClick={() => splitTask(index)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] disabled:opacity-40"><Scissors className="size-3" />拆分</button>
                  <button disabled={["syncing", "failed", "unknown"].includes(task.submissionStatus)} onClick={() => { setTasks((current) => current.filter((_, itemIndex) => itemIndex !== index)); setDirty(true); }} className="rounded-lg border border-danger/20 p-1.5 text-danger disabled:opacity-40" aria-label="删除任务"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-6">
                <label className="lg:col-span-2">
                  <span className="mb-1 block text-[10px] text-muted-foreground">任务详情（必填） · {confidenceLabel(task.confidence.description)}</span>
                  <textarea data-task-index={index} data-task-field="description" disabled={["syncing", "failed", "unknown"].includes(task.submissionStatus)} aria-invalid={Boolean(taskError(index, "description"))} aria-describedby={taskError(index, "description") ? `task-${index}-description-error` : undefined} value={task.description} onChange={(event) => changeTask(index, { description: event.target.value })} rows={2} className="w-full rounded-lg border border-input px-3 py-2 text-xs disabled:bg-muted" />
                  {taskError(index, "description") ? <span id={`task-${index}-description-error`} className="mt-1 block text-[10px] text-danger">{taskError(index, "description")?.message}</span> : null}
                </label>
                <label>
                  <span className="mb-1 block text-[10px] text-muted-foreground">项目（必填） · {confidenceLabel(task.confidence.project)}</span>
                  <select data-task-index={index} data-task-field="project" disabled={["syncing", "failed", "unknown"].includes(task.submissionStatus)} aria-invalid={Boolean(taskError(index, "project"))} value={task.projectId ?? ""} onChange={(event) => changeTask(index, { projectId: event.target.value || null })} className="h-10 w-full rounded-lg border border-input px-2 text-xs disabled:bg-muted"><option value="">待确认</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
                  {taskError(index, "project") ? <span className="mt-1 block text-[10px] text-danger">{taskError(index, "project")?.message}</span> : null}
                </label>
                <label>
                  <span className="mb-1 block text-[10px] text-muted-foreground">正常工时（必填） · {confidenceLabel(task.confidence.hours)}</span>
                  <input data-task-index={index} data-task-field="regularHours" disabled={["syncing", "failed", "unknown"].includes(task.submissionStatus)} aria-invalid={Boolean(taskError(index, "regularHours"))} type="number" min="0" max="24" step="0.25" value={task.regularHours ?? ""} onChange={(event) => { const value = event.target.value ? Number(event.target.value) : null; changeTask(index, { hours: value, regularHours: value }); }} className="h-10 w-full rounded-lg border border-input px-3 text-xs disabled:bg-muted" />
                  {taskError(index, "regularHours") ? <span className="mt-1 block text-[10px] text-danger">{taskError(index, "regularHours")?.message}</span> : null}
                </label>
                <label>
                  <span className="mb-1 block text-[10px] text-muted-foreground">加班工时（必填，无加班填 0） · {confidenceLabel(task.confidence.overtimeHours ?? 0)}</span>
                  <input data-task-index={index} data-task-field="overtimeHours" disabled={["syncing", "failed", "unknown"].includes(task.submissionStatus)} aria-invalid={Boolean(taskError(index, "overtimeHours"))} type="number" min="0" max="24" step="0.25" value={task.overtimeHours ?? ""} onChange={(event) => changeTask(index, { overtimeHours: event.target.value ? Number(event.target.value) : event.target.value === "0" ? 0 : null })} className="h-10 w-full rounded-lg border border-input px-3 text-xs disabled:bg-muted" />
                  {taskError(index, "overtimeHours") ? <span className="mt-1 block text-[10px] text-danger">{taskError(index, "overtimeHours")?.message}</span> : null}
                </label>
                <label>
                  <span className="mb-1 block text-[10px] text-muted-foreground">分类（必填） · {confidenceLabel(task.confidence.category)}</span>
                  <select data-task-index={index} data-task-field="category" disabled={["syncing", "failed", "unknown"].includes(task.submissionStatus)} aria-invalid={Boolean(taskError(index, "category"))} value={task.categoryId ?? ""} onChange={(event) => changeTask(index, { categoryId: event.target.value || null })} className="h-10 w-full rounded-lg border border-input px-2 text-xs disabled:bg-muted"><option value="">待确认</option>{TIMESHEET_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                  {taskError(index, "category") ? <span className="mt-1 block text-[10px] text-danger">{taskError(index, "category")?.message}</span> : null}
                </label>
                <label>
                  <span className="mb-1 block text-[10px] text-muted-foreground">状态（必填） · {confidenceLabel(task.confidence.status)}</span>
                  <select data-task-index={index} data-task-field="status" disabled={["syncing", "failed", "unknown"].includes(task.submissionStatus)} aria-invalid={Boolean(taskError(index, "status"))} value={task.workStatus ?? ""} onChange={(event) => changeTask(index, { workStatus: event.target.value || null })} className="h-10 w-full rounded-lg border border-input px-2 text-xs disabled:bg-muted"><option value="">待确认</option>{TIMESHEET_STATUSES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
                  {taskError(index, "status") ? <span className="mt-1 block text-[10px] text-danger">{taskError(index, "status")?.message}</span> : null}
                </label>
                <label>
                  <span className="mb-1 block text-[10px] text-muted-foreground">紧急重要度（可选）</span>
                  <input value={task.urgency ?? ""} disabled placeholder="可选，当前不设置" className="h-10 w-full rounded-lg border border-input bg-muted px-3 text-xs" />
                </label>
                <label>
                  <span className="mb-1 block text-[10px] text-muted-foreground">任务进度（可选） · {confidenceLabel(task.confidence.progress ?? 0)}</span>
                  <input disabled={["syncing", "failed", "unknown"].includes(task.submissionStatus)} type="number" min="0" max="100" step="1" value={task.progress ?? ""} onChange={(event) => changeTask(index, { progress: event.target.value ? Number(event.target.value) : event.target.value === "0" ? 0 : null })} className="h-10 w-full rounded-lg border border-input px-3 text-xs disabled:bg-muted" />
                </label>
                <div className="lg:col-span-6"><p className="text-[10px] text-muted-foreground">来源记录：{task.sourceRecordIds.map((id) => records.find((record) => record.id === id)?.rawText ?? id).join("；")}</p>{task.reviewFields.length ? <p className="mt-1 text-[10px] text-warning">低置信度提示（不阻塞整批确认）：{task.reviewFields.join("、")}</p> : null}</div>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {draft ? (
        <section className="rounded-xl border border-border bg-card p-5" data-testid="daily-summary">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">今日汇总</p>
              <p className="text-2xl font-semibold">待提交 {totalHours.toFixed(2)} h</p>
              <p className="mt-1 text-xs text-muted-foreground">已提交 {(draft.summary?.submittedHours ?? 0).toFixed(2)} h · 今日累计 {(draft.summary?.cumulativeHours ?? totalHours).toFixed(2)} h</p>
              {totalHours > 16 ? <p className="text-xs text-warning">总工时异常偏高，请人工确认；系统不会自动修正。</p> : null}
              <p className="mt-2 text-xs text-muted-foreground">必填：任务详情、项目、正常工时、加班工时、分类、状态；可选：紧急重要度、任务进度。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {draft.status === "confirmed" && !dirty && tasks.length > 0 ? <button onClick={() => { setDirty(true); setConfirmationState("idle"); setNotice("已进入本次工时修改状态；修改后需要重新整批确认"); setNoticeTone("info"); }} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs"><RefreshCw className="size-3.5" />修改本次工时</button> : null}
              <button disabled={!dirty || phase === "working"} onClick={() => void run(async () => { await saveDraft(); }, "本次草稿修改已保存，仍需整批确认")} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Save className="size-3.5" />保存修改</button>
              <button disabled={tasks.length === 0 || confirmationState === "validating" || confirmationState === "submitting" || phase === "loading" || phase === "working" || (draft.status === "confirmed" && !dirty) || tasks.some((task) => ["syncing", "failed", "unknown"].includes(task.submissionStatus))} onClick={() => void confirmDraft()} className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-2 text-xs font-medium text-white disabled:opacity-40">
                {confirmationState === "submitting" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                {confirmationState === "validating" ? "正在校验…" : confirmationState === "submitting" ? "正在确认…" : draft.status === "confirmed" && !dirty ? "本次工时已确认" : "确认本次工时"}
              </button>
              <button disabled={!draft.confirmedAt || dirty || phase === "working"} onClick={() => void copyJson()} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Clipboard className="size-3.5" />复制 JSON</button>
              <button disabled={!draft.confirmedAt || dirty || phase === "working"} onClick={() => void downloadJson()} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Download className="size-3.5" />下载 JSON</button>
            </div>
          </div>
          <div className={`mt-4 rounded-lg border px-3 py-2 text-xs ${
            confirmationState === "success"
              ? "border-success/20 bg-success-soft text-success"
              : confirmationState === "validation_error" || confirmationState === "conflict_error" || confirmationState === "server_error"
                ? "border-danger/20 bg-danger-soft text-danger"
                : "border-border bg-muted/30 text-muted-foreground"
          }`} data-testid="confirmation-state" data-state={confirmationState} aria-live="polite">
            {confirmationState === "idle" ? "确认状态：待操作" : null}
            {confirmationState === "validating" ? "确认状态：正在校验整批必填字段" : null}
            {confirmationState === "submitting" ? "确认状态：正在保存并提交，请勿重复点击" : null}
            {confirmationState === "success" ? "确认状态：本批工时已确认；尚未发起同步" : null}
            {confirmationState === "validation_error" ? "确认状态：整批字段校验未通过，本次工时尚未确认" : null}
            {confirmationState === "conflict_error" ? "确认状态：版本冲突，请刷新后重新核对" : null}
            {confirmationState === "server_error" ? "确认状态：服务端确认失败，日报尚未确认，可修正后重试" : null}
          </div>
          {confirmationErrors.length > 0 ? (
            <div className="mt-3 rounded-lg border border-danger/20 bg-danger-soft px-3 py-2 text-xs text-danger" role="alert" data-testid="confirmation-errors">
              <p className="font-medium">请先处理以下问题：</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {confirmationErrors.map((issue) => <li key={`${issue.taskIndex}-${issue.field}`}>{issue.message}</li>)}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {draft?.submittedTasks?.length ? (
        <section className="rounded-xl border border-border bg-card" data-testid="submitted-tasks">
          <div className="border-b border-border px-5 py-4">
            <h2 className="text-sm font-semibold">今日已提交</h2>
            <p className="mt-1 text-xs text-muted-foreground">只读历史；不会再次进入 AI 输入、活动草稿或后续同步批次。</p>
          </div>
          <div className="divide-y divide-border">
            {draft.submittedTasks.map((task) => (
              <article key={task.id} className="grid gap-2 px-5 py-4 text-xs md:grid-cols-[1fr_auto]">
                <div>
                  <p className="font-medium">{task.description}</p>
                  <p className="mt-1 text-muted-foreground">{task.projectName} · 正常 {task.regularHours ?? 0} h · 加班 {task.overtimeHours ?? 0} h · {task.categoryName} · {task.workStatusName}</p>
                  <p className="mt-1 text-muted-foreground">
                    {syncProvider === "mock_smartsheet"
                      ? "已提交至 Mock SmartSheet。该记录仅用于本地生命周期验收。"
                      : "已提交至腾讯文档。如需修改，请前往腾讯文档。"}
                  </p>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">外部引用：{task.externalReference ?? "已验证但无公开引用"}</p>
                </div>
                <div className="text-right text-[10px] text-muted-foreground">
                  <p>{task.submittedAt ? new Date(task.submittedAt).toLocaleString("zh-CN") : "提交时间未记录"}</p>
                  {task.externalUrl ? <a href={task.externalUrl} target="_blank" rel="noreferrer" className="text-primary underline">{syncProvider === "mock_smartsheet" ? "查看 Mock 记录" : "前往腾讯文档"}</a> : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">腾讯文档同步中心</h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {syncProvider === "mock_smartsheet"
                ? <><Check className="size-3 text-success" />Mock SmartSheet Provider（仅本地流程测试，不代表真实企业微信）</>
                : extension.connected
                  ? <><Check className="size-3 text-success" />企业微信扩展已连接 {extension.version ? `v${extension.version}` : ""}</>
                  : <><Unplug className="size-3" />企业微信扩展未安装或未连接</>}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />Dry Run（不点击单条保存）</label>
        </div>
        <div className="space-y-4 p-5">
          {!wecomSyncEnabled ? <div className="flex items-center gap-2 rounded-lg border border-warning/25 bg-warning-soft p-3 text-xs text-warning"><CloudOff className="size-4" />企业微信同步 Feature Flag 当前关闭。</div> : null}
          <div className="flex flex-wrap gap-2">
            <button disabled={!wecomSyncEnabled || phase === "working" || (syncProvider === "wecom_extension" && !extension.connected) || !draft?.confirmedAt || dirty || Boolean(activeBatch) || tasks.length === 0 || (hasUnknownTasks && !hasFailedTasks)} onClick={() => void startSync()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs text-white disabled:opacity-40">
              {phase === "working" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
              {phase === "working"
                ? "正在同步…"
                : tasks.length === 0 && draft?.status === "synced"
                  ? "本次工时已提交"
                  : hasFailedTasks
                    ? "重试失败项"
                    : "同步到腾讯文档"}
            </button>
            <button disabled={!wecomSyncEnabled || syncProvider !== "wecom_extension" || !extension.connected} onClick={openWecomBoard} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">打开企业微信任务看板</button>
            <button disabled={!wecomSyncEnabled || syncProvider !== "wecom_extension" || !activeBatch} onClick={() => controlSync("pause")} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Pause className="size-3.5" />暂停</button>
            <button disabled={!wecomSyncEnabled || syncProvider !== "wecom_extension" || !activeBatch} onClick={() => controlSync("resume")} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Play className="size-3.5" />恢复</button>
            <button disabled={!wecomSyncEnabled || syncProvider !== "wecom_extension" || !activeBatch} onClick={() => controlSync("cancel")} className="inline-flex items-center gap-1.5 rounded-lg border border-danger/20 px-3 py-2 text-xs text-danger disabled:opacity-40"><Square className="size-3.5" />取消</button>
            <button disabled={!wecomSyncEnabled || (!activeBatch && batches.length === 0)} onClick={downloadSyncResult} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Download className="size-3.5" />下载同步结果</button>
          </div>
          {activeBatch ? <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs"><p>批次 {activeBatch.syncBatchId} · {activeBatch.status} · {activeBatch.dryRun ? "Dry Run" : "实际逐条保存"}</p><p className="mt-1 text-muted-foreground">当前任务：{currentSyncTask?.description ?? currentSyncItem?.taskId ?? "等待调度"}</p><p className="mt-1 text-muted-foreground">总数 {activeBatch.items.length} / 成功 {activeBatch.items.filter((item) => item.status === "saved").length} / 失败 {activeBatch.items.filter((item) => item.status === "failed").length} / 未知 {activeBatch.items.filter((item) => item.status === "unknown").length}</p></div> : null}
          <div>
            <h3 className="text-xs font-semibold">同步历史</h3>
            <div className="mt-2 divide-y divide-border rounded-lg border border-border">
              {batches.map((batch) => <div key={batch.syncBatchId} className="px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center justify-between gap-2"><span>{new Date(batch.createdAt).toLocaleString("zh-CN")} · {batch.dryRun ? "Dry Run" : "保存"}</span><span className="font-mono text-[10px] text-muted-foreground">{batch.status} · {batch.items.filter((item) => item.status === "saved").length}/{batch.items.length}</span></div>
                {batch.items.some((item) => item.status === "unknown") ? <div className="mt-2 space-y-2 rounded-lg border border-warning/25 bg-warning-soft p-2 text-warning">
                  {batch.items.filter((item) => item.status === "unknown").map((item) => <div key={item.taskId} className="flex flex-wrap items-center justify-between gap-2">
                    <span>任务 {item.taskId} 保存结果未知，禁止自动重试</span>
                    {syncProvider === "mock_smartsheet" ? <span className="flex gap-2"><button onClick={() => void reconcileUnknown(batch, item.taskId, "saved")} className="rounded border border-warning/40 px-2 py-1">人工确认已保存</button><button onClick={() => void reconcileUnknown(batch, item.taskId, "failed")} className="rounded border border-warning/40 px-2 py-1">人工确认未保存</button></span> : <span>请在扩展弹窗中人工核对</span>}
                  </div>)}
                </div> : null}
              </div>)}
              {!batches.length ? <p className="p-4 text-center text-xs text-muted-foreground">暂无同步历史。</p> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
