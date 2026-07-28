import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import {
  projectDocument,
  projectDocumentVersion,
  testFixture,
  type KnowledgePermission,
  type KnowledgeSpaceType,
  type ProjectDocumentRecord,
  type ProjectDocumentVersionRecord,
} from "@/lib/db/schema";
import { includeTestFixturesInProductQueries } from "@/lib/test-fixtures/service";

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

async function filterFixtureDocumentScopes(
  scopes: AuthorizedDocumentScope[],
  executor: DatabaseExecutor,
): Promise<AuthorizedDocumentScope[]> {
  if (!scopes.length || includeTestFixturesInProductQueries()) return scopes;
  const documentIds = [...new Set(scopes.map((scope) => scope.documentId))];
  const projectIds = [...new Set(scopes.map((scope) => scope.sourceProjectId))];
  const knowledgeSpaceIds = [...new Set(scopes.map((scope) => scope.knowledgeSpaceId))];
  const fixtures = await executor
    .select({ entityType: testFixture.entityType, entityId: testFixture.entityId })
    .from(testFixture)
    .where(
      and(
        eq(testFixture.isTestFixture, true),
        or(
          and(eq(testFixture.entityType, "document"), inArray(testFixture.entityId, documentIds)),
          and(eq(testFixture.entityType, "project"), inArray(testFixture.entityId, projectIds)),
          and(eq(testFixture.entityType, "knowledge_space"), inArray(testFixture.entityId, knowledgeSpaceIds)),
        ),
      ),
    );
  const fixtureKeys = new Set(
    fixtures.map((fixture) => `${fixture.entityType}:${fixture.entityId}`),
  );
  return scopes.filter(
    (scope) =>
      !fixtureKeys.has(`document:${scope.documentId}`) &&
      !fixtureKeys.has(`project:${scope.sourceProjectId}`) &&
      !fixtureKeys.has(`knowledge_space:${scope.knowledgeSpaceId}`),
  );
}

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
  return filterFixtureDocumentScopes(result.rows.map((row) => ({
    documentId: row.document_id,
    sourceProjectId: row.source_project_id,
    knowledgeSpaceId: row.knowledge_space_id,
    sourceScope: row.source_scope,
  })), executor);
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
  // Fixture-backed records stay absent from ordinary list/search responses,
  // while an exact-ID UAT request still traverses the real authorization
  // function. Production cannot register fixtures, and the SQL scope above
  // continues to enforce project, role, grant, and deny rules.
  const [row] = result.rows.map((item) => ({
    documentId: item.document_id,
    sourceProjectId: item.source_project_id,
    knowledgeSpaceId: item.knowledge_space_id,
    sourceScope: item.source_scope,
  }));
  if (!row) return null;
  const [document] = await executor
    .select()
    .from(projectDocument)
    .where(and(
      eq(projectDocument.id, input.documentId),
      eq(projectDocument.projectId, row.sourceProjectId),
    ))
    .limit(1);
  if (!document) return null;
  return {
    document,
    scope: {
      documentId: row.documentId,
      sourceProjectId: row.sourceProjectId,
      knowledgeSpaceId: row.knowledgeSpaceId,
      sourceScope: row.sourceScope,
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
