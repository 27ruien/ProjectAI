import { and, eq, inArray } from "drizzle-orm";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { projectDocument, projectDocumentVersion } from "@/lib/db/schema";
import { listAuthorizedProjects } from "@/lib/db/repositories/project-repository";
import { listAuthorizedDocumentScope } from "@/lib/knowledge/authorization";
import type { AssistantContextReference } from "@/types/project-assistant";
import { ProjectAssistantError } from "./errors";

export type AssistantContextOption = {
  type: "project" | "document";
  id: string;
  label: string;
  projectId?: string;
  sourceType?: "project" | "company";
};

export type ResolvedAssistantContext = {
  references: AssistantContextReference[];
  projectIds: string[];
  documentIds: string[];
};

async function authorizedScope(principal: AuthenticatedPrincipal) {
  const projects = await listAuthorizedProjects(principal.user.id, principal.user.productRole);
  const scopes = await Promise.all(projects.map(async (item) => ({
    project: item,
    documents: await listAuthorizedDocumentScope({ principal, projectId: item.id, permission: "view" }),
  })));
  return { projects, scopes };
}

/**
 * The complete, already-authorized document scope for a general assistant
 * conversation.  This is intentionally resolved on the server each time a
 * conversation is read so a permission change also hides old citations.
 */
export async function listAllAuthorizedDocumentScope(principal: AuthenticatedPrincipal) {
  const { scopes } = await authorizedScope(principal);
  return scopes.flatMap((item) => item.documents);
}

/**
 * Returns only already-authorized identifiers and labels.  The browser never
 * receives object keys, chunks, embeddings, or an ACL-bypassing selector.
 */
export async function listAssistantContextOptions(principal: AuthenticatedPrincipal): Promise<{
  projects: AssistantContextOption[];
  documents: AssistantContextOption[];
}> {
  const { projects, scopes } = await authorizedScope(principal);
  const documentScopes = new Map<string, { sourceType: "project" | "company"; projectId: string }>();
  for (const item of scopes) {
    for (const document of item.documents) {
      if (!documentScopes.has(document.documentId)) {
        documentScopes.set(document.documentId, {
          sourceType: document.sourceScope === "organization" ? "company" : "project",
          projectId: document.sourceProjectId,
        });
      }
    }
  }
  const ids = [...documentScopes.keys()];
  const rows = ids.length
    ? await getDb()
      .select({ id: projectDocument.id, displayName: projectDocument.displayName })
      .from(projectDocument)
      .innerJoin(projectDocumentVersion, and(
        eq(projectDocumentVersion.documentId, projectDocument.id),
        eq(projectDocumentVersion.projectId, projectDocument.projectId),
        eq(projectDocumentVersion.isCurrent, true),
      ))
      .where(and(inArray(projectDocument.id, ids), eq(projectDocument.status, "active"), eq(projectDocumentVersion.storageStatus, "stored")))
    : [];
  return {
    projects: projects.map((item) => ({ type: "project", id: item.id, label: item.name })),
    documents: rows.map((item) => ({
      type: "document",
      id: item.id,
      label: item.displayName,
      projectId: documentScopes.get(item.id)!.projectId,
      sourceType: documentScopes.get(item.id)!.sourceType,
    })),
  };
}

/** Validate and canonicalize client references against current server ACL. */
export async function resolveAssistantContextReferences(input: {
  principal: AuthenticatedPrincipal;
  references: AssistantContextReference[];
}): Promise<ResolvedAssistantContext> {
  const unique = new Map<string, AssistantContextReference>();
  for (const reference of input.references) {
    const key = reference.type === "project" ? `p:${reference.projectId}` : `d:${reference.documentId}`;
    if (unique.has(key)) throw new ProjectAssistantError(400, "AI_INVALID_REQUEST", "资料引用存在重复项");
    unique.set(key, reference);
  }
  const options = await listAssistantContextOptions(input.principal);
  const projects = new Map(options.projects.map((item) => [item.id, item]));
  const documents = new Map(options.documents.map((item) => [item.id, item]));
  const references: AssistantContextReference[] = [];
  for (const reference of unique.values()) {
    if (reference.type === "project") {
      const project = projects.get(reference.projectId);
      if (!project) throw new ProjectAssistantError(404, "AI_SOURCE_NOT_FOUND", "引用的项目不存在或无权访问");
      references.push({ type: "project", projectId: project.id, label: project.label });
      continue;
    }
    const document = documents.get(reference.documentId);
    if (!document || !document.sourceType) throw new ProjectAssistantError(404, "AI_SOURCE_NOT_FOUND", "引用的资料不存在或无权访问");
    references.push({
      type: "document",
      documentId: document.id,
      ...(reference.documentVersionId ? { documentVersionId: reference.documentVersionId } : {}),
      sourceType: document.sourceType,
      label: document.label,
    });
  }
  const explicitlyReferencedProjects = references.filter((item): item is Extract<AssistantContextReference, { type: "project" }> => item.type === "project").map((item) => item.projectId);
  const projectIds = explicitlyReferencedProjects.length
    ? explicitlyReferencedProjects
    : options.projects.map((item) => item.id);
  return {
    references,
    projectIds: [...new Set(projectIds)],
    documentIds: references.filter((item): item is Extract<AssistantContextReference, { type: "document" }> => item.type === "document").map((item) => item.documentId),
  };
}
