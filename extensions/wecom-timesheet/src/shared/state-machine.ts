import { idempotencyKey, protocolDigest, type SyncPayload } from "./protocol";

export type BatchStatus =
  | "idle"
  | "validating"
  | "waiting_for_board"
  | "waiting_for_login"
  | "ready"
  | "syncing"
  | "paused"
  | "completed"
  | "partially_completed"
  | "failed"
  | "cancelled";

export type ItemStatus =
  | "pending"
  | "validating"
  | "waiting_for_login"
  | "running"
  | "saved"
  | "unknown"
  | "failed"
  | "cancelled";

export type PersistedItem = {
  taskId: string;
  idempotencyKey: string;
  status: ItemStatus;
  attemptCount: number;
  updatedAt: string;
  externalReference: string | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type PersistedBatch = {
  version: 1;
  requestId: string;
  syncBatchId: string;
  payloadDigest: string;
  payload: SyncPayload;
  status: BatchStatus;
  items: PersistedItem[];
  createdAt: string;
  updatedAt: string;
};

export function createBatch(payload: SyncPayload, now = new Date()): PersistedBatch {
  const timestamp = now.toISOString();
  return {
    version: 1,
    requestId: payload.request_id,
    syncBatchId: payload.sync_batch_id,
    payloadDigest: protocolDigest(payload),
    payload,
    status: "validating",
    items: payload.tasks.map((task) => ({
      taskId: task.id,
      idempotencyKey: idempotencyKey(payload.sync_batch_id, task.id),
      status: "pending",
      attemptCount: 0,
      updatedAt: timestamp,
      externalReference: null,
      errorCode: null,
      errorMessage: null,
    })),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function acceptReplay(existing: PersistedBatch, payload: SyncPayload): "same" | "conflict" {
  return existing.payloadDigest === protocolDigest(payload) ? "same" : "conflict";
}

export function recoverInterruptedBatch(batch: PersistedBatch, now = new Date()): PersistedBatch {
  const timestamp = now.toISOString();
  let interrupted = false;
  const items = batch.items.map((item) => {
    if (item.status !== "running") return item;
    interrupted = true;
    return {
      ...item,
      status: "unknown" as const,
      updatedAt: timestamp,
      errorCode: "SERVICE_WORKER_INTERRUPTED",
      errorMessage: "执行被浏览器中断，需人工确认是否已保存",
    };
  });
  return interrupted
    ? { ...batch, status: "paused", items, updatedAt: timestamp }
    : batch;
}

export function nextPendingItem(batch: PersistedBatch): PersistedItem | null {
  if (batch.status === "paused" || batch.status === "cancelled") return null;
  if (batch.items.some((item) => item.status === "unknown")) return null;
  return batch.items.find((item) => item.status === "pending" || item.status === "failed") ?? null;
}

export function updateItem(
  batch: PersistedBatch,
  taskId: string,
  changes: Partial<Omit<PersistedItem, "taskId" | "idempotencyKey">>,
  now = new Date(),
): PersistedBatch {
  const current = batch.items.find((item) => item.taskId === taskId);
  if (!current) throw new Error("SYNC_ITEM_NOT_FOUND");
  if (current.status === "saved" && changes.status && changes.status !== "saved") {
    throw new Error("SYNC_ITEM_ALREADY_SAVED");
  }
  const updatedAt = now.toISOString();
  return {
    ...batch,
    items: batch.items.map((item) =>
      item.taskId === taskId ? { ...item, ...changes, updatedAt } : item,
    ),
    updatedAt,
  };
}

export function deriveBatchStatus(batch: PersistedBatch): BatchStatus {
  if (batch.status === "paused") return "paused";
  if (batch.status === "cancelled") return "cancelled";
  if (batch.items.some((item) => item.status === "unknown")) return "paused";
  if (batch.items.some((item) => ["running", "validating"].includes(item.status))) return "syncing";
  if (batch.items.some((item) => item.status === "waiting_for_login")) return "waiting_for_login";
  const saved = batch.items.filter((item) => item.status === "saved").length;
  const failed = batch.items.filter((item) => item.status === "failed").length;
  if (saved === batch.items.length) return "completed";
  if (saved > 0 && saved + failed === batch.items.length) return "partially_completed";
  if (failed === batch.items.length) return "failed";
  return batch.status;
}

export function pauseBatch(batch: PersistedBatch, now = new Date()): PersistedBatch {
  return { ...batch, status: "paused", updatedAt: now.toISOString() };
}

export function resumeBatch(batch: PersistedBatch, now = new Date()): PersistedBatch {
  if (["completed", "cancelled"].includes(batch.status)) {
    throw new Error("TERMINAL_BATCH_CANNOT_RESUME");
  }
  if (batch.items.some((item) => item.status === "unknown")) {
    throw new Error("UNKNOWN_ITEM_REQUIRES_REVIEW");
  }
  const updatedAt = now.toISOString();
  return {
    ...batch,
    status: "ready",
    items: batch.items.map((item) =>
      item.status === "waiting_for_login"
        ? {
            ...item,
            status: "pending" as const,
            errorCode: null,
            errorMessage: null,
            updatedAt,
          }
        : item,
    ),
    updatedAt,
  };
}

export function cancelBatch(batch: PersistedBatch, now = new Date()): PersistedBatch {
  const updatedAt = now.toISOString();
  const items = batch.items.map((item) =>
    ["saved", "unknown", "running"].includes(item.status)
      ? item
      : { ...item, status: "cancelled" as const, updatedAt },
  );
  const status: BatchStatus = items.some((item) =>
    ["unknown", "running"].includes(item.status),
  )
    ? "paused"
    : items.every((item) => item.status === "saved")
      ? "completed"
      : "cancelled";
  return {
    ...batch,
    status,
    items,
    updatedAt,
  };
}

export function applyDeferredControl(
  batch: PersistedBatch,
  action: "pause" | "cancel" | undefined,
  now = new Date(),
): PersistedBatch {
  return action === "cancel"
    ? cancelBatch(batch, now)
    : action === "pause"
      ? pauseBatch(batch, now)
      : batch;
}

export function resolveUnknownItem(
  batch: PersistedBatch,
  taskId: string,
  resolution: "saved" | "failed",
  now = new Date(),
): PersistedBatch {
  const current = batch.items.find((item) => item.taskId === taskId);
  if (!current || current.status !== "unknown") {
    throw new Error("UNKNOWN_ITEM_NOT_FOUND");
  }
  const updated = updateItem(
    batch,
    taskId,
    resolution === "saved"
      ? {
          status: "saved",
          externalReference: "manual-reconciliation",
          errorCode: null,
          errorMessage: null,
        }
      : {
          status: "failed",
          externalReference: null,
          errorCode: "MANUAL_RECONCILIATION_NOT_SAVED",
          errorMessage: "用户人工核对后确认未保存",
        },
    now,
  );
  return {
    ...updated,
    status: updated.items.every((item) => item.status === "saved")
      ? "completed"
      : "paused",
  };
}
