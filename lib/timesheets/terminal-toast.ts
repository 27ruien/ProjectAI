import { storageKey } from "@/lib/storage-key";

type TerminalJob = {
  id: string;
  requestId: string;
  status: "completed" | "failed" | "cancelled";
  outputCount: number | null;
  failureStage: string | null;
};

type DraftSummary = {
  totalHours: number;
  summary: {
    pendingCount: number;
  };
};

type ToastStorage = Pick<Storage, "getItem" | "setItem">;

export function terminalToastStorageKey(job: Pick<TerminalJob, "id">): string {
  return storageKey(`timesheet-ai-job-toast:${job.id}`);
}

export function hasConsumedTerminalToast(
  storage: ToastStorage,
  job: Pick<TerminalJob, "id" | "status">,
): boolean {
  return storage.getItem(terminalToastStorageKey(job)) === job.status;
}

export function consumeTerminalToast(
  storage: ToastStorage,
  job: Pick<TerminalJob, "id" | "status">,
): void {
  storage.setItem(terminalToastStorageKey(job), job.status);
}

export function redactRequestId(requestId: string): string {
  if (requestId.length <= 12) return `${requestId.slice(0, 4)}…`;
  return `${requestId.slice(0, 8)}…${requestId.slice(-4)}`;
}

export function completedTimesheetToastMessage(
  job: Pick<TerminalJob, "outputCount">,
  draft: DraftSummary | null,
): string {
  const totalHours = draft?.totalHours ?? 0;
  const pendingCount = draft?.summary.pendingCount ?? job.outputCount ?? 0;
  return `AI 工时草稿已生成 ${job.outputCount ?? 0} 条，共 ${totalHours} 小时，待确认 ${pendingCount} 条。`;
}

export function failedTimesheetToastMessage(
  job: Pick<TerminalJob, "requestId" | "failureStage">,
  stageLabel: string,
): string {
  return `AI 整理在“${stageLabel}”失败。脱敏 requestId：${redactRequestId(job.requestId)}`;
}
