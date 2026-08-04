import { and, eq, sql } from "drizzle-orm";
import { requireProjectAccess, requireProjectRole } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { getDb, type DatabaseTransaction } from "@/lib/db/client";
import { getPostgresErrorCode } from "@/lib/db/errors";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import {
  projectDocument,
  projectDocumentFolder,
  user,
  type ProjectDocumentFolderRecord,
} from "@/lib/db/schema";
import { requireUploadableKnowledgeSpace } from "@/lib/knowledge/management";
import type { ProjectDocumentFolderDto } from "@/types/file-workspace";
import { FileOperationError } from "./errors";
import { documentRoles } from "./document-service";

function normalizedFolderName(value: string): string {
  const name = value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
  if (!name) throw new FileOperationError(400, "INVALID_REQUEST", "文件夹名称不能为空");
  return name;
}
async function folderInProject(
  tx: DatabaseTransaction | ReturnType<typeof getDb>,
  projectId: string,
  folderId: string,
  lockForUpdate = false,
): Promise<ProjectDocumentFolderRecord | null> {
  const query = tx
    .select()
    .from(projectDocumentFolder)
    .where(
      and(
        eq(projectDocumentFolder.id, folderId),
        eq(projectDocumentFolder.projectId, projectId),
      ),
    )
    .limit(1);
  const [folder] = lockForUpdate
    ? await query.for("update", { of: projectDocumentFolder })
    : await query;
  return folder ?? null;
}

async function validateParent(input: {
  tx: DatabaseTransaction;
  projectId: string;
  knowledgeSpaceId: string;
  folderId?: string;
  parentFolderId: string | null;
}) {
  if (!input.parentFolderId) return;
  if (input.parentFolderId === input.folderId) {
    throw new FileOperationError(409, "FOLDER_CYCLE", "文件夹不能移动到自身");
  }
  let cursor: string | null = input.parentFolderId;
  const visited = new Set<string>();
  for (let depth = 0; cursor && depth < 64; depth += 1) {
    if (visited.has(cursor) || cursor === input.folderId) {
      throw new FileOperationError(409, "FOLDER_CYCLE", "不能把文件夹移动到自己的子文件夹");
    }
    visited.add(cursor);
    const parent = await folderInProject(input.tx, input.projectId, cursor, true);
    if (!parent || parent.knowledgeSpaceId !== input.knowledgeSpaceId) {
      throw new FileOperationError(404, "FOLDER_NOT_FOUND", "目标文件夹不存在或不可访问");
    }
    cursor = parent.parentFolderId;
  }
  if (cursor) throw new FileOperationError(409, "FOLDER_DEPTH_LIMIT", "文件夹层级过深");
}

function folderPermissions(
  principal: AuthenticatedPrincipal,
  projectRole: string | null,
) {
  const admin = principal.user.productRole !== "member";
  const writer = admin || projectRole === "project_manager" || projectRole === "project_member";
  const manager = admin || projectRole === "project_manager";
  return { canEdit: writer, canDelete: manager };
}

export async function listProjectFolders(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
}): Promise<ProjectDocumentFolderDto[]> {
  const access = await requireProjectAccess(
    input.principal,
    input.projectId,
    input.requestHeaders,
  );
  const rows = await getDb()
    .select({ folder: projectDocumentFolder, creatorName: user.displayName })
    .from(projectDocumentFolder)
    .innerJoin(user, eq(user.id, projectDocumentFolder.createdBy))
    .where(eq(projectDocumentFolder.projectId, input.projectId));
  const permissions = folderPermissions(input.principal, access.projectRole);
  return rows.map(({ folder, creatorName }) => ({
    id: folder.id,
    projectId: folder.projectId,
    knowledgeSpaceId: folder.knowledgeSpaceId,
    parentFolderId: folder.parentFolderId,
    name: folder.name,
    createdBy: { displayName: creatorName },
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
    permissions,
  }));
}

export async function createProjectFolder(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  knowledgeSpaceId: string;
  parentFolderId: string | null;
  name: string;
  requestHeaders: Headers;
}): Promise<ProjectDocumentFolderRecord> {
  await requireProjectRole(
    input.principal,
    input.projectId,
    documentRoles.upload,
    input.requestHeaders,
  );
  const destination = await requireUploadableKnowledgeSpace({
    principal: input.principal,
    projectId: input.projectId,
    knowledgeSpaceId: input.knowledgeSpaceId,
    requestHeaders: input.requestHeaders,
  });
  if (destination.type !== "project" || destination.projectId !== input.projectId) {
    throw new FileOperationError(400, "INVALID_REQUEST", "项目文件夹必须位于项目知识空间");
  }
  try {
    return await getDb().transaction(async (tx) => {
      await validateParent({
        tx,
        projectId: input.projectId,
        knowledgeSpaceId: destination.id,
        parentFolderId: input.parentFolderId,
      });
      const [folder] = await tx
        .insert(projectDocumentFolder)
        .values({
          id: crypto.randomUUID(),
          projectId: input.projectId,
          knowledgeSpaceId: destination.id,
          parentFolderId: input.parentFolderId,
          name: normalizedFolderName(input.name),
          createdBy: input.principal.user.id,
        })
        .returning();
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          projectId: input.projectId,
          eventType: "project_folder_created",
          entityType: "project_document_folder",
          entityId: folder.id,
          result: "succeeded",
          metadata: { parentFolderId: folder.parentFolderId },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
      return folder;
    });
  } catch (error) {
    if (getPostgresErrorCode(error) === "23505") {
      throw new FileOperationError(409, "FOLDER_NAME_CONFLICT", "同级已有同名文件夹");
    }
    throw error;
  }
}

export async function updateProjectFolder(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  folderId: string;
  name?: string;
  parentFolderId?: string | null;
  requestHeaders: Headers;
}): Promise<ProjectDocumentFolderRecord> {
  await requireProjectRole(
    input.principal,
    input.projectId,
    documentRoles.upload,
    input.requestHeaders,
  );
  try {
    return await getDb().transaction(async (tx) => {
      const current = await folderInProject(tx, input.projectId, input.folderId, true);
      if (!current) throw new FileOperationError(404, "FOLDER_NOT_FOUND", "文件夹不存在");
      const parentFolderId =
        input.parentFolderId === undefined ? current.parentFolderId : input.parentFolderId;
      await validateParent({
        tx,
        projectId: input.projectId,
        knowledgeSpaceId: current.knowledgeSpaceId,
        folderId: current.id,
        parentFolderId,
      });
      const [updated] = await tx
        .update(projectDocumentFolder)
        .set({
          name: input.name === undefined ? current.name : normalizedFolderName(input.name),
          parentFolderId,
          updatedAt: new Date(),
        })
        .where(eq(projectDocumentFolder.id, current.id))
        .returning();
      await writeAuditEvent(
        {
          actorUserId: input.principal.user.id,
          projectId: input.projectId,
          eventType: "project_folder_updated",
          entityType: "project_document_folder",
          entityId: current.id,
          result: "succeeded",
          metadata: { parentFolderId },
          ...getRequestAuditContext(input.requestHeaders),
        },
        tx,
      );
      return updated;
    });
  } catch (error) {
    if (getPostgresErrorCode(error) === "23505") {
      throw new FileOperationError(409, "FOLDER_NAME_CONFLICT", "同级已有同名文件夹");
    }
    throw error;
  }
}

export async function deleteProjectFolder(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  folderId: string;
  requestHeaders: Headers;
}): Promise<void> {
  await requireProjectRole(
    input.principal,
    input.projectId,
    documentRoles.manage,
    input.requestHeaders,
  );
  await getDb().transaction(async (tx) => {
    const current = await folderInProject(tx, input.projectId, input.folderId, true);
    if (!current) throw new FileOperationError(404, "FOLDER_NOT_FOUND", "文件夹不存在");
    const [{ childCount }] = await tx
      .select({ childCount: sql<number>`count(*)::int` })
      .from(projectDocumentFolder)
      .where(
        and(
          eq(projectDocumentFolder.projectId, input.projectId),
          eq(projectDocumentFolder.parentFolderId, input.folderId),
        ),
      );
    const [{ documentCount }] = await tx
      .select({ documentCount: sql<number>`count(*)::int` })
      .from(projectDocument)
      .where(
        and(
          eq(projectDocument.projectId, input.projectId),
          eq(projectDocument.folderId, input.folderId),
        ),
      );
    if (childCount + documentCount > 0) {
      throw new FileOperationError(
        409,
        "FOLDER_NOT_EMPTY",
        "文件夹中仍有内容，请先移动或删除其中的文件",
      );
    }
    await tx.delete(projectDocumentFolder).where(eq(projectDocumentFolder.id, current.id));
    await writeAuditEvent(
      {
        actorUserId: input.principal.user.id,
        projectId: input.projectId,
        eventType: "project_folder_deleted",
        entityType: "project_document_folder",
        entityId: current.id,
        result: "succeeded",
        metadata: { parentFolderId: current.parentFolderId },
        ...getRequestAuditContext(input.requestHeaders),
      },
      tx,
    );
  });
}

export async function requireProjectFolder(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  folderId: string;
  requestHeaders: Headers;
}) {
  await requireProjectAccess(input.principal, input.projectId, input.requestHeaders);
  const folder = await folderInProject(getDb(), input.projectId, input.folderId);
  if (!folder) throw new FileOperationError(404, "FOLDER_NOT_FOUND", "文件夹不存在");
  return folder;
}
