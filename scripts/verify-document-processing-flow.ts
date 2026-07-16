import { randomUUID } from "node:crypto";
import { closeDatabasePool, getPool } from "../lib/db/client";
import type {
  ProjectDocumentUploadResponse,
  ProjectDocumentVersionDto,
  ProjectDocumentVersionsResponse,
  PublicDocumentIngestionStatus,
} from "../types/documents";
import type { KnowledgeSearchResponse } from "../types/knowledge-search";
import {
  createMarkdownFixture,
  createScannedPdfFixture,
  createSearchableDocxFixture,
  createSearchablePdfFixture,
  createSearchablePptxFixture,
  createSearchableXlsxFixture,
  createTextFixture,
} from "../tests/helpers/file-fixtures";
import {
  assert,
  authenticatedFetch,
  cleanupDocumentVerification,
  documentVerificationEnvironment,
  requiredEnvironment,
  responseJson,
  signIn,
  signOut,
  uploadVerificationDocument,
  type VerificationSession,
} from "./lib/staging-document-verification";

const environment = documentVerificationEnvironment();
const runId = randomUUID();
const displayNamePrefix = "B2 虚构 Staging 文档验收 ";
const managerUserAgent = `projectai-staging-document-manager/0.5/${runId}`;
const viewerUserAgent = `projectai-staging-document-viewer/0.5/${runId}`;
const managerEmail = requiredEnvironment("SEED_MANAGER_A_EMAIL");
const managerPassword = requiredEnvironment("SEED_MANAGER_A_PASSWORD");
const viewerEmail = requiredEnvironment("SEED_VIEWER_A_EMAIL");
const viewerPassword = requiredEnvironment("SEED_VIEWER_A_PASSWORD");

type Uploaded = ProjectDocumentUploadResponse & {
  key: string;
};

let manager: VerificationSession | null = null;
let viewer: VerificationSession | null = null;

function documentPath(documentId: string, suffix = ""): string {
  return `api/projects/${encodeURIComponent(environment.projectAId)}/documents/${encodeURIComponent(documentId)}${suffix}`;
}

async function upload(
  key: string,
  file: File,
  documentId?: string,
): Promise<Uploaded> {
  assert(manager, "Manager Session is unavailable.");
  const response = await uploadVerificationDocument({
    environment,
    session: manager,
    projectId: environment.projectAId,
    file,
    displayName: `${displayNamePrefix}${key} ${runId}`,
    documentId,
  });
  assert(response.status === 201, `${key} upload returned ${response.status}.`);
  return {
    ...(await responseJson<ProjectDocumentUploadResponse>(
      response,
      `${key} upload`,
    )),
    key,
  };
}

async function versions(
  session: VerificationSession,
  documentId: string,
): Promise<ProjectDocumentVersionsResponse> {
  const response = await authenticatedFetch(
    environment,
    session,
    documentPath(documentId, "/versions"),
  );
  assert(response.status === 200, `Version list returned ${response.status}.`);
  return responseJson(response, "Version list");
}

async function waitForIngestion(
  documentId: string,
  versionId: string,
  expected: PublicDocumentIngestionStatus,
  minimumGeneration = 0,
): Promise<ProjectDocumentVersionDto> {
  assert(manager, "Manager Session is unavailable.");
  const deadline = Date.now() + 120_000;
  let current: ProjectDocumentVersionDto | undefined;
  while (Date.now() < deadline) {
    const result = await versions(manager, documentId);
    current = result.versions.find((version) => version.id === versionId);
    if (
      current?.ingestion.status === expected &&
      (current.ingestion.generation ?? 0) >= minimumGeneration
    ) {
      return current;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Ingestion did not reach ${expected}; last status was ${
      current?.ingestion.status ?? "missing"
    }.`,
  );
}

async function search(
  session: VerificationSession,
  query: string,
  documentIds: string[] = [],
  projectId = environment.projectAId,
): Promise<{ response: Response; body: KnowledgeSearchResponse | null }> {
  const response = await authenticatedFetch(
    environment,
    session,
    `api/projects/${encodeURIComponent(projectId)}/knowledge/search`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, documentIds, limit: 20 }),
    },
  );
  return {
    response,
    body:
      response.status === 200
        ? await responseJson<KnowledgeSearchResponse>(
            response,
            "Knowledge search",
          )
        : null,
  };
}

async function mutate(
  session: VerificationSession,
  path: string,
): Promise<Response> {
  return authenticatedFetch(environment, session, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

let verificationError: unknown;
try {
  await cleanupDocumentVerification({
    projectId: environment.projectAId,
    displayNamePrefix,
    userAgents: [managerUserAgent, viewerUserAgent],
    userAgentPrefixes: [
      "projectai-staging-document-manager/0.5/",
      "projectai-staging-document-viewer/0.5/",
    ],
  });
  manager = await signIn({
    environment,
    email: managerEmail,
    password: managerPassword,
    userAgent: managerUserAgent,
  });
  viewer = await signIn({
    environment,
    email: viewerEmail,
    password: viewerPassword,
    userAgent: viewerUserAgent,
  });

  const fixtures = [
    {
      key: "pdf",
      file: createSearchablePdfFixture(
        `B2-${runId}.pdf`,
        `Project Aurora B2 ${runId} launch date October 15`,
      ),
      query: "launch date",
      source: "pdf_page",
    },
    {
      key: "docx",
      file: createSearchableDocxFixture(`B2-${runId}.docx`),
      query: "Timeline",
      source: "docx_section",
    },
    {
      key: "xlsx",
      file: createSearchableXlsxFixture(`B2-${runId}.xlsx`),
      query: "Budget",
      source: "xlsx_range",
    },
    {
      key: "pptx",
      file: createSearchablePptxFixture(`B2-${runId}.pptx`),
      query: "Milestone",
      source: "pptx_slide",
    },
    {
      key: "txt",
      file: createTextFixture(
        `B2-${runId}.txt`,
        `虚构灯塔计划 ${runId} 发布日期 十月十五日`,
      ),
      query: "发布日期",
      source: "text_lines",
    },
    {
      key: "markdown",
      file: createMarkdownFixture(
        `B2-${runId}.md`,
        `Project Aurora approval October 15 ${runId}`,
      ),
      query: "approval",
      source: "markdown_section",
    },
  ] as const;
  const supported = await Promise.all(
    fixtures.map((fixture) => upload(fixture.key, fixture.file)),
  );
  const scanned = await upload(
    "scan",
    createScannedPdfFixture(`B2-scan-${runId}.pdf`),
  );
  const corrupt = await upload(
    "corrupt",
    new File(
      ["%PDF-1.4\nB2 FICTITIOUS CORRUPT PDF\n%%EOF\n"],
      `B2-corrupt-${runId}.pdf`,
      { type: "application/pdf" },
    ),
  );

  const completed = new Map<string, ProjectDocumentVersionDto>();
  for (const item of supported) {
    const version = await waitForIngestion(
      item.document.id,
      item.version.id,
      "succeeded",
    );
    assert(version.ingestion.sectionCount > 0, `${item.key} has no Sections.`);
    assert(version.ingestion.chunkCount > 0, `${item.key} has no Chunks.`);
    completed.set(item.key, version);
  }
  const needsOcr = await waitForIngestion(
    scanned.document.id,
    scanned.version.id,
    "needs_ocr",
  );
  assert(
    needsOcr.ingestion.failureCode === "OCR_REQUIRED",
    "Scanned PDF did not report OCR_REQUIRED.",
  );
  const failed = await waitForIngestion(
    corrupt.document.id,
    corrupt.version.id,
    "failed",
  );
  assert(failed.ingestion.chunkCount === 0, "Failed PDF produced Chunks.");

  for (const fixture of fixtures) {
    const item = supported.find((candidate) => candidate.key === fixture.key)!;
    const result = await search(manager, fixture.query, [item.document.id]);
    assert(result.response.status === 200, `${fixture.key} search failed.`);
    const match = result.body?.results.find(
      (candidate) => candidate.documentId === item.document.id,
    );
    assert(match, `${fixture.key} search returned no result.`);
    assert(
      match.source.type === fixture.source,
      `${fixture.key} source locator is incorrect.`,
    );
    const serialized = JSON.stringify(result.body);
    assert(!/objectKey|bucket|endpoint|lease/i.test(serialized), `${fixture.key} search leaked internal metadata.`);
  }

  const txt = supported.find((item) => item.key === "txt")!;
  const viewerSearch = await search(viewer, "发布日期", [txt.document.id]);
  assert(viewerSearch.response.status === 200, "Viewer could not search.");
  assert((viewerSearch.body?.resultCount ?? 0) > 0, "Viewer search was empty.");
  const fuzzy = await search(
    manager,
    "Octobr",
    [supported.find((item) => item.key === "markdown")!.document.id],
  );
  assert(fuzzy.response.status === 200, "Fuzzy search failed.");
  assert((fuzzy.body?.resultCount ?? 0) > 0, "Fuzzy search returned no result.");

  const pdf = supported.find((item) => item.key === "pdf")!;
  const download = await authenticatedFetch(
    environment,
    viewer,
    documentPath(
      pdf.document.id,
      `/versions/${encodeURIComponent(pdf.version.id)}/download`,
    ),
  );
  assert(download.status === 200, "Viewer could not download a source file.");
  const viewerReindex = await mutate(
    viewer,
    documentPath(
      pdf.document.id,
      `/versions/${encodeURIComponent(pdf.version.id)}/reindex`,
    ),
  );
  assert(viewerReindex.status === 403, "Viewer was allowed to reindex.");
  const crossProject = await search(
    manager,
    "launch date",
    [],
    environment.projectBId,
  );
  assert(crossProject.response.status === 404, "Cross-project search did not return 404.");

  const pdfV2 = await upload(
    "pdf-v2",
    createSearchablePdfFixture(
      `B2-${runId}-v2.pdf`,
      `Project Aurora B2 ${runId} revised launch date November 20`,
    ),
    pdf.document.id,
  );
  const pdfV2Completed = await waitForIngestion(
    pdf.document.id,
    pdfV2.version.id,
    "succeeded",
  );
  assert(pdfV2Completed.versionNumber === 2, "PDF v2 was not version 2.");
  const oldVersion = await search(manager, "October 15", [pdf.document.id]);
  assert(oldVersion.response.status === 200, "Old-version filter search failed.");
  assert(oldVersion.body?.resultCount === 0, "Old current-version index remained searchable.");
  const newVersion = await search(manager, "November 20", [pdf.document.id]);
  assert(newVersion.body?.results[0]?.versionId === pdfV2.version.id, "Current-version search did not return PDF v2.");

  const docx = supported.find((item) => item.key === "docx")!;
  const archive = await mutate(
    manager,
    documentPath(docx.document.id, "/archive"),
  );
  assert(archive.status === 200, "Archive failed.");
  const archivedSearch = await search(manager, "Timeline", [docx.document.id]);
  assert(archivedSearch.body?.resultCount === 0, "Archived document remained searchable.");
  const restore = await mutate(
    manager,
    documentPath(docx.document.id, "/restore"),
  );
  assert(restore.status === 200, "Restore failed.");
  const restoredSearch = await search(manager, "Timeline", [docx.document.id]);
  assert((restoredSearch.body?.resultCount ?? 0) > 0, "Restored document was not searchable.");

  const xlsx = supported.find((item) => item.key === "xlsx")!;
  const oldGeneration = completed.get("xlsx")!.ingestion.generation ?? 0;
  const reindex = await mutate(
    manager,
    documentPath(
      xlsx.document.id,
      `/versions/${encodeURIComponent(xlsx.version.id)}/reindex`,
    ),
  );
  assert(reindex.status === 202, `Reindex returned ${reindex.status}.`);
  const reindexed = await waitForIngestion(
    xlsx.document.id,
    xlsx.version.id,
    "succeeded",
    oldGeneration + 1,
  );
  assert(
    (reindexed.ingestion.generation ?? 0) > oldGeneration,
    "Reindex did not create a new generation.",
  );
  const reindexedSearch = await search(manager, "Budget", [xlsx.document.id]);
  assert((reindexedSearch.body?.resultCount ?? 0) > 0, "Reindexed XLSX was not searchable.");

  const pool = getPool();
  const indexed = await pool.query<{
    section_count: string;
    chunk_count: string;
    invalid_lease_count: string;
  }>(
    `select
       (select count(*) from document_sections where document_id = any($1::text[]))::text as section_count,
       (select count(*) from document_chunks where document_id = any($1::text[]))::text as chunk_count,
       (select count(*) from document_ingestion_jobs
        where document_id = any($1::text[])
          and status in ('succeeded', 'failed', 'needs_ocr')
          and (leased_by is not null or lease_expires_at is not null))::text as invalid_lease_count`,
    [supported.map((item) => item.document.id)],
  );
  assert(Number(indexed.rows[0]?.section_count ?? 0) >= 6, "Staging Section verification failed.");
  assert(Number(indexed.rows[0]?.chunk_count ?? 0) >= 6, "Staging Chunk verification failed.");
  assert(Number(indexed.rows[0]?.invalid_lease_count ?? 0) === 0, "Terminal Jobs retained a Worker lease.");
  const searchAudits = await pool.query<{ metadata: Record<string, unknown> }>(
    `select metadata
     from audit_events
     where user_agent = any($1::text[])
       and event_type = 'knowledge_search_executed'`,
    [[managerUserAgent, viewerUserAgent]],
  );
  assert(
    (searchAudits.rowCount ?? 0) > 0,
    "Knowledge search audit was not written.",
  );
  for (const audit of searchAudits.rows) {
    assert(!("query" in audit.metadata), "Audit stored the full search query.");
    assert(
      /^[0-9a-f]{64}$/.test(String(audit.metadata.queryHash)),
      "Audit query hash is invalid.",
    );
  }

  await signOut(environment, manager);
  await signOut(environment, viewer);
  manager = null;
  viewer = null;
  const cleanup = await cleanupDocumentVerification({
    projectId: environment.projectAId,
    displayNamePrefix,
    userAgents: [managerUserAgent, viewerUserAgent],
    userAgentPrefixes: [
      "projectai-staging-document-manager/0.5/",
      "projectai-staging-document-viewer/0.5/",
    ],
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      supportedFormats: 6,
      succeeded: 6,
      failed: 1,
      needsOcr: 1,
      lexicalSearch: true,
      chineseSearch: true,
      englishSearch: true,
      fuzzySearch: true,
      sourceLocators: true,
      viewer: true,
      crossProject404: true,
      currentVersion: true,
      archiveFilter: true,
      reindexGeneration: true,
      cleanup,
    })}\n`,
  );
} catch (error) {
  verificationError = error;
  throw error;
} finally {
  try {
    await signOut(environment, manager);
    await signOut(environment, viewer);
  } catch (cleanupError) {
    if (!verificationError) throw cleanupError;
  }
  try {
    await cleanupDocumentVerification({
      projectId: environment.projectAId,
      displayNamePrefix,
      userAgents: [managerUserAgent, viewerUserAgent],
      userAgentPrefixes: [
        "projectai-staging-document-manager/0.5/",
        "projectai-staging-document-viewer/0.5/",
      ],
    });
  } catch (cleanupError) {
    if (!verificationError) throw cleanupError;
  } finally {
    await closeDatabasePool();
  }
}
