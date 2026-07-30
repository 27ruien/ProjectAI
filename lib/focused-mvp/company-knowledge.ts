import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getDb, type DatabaseExecutor } from "@/lib/db/client";
import {
  companyKnowledgeDocument,
  departmentMember,
  knowledgeSpace,
  organization,
  organizationMember,
  project,
  projectDocument,
  projectDocumentVersion,
} from "@/lib/db/schema";
import { listAuthorizedDocuments, listProjectDocumentVersions } from "@/lib/db/repositories/document-repository";
import { createProjectWithManager } from "@/lib/db/repositories/project-repository";
import { serializeDocumentList, serializeDocumentVersions } from "@/lib/files/serialization";
import { uploadDocument } from "@/lib/files/document-service";
import { KnowledgeManagementError } from "@/lib/knowledge/errors";

export const companyCategories = [
  "charter",
  "hr",
  "project_management",
  "security",
  "finance",
  "template",
  "other",
] as const;
export type CompanyCategory = (typeof companyCategories)[number];
export type CompanyAudience = "organization" | "department" | "admin";
export type CompanyLifecycle = "draft" | "published" | "expired" | "archived";

function isAdmin(principal: AuthenticatedPrincipal): boolean {
  return principal.user.productRole === "super_admin" || principal.user.productRole === "admin";
}

async function companyOrganization(
  principal: AuthenticatedPrincipal,
  db: DatabaseExecutor = getDb(),
) {
  const [current] = await db
    .select()
    .from(organization)
    .where(and(eq(organization.slug, "kivisense"), eq(organization.isActive, true)))
    .limit(1);
  if (!current) throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "公司知识库不存在");
  if (!isAdmin(principal)) {
    const [membership] = await db
      .select({ id: organizationMember.id })
      .from(organizationMember)
      .where(and(
        eq(organizationMember.organizationId, current.id),
        eq(organizationMember.userId, principal.user.id),
        eq(organizationMember.isActive, true),
      ))
      .limit(1);
    if (!membership) throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "公司知识库不存在");
  }
  return current;
}

function requireCompanyAdmin(principal: AuthenticatedPrincipal): void {
  if (!isAdmin(principal)) {
    throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "公司知识库不存在");
  }
}

export async function listCompanyKnowledge(input: {
  principal: AuthenticatedPrincipal;
  category?: CompanyCategory;
  query?: string;
}) {
  const db = getDb();
  const currentOrganization = await companyOrganization(input.principal, db);
  const admin = isAdmin(input.principal);
  const departmentIds = admin
    ? []
    : (await db
        .select({ id: departmentMember.departmentId })
        .from(departmentMember)
        .where(and(
          eq(departmentMember.organizationId, currentOrganization.id),
          eq(departmentMember.userId, input.principal.user.id),
          eq(departmentMember.isActive, true),
        )))
        .map((item) => item.id);
  const filters = [eq(companyKnowledgeDocument.organizationId, currentOrganization.id)];
  if (input.category) filters.push(eq(companyKnowledgeDocument.category, input.category));
  if (!admin) {
    filters.push(eq(companyKnowledgeDocument.lifecycleStatus, "published"));
    filters.push(sql`(${companyKnowledgeDocument.expiresAt} is null or ${companyKnowledgeDocument.expiresAt} > now())`);
    filters.push(or(
      eq(companyKnowledgeDocument.audience, "organization"),
      departmentIds.length
        ? and(
            eq(companyKnowledgeDocument.audience, "department"),
            inArray(companyKnowledgeDocument.departmentId, departmentIds),
          )
        : sql`false`,
    )!);
  }
  const metadata = await db
    .select()
    .from(companyKnowledgeDocument)
    .where(and(...filters))
    .orderBy(desc(companyKnowledgeDocument.updatedAt));
  const documents = metadata.length
    ? await listAuthorizedDocuments(metadata.map((item) => item.documentId), "active", db)
    : [];
  const serialized = await serializeDocumentList(documents, input.principal, null);
  const metadataByDocument = new Map(metadata.map((item) => [item.documentId, item]));
  const keyword = input.query?.trim().toLocaleLowerCase("zh-CN") ?? "";
  return {
    canManage: admin,
    documents: serialized
      .map((document) => {
        const item = metadataByDocument.get(document.id)!;
        const effectiveLifecycle: CompanyLifecycle =
          item.lifecycleStatus === "published" && item.expiresAt && item.expiresAt <= new Date()
            ? "expired"
            : (item.lifecycleStatus as CompanyLifecycle);
        return {
          ...document,
          category: item.category as CompanyCategory,
          lifecycleStatus: effectiveLifecycle,
          audience: item.audience as CompanyAudience,
          departmentId: item.departmentId,
          publishedAt: item.publishedAt?.toISOString() ?? null,
          expiresAt: item.expiresAt?.toISOString() ?? null,
        };
      })
      .filter((item) => !keyword || item.displayName.toLocaleLowerCase("zh-CN").includes(keyword)),
  };
}

async function companyUploadContext(principal: AuthenticatedPrincipal, db: DatabaseExecutor) {
  requireCompanyAdmin(principal);
  const currentOrganization = await companyOrganization(principal, db);
  const [space] = await db
    .select()
    .from(knowledgeSpace)
    .where(and(
      eq(knowledgeSpace.organizationId, currentOrganization.id),
      eq(knowledgeSpace.type, "organization"),
      eq(knowledgeSpace.isActive, true),
    ))
    .orderBy(asc(knowledgeSpace.createdAt))
    .limit(1);
  const [storageProject] = await db
    .select({ id: project.id })
    .from(project)
    .where(and(
      eq(project.organizationId, currentOrganization.id),
      eq(project.isInternal, true),
    ))
    .limit(1);
  if (!space) {
    throw new KnowledgeManagementError(409, "SOURCE_CONFLICT", "公司知识空间尚未初始化");
  }
  if (storageProject) return { organization: currentOrganization, space, storageProject };
  const created = await createProjectWithManager({
    id: `project-company-knowledge-${currentOrganization.id}`,
    organizationId: currentOrganization.id,
    name: "公司知识库内部存储",
    clientName: "内部系统",
    description: "ProjectAI 公司知识库使用的内部存储项目，不在项目列表显示。",
    status: "active",
    stage: "operation",
    health: "healthy",
    isInternal: true,
    createdBy: principal.user.id,
  }, db);
  return { organization: currentOrganization, space, storageProject: created };
}

export async function uploadCompanyKnowledge(input: {
  principal: AuthenticatedPrincipal;
  requestHeaders: Headers;
  idempotencyKey: string;
  file: File;
  displayName: string | null;
  versionNote: string | null;
  category: CompanyCategory;
  audience: CompanyAudience;
  departmentId: string | null;
  expiresAt: Date | null;
}) {
  const context = await companyUploadContext(input.principal, getDb());
  if ((input.audience === "department") !== Boolean(input.departmentId)) {
    throw new KnowledgeManagementError(400, "INVALID_REQUEST", "部门可见资料必须选择部门");
  }
  const uploaded = await uploadDocument({
    principal: input.principal,
    projectId: context.storageProject.id,
    requestHeaders: input.requestHeaders,
    idempotencyKey: input.idempotencyKey,
    file: input.file,
    displayName: input.displayName,
    versionNote: input.versionNote,
    knowledgeSpaceId: context.space.id,
  });
  await getDb()
    .insert(companyKnowledgeDocument)
    .values({
      documentId: uploaded.document.id,
      organizationId: context.organization.id,
      category: input.category,
      audience: input.audience,
      departmentId: input.departmentId,
      expiresAt: input.expiresAt,
      createdBy: input.principal.user.id,
      updatedBy: input.principal.user.id,
    })
    .onConflictDoNothing({ target: companyKnowledgeDocument.documentId });
  return { documentId: uploaded.document.id, replayed: uploaded.replayed };
}

export async function updateCompanyKnowledge(input: {
  principal: AuthenticatedPrincipal;
  documentId: string;
  lifecycleStatus?: CompanyLifecycle;
  category?: CompanyCategory;
  audience?: CompanyAudience;
  departmentId?: string | null;
  expiresAt?: Date | null;
}) {
  requireCompanyAdmin(input.principal);
  const currentOrganization = await companyOrganization(input.principal);
  if (input.audience && (input.audience === "department") !== Boolean(input.departmentId)) {
    throw new KnowledgeManagementError(400, "INVALID_REQUEST", "部门可见资料必须选择部门");
  }
  const [updated] = await getDb()
    .update(companyKnowledgeDocument)
    .set({
      ...(input.lifecycleStatus ? { lifecycleStatus: input.lifecycleStatus } : {}),
      ...(input.category ? { category: input.category } : {}),
      ...(input.audience ? { audience: input.audience } : {}),
      ...(input.departmentId !== undefined ? { departmentId: input.departmentId } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
      ...(input.lifecycleStatus === "published" ? { publishedAt: new Date() } : {}),
      updatedBy: input.principal.user.id,
      updatedAt: new Date(),
    })
    .where(and(
      eq(companyKnowledgeDocument.documentId, input.documentId),
      eq(companyKnowledgeDocument.organizationId, currentOrganization.id),
    ))
    .returning();
  if (!updated) throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "公司资料不存在");
  return updated;
}

export async function uploadCompanyKnowledgeVersion(input: {
  principal: AuthenticatedPrincipal;
  documentId: string;
  requestHeaders: Headers;
  idempotencyKey: string;
  file: File;
  versionNote: string | null;
}) {
  requireCompanyAdmin(input.principal);
  const currentOrganization = await companyOrganization(input.principal);
  const [record] = await getDb()
    .select({ projectId: projectDocument.projectId })
    .from(companyKnowledgeDocument)
    .innerJoin(projectDocument, eq(projectDocument.id, companyKnowledgeDocument.documentId))
    .where(and(
      eq(companyKnowledgeDocument.documentId, input.documentId),
      eq(companyKnowledgeDocument.organizationId, currentOrganization.id),
    ))
    .limit(1);
  if (!record) throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "公司资料不存在");
  const uploaded = await uploadDocument({
    principal: input.principal,
    projectId: record.projectId,
    documentId: input.documentId,
    requestHeaders: input.requestHeaders,
    idempotencyKey: input.idempotencyKey,
    file: input.file,
    displayName: null,
    versionNote: input.versionNote,
  });
  await getDb().update(companyKnowledgeDocument).set({
    lifecycleStatus: "draft",
    publishedAt: null,
    updatedBy: input.principal.user.id,
    updatedAt: new Date(),
  }).where(eq(companyKnowledgeDocument.documentId, input.documentId));
  return uploaded;
}

export async function listCompanyKnowledgeVersions(input: {
  principal: AuthenticatedPrincipal;
  documentId: string;
}) {
  const currentOrganization = await companyOrganization(input.principal);
  const visible = await listCompanyKnowledge({ principal: input.principal });
  const document = visible.documents.find((item) => item.id === input.documentId);
  if (!document) throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "公司资料不存在");
  const [metadata] = await getDb().select().from(companyKnowledgeDocument).where(and(
    eq(companyKnowledgeDocument.documentId, input.documentId),
    eq(companyKnowledgeDocument.organizationId, currentOrganization.id),
  )).limit(1);
  if (!metadata) throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "公司资料不存在");
  const versions = await listProjectDocumentVersions(document.projectId, document.id);
  return { document, versions: await serializeDocumentVersions(versions) };
}

export async function requireReadableCompanyVersion(input: {
  principal: AuthenticatedPrincipal;
  documentId: string;
  versionId: string;
}) {
  const visible = await listCompanyKnowledge({ principal: input.principal });
  const document = visible.documents.find((item) => item.id === input.documentId);
  if (!document) throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "公司资料不存在");
  const [version] = await getDb().select().from(projectDocumentVersion).where(and(
    eq(projectDocumentVersion.id, input.versionId),
    eq(projectDocumentVersion.documentId, input.documentId),
    eq(projectDocumentVersion.projectId, document.projectId),
  )).limit(1);
  if (!version) throw new KnowledgeManagementError(404, "RESOURCE_NOT_FOUND", "公司资料版本不存在");
  return { document, version };
}
