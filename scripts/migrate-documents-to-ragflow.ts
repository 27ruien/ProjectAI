import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { createHash } from "node:crypto";
import { closeDatabasePool, getDb } from "../lib/db/client";
import {
  project,
  projectDocument,
  projectDocumentVersion,
  type ProjectRecord,
} from "../lib/db/schema";
import { getObjectStorage } from "../lib/files/object-storage";
import {
  createRagflowClient,
  type RagflowClient,
} from "../lib/ragflow";
import {
  provisionProjectDataset,
  requireReadyDataset,
} from "../lib/knowledge-slim/datasets";

type Options = {
  dryRun: boolean;
  all: boolean;
  projectId: string | null;
  resume: boolean;
};

type Summary = {
  dryRun: boolean;
  resume: boolean;
  projects: number;
  datasetsReady: number;
  documentsDiscovered: number;
  documentsUploaded: number;
  documentsReused: number;
  parseStarted: number;
  documentsReady: number;
  failed: number;
};

const POLL_INTERVAL_MS = 5_000;
const PARSE_TIMEOUT_MS = 20 * 60_000;

async function waitForParse(
  client: RagflowClient,
  datasetId: string,
  documentId: string,
): Promise<void> {
  const deadline = Date.now() + PARSE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const document = await client.getDocumentStatus(datasetId, documentId);
    if (!document) throw new Error("RAGFlow document disappeared during parsing.");
    if (document.parseStatus === "ready") return;
    if (document.parseStatus === "failed") throw new Error("RAGFlow parsing failed.");
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error("RAGFlow parsing timed out.");
}

function parseOptions(argv: string[]): Options {
  const dryRun = argv.includes("--dry-run");
  const all = argv.includes("--all");
  const resume = argv.includes("--resume");
  const projectIndex = argv.indexOf("--project");
  const projectId = projectIndex >= 0 ? argv[projectIndex + 1]?.trim() || null : null;
  if ((all ? 1 : 0) + (projectId ? 1 : 0) !== 1) {
    throw new Error("Choose exactly one scope: --project <id> or --all.");
  }
  const known = new Set(["--dry-run", "--all", "--resume", "--project", projectId ?? ""]);
  const unknown = argv.filter((value, index) => !known.has(value) && argv[index - 1] !== "--project");
  if (unknown.length) throw new Error(`Unknown option: ${unknown[0]}`);
  return { dryRun, all, projectId, resume };
}

function migrationFilename(documentId: string, extension: string): string {
  const safeExtension = extension.replace(/[^a-z0-9]/giu, "").toLocaleLowerCase() || "bin";
  return `projectai-${documentId}.${safeExtension}`.slice(0, 240);
}

async function scopedProjects(options: Options): Promise<ProjectRecord[]> {
  return getDb()
    .select()
    .from(project)
    .where(options.projectId ? eq(project.id, options.projectId) : eq(project.isInternal, false))
    .orderBy(asc(project.createdAt));
}

async function sourceDocuments(projectIds: string[], resume: boolean) {
  if (projectIds.length === 0) return [];
  return getDb()
    .select({
      documentId: projectDocument.id,
      projectId: projectDocument.projectId,
      ragflowDocumentId: projectDocument.ragflowDocumentId,
      ragflowParseStatus: projectDocument.ragflowParseStatus,
      objectKey: projectDocumentVersion.objectKey,
      extension: projectDocumentVersion.normalizedExtension,
      mimeType: projectDocumentVersion.detectedMimeType,
      sizeBytes: projectDocumentVersion.sizeBytes,
      sha256: projectDocumentVersion.sha256,
    })
    .from(projectDocument)
    .innerJoin(
      projectDocumentVersion,
      and(
        eq(projectDocumentVersion.documentId, projectDocument.id),
        eq(projectDocumentVersion.projectId, projectDocument.projectId),
      ),
    )
    .where(and(
      inArray(projectDocument.projectId, projectIds),
      eq(projectDocument.status, "active"),
      eq(projectDocumentVersion.isCurrent, true),
      eq(projectDocumentVersion.storageStatus, "stored"),
      resume
        ? or(
            eq(projectDocument.ragflowParseStatus, "failed"),
            isNull(projectDocument.ragflowDocumentId),
          )
        : isNull(projectDocument.ragflowDocumentId),
    ))
    .orderBy(asc(projectDocument.projectId), asc(projectDocument.createdAt));
}

async function ensureDataset(
  record: ProjectRecord,
  client: RagflowClient,
): Promise<ProjectRecord> {
  if (record.knowledgeStatus === "ready" && record.ragflowDatasetId) return record;
  return provisionProjectDataset({
    projectId: record.id,
    actorUserId: record.createdBy,
    client,
  });
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const projects = await scopedProjects(options);
  if (options.projectId && projects.length !== 1) throw new Error("Project not found.");
  const documents = await sourceDocuments(projects.map((item) => item.id), options.resume);
  const summary: Summary = {
    dryRun: options.dryRun,
    resume: options.resume,
    projects: projects.length,
    datasetsReady: projects.filter((item) => item.knowledgeStatus === "ready" && item.ragflowDatasetId).length,
    documentsDiscovered: documents.length,
    documentsUploaded: 0,
    documentsReused: 0,
    parseStarted: 0,
    documentsReady: 0,
    failed: 0,
  };
  if (options.dryRun) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }

  const client = await createRagflowClient();
  const storage = getObjectStorage();
  const projectById = new Map(projects.map((item) => [item.id, item]));
  for (const initial of projects) {
    try {
      const ready = await ensureDataset(initial, client);
      projectById.set(ready.id, ready);
      summary.datasetsReady += initial.knowledgeStatus === "ready" && initial.ragflowDatasetId ? 0 : 1;
    } catch {
      summary.failed += documents.filter((item) => item.projectId === initial.id).length || 1;
    }
  }

  for (const document of documents) {
    const owningProject = projectById.get(document.projectId);
    if (!owningProject || owningProject.knowledgeStatus !== "ready" || !owningProject.ragflowDatasetId) continue;
    const datasetId = requireReadyDataset(owningProject);
    let mappedRemoteId = document.ragflowDocumentId;
    try {
      if (document.ragflowDocumentId) {
        await client.parseDocuments(datasetId, [document.ragflowDocumentId]);
        await getDb().update(projectDocument).set({
          ragflowParseStatus: "processing",
          ragflowFailureCode: null,
          updatedAt: new Date(),
        }).where(and(eq(projectDocument.id, document.documentId), eq(projectDocument.projectId, document.projectId)));
        summary.documentsReused += 1;
        summary.parseStarted += 1;
        await waitForParse(client, datasetId, document.ragflowDocumentId);
        await getDb().update(projectDocument).set({
          ragflowParseStatus: "ready",
          ragflowFailureCode: null,
          updatedAt: new Date(),
        }).where(and(eq(projectDocument.id, document.documentId), eq(projectDocument.projectId, document.projectId)));
        summary.documentsReady += 1;
        continue;
      }

      const filename = migrationFilename(document.documentId, document.extension);
      const remoteDocuments = await client.listDocuments(datasetId);
      let remote = remoteDocuments.find((item) => item.name === filename) ?? null;
      if (remote) {
        summary.documentsReused += 1;
      } else {
        const object = await storage.getObject(document.objectKey);
        const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
        if (bytes.byteLength !== document.sizeBytes) throw new Error("Stored object size mismatch.");
        if (createHash("sha256").update(bytes).digest("hex") !== document.sha256) {
          throw new Error("Stored object integrity mismatch.");
        }
        remote = await client.uploadDocument({
          datasetId,
          filename,
          blob: new Blob([bytes], { type: document.mimeType }),
        });
        summary.documentsUploaded += 1;
      }
      await getDb().update(projectDocument).set({
        ragflowDocumentId: remote.id,
        ragflowParseStatus: "processing",
        ragflowFailureCode: null,
        mimeType: document.mimeType,
        sizeBytes: document.sizeBytes,
        sha256: document.sha256,
        updatedAt: new Date(),
      }).where(and(eq(projectDocument.id, document.documentId), eq(projectDocument.projectId, document.projectId)));
      mappedRemoteId = remote.id;
      await client.parseDocuments(datasetId, [remote.id]);
      summary.parseStarted += 1;
      await waitForParse(client, datasetId, remote.id);
      await getDb().update(projectDocument).set({
        ragflowParseStatus: "ready",
        ragflowFailureCode: null,
        updatedAt: new Date(),
      }).where(and(eq(projectDocument.id, document.documentId), eq(projectDocument.projectId, document.projectId)));
      summary.documentsReady += 1;
    } catch {
      summary.failed += 1;
      await getDb().update(projectDocument).set({
        ragflowParseStatus: mappedRemoteId ? "failed" : null,
        ragflowFailureCode: mappedRemoteId ? "KNOWLEDGE_MIGRATION_FAILED" : null,
        updatedAt: new Date(),
      }).where(and(eq(projectDocument.id, document.documentId), eq(projectDocument.projectId, document.projectId)));
    }
  }
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main()
  .then(() => closeDatabasePool())
  .catch(async (error: unknown) => {
    process.stderr.write(`RAGFlow migration failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    await closeDatabasePool();
    process.exitCode = 1;
  });
