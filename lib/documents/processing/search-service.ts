import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { requireProjectAccess } from "@/lib/auth/authorization";
import type { AuthenticatedPrincipal } from "@/lib/auth/session";
import { getRequestAuditContext } from "@/lib/auth/request-context";
import { getDb } from "@/lib/db/client";
import { writeAuditEvent } from "@/lib/db/repositories/audit-repository";
import { projectDocument } from "@/lib/db/schema";
import type {
  KnowledgeSearchResponse,
  KnowledgeSearchResultDto,
} from "@/types/knowledge-search";
import { validateSourceLocator } from "./source-locator";

const searchRequestSchema = z.object({
  query: z.string().trim().min(2).max(200),
  documentIds: z.array(z.string().min(1).max(200)).max(50).optional().default([]),
  limit: z.number().int().min(1).max(50).optional().default(20),
});

export class KnowledgeSearchError extends Error {
  constructor(
    public readonly status: 400 | 404,
    public readonly code: "INVALID_SEARCH_REQUEST" | "DOCUMENT_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeSearchError";
  }
}

function excerpt(content: string, query: string): string {
  const cleaned = content
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/</g, "‹")
    .replace(/>/g, "›");
  const index = cleaned.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  const start = Math.max(0, index >= 0 ? index - 120 : 0);
  const end = Math.min(cleaned.length, start + 360);
  return `${start > 0 ? "…" : ""}${cleaned.slice(start, end).trim()}${
    end < cleaned.length ? "…" : ""
  }`;
}

type SearchRow = {
  chunk_id: string;
  document_id: string;
  version_id: string;
  display_name: string;
  version_number: number;
  mime_type: string;
  content: string;
  heading_path: unknown;
  source_locator: unknown;
  raw_score: number | string;
};

export async function searchProjectKnowledge(input: {
  principal: AuthenticatedPrincipal;
  projectId: string;
  requestHeaders: Headers;
  body: unknown;
}): Promise<KnowledgeSearchResponse> {
  const started = performance.now();
  const parsed = searchRequestSchema.safeParse(input.body);
  if (!parsed.success) {
    throw new KnowledgeSearchError(
      400,
      "INVALID_SEARCH_REQUEST",
      "搜索条件无效",
    );
  }
  const { query, documentIds, limit } = parsed.data;
  await requireProjectAccess(
    input.principal,
    input.projectId,
    input.requestHeaders,
  );
  if (documentIds.length) {
    const documents = await getDb()
      .select({ id: projectDocument.id })
      .from(projectDocument)
      .where(
        and(
          eq(projectDocument.projectId, input.projectId),
          inArray(projectDocument.id, documentIds),
        ),
      );
    if (documents.length !== new Set(documentIds).size) {
      await writeAuditEvent({
        actorUserId: input.principal.user.id,
        projectId: input.projectId,
        eventType: "knowledge_search_denied",
        entityType: "project",
        entityId: input.projectId,
        result: "denied",
        metadata: {
          reason: "document_filter_not_authorized_or_not_found",
          queryHash: createHash("sha256").update(query).digest("hex"),
          queryLength: query.length,
          documentFilterCount: documentIds.length,
        },
        ...getRequestAuditContext(input.requestHeaders),
      });
      throw new KnowledgeSearchError(
        404,
        "DOCUMENT_NOT_FOUND",
        "资料不存在",
      );
    }
  }
  const documentFilter = documentIds.length
    ? sql`and c.document_id in (${sql.join(
        documentIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;
  const contains = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
  const escapeCharacter = "\\";
  const result = await getDb().transaction(async (tx) => {
    await tx.execute(sql`set local statement_timeout = '3000ms'`);
    return tx.execute<SearchRow>(sql`
      with ranked as (
        select
          c.id as chunk_id,
          c.document_id,
          c.version_id,
          d.display_name,
          v.version_number,
          v.detected_mime_type as mime_type,
          c.content,
          c.heading_path,
          c.source_locator,
          (
            ts_rank_cd(c.search_vector, websearch_to_tsquery('english', ${query})) * 2.0
            + case when lower(c.search_text) like lower(${contains}) escape ${escapeCharacter} then 2.5 else 0 end
            + case when lower(d.display_name) like lower(${contains}) escape ${escapeCharacter} then 1.5 else 0 end
            + case when lower(c.heading_path::text) like lower(${contains}) escape ${escapeCharacter} then 1.25 else 0 end
            + similarity(c.search_text, ${query})
            + similarity(d.display_name, ${query}) * 0.75
          ) as raw_score
        from document_chunks c
        inner join document_ingestion_jobs j on j.id = c.ingestion_job_id
        inner join project_document_versions v
          on v.id = c.version_id
          and v.document_id = c.document_id
          and v.project_id = c.project_id
        inner join project_documents d
          on d.id = c.document_id
          and d.project_id = c.project_id
        where c.project_id = ${input.projectId}
          and c.is_effective = true
          and d.document_status = 'active'
          and v.storage_status = 'stored'
          and v.is_current = true
          and j.status = 'succeeded'
          ${documentFilter}
          and (
            c.search_vector @@ websearch_to_tsquery('english', ${query})
            or lower(c.search_text) like lower(${contains}) escape ${escapeCharacter}
            or lower(d.display_name) like lower(${contains}) escape ${escapeCharacter}
            or similarity(c.search_text, ${query}) >= 0.08
            or similarity(d.display_name, ${query}) >= 0.12
          )
      )
      select *
      from ranked
      order by raw_score desc, document_id asc, version_number desc, chunk_id asc
      limit ${limit}
    `);
  });
  const results: KnowledgeSearchResultDto[] = result.rows.map((row) => {
    const rawScore = Math.max(0, Number(row.raw_score));
    return {
      chunkId: row.chunk_id,
      documentId: row.document_id,
      versionId: row.version_id,
      displayName: row.display_name,
      versionNumber: row.version_number,
      mimeType: row.mime_type,
      excerpt: excerpt(row.content, query),
      headingPath: Array.isArray(row.heading_path)
        ? row.heading_path.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      source: validateSourceLocator(row.source_locator),
      score: Number((rawScore / (rawScore + 1)).toFixed(4)),
    };
  });
  await writeAuditEvent({
    actorUserId: input.principal.user.id,
    projectId: input.projectId,
    eventType: "knowledge_search_executed",
    entityType: "project",
    entityId: input.projectId,
    result: "succeeded",
    metadata: {
      queryHash: createHash("sha256").update(query).digest("hex"),
      queryLength: query.length,
      resultCount: results.length,
      durationMs: Math.round(performance.now() - started),
      documentFilterCount: documentIds.length,
    },
    ...getRequestAuditContext(input.requestHeaders),
  });
  return { query, results, resultCount: results.length };
}
