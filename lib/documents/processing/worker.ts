import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  documentIngestionJob,
  projectDocumentVersion,
  type DocumentIngestionJobRecord,
} from "@/lib/db/schema";
import {
  getObjectStorage,
  type ObjectStorage,
} from "@/lib/files/object-storage";
import {
  validateUploadFile,
} from "@/lib/files/validation";
import type { SupportedFileExtension } from "@/lib/files/config";
import {
  claimIngestionJob,
  completeIngestionJob,
  recordIngestionFailure,
  renewIngestionLease,
} from "./jobs";
import {
  DOCUMENT_WORKER_VERSION,
  getDocumentProcessingConfig,
  type DocumentProcessingConfig,
} from "./config";
import { DocumentProcessingError } from "./errors";
import { parseDocumentWithTimeout } from "./parse-with-timeout";

const HEARTBEAT_FILE = "/tmp/projectai-document-worker-heartbeat";

async function readStream(
  stream: ReadableStream<Uint8Array>,
  expectedSize: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > expectedSize) {
        throw new DocumentProcessingError(
          "FILE_INTEGRITY_MISMATCH",
          "Stored object exceeded the expected size.",
        );
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  if (total !== expectedSize) {
    throw new DocumentProcessingError(
      "FILE_INTEGRITY_MISMATCH",
      "Stored object size did not match the database record.",
    );
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function loadJobBytes(
  job: DocumentIngestionJobRecord,
  storage: ObjectStorage,
): Promise<{ bytes: Uint8Array; extension: SupportedFileExtension }> {
  const [version] = await getDb()
    .select()
    .from(projectDocumentVersion)
    .where(
      and(
        eq(projectDocumentVersion.id, job.versionId),
        eq(projectDocumentVersion.documentId, job.documentId),
        eq(projectDocumentVersion.projectId, job.projectId),
      ),
    )
    .limit(1);
  if (!version || version.storageStatus !== "stored") {
    throw new DocumentProcessingError(
      "INVALID_DOCUMENT_STRUCTURE",
      "Document version is not stored.",
    );
  }
  let stored;
  try {
    stored = await storage.getObject(version.objectKey);
  } catch {
    throw new DocumentProcessingError(
      "OBJECT_READ_FAILED",
      "Stored object could not be read.",
      true,
    );
  }
  if (
    stored.size !== version.sizeBytes ||
    stored.sha256 !== version.sha256 ||
    (version.storageEtag && stored.etag !== version.storageEtag)
  ) {
    throw new DocumentProcessingError(
      "FILE_INTEGRITY_MISMATCH",
      "Stored object metadata did not match the database record.",
    );
  }
  const bytes = await readStream(stored.body, version.sizeBytes);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== version.sha256) {
    throw new DocumentProcessingError(
      "FILE_INTEGRITY_MISMATCH",
      "Stored object checksum did not match the database record.",
    );
  }
  try {
    const fileBuffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(fileBuffer).set(bytes);
    const validated = await validateUploadFile(
      new File([fileBuffer], version.originalFilename, {
        type: version.declaredMimeType,
      }),
    );
    if (
      validated.extension !== version.normalizedExtension ||
      validated.detectedMimeType !== version.detectedMimeType ||
      validated.sha256 !== version.sha256
    ) {
      throw new Error("Validated metadata mismatch.");
    }
    return { bytes, extension: validated.extension };
  } catch {
    throw new DocumentProcessingError(
      "INVALID_DOCUMENT_STRUCTURE",
      "Stored document structure is invalid.",
    );
  }
}

async function touchHeartbeat(): Promise<void> {
  await writeFile(
    HEARTBEAT_FILE,
    `${Date.now()} ${DOCUMENT_WORKER_VERSION}\n`,
    { mode: 0o600 },
  );
}

export type DocumentWorkerOptions = {
  once?: boolean;
  workerId?: string;
  storage?: ObjectStorage;
  config?: DocumentProcessingConfig;
  signal?: AbortSignal;
};

export async function runDocumentWorker(
  options: DocumentWorkerOptions = {},
): Promise<void> {
  const config = options.config ?? getDocumentProcessingConfig();
  const workerId = options.workerId ?? `document-worker-${randomUUID()}`;
  const storage = options.storage ?? getObjectStorage();
  await touchHeartbeat();
  do {
    if (options.signal?.aborted) break;
    const job = await claimIngestionJob(workerId, config);
    await touchHeartbeat();
    if (!job) {
      if (options.once) break;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, config.pollMs);
        const onAbort = () => {
          clearTimeout(timer);
          resolve();
        };
        options.signal?.addEventListener("abort", onAbort, { once: true });
      });
      continue;
    }
    const heartbeat = setInterval(() => {
      void renewIngestionLease(job.id, workerId, config).then((renewed) => {
        if (!renewed) clearInterval(heartbeat);
        return touchHeartbeat();
      });
    }, Math.max(1_000, Math.floor((config.leaseSeconds * 1_000) / 3)));
    heartbeat.unref();
    try {
      const loaded = await loadJobBytes(job, storage);
      const result = await parseDocumentWithTimeout({
        bytes: loaded.bytes,
        extension: loaded.extension,
        config,
      });
      await completeIngestionJob({
        jobId: job.id,
        workerId,
        sections: result.parsed.sections,
        chunks: result.chunks,
      });
    } catch (error) {
      const processingError =
        error instanceof DocumentProcessingError
          ? error
          : new DocumentProcessingError(
              "DOCUMENT_PARSE_FAILED",
              "Document processing failed.",
              true,
            );
      await recordIngestionFailure({
        jobId: job.id,
        workerId,
        error: processingError,
      });
    } finally {
      clearInterval(heartbeat);
      await touchHeartbeat();
    }
  } while (!options.once);
}

export async function countRunningIngestionJobs(): Promise<number> {
  const rows = await getDb()
    .select({ id: documentIngestionJob.id })
    .from(documentIngestionJob)
    .where(eq(documentIngestionJob.status, "running"));
  return rows.length;
}
