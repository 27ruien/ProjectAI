import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { project, type ProjectRecord } from "@/lib/db/schema";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { createRagflowClient, type RagflowClient } from "@/lib/ragflow";
import { KnowledgeServiceError } from "./errors";

export function ragflowDatasetName(projectId: string): string {
  return `project-ai-${projectId}`.slice(0, 128);
}

async function projectRecord(projectId: string): Promise<ProjectRecord> {
  const [record] = await getDb()
    .select()
    .from(project)
    .where(eq(project.id, projectId))
    .limit(1);
  if (!record) throw new KnowledgeServiceError(404, "NOT_FOUND", "项目不存在");
  return record;
}

export async function provisionProjectDataset(input: {
  projectId: string;
  actorUserId: string;
  client?: RagflowClient;
}): Promise<ProjectRecord> {
  const client = input.client ?? (await createRagflowClient());
  const current = await projectRecord(input.projectId);
  try {
    let datasetId: string | null = null;
    if (current.ragflowDatasetId) {
      const existing = await client.listDatasets({ id: current.ragflowDatasetId });
      datasetId = existing.find((item) => item.id === current.ragflowDatasetId)?.id ?? null;
    }
    if (!datasetId) {
      const name = ragflowDatasetName(current.id);
      const matches = await client.listDatasets({ name });
      datasetId = matches.find((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())?.id ?? null;
      if (!datasetId) {
        try {
          datasetId = (await client.createDataset({
            name,
            description: `Project AI knowledge dataset for ${current.id}`,
          })).id;
        } catch (error) {
          // Dataset names are unique in RAGFlow. A concurrent retry may have
          // created the deterministic dataset between list and create.
          const afterConflict = await client.listDatasets({ name });
          datasetId = afterConflict.find(
            (item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
          )?.id ?? null;
          if (!datasetId) throw error;
        }
      }
    }
    const [updated] = await getDb()
      .update(project)
      .set({
        ragflowDatasetId: datasetId,
        knowledgeStatus: "ready",
        knowledgeFailureCode: null,
        updatedAt: new Date(),
      })
      .where(eq(project.id, current.id))
      .returning();
    await writeAuditEvent({
      actorUserId: input.actorUserId,
      projectId: current.id,
      eventType: "project_knowledge_provisioned",
      entityType: "project",
      entityId: current.id,
      result: "succeeded",
      metadata: { knowledgeStatus: "ready" },
    });
    return updated;
  } catch (error) {
    const failureCode = "KNOWLEDGE_PROVISION_FAILED";
    await getDb()
      .update(project)
      .set({
        knowledgeStatus: "failed",
        knowledgeFailureCode: failureCode,
        updatedAt: new Date(),
      })
      .where(eq(project.id, current.id));
    await writeAuditEvent({
      actorUserId: input.actorUserId,
      projectId: current.id,
      eventType: "project_knowledge_provision_failed",
      entityType: "project",
      entityId: current.id,
      result: "failed",
      metadata: { failureCode },
    });
    throw error;
  }
}

export function requireReadyDataset(
  record: Pick<ProjectRecord, "ragflowDatasetId" | "knowledgeStatus">,
): string {
  if (record.knowledgeStatus !== "ready" || !record.ragflowDatasetId) {
    throw new KnowledgeServiceError(
      409,
      "PROJECT_KNOWLEDGE_NOT_READY",
      "项目知识空间尚未就绪",
    );
  }
  return record.ragflowDatasetId;
}
