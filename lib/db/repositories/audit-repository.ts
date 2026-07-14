import { desc } from "drizzle-orm";
import { getDb, type DatabaseExecutor } from "../client";
import {
  auditEvent,
  type AuditEventRecord,
  type AuditResult,
} from "../schema";

const FORBIDDEN_METADATA_KEY =
  /password|passphrase|secret|token|cookie|authorization|api.?key|database.?url|connection|string|file.?content|document.?body|client.?content/i;

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 3) return "[truncated]";
  if (value === null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") return value.slice(0, 500);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key]) => !FORBIDDEN_METADATA_KEY.test(key))
        .slice(0, 30)
        .map(([key, item]) => [key, sanitizeValue(item, depth + 1)]),
    );
  }
  return String(value).slice(0, 500);
}

export function sanitizeAuditMetadata(
  metadata: Record<string, unknown> = {},
): Record<string, unknown> {
  return sanitizeValue(metadata, 0) as Record<string, unknown>;
}

export async function writeAuditEvent(
  input: {
    actorUserId?: string | null;
    projectId?: string | null;
    eventType: string;
    entityType?: string | null;
    entityId?: string | null;
    result: AuditResult;
    metadata?: Record<string, unknown>;
    ipAddress?: string | null;
    userAgent?: string | null;
  },
  db: DatabaseExecutor = getDb(),
): Promise<void> {
  await db.insert(auditEvent).values({
    id: crypto.randomUUID(),
    actorUserId: input.actorUserId ?? null,
    projectId: input.projectId ?? null,
    eventType: input.eventType,
    entityType: input.entityType ?? null,
    entityId: input.entityId ?? null,
    result: input.result,
    metadata: sanitizeAuditMetadata(input.metadata),
    ipAddress: input.ipAddress?.slice(0, 64) ?? null,
    userAgent: input.userAgent?.slice(0, 1_000) ?? null,
  });
}

export async function listRecentAuditEvents(
  limit = 100,
  db: DatabaseExecutor = getDb(),
): Promise<AuditEventRecord[]> {
  return db
    .select()
    .from(auditEvent)
    .orderBy(desc(auditEvent.createdAt))
    .limit(Math.min(Math.max(limit, 1), 250));
}
