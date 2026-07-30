import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { requireAiAssistantEnabled } from "@/lib/ai/project-assistant/config";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { findUserById } from "@/lib/db/repositories/user-repository";
import {
  timesheetAiExecution,
  type TimesheetAiExecutionRecord,
} from "@/lib/db/schema";
import {
  TIMESHEET_PROMPT_VERSION,
  TIMESHEET_SKILL_ID,
} from "./contracts";
import { TimesheetError } from "./errors";
import {
  generateDailyTimesheet,
  prepareDailyTimesheetGeneration,
  type TimesheetGenerationInput,
} from "./service";
import { requireTimesheetOrganization } from "./authorization";

const ACTIVE_STATUSES = [
  "queued",
  "reading_notes",
  "matching_projects",
  "merging_duplicates",
  "generating_draft",
  "validating_result",
] as const;
const TERMINAL_STATUSES = ["completed", "failed", "cancelled"] as const;
const DEFAULT_HEARTBEAT_FILE = "/tmp/projectai-timesheet-ai-worker-heartbeat";

export type TimesheetAiJobStatus =
  | (typeof ACTIVE_STATUSES)[number]
  | (typeof TERMINAL_STATUSES)[number];

export type TimesheetAiJobPayload = {
  id: string;
  requestId: string;
  status: TimesheetAiJobStatus;
  reportDate: string;
  sourceCount: number;
  outputCount: number | null;
  attemptCount: number;
  failureCode: string | null;
  failureStage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  cancellationRequestedAt: string | null;
};

export type TimesheetAiWorkerConfig = {
  pollMs: number;
  leaseSeconds: number;
  heartbeatFile: string;
};

function workerConfig(): TimesheetAiWorkerConfig {
  const pollMs = Number(process.env.TIMESHEET_AI_WORKER_POLL_MS || 1_000);
  const leaseSeconds = Number(
    process.env.TIMESHEET_AI_WORKER_LEASE_SECONDS || 180,
  );
  if (!Number.isInteger(pollMs) || pollMs < 100 || pollMs > 60_000) {
    throw new Error("TIMESHEET_AI_WORKER_POLL_MS_INVALID");
  }
  if (
    !Number.isInteger(leaseSeconds) ||
    leaseSeconds < 30 ||
    leaseSeconds > 900
  ) {
    throw new Error("TIMESHEET_AI_WORKER_LEASE_SECONDS_INVALID");
  }
  return {
    pollMs,
    leaseSeconds,
    heartbeatFile:
      process.env.TIMESHEET_AI_WORKER_HEARTBEAT_FILE?.trim() ||
      DEFAULT_HEARTBEAT_FILE,
  };
}

function publicStatus(status: string): TimesheetAiJobStatus {
  if (status === "succeeded") return "completed";
  if (status === "running") return "reading_notes";
  if (
    (ACTIVE_STATUSES as readonly string[]).includes(status) ||
    (TERMINAL_STATUSES as readonly string[]).includes(status)
  ) {
    return status as TimesheetAiJobStatus;
  }
  return "failed";
}

export function serializeTimesheetAiJob(
  job: TimesheetAiExecutionRecord,
): TimesheetAiJobPayload {
  return {
    id: job.id,
    requestId: job.requestId,
    status: publicStatus(job.status),
    reportDate: job.reportDate,
    sourceCount: job.sourceCount,
    outputCount: job.outputCount,
    attemptCount: job.attemptCount,
    failureCode: job.failureCode,
    failureStage: job.failureStage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    cancellationRequestedAt:
      job.cancellationRequestedAt?.toISOString() ?? null,
  };
}

export async function enqueueTimesheetAiJob(
  input: TimesheetGenerationInput & { attemptCount?: number },
): Promise<{ job: TimesheetAiJobPayload; created: boolean }> {
  const prepared = await prepareDailyTimesheetGeneration(input);
  const aiConfig = requireAiAssistantEnabled();
  const db = getDb();
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${input.organizationId}:${input.principal.user.id}:${input.reportDate}:timesheet-ai-job`}, 0))`,
    );
    const [active] = await tx
      .select()
      .from(timesheetAiExecution)
      .where(
        and(
          eq(timesheetAiExecution.organizationId, input.organizationId),
          eq(timesheetAiExecution.userId, input.principal.user.id),
          eq(timesheetAiExecution.reportDate, input.reportDate),
          inArray(timesheetAiExecution.status, [...ACTIVE_STATUSES]),
        ),
      )
      .orderBy(desc(timesheetAiExecution.createdAt))
      .limit(1);
    if (active) return { job: serializeTimesheetAiJob(active), created: false };

    const id = randomUUID();
    const [created] = await tx
      .insert(timesheetAiExecution)
      .values({
        id,
        executionId: id,
        requestId: randomUUID(),
        organizationId: input.organizationId,
        userId: input.principal.user.id,
        reportDate: input.reportDate,
        skillId: TIMESHEET_SKILL_ID,
        modelProfileId: aiConfig.profileId,
        promptVersion: TIMESHEET_PROMPT_VERSION,
        status: "queued",
        attemptCount: input.attemptCount ?? 1,
        sourceSelectionDigest: prepared.sourceSelectionDigest,
        sourceCount: prepared.records.length,
      })
      .returning();
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        eventType: "timesheet.ai_queued",
        entityType: "timesheet_ai_execution",
        entityId: created.id,
        result: "succeeded",
        metadata: {
          organizationId: input.organizationId,
          reportDate: input.reportDate,
          sourceCount: created.sourceCount,
          requestId: created.requestId,
        },
      },
      tx,
    );
    return { job: serializeTimesheetAiJob(created), created: true };
  });
}

export async function getLatestTimesheetAiJob(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  reportDate: string;
  requestHeaders: Headers;
}): Promise<TimesheetAiJobPayload | null> {
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  const [job] = await getDb()
    .select()
    .from(timesheetAiExecution)
    .where(
      and(
        eq(timesheetAiExecution.organizationId, input.organizationId),
        eq(timesheetAiExecution.userId, input.principal.user.id),
        eq(timesheetAiExecution.reportDate, input.reportDate),
      ),
    )
    .orderBy(desc(timesheetAiExecution.createdAt))
    .limit(1);
  return job ? serializeTimesheetAiJob(job) : null;
}

async function ownedJob(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  jobId: string;
  requestHeaders: Headers;
}): Promise<TimesheetAiExecutionRecord> {
  await requireTimesheetOrganization(
    input.principal,
    input.organizationId,
    input.requestHeaders,
  );
  const [job] = await getDb()
    .select()
    .from(timesheetAiExecution)
    .where(
      and(
        eq(timesheetAiExecution.id, input.jobId),
        eq(timesheetAiExecution.organizationId, input.organizationId),
        eq(timesheetAiExecution.userId, input.principal.user.id),
      ),
    )
    .limit(1);
  if (!job) throw new TimesheetError(404, "NOT_FOUND", "AI 整理任务不存在");
  return job;
}

export async function cancelTimesheetAiJob(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  jobId: string;
  requestHeaders: Headers;
}): Promise<TimesheetAiJobPayload> {
  const job = await ownedJob(input);
  if ((TERMINAL_STATUSES as readonly string[]).includes(publicStatus(job.status))) {
    return serializeTimesheetAiJob(job);
  }
  const now = new Date();
  const [updated] = await getDb()
    .update(timesheetAiExecution)
    .set(
      job.status === "queued"
        ? {
            status: "cancelled",
            cancellationRequestedAt: now,
            failureCode: "TIMESHEET_GENERATION_CANCELLED",
            failureStage: "queued",
            completedAt: now,
            totalDurationMs: Math.max(0, now.getTime() - job.createdAt.getTime()),
          }
        : { cancellationRequestedAt: now },
    )
    .where(
      and(
        eq(timesheetAiExecution.id, job.id),
        eq(timesheetAiExecution.organizationId, job.organizationId),
        eq(timesheetAiExecution.userId, job.userId),
        inArray(timesheetAiExecution.status, [...ACTIVE_STATUSES]),
      ),
    )
    .returning();
  return serializeTimesheetAiJob(updated ?? job);
}

export async function retryTimesheetAiJob(input: {
  principal: AuthenticatedPrincipal;
  organizationId: string;
  jobId: string;
  requestHeaders: Headers;
}): Promise<{ job: TimesheetAiJobPayload; created: boolean }> {
  const previous = await ownedJob(input);
  if (!(TERMINAL_STATUSES as readonly string[]).includes(publicStatus(previous.status))) {
    throw new TimesheetError(
      409,
      "TIMESHEET_GENERATION_IN_PROGRESS",
      "AI 整理任务仍在运行",
    );
  }
  return enqueueTimesheetAiJob({
    principal: input.principal,
    organizationId: input.organizationId,
    reportDate: previous.reportDate,
    timezone: "Asia/Shanghai",
    requestHeaders: input.requestHeaders,
    attemptCount: Math.min(20, previous.attemptCount + 1),
  });
}

export async function claimTimesheetAiJob(
  workerId: string,
  config: TimesheetAiWorkerConfig = workerConfig(),
): Promise<TimesheetAiExecutionRecord | null> {
  return getDb().transaction(async (tx) => {
    await tx
      .update(timesheetAiExecution)
      .set({
        status: "failed",
        failureCode: "TIMESHEET_PROVIDER_RESULT_UNKNOWN",
        failureStage: "generating_draft",
        leasedBy: null,
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: new Date(),
      })
      .where(
        and(
          inArray(timesheetAiExecution.status, [...ACTIVE_STATUSES]),
          sql`${timesheetAiExecution.leaseExpiresAt} <= now()`,
          sql`${timesheetAiExecution.providerDispatchedAt} is not null`,
        ),
      );
    await tx
      .update(timesheetAiExecution)
      .set({
        status: "queued",
        leasedBy: null,
        leaseToken: null,
        leaseExpiresAt: null,
        heartbeatAt: null,
        startedAt: null,
        currentStageStartedAt: null,
        failureCode: "TIMESHEET_WORKER_LEASE_EXPIRED",
        failureStage: null,
      })
      .where(
        and(
          inArray(timesheetAiExecution.status, [...ACTIVE_STATUSES]),
          sql`${timesheetAiExecution.status} <> 'queued'`,
          sql`${timesheetAiExecution.leaseExpiresAt} <= now()`,
          sql`${timesheetAiExecution.providerDispatchedAt} is null`,
        ),
      );
    const candidate = await tx.execute<{ id: string; organization_id: string; user_id: string }>(sql`
      select id, organization_id, user_id
      from timesheet_ai_executions
      where status = 'queued'
        and cancellation_requested_at is null
      order by created_at asc, id asc
      for update skip locked
      limit 1
    `);
    const candidateJob = candidate.rows[0];
    if (!candidateJob) return null;
    const leaseToken = randomUUID();
    const [claimed] = await tx
      .update(timesheetAiExecution)
      .set({
        status: "reading_notes",
        leasedBy: workerId,
        leaseToken,
        leaseExpiresAt: sql`now() + (${config.leaseSeconds} * interval '1 second')`,
        heartbeatAt: sql`now()`,
        startedAt: sql`now()`,
        currentStageStartedAt: sql`now()`,
        queueDurationMs: sql`greatest(0, extract(epoch from (now() - ${timesheetAiExecution.createdAt})) * 1000)::integer`,
        failureCode: null,
        failureStage: null,
      })
      .where(and(
        eq(timesheetAiExecution.id, candidateJob.id),
        eq(timesheetAiExecution.organizationId, candidateJob.organization_id),
        eq(timesheetAiExecution.userId, candidateJob.user_id),
      ))
      .returning();
    return claimed;
  });
}

export async function renewTimesheetAiLease(
  jobId: string,
  organizationId: string,
  userId: string,
  workerId: string,
  leaseToken: string,
  config: TimesheetAiWorkerConfig = workerConfig(),
): Promise<boolean> {
  const renewed = await getDb()
    .update(timesheetAiExecution)
    .set({
      leaseExpiresAt: sql`now() + (${config.leaseSeconds} * interval '1 second')`,
      heartbeatAt: sql`now()`,
    })
    .where(
      and(
        eq(timesheetAiExecution.id, jobId),
        eq(timesheetAiExecution.organizationId, organizationId),
        eq(timesheetAiExecution.userId, userId),
        eq(timesheetAiExecution.leasedBy, workerId),
        eq(timesheetAiExecution.leaseToken, leaseToken),
        inArray(timesheetAiExecution.status, [...ACTIVE_STATUSES]),
        sql`${timesheetAiExecution.leaseExpiresAt} > now()`,
      ),
    )
    .returning({ id: timesheetAiExecution.id });
  return renewed.length === 1;
}

async function wait(ms: number, signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => {
    const finish = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const onAbort = () => {
      clearTimeout(timer);
      finish();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

async function maintainLease(input: {
  job: TimesheetAiExecutionRecord;
  workerId: string;
  config: TimesheetAiWorkerConfig;
  controller: AbortController;
}): Promise<void> {
  const interval = Math.max(1_000, input.config.leaseSeconds * 1_000 / 3);
  while (!input.controller.signal.aborted) {
    await wait(interval, input.controller.signal);
    if (input.controller.signal.aborted) return;
    const renewed = await renewTimesheetAiLease(
      input.job.id,
      input.job.organizationId,
      input.job.userId,
      input.workerId,
      input.job.leaseToken!,
      input.config,
    );
    if (!renewed) {
      input.controller.abort(new Error("TIMESHEET_AI_LEASE_LOST"));
      return;
    }
    await writeFile(
      input.config.heartbeatFile,
      `${Date.now()} ${input.workerId}\n`,
      { mode: 0o600 },
    );
  }
}

export async function processTimesheetAiJob(input: {
  job: TimesheetAiExecutionRecord;
  workerId: string;
  signal?: AbortSignal;
}): Promise<void> {
  void input.signal;
  const currentUser = await findUserById(input.job.userId);
  if (!currentUser || currentUser.status !== "active") {
    throw new TimesheetError(
      404,
      "TIMESHEET_JOB_PRINCIPAL_INVALID",
      "AI 整理任务的用户已不可用",
    );
  }
  await generateDailyTimesheet({
    principal: {
      sessionId: `timesheet-ai-job:${input.job.id}`,
      user: currentUser,
    },
    organizationId: input.job.organizationId,
    reportDate: input.job.reportDate,
    timezone: "Asia/Shanghai",
    requestHeaders: new Headers(),
    executionLease: {
      executionId: input.job.id,
      workerId: input.workerId,
      leaseToken: input.job.leaseToken!,
    },
  });
}

export async function runTimesheetAiWorker(options: {
  once?: boolean;
  workerId?: string;
  signal?: AbortSignal;
  config?: TimesheetAiWorkerConfig;
} = {}): Promise<void> {
  const config = options.config ?? workerConfig();
  const workerId = options.workerId ?? `timesheet-ai-worker-${randomUUID()}`;
  await writeFile(config.heartbeatFile, `${Date.now()} ${workerId}\n`, {
    mode: 0o600,
  });
  do {
    if (options.signal?.aborted) break;
    const job = await claimTimesheetAiJob(workerId, config);
    if (!job) {
      if (options.once) break;
      await wait(config.pollMs, options.signal);
      await writeFile(config.heartbeatFile, `${Date.now()} ${workerId}\n`, {
        mode: 0o600,
      });
      continue;
    }
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    const heartbeat = maintainLease({ job, workerId, config, controller });
    try {
      await processTimesheetAiJob({ job, workerId, signal: controller.signal });
    } catch (error) {
      if (
        !(error instanceof TimesheetError) ||
        ![
          "TIMESHEET_GENERATION_CANCELLED",
          "TIMESHEET_AI_LEASE_LOST",
        ].includes(error.code)
      ) {
        const [current] = await getDb()
          .select({ status: timesheetAiExecution.status })
          .from(timesheetAiExecution)
          .where(and(
            eq(timesheetAiExecution.id, job.id),
            eq(timesheetAiExecution.organizationId, job.organizationId),
            eq(timesheetAiExecution.userId, job.userId),
          ))
          .limit(1);
        if (
          current &&
          !(TERMINAL_STATUSES as readonly string[]).includes(current.status)
        ) {
          await getDb()
            .update(timesheetAiExecution)
            .set({
              status: "failed",
              failureCode:
                error instanceof TimesheetError
                  ? error.code
                  : "TIMESHEET_AI_WORKER_FAILED",
              failureStage: current.status,
              leasedBy: null,
              leaseToken: null,
              leaseExpiresAt: null,
              completedAt: new Date(),
            })
            .where(and(
              eq(timesheetAiExecution.id, job.id),
              eq(timesheetAiExecution.organizationId, job.organizationId),
              eq(timesheetAiExecution.userId, job.userId),
            ));
        }
      }
    } finally {
      controller.abort();
      await heartbeat;
      options.signal?.removeEventListener("abort", abort);
      await writeFile(config.heartbeatFile, `${Date.now()} ${workerId}\n`, {
        mode: 0o600,
      });
    }
  } while (!options.once);
}
