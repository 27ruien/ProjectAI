import { eq, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import {
  projectDocument,
  projectDocumentVersion,
  type KnowledgePermission,
  type KnowledgeSpaceType,
  type ProjectDocumentRecord,
  type ProjectDocumentVersionRecord,
} from "@/lib/db/schema";

export type AuthorizedDocumentScope = {
  documentId: string;
  sourceProjectId: string;
  knowledgeSpaceId: string;
  sourceScope: KnowledgeSpaceType;
};

type AuthorizedDocumentRow = {
  document_id: string;
  source_project_id: string;
  knowledge_space_id: string;
  source_scope: KnowledgeSpaceType;
};

export async function listAuthorizedDocumentScope(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  permission: KnowledgePermission;
  db?: DatabaseExecutor;
}): Promise<AuthorizedDocumentScope[]> {
  const executor = input.db ?? getDb();
  const result = await executor.execute<AuthorizedDocumentRow>(sql`
    select document_id, source_project_id, knowledge_space_id, source_scope
    from projectai_authorized_documents(
      ${input.principal.user.id},
      ${input.projectId},
      ${input.permission}::knowledge_permission
    )
    order by document_id
  `);
  return result.rows.map((row) => ({
    documentId: row.document_id,
    sourceProjectId: row.source_project_id,
    knowledgeSpaceId: row.knowledge_space_id,
    sourceScope: row.source_scope,
  }));
}

export async function findAuthorizedDocument(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentId: string;
  permission: KnowledgePermission;
  db?: DatabaseExecutor;
}): Promise<
  | { document: ProjectDocumentRecord; scope: AuthorizedDocumentScope }
  | null
> {
  const executor = input.db ?? getDb();
  const result = await executor.execute<AuthorizedDocumentRow>(sql`
    select document_id, source_project_id, knowledge_space_id, source_scope
    from projectai_authorized_documents(
      ${input.principal.user.id},
      ${input.projectId},
      ${input.permission}::knowledge_permission
    )
    where document_id = ${input.documentId}
    limit 1
  `);
  const row = result.rows[0];
  if (!row) return null;
  const [document] = await executor
    .select()
    .from(projectDocument)
    .where(eq(projectDocument.id, input.documentId))
    .limit(1);
  if (!document) return null;
  return {
    document,
    scope: {
      documentId: row.document_id,
      sourceProjectId: row.source_project_id,
      knowledgeSpaceId: row.knowledge_space_id,
      sourceScope: row.source_scope,
    },
  };
}

export async function findAuthorizedDocumentVersion(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  documentId: string;
  versionId: string;
  permission: KnowledgePermission;
  db?: DatabaseExecutor;
}): Promise<
  | {
      document: ProjectDocumentRecord;
      version: ProjectDocumentVersionRecord;
      scope: AuthorizedDocumentScope;
    }
  | null
> {
  const authorized = await findAuthorizedDocument(input);
  if (!authorized) return null;
  const executor = input.db ?? getDb();
  const [version] = await executor
    .select()
    .from(projectDocumentVersion)
    .where(eq(projectDocumentVersion.id, input.versionId))
    .limit(1);
  if (!version || version.documentId !== input.documentId) return null;
  return { ...authorized, version };
}
