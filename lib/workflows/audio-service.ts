import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { and, desc, eq, sql } from "drizzle-orm";
import { requireProjectRole } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { workflowAudioJob, workflowDefinition, workflowRun, workflowRunSource } from "@/lib/db/schema";
import { getObjectStorage } from "@/lib/files/object-storage";
import { WorkflowError } from "./errors";

const AUDIO_TYPES = new Map([
  ["mp3", ["audio/mpeg", "audio/mp3"]],
  ["m4a", ["audio/mp4", "audio/x-m4a"]],
  ["wav", ["audio/wav", "audio/x-wav"]],
  ["aac", ["audio/aac", "audio/x-aac"]],
  ["mp4", ["video/mp4"]],
  ["mov", ["video/quicktime"]],
]);
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }

async function validatedAudio(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const allowedMimes = AUDIO_TYPES.get(extension);
  if (!allowedMimes || !allowedMimes.includes(file.type)) throw new WorkflowError(422, "AUDIO_TYPE_UNSUPPORTED", "仅支持 MP3、M4A、WAV、AAC、MP4 和 MOV");
  if (file.size <= 0 || file.size > MAX_AUDIO_BYTES) throw new WorkflowError(422, "AUDIO_SIZE_INVALID", "音视频必须小于等于 100 MB");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const header = bytes.subarray(0, 16);
  const ascii = new TextDecoder("latin1").decode(header);
  const signatureOk = extension === "wav"
    ? ascii.startsWith("RIFF") && ascii.slice(8, 12) === "WAVE"
    : extension === "mp3"
      ? ascii.startsWith("ID3") || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
      : extension === "aac"
        ? header[0] === 0xff && (header[1] & 0xf6) === 0xf0
        : ascii.slice(4, 8) === "ftyp";
  if (!signatureOk) throw new WorkflowError(422, "AUDIO_SIGNATURE_INVALID", "音视频文件签名与扩展名不一致");
  return { extension, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export async function createMeetingRun(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  file: File;
  idempotencyKey: string;
  requestHeaders: Headers;
}): Promise<{ runId: string; created: boolean }> {
  const audio = await validatedAudio(input.file);
  const idempotencyKeyHash = digest(input.idempotencyKey);
  const db = getDb();
  const prepared = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${input.projectId}:${input.principal.user.id}:${idempotencyKeyHash}:meeting`}, 0))`);
    const target = await requireProjectRole(input.principal, input.projectId, ["project_manager", "project_member"], input.requestHeaders, { db: tx, lockForUpdate: true });
    if (!target.departmentId) throw new WorkflowError(422, "WORKFLOW_DEPARTMENT_REQUIRED", "项目必须归属有效部门后才能运行工作流");
    const [existing] = await tx.select({ id: workflowRun.id }).from(workflowRun).where(and(eq(workflowRun.projectId, target.id), eq(workflowRun.creatorId, input.principal.user.id), eq(workflowRun.idempotencyKeyHash, idempotencyKeyHash))).limit(1);
    if (existing) return { runId: existing.id, created: false, objectKey: null as string | null, sourceId: null as string | null };
    const [definition] = await tx.select().from(workflowDefinition).where(and(eq(workflowDefinition.workflowType, "meeting_minutes"), eq(workflowDefinition.isActive, true))).orderBy(desc(workflowDefinition.version)).limit(1);
    if (!definition) throw new WorkflowError(503, "WORKFLOW_DEFINITION_MISSING", "会议工作流定义尚未就绪");
    const runId = randomUUID();
    const sourceId = randomUUID();
    const objectKey = `workflow-audio/${target.organizationId}/${target.id}/${runId}/${randomBytes(24).toString("hex")}.${audio.extension}`;
    const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(new Date());
    await tx.insert(workflowRun).values({
      id: runId, definitionId: definition.id, organizationId: target.organizationId,
      departmentId: target.departmentId, projectId: target.id, workflowType: "meeting_minutes",
      creatorId: input.principal.user.id, displayName: `${target.name} · 会议纪要 · ${date}`,
      authorizedSourceScope: { documentIds: [], knowledgeSpaceIds: [] }, sourceScopeDigest: digest({ audioSha256: audio.sha256 }),
      modelProfileId: definition.modelProfileId, status: "uploading", currentStep: 1, idempotencyKeyHash,
    });
    await tx.insert(workflowRunSource).values({
      id: sourceId, runId, projectId: target.id, sourceType: "audio", objectKey,
      sourceProjectId: target.id,
      displayName: `会议录音 · ${date}`, mimeType: input.file.type, sizeBytes: input.file.size,
      sha256: audio.sha256, status: "uploading",
    });
    await tx.insert(workflowAudioJob).values({
      id: randomUUID(), runId, projectId: target.id, sourceId,
      transcriptionProvider: "alibaba-model-studio", transcriptionModel: "paraformer-v2",
      diarizationProvider: "alibaba-model-studio", diarizationModel: "paraformer-v2", status: "queued",
    });
    return { runId, created: true, objectKey, sourceId };
  });
  if (!prepared.created) return { runId: prepared.runId, created: false };
  try {
    const stored = await getObjectStorage().putObject({ key: prepared.objectKey!, body: audio.bytes, contentType: input.file.type, sha256: audio.sha256 });
    if (stored.size !== audio.bytes.byteLength || stored.sha256 !== audio.sha256) throw new Error("AUDIO_STORAGE_INTEGRITY_FAILED");
    await db.transaction(async (tx) => {
      await tx.update(workflowRunSource).set({ status: "ready" }).where(and(eq(workflowRunSource.id, prepared.sourceId!), eq(workflowRunSource.runId, prepared.runId)));
      await tx.update(workflowRun).set({ status: "queued", currentStep: 1, updatedAt: new Date() }).where(eq(workflowRun.id, prepared.runId));
    });
    return { runId: prepared.runId, created: true };
  } catch {
    await db.transaction(async (tx) => {
      await tx.update(workflowRunSource).set({ status: "failed" }).where(eq(workflowRunSource.id, prepared.sourceId!));
      await tx.update(workflowAudioJob).set({ status: "failed", failureCode: "AUDIO_STORAGE_FAILED", completedAt: new Date(), updatedAt: new Date() }).where(eq(workflowAudioJob.runId, prepared.runId));
      await tx.update(workflowRun).set({ status: "failed", failureCode: "AUDIO_STORAGE_FAILED", failureStep: 1, completedAt: new Date(), updatedAt: new Date() }).where(eq(workflowRun.id, prepared.runId));
    });
    throw new WorkflowError(503, "AUDIO_STORAGE_FAILED", "音视频安全存储失败");
  }
}

async function signingKey(): Promise<Buffer> {
  const path = process.env.AUDIO_DOWNLOAD_SIGNING_KEY_FILE?.trim();
  if (!path) throw new WorkflowError(503, "AUDIO_PROVIDER_NOT_CONFIGURED", "语音临时下载签名尚未配置");
  const details = await stat(path);
  if (!details.isFile() || (details.mode & 0o077) !== 0) throw new WorkflowError(503, "AUDIO_PROVIDER_NOT_CONFIGURED", "语音临时下载签名权限无效");
  const key = Buffer.from((await readFile(path, "utf8")).trim(), "base64");
  if (key.length < 32 || key.length > 128) throw new WorkflowError(503, "AUDIO_PROVIDER_NOT_CONFIGURED", "语音临时下载签名无效");
  return key;
}

function signaturePayload(runId: string, sourceId: string, expires: number) { return `${runId}\n${sourceId}\n${expires}`; }

export async function buildAudioProviderUrl(runId: string, sourceId: string): Promise<string> {
  const rawBase = process.env.AUDIO_PROVIDER_PUBLIC_BASE_URL?.trim();
  if (!rawBase) throw new WorkflowError(503, "AUDIO_PROVIDER_NOT_CONFIGURED", "语音 Provider 回源地址尚未配置");
  const base = new URL(rawBase);
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) throw new WorkflowError(503, "AUDIO_PROVIDER_NOT_CONFIGURED", "语音 Provider 回源地址无效");
  const expires = Math.floor(Date.now() / 1_000) + 3_600;
  const signature = createHmac("sha256", await signingKey()).update(signaturePayload(runId, sourceId, expires)).digest("base64url");
  const path = `${base.pathname.replace(/\/$/, "")}/api/workflows/audio-source`;
  base.pathname = path;
  base.searchParams.set("runId", runId);
  base.searchParams.set("sourceId", sourceId);
  base.searchParams.set("expires", String(expires));
  base.searchParams.set("signature", signature);
  return base.toString();
}

export async function readSignedAudioSource(input: { runId: string; sourceId: string; expires: string; signature: string }) {
  const expires = Number(input.expires);
  if (!Number.isInteger(expires) || expires < Math.floor(Date.now() / 1_000) || expires > Math.floor(Date.now() / 1_000) + 3_700) throw new WorkflowError(404, "NOT_FOUND", "音视频来源不存在");
  const expected = createHmac("sha256", await signingKey()).update(signaturePayload(input.runId, input.sourceId, expires)).digest();
  let supplied: Buffer;
  try { supplied = Buffer.from(input.signature, "base64url"); } catch { throw new WorkflowError(404, "NOT_FOUND", "音视频来源不存在"); }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new WorkflowError(404, "NOT_FOUND", "音视频来源不存在");
  const [source] = await getDb().select().from(workflowRunSource).where(and(eq(workflowRunSource.id, input.sourceId), eq(workflowRunSource.runId, input.runId), eq(workflowRunSource.sourceType, "audio"), eq(workflowRunSource.status, "ready"))).limit(1);
  if (!source?.objectKey) throw new WorkflowError(404, "NOT_FOUND", "音视频来源不存在");
  return { object: await getObjectStorage().getObject(source.objectKey), contentType: source.mimeType || "application/octet-stream" };
}
