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
import { timesheetMutation, timesheetRequest } from "@/lib/timesheets/client";

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
  tasks: DraftTask[];
};

type SyncItem = {
  taskId: string;
  idempotencyKey: string;
  status: string;
  attemptCount: number;
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
}: {
  viewer: ViewerContext;
  wecomSyncEnabled: boolean;
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
  const [dirty, setDirty] = useState(false);
  const [extension, setExtension] = useState<{
    connected: boolean;
    version: string | null;
  }>({ connected: false, version: null });
  const [activeBatch, setActiveBatch] = useState<SyncBatch | null>(null);
  const statusWriteQueue = useRef<Promise<void>>(Promise.resolve());

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
      setPhase("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "工作日报加载失败");
      setPhase("error");
    }
  }, [organizationId, reportDate, wecomSyncEnabled]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!wecomSyncEnabled) return;
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
        PROJECT_AI_SYNC_COMPLETED: "synced",
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
            await load();
          }
        })
        .catch((error: unknown) => {
          setNotice(error instanceof Error ? error.message : "同步状态保存失败");
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
  }, [load, organizationId, wecomSyncEnabled]);

  const run = async (operation: () => Promise<void>, success?: string) => {
    setPhase("working");
    setNotice(null);
    try {
      await operation();
      if (success) setNotice(success);
      setPhase("ready");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败");
      setPhase("ready");
    }
  };

  const addRecord = async () => {
    if (!rawText.trim() || !organizationId) return;
    await run(async () => {
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
  };

  const saveRecord = async () => {
    if (!editingRecord) return;
    await run(async () => {
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
  };

  const removeRecord = async (record: WorkLog) => {
    if (!window.confirm("确认删除这条随记？关联草稿将回到待审核状态。")) return;
    await run(async () => {
      await timesheetMutation(
        `/api/timesheets/work-logs/${encodeURIComponent(record.id)}?${requestQuery(organizationId)}`,
        "DELETE",
      );
      await load();
    }, "随记已删除");
  };

  const generate = async () => {
    if (records.length === 0) {
      setNotice("请先添加至少一条今日随记；系统不会调用模型生成空日报。");
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
    }, "AI 工时草稿已生成，请逐项审核后确认");
  };

  const changeTask = (index: number, changes: Partial<DraftTask>) => {
    setTasks((current) =>
      current.map((task, taskIndex) =>
        taskIndex === index ? { ...task, ...changes } : task,
      ),
    );
    setDirty(true);
  };

  const markReviewed = (index: number) => {
    const task = tasks[index];
    const complete = Boolean(
      task.description.trim() &&
        task.projectId &&
        task.regularHours !== null &&
        task.overtimeHours !== null &&
        task.categoryId &&
        task.workStatus,
    );
    if (!complete) {
      setNotice("项目、工时、分类和状态均填写后才能标记已审核");
      return;
    }
    if ((task.regularHours ?? 0) + (task.overtimeHours ?? 0) > 24) {
      setNotice("正常与加班工时合计不能超过 24 小时");
      return;
    }
    changeTask(index, { needsReview: false, reviewFields: [] });
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
    if (!draft) return;
    await run(async () => {
      const saved = dirty ? await saveDraft() : draft;
      if (!saved) return;
      const payload = await timesheetMutation<{ draft: Draft }>(
        `/api/timesheets/drafts/${encodeURIComponent(saved.id)}/confirm`,
        "POST",
        { organizationId, expectedVersion: saved.version },
      );
      setDraft(payload.draft);
      setTasks(payload.draft.tasks);
    }, "工时已由你人工确认，可以导出或创建同步批次");
  };

  const splitTask = (index: number) => {
    const task = tasks[index];
    const firstHours = task.regularHours
      ? Math.max(0.25, Math.floor(task.regularHours * 2) / 4)
      : null;
    const secondHours = task.regularHours && firstHours ? task.regularHours - firstHours : null;
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
      hours: secondHours && secondHours > 0 ? secondHours : null,
      regularHours: secondHours && secondHours > 0 ? secondHours : null,
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
    if (!wecomSyncEnabled || !extension.connected) return;
    window.postMessage(
      {
        source: "project-ai",
        type: "PROJECT_AI_OPEN_WECOM_BOARD",
        version: TIMESHEET_SYNC_PROTOCOL_VERSION,
      },
      window.location.origin,
    );
    setNotice("已请求扩展打开已配置的企业微信任务看板");
  };

  const startSync = async () => {
    if (!wecomSyncEnabled || !draft?.confirmedAt || dirty || !extension.connected) return;
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
    }, dryRun ? "Dry Run 批次已发送到扩展" : "同步批次已发送到扩展");
  };

  const controlSync = (action: "pause" | "resume" | "cancel") => {
    if (!wecomSyncEnabled || !activeBatch) return;
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

  const totalHours = tasks.reduce(
    (sum, task) => sum + (task.regularHours ?? 0) + (task.overtimeHours ?? 0),
    0,
  );
  const pendingReview = tasks.filter(
    (task) => task.needsReview || task.reviewFields.length > 0,
  ).length;
  const currentSyncItem = activeBatch?.items.find((item) =>
    ["validating", "waiting_for_login", "running", "unknown"].includes(
      item.status,
    ),
  );
  const currentSyncTask = currentSyncItem
    ? tasks.find((task) => task.id === currentSyncItem.taskId)
    : null;

  if (!organizationId) {
    return (
      <div className="rounded-xl border border-warning/25 bg-warning-soft p-6 text-sm text-warning">
        当前账号没有可用于日报的已授权项目组织。
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <Bot className="size-3.5" /> 随手记录 → AI 草稿 → 人工确认 → 扩展同步
          </p>
          <h1 className="mt-1 text-2xl font-semibold">工作日报</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {reportDate} · AI 不会自动确认工时，扩展不会点击企业微信最终提交。
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
        <div role="status" className="rounded-lg border border-info/20 bg-info-soft px-4 py-3 text-sm text-info">
          {notice}
        </div>
      ) : null}

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">今日随记</h2>
          <p className="mt-1 text-xs text-muted-foreground">只记录事实即可，正式字段可以稍后审核。</p>
        </div>
        <div className="grid gap-3 p-5 lg:grid-cols-[1fr_220px_190px_auto]">
          <textarea
            value={rawText}
            onChange={(event) => setRawText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void addRecord();
              }
            }}
            rows={2}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm"
            placeholder="例如：CHAGEE｜确认 EARN 跳转逻辑｜约 1 小时｜已确认"
          />
          <select
            value={projectId}
            onChange={(event) => setProjectId(event.target.value)}
            className="h-10 rounded-lg border border-input bg-background px-3 text-xs"
          >
            <option value="">暂不选择项目</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
          <input
            type="datetime-local"
            value={recordedAt}
            onChange={(event) => setRecordedAt(event.target.value)}
            className="h-10 rounded-lg border border-input bg-background px-3 text-xs"
          />
          <button
            disabled={!rawText.trim() || phase === "working"}
            onClick={() => void addRecord()}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-40"
          >
            <Plus className="size-3.5" /> 保存
          </button>
        </div>
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
                      {record.includedInDraft ? <span className="rounded-full bg-success-soft px-2 py-0.5 text-success">已纳入草稿</span> : null}
                    </div>
                    <p className="mt-1 text-sm leading-6">{record.rawText}</p>
                  </div>
                  <button onClick={() => setEditingRecord(record)} className="rounded-lg border border-border px-3 py-1.5 text-xs">编辑</button>
                  <button onClick={() => void removeRecord(record)} className="rounded-lg border border-danger/20 p-2 text-danger" aria-label="删除随记"><Trash2 className="size-3.5" /></button>
                </>
              )}
            </article>
          ))}
          {!records.length ? <p className="p-8 text-center text-sm text-muted-foreground">今天还没有随记。</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">AI 整理今日工时</h2>
            <p className="mt-1 text-xs text-muted-foreground">只使用当前组织、当前用户和已授权项目；会议来源当前为空数组。</p>
          </div>
          <button
            disabled={!records.length || phase === "working"}
            onClick={() => void generate()}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-xs font-medium text-white disabled:opacity-40"
          >
            {phase === "working" ? <LoaderCircle className="size-4 animate-spin" /> : <Bot className="size-4" />}
            AI 整理今日工时
          </button>
        </div>
      </section>

      {draft ? (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">工时审核</h2>
              <p className="text-xs text-muted-foreground">Draft v{draft.version} · {draft.status} · {pendingReview} 条待审核</p>
            </div>
            <button onClick={mergeTasks} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs"><RefreshCw className="size-3.5" />合并所选</button>
          </div>
          {draft.warnings.map((warning) => (
            <div key={warning} className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning-soft px-4 py-3 text-xs text-warning"><AlertTriangle className="mt-0.5 size-3.5" />{warning}</div>
          ))}
          {tasks.map((task, index) => (
            <article key={task.id ?? `new-${index}`} className="rounded-xl border border-border bg-card p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    disabled={!task.id}
                    checked={Boolean(task.id && selectedTaskIds.includes(task.id))}
                    onChange={(event) => task.id && setSelectedTaskIds((current) => event.target.checked ? [...current, task.id!] : current.filter((id) => id !== task.id))}
                  />
                  任务 {index + 1}
                </label>
                <div className="flex gap-2">
                  <button onClick={() => splitTask(index)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px]"><Scissors className="size-3" />拆分</button>
                  <button onClick={() => { setTasks((current) => current.filter((_, itemIndex) => itemIndex !== index)); setDirty(true); }} className="rounded-lg border border-danger/20 p-1.5 text-danger" aria-label="删除任务"><Trash2 className="size-3.5" /></button>
                </div>
              </div>
              <div className="grid gap-3 lg:grid-cols-6">
                <label className="lg:col-span-2"><span className="mb-1 block text-[10px] text-muted-foreground">任务详情 · {confidenceLabel(task.confidence.description)}</span><textarea value={task.description} onChange={(event) => changeTask(index, { description: event.target.value, needsReview: true })} rows={2} className="w-full rounded-lg border border-input px-3 py-2 text-xs" /></label>
                <label><span className="mb-1 block text-[10px] text-muted-foreground">项目 · {confidenceLabel(task.confidence.project)}</span><select value={task.projectId ?? ""} onChange={(event) => changeTask(index, { projectId: event.target.value || null, needsReview: true })} className="h-10 w-full rounded-lg border border-input px-2 text-xs"><option value="">待确认</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
                <label><span className="mb-1 block text-[10px] text-muted-foreground">正常工时 · {confidenceLabel(task.confidence.hours)}</span><input type="number" min="0" max="24" step="0.25" value={task.regularHours ?? ""} onChange={(event) => { const value = event.target.value ? Number(event.target.value) : null; changeTask(index, { hours: value, regularHours: value, needsReview: true }); }} className="h-10 w-full rounded-lg border border-input px-3 text-xs" /></label>
                <label><span className="mb-1 block text-[10px] text-muted-foreground">加班工时 · {confidenceLabel(task.confidence.overtimeHours ?? 0)}</span><input type="number" min="0" max="24" step="0.25" value={task.overtimeHours ?? ""} onChange={(event) => changeTask(index, { overtimeHours: event.target.value ? Number(event.target.value) : event.target.value === "0" ? 0 : null, needsReview: true })} className="h-10 w-full rounded-lg border border-input px-3 text-xs" /></label>
                <label><span className="mb-1 block text-[10px] text-muted-foreground">分类 · {confidenceLabel(task.confidence.category)}</span><select value={task.categoryId ?? ""} onChange={(event) => changeTask(index, { categoryId: event.target.value || null, needsReview: true })} className="h-10 w-full rounded-lg border border-input px-2 text-xs"><option value="">待确认</option>{TIMESHEET_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label><span className="mb-1 block text-[10px] text-muted-foreground">状态 · {confidenceLabel(task.confidence.status)}</span><select value={task.workStatus ?? ""} onChange={(event) => changeTask(index, { workStatus: event.target.value || null, needsReview: true })} className="h-10 w-full rounded-lg border border-input px-2 text-xs"><option value="">待确认</option>{TIMESHEET_STATUSES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
                <label><span className="mb-1 block text-[10px] text-muted-foreground">紧急重要度</span><input value={task.urgency ?? ""} disabled placeholder="待真实候选项配置" className="h-10 w-full rounded-lg border border-input bg-muted px-3 text-xs" /></label>
                <label><span className="mb-1 block text-[10px] text-muted-foreground">任务进度 · {confidenceLabel(task.confidence.progress ?? 0)}</span><input type="number" min="0" max="100" step="1" value={task.progress ?? ""} onChange={(event) => changeTask(index, { progress: event.target.value ? Number(event.target.value) : event.target.value === "0" ? 0 : null, needsReview: true })} className="h-10 w-full rounded-lg border border-input px-3 text-xs" /></label>
                <div className="lg:col-span-5"><p className="text-[10px] text-muted-foreground">来源记录：{task.sourceRecordIds.map((id) => records.find((record) => record.id === id)?.rawText ?? id).join("；")}</p>{task.reviewFields.length ? <p className="mt-1 text-[10px] text-warning">需确认：{task.reviewFields.join("、")}</p> : null}</div>
                <button onClick={() => markReviewed(index)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-success/30 text-xs text-success"><Check className="size-3.5" />{task.needsReview ? "标记已审核" : "已人工审核"}</button>
              </div>
            </article>
          ))}
        </section>
      ) : null}

      {draft ? (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs text-muted-foreground">今日总工时</p>
              <p className="text-2xl font-semibold">{totalHours.toFixed(2)} h</p>
              {totalHours > 16 ? <p className="text-xs text-warning">总工时异常偏高，请人工确认；系统不会自动修正。</p> : null}
            </div>
            <div className="flex flex-wrap gap-2">
              <button disabled={!dirty || phase === "working"} onClick={() => void run(async () => { await saveDraft(); }, "草稿已保存，仍需人工确认")} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Save className="size-3.5" />保存草稿</button>
              <button disabled={pendingReview > 0 || tasks.length === 0 || phase === "working"} onClick={() => void confirmDraft()} className="inline-flex items-center gap-1.5 rounded-lg bg-success px-3 py-2 text-xs font-medium text-white disabled:opacity-40"><Check className="size-3.5" />确认工时</button>
              <button disabled={!draft.confirmedAt || dirty || phase === "working"} onClick={() => void copyJson()} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Clipboard className="size-3.5" />复制 JSON</button>
              <button disabled={!draft.confirmedAt || dirty || phase === "working"} onClick={() => void downloadJson()} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Download className="size-3.5" />下载 JSON</button>
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">企业微信同步中心</h2>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              {extension.connected ? <><Check className="size-3 text-success" />扩展已连接 {extension.version ? `v${extension.version}` : ""}</> : <><Unplug className="size-3" />扩展未安装或未连接</>}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />Dry Run（不点击单条保存）</label>
        </div>
        <div className="space-y-4 p-5">
          {!wecomSyncEnabled ? <div className="flex items-center gap-2 rounded-lg border border-warning/25 bg-warning-soft p-3 text-xs text-warning"><CloudOff className="size-4" />企业微信同步 Feature Flag 当前关闭。</div> : null}
          <div className="flex flex-wrap gap-2">
            <button disabled={!wecomSyncEnabled || !extension.connected || !draft?.confirmedAt || dirty || Boolean(activeBatch)} onClick={() => void startSync()} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs text-white disabled:opacity-40"><Send className="size-3.5" />同步到企业微信</button>
            <button disabled={!wecomSyncEnabled || !extension.connected} onClick={openWecomBoard} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">打开企业微信任务看板</button>
            <button disabled={!wecomSyncEnabled || !activeBatch} onClick={() => controlSync("pause")} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Pause className="size-3.5" />暂停</button>
            <button disabled={!wecomSyncEnabled || !activeBatch} onClick={() => controlSync("resume")} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Play className="size-3.5" />继续</button>
            <button disabled={!wecomSyncEnabled || !activeBatch} onClick={() => controlSync("cancel")} className="inline-flex items-center gap-1.5 rounded-lg border border-danger/20 px-3 py-2 text-xs text-danger disabled:opacity-40"><Square className="size-3.5" />取消</button>
            <button disabled={!wecomSyncEnabled || (!activeBatch && batches.length === 0)} onClick={downloadSyncResult} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><Download className="size-3.5" />下载同步结果</button>
          </div>
          {activeBatch ? <div className="rounded-lg border border-border bg-muted/30 p-3 text-xs"><p>批次 {activeBatch.syncBatchId} · {activeBatch.status} · {activeBatch.dryRun ? "Dry Run" : "实际逐条保存"}</p><p className="mt-1 text-muted-foreground">当前任务：{currentSyncTask?.description ?? currentSyncItem?.taskId ?? "等待调度"}</p><p className="mt-1 text-muted-foreground">总数 {activeBatch.items.length} / 成功 {activeBatch.items.filter((item) => item.status === "saved").length} / 失败 {activeBatch.items.filter((item) => item.status === "failed").length} / 未知 {activeBatch.items.filter((item) => item.status === "unknown").length}</p></div> : null}
          <div>
            <h3 className="text-xs font-semibold">同步历史</h3>
            <div className="mt-2 divide-y divide-border rounded-lg border border-border">
              {batches.map((batch) => <div key={batch.syncBatchId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"><span>{new Date(batch.createdAt).toLocaleString("zh-CN")} · {batch.dryRun ? "Dry Run" : "保存"}</span><span className="font-mono text-[10px] text-muted-foreground">{batch.status} · {batch.items.filter((item) => item.status === "saved").length}/{batch.items.length}</span></div>)}
              {!batches.length ? <p className="p-4 text-center text-xs text-muted-foreground">暂无同步历史。</p> : null}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
